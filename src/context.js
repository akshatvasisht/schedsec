import { CONFIG } from './config.js';
import { SchedSecError } from './errors.js';

/**
 * Helper class for interacting with the Context (Key-Value) database in Notion.
 */
export class ContextManager {
  /**
   * Initializes the context manager with Notion client and DB ID.
   * @param {NotionClient} notionClient Shared Notion API client.
   * @param {string} contextDbId Target database ID for KV storage.
   */
  constructor(notionClient, contextDbId) {
    this.notion = notionClient;
    this.dbId = contextDbId;
    this.cache = new Map();
    this.pageIds = new Map();
    this.pendingWrites = new Map();
  }

  /**
   * Retrieves a JSON-parsed value by key from the Context DB.
   * @param {string} key Unique configuration key.
   * @returns {Promise<any>} Parsed JSON value or null if not found.
   */
  async get(key) {
    if (this.cache.has(key)) return this.cache.get(key);

    const props = CONFIG.PROPERTIES.CONTEXT;
    const response = await this.notion.queryDatabase(this.dbId, {
      property: props.KEY,
      title: { equals: key }
    });

    if (response.results.length === 0) return null;

    const page = response.results[0];
    this.pageIds.set(key, page.id);
    const richText = page.properties[props.VALUE]?.rich_text || [];
    const valueStr = richText.map(rt => rt.plain_text || '').join('');

    try {
      const value = valueStr ? JSON.parse(valueStr) : null;
      this.cache.set(key, value);
      return value;
    } catch (e) {
      throw new SchedSecError(`Failed to parse context value for key ${key}: ${e.message}`, 'CONTEXT_PARSE_ERROR');
    }
  }

  /**
   * Updates or creates a key-value pair in Notion.
   * @param {string} key Unique configuration key.
   * @param {any} value Value to store (will be JSON stringified).
   * @param {string} [description=''] Optional human-readable description.
   */
  async set(key, value, description = '') {
    this.pendingWrites.set(key, {
      value,
      description: description || null
    });
    this.cache.set(key, value);
  }

  /**
   * Clears the local cache.
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Flushes pending context writes to Notion in a single batch cycle.
   * Reduces per-write query overhead by loading existing pages once.
   */
  async flush() {
    if (this.pendingWrites.size === 0) return;

    const props = CONFIG.PROPERTIES.CONTEXT;
    const keys = Array.from(this.pendingWrites.keys());
    const unknownKeys = keys.filter(key => !this.pageIds.has(key));

    if (unknownKeys.length > 0) {
      const filter = unknownKeys.length === 1
        ? { property: props.KEY, title: { equals: unknownKeys[0] } }
        : { or: unknownKeys.map(k => ({ property: props.KEY, title: { equals: k } })) };
      const response = await this.notion.queryDatabase(this.dbId, filter);
      for (const page of response.results) {
        const keyName = page.properties[props.KEY]?.title?.[0]?.plain_text;
        if (keyName && !this.pageIds.has(keyName)) {
          this.pageIds.set(keyName, page.id);
        }
      }
    }

    for (const key of keys) {
      const { value, description } = this.pendingWrites.get(key);
      const valueStr = JSON.stringify(value);
      if (valueStr.length > 2000) {
        console.warn(
          `Context value for key "${key}" exceeds 2000 chars; storing as chunked rich_text (${valueStr.length} chars)`
        );
      }

      const properties = {
        [props.KEY]: { title: [{ text: { content: key } }] },
        [props.VALUE]: { rich_text: this._toRichTextChunks(valueStr) }
      };

      // Preserve existing description unless explicitly provided.
      if (description) {
        properties[props.DESCRIPTION] = { rich_text: this._toRichTextChunks(description) };
      }

      const pageId = this.pageIds.get(key);
      if (pageId) {
        await this.notion.updatePage(pageId, properties);
      } else {
        const created = await this.notion.createPage(this.dbId, properties);
        this.pageIds.set(key, created.id);
      }
    }

    this.pendingWrites.clear();
  }

  /**
   * Splits text into Notion rich_text objects (2000 char max per segment).
   * @param {string} text Text content to split into rich_text chunks.
   * @returns {Array<object>} Array of Notion rich_text text objects.
   */
  _toRichTextChunks(text) {
    if (!text || text.length === 0) return [{ text: { content: '' } }];

    const chunks = [];
    for (let i = 0; i < text.length; i += 2000) {
      chunks.push({ text: { content: text.slice(i, i + 2000) } });
    }
    return chunks;
  }
}

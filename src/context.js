import { CONFIG } from './config.js';

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
    const valueStr = page.properties[props.VALUE].rich_text[0]?.plain_text;

    try {
      const value = valueStr ? JSON.parse(valueStr) : null;
      this.cache.set(key, value);
      return value;
    } catch (e) {
      throw new Error(`Failed to parse context value for key ${key}: ${e.message}`);
    }
  }

  /**
   * Updates or creates a key-value pair in Notion.
   * @param {string} key Unique configuration key.
   * @param {any} value Value to store (will be JSON stringified).
   * @param {string} [description=''] Optional human-readable description.
   */
  async set(key, value, description = '') {
    const props = CONFIG.PROPERTIES.CONTEXT;
    const existing = await this.notion.queryDatabase(this.dbId, {
      property: props.KEY,
      title: { equals: key }
    });

    const valueStr = JSON.stringify(value);
    const properties = {
      [props.KEY]: { title: [{ text: { content: key } }] },
      [props.VALUE]: { rich_text: [{ text: { content: valueStr } }] },
      [props.DESCRIPTION]: { rich_text: [{ text: { content: description } }] }
    };

    if (existing.results.length > 0) {
      await this.notion.updatePage(existing.results[0].id, properties);
    } else {
      await this.notion.createPage(this.dbId, properties);
    }

    this.cache.set(key, value);
  }

  /**
   * Clears the local cache.
   */
  clearCache() {
    this.cache.clear();
  }
}

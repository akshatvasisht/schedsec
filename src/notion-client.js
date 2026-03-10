import { Client } from '@notionhq/client';
import { NotionAPIError } from './errors.js';

/**
 * Enhanced Notion client with rate limiting and retry logic.
 */
export class NotionClient {
  /**
   * Creates a rate-limited wrapper around the official Notion client.
   * @param {string} apiKey Internal integration token used for Notion API calls.
   */
  constructor(apiKey) {
    this.client = new Client({ auth: apiKey });
    this.requestQueue = [];
    this.isProcessing = false;
    this.delayMs = 350; // Roughly 3 requests per second
  }

  /**
   * Internal queue processor to respect rate limits.
   */
  async _processQueue() {
    if (this.isProcessing || this.requestQueue.length === 0) return;
    this.isProcessing = true;

    while (this.requestQueue.length > 0) {
      const { fn, resolve, reject, retries } = this.requestQueue.shift();
      try {
        const result = await fn();
        resolve(result);
      } catch (error) {
        if (error.code === 'rate_limited' && retries > 0) {
          // Parse Retry-After header if available, else use exponential backoff
          const retryAfter = error.headers?.['retry-after'];
          const wait = retryAfter
            ? parseInt(retryAfter) * 1000
            : Math.pow(2, 4 - retries) * 1000;
          console.warn(`Rate limited, waiting ${wait}ms (retry ${4 - retries}/3)...`);
          await new Promise(r => { setTimeout(r, wait); });
          this.requestQueue.unshift({ fn, resolve, reject, retries: retries - 1 });
        } else {
          reject(new NotionAPIError(error.status || 0, {
            message: error.message,
            code: error.code
          }));
        }
      }
      await new Promise(r => { setTimeout(r, this.delayMs); });
    }

    this.isProcessing = false;
  }

  /**
   * Generic request wrapper.
   * Queues a Notion API operation behind the shared in-request rate limiter.
   * @param {Function} fn Deferred Notion API call.
   * @param {number} [retries=3] Remaining retry attempts for rate-limited responses.
   * @returns {Promise<unknown>} Result of the wrapped Notion API call.
   */
  async request(fn, retries = 3) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ fn, resolve, reject, retries });
      this._processQueue();
    });
  }

  /**
   * Queries a Notion database and transparently paginates all results.
   * @param {string} databaseId Target database ID.
   * @param {object} [filter] Optional Notion database filter object.
   * @param {Array<object>} [sorts] Optional Notion sort definitions.
   * @returns {Promise<{results: Array<object>}>} Aggregated query results across all pages.
   */
  async queryDatabase(databaseId, filter = undefined, sorts = undefined) {
    let allResults = [];
    let cursor;

    do {
      const response = await this.request(() => this.client.databases.query({
        database_id: databaseId,
        filter,
        sorts,
        start_cursor: cursor
      }));

      allResults = allResults.concat(response.results || []);
      cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);

    return { results: allResults };
  }

  /**
   * Updates properties on an existing Notion page.
   * @param {string} pageId Target page ID.
   * @param {object} properties Notion properties payload.
   * @returns {Promise<object>} Updated Notion page object.
   */
  async updatePage(pageId, properties) {
    return this.request(() => this.client.pages.update({
      page_id: pageId,
      properties
    }));
  }

  /**
   * Creates a page inside a Notion database.
   * @param {string} databaseId Parent database ID.
   * @param {object} properties Notion properties payload.
   * @returns {Promise<object>} Created Notion page object.
   */
  async createPage(databaseId, properties) {
    return this.request(() => this.client.pages.create({
      parent: { database_id: databaseId },
      properties
    }));
  }

  /**
   * Retrieves a single Notion page by ID.
   * @param {string} pageId Target page ID.
   * @returns {Promise<object>} Notion page object.
   */
  async getPage(pageId) {
    return this.request(() => this.client.pages.retrieve({ page_id: pageId }));
  }

  /**
   * Archives a Notion page.
   * @param {string} pageId Target page ID.
   * @returns {Promise<object>} Archived Notion page object.
   */
  async archivePage(pageId) {
    return this.request(() => this.client.pages.update({
      page_id: pageId,
      archived: true
    }));
  }

  /**
   * Batch update multiple pages sequentially through the queue.
   * Prevents parallel update storms that trigger rate limits.
   * @param {Array<{pageId: string, properties: object}>} updates Array of page updates.
   * @returns {Promise<Array>} Results of each update.
   */
  async batchUpdate(updates) {
    const results = [];
    for (const { pageId, properties } of updates) {
      const result = await this.updatePage(pageId, properties);
      results.push(result);
    }
    return results;
  }
}

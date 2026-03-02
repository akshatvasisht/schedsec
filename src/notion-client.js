import { Client } from '@notionhq/client';
import { NotionAPIError } from './errors.js';

/**
 * Enhanced Notion client with rate limiting and retry logic.
 */
export class NotionClient {
  /**
   *
   * @param apiKey The parameter.
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
          const wait = Math.pow(2, 4 - retries) * 1000;
          console.warn(`Rate limited, waiting ${wait}ms...`);
          await new Promise(r => { setTimeout(r, wait); });
          this.requestQueue.unshift({ fn, resolve, reject, retries: retries - 1 });
        } else {
          reject(new NotionAPIError(error.message, error));
        }
      }
      await new Promise(r => { setTimeout(r, this.delayMs); });
    }

    this.isProcessing = false;
  }

  /**
   * Generic request wrapper.
   * @param fn The parameter.
   * @param retries The parameter.
   */
  async request(fn, retries = 3) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ fn, resolve, reject, retries });
      this._processQueue();
    });
  }

  /**
   * Query a database.
   * @param databaseId The parameter.
   * @param filter The parameter.
   * @param sorts The parameter.
   * @returns {any} The return value.
   */
  async queryDatabase(databaseId, filter = undefined, sorts = undefined) {
    return this.request(() => this.client.databases.query({
      database_id: databaseId,
      filter,
      sorts
    }));
  }

  /**
   * Update a page.
   * @param pageId The parameter.
   * @param properties The parameter.
   * @returns {any} The return value.
   */
  async updatePage(pageId, properties) {
    return this.request(() => this.client.pages.update({
      page_id: pageId,
      properties
    }));
  }

  /**
   * Create a page in a database.
   * @param databaseId The parameter.
   * @param properties The parameter.
   * @returns {any} The return value.
   */
  async createPage(databaseId, properties) {
    return this.request(() => this.client.pages.create({
      parent: { database_id: databaseId },
      properties
    }));
  }

  /**
   * Retrieve a page.
   * @param pageId The parameter.
   * @returns {any} The return value.
   */
  async getPage(pageId) {
    return this.request(() => this.client.pages.retrieve({ page_id: pageId }));
  }

  /**
   * Archive a page.
   * @param pageId The parameter.
   * @returns {any} The return value.
   */
  async archivePage(pageId) {
    return this.request(() => this.client.pages.update({
      page_id: pageId,
      archived: true
    }));
  }
}

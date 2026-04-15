/**
 * Idempotency logic using Cloudflare KV.
 * Prevents double-processing of cron jobs or manual requests.
 */
export class IdempotencyManager {
  /**
   * Creates an IdempotencyManager backed by the given KV binding.
   * @param {object} kv Cloudflare KV binding used to read and write idempotency records.
   */
  constructor(kv) {
    this.kv = kv;
  }

  /**
   * Generates a key for a specific run.
   * @param {string} date Date string (YYYY-MM-DD) identifying the scheduled run.
   * @param {string} type Worker type identifier (e.g. "preview" or "final").
   * @returns {string} KV key in the form "idempotent_<type>_<date>".
   */
  generateKey(date, type) {
    return `idempotent_${type}_${date}`;
  }

  /**
   * Checks if a run is already processed or in progress.
   * @param {string} key KV key previously returned by generateKey.
   * @returns {Promise<string|null>} "processing", "completed", or null if no record exists.
   */
  async check(key) {
    return await this.kv.get(key);
  }

  /**
   * Marks a run as processing.
   * TTL: 1 hour (locks for 1 hour max)
   * @param {string} key KV key previously returned by generateKey.
   */
  async lock(key) {
    await this.kv.put(key, 'processing', { expirationTtl: 3600 });
  }

  /**
   * Marks a run as completed.
   * TTL: 24 hours (prevents double-run within same day)
   * @param {string} key KV key previously returned by generateKey.
   */
  async complete(key) {
    await this.kv.put(key, 'completed', { expirationTtl: 86400 });
  }

  /**
   * Releases a lock (e.g. on failure).
   * @param {string} key KV key previously returned by generateKey.
   */
  async release(key) {
    await this.kv.delete(key);
  }
}

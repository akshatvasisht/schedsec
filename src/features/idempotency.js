/**
 * Idempotency logic using Cloudflare KV.
 * Prevents double-processing of cron jobs or manual requests.
 */
export class IdempotencyManager {
  /**
   *
   * @param kv The parameter.
   */
  constructor(kv) {
    this.kv = kv;
  }

  /**
   * Generates a key for a specific run.
   * @param date The parameter.
   * @param type The parameter.
   * @returns {any} The return value.
   */
  generateKey(date, type) {
    return `idempotent_${type}_${date}`;
  }

  /**
   * Checks if a run is already processed or in progress.
   * @param key The parameter.
   * @returns {any} The return value.
   */
  async check(key) {
    return await this.kv.get(key);
  }

  /**
   * Marks a run as processing.
   * TTL: 1 hour (locks for 1 hour max)
   * @param key The parameter.
   */
  async lock(key) {
    await this.kv.put(key, 'processing', { expirationTtl: 3600 });
  }

  /**
   * Marks a run as completed.
   * TTL: 24 hours (prevents double-run within same day)
   * @param key The parameter.
   */
  async complete(key) {
    await this.kv.put(key, 'completed', { expirationTtl: 86400 });
  }

  /**
   * Releases a lock (e.g. on failure).
   * @param key The parameter.
   */
  async release(key) {
    await this.kv.delete(key);
  }
}

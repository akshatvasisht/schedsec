import { CONFIG } from '../config.js';

/**
 * Logic for prefetching future schedules.
 */
export class PrefetchManager {
  /**
   * Calculates dates for prefetching.
   * Preview (T+1) and Prefetch (T+2)
   * @param now The parameter.
   * @returns {any} The return value.
   */
  static getDates(now = new Date()) {
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);

    const dayAfter = new Date(now);
    dayAfter.setDate(now.getDate() + 2);

    return {
      tomorrow: tomorrow.toISOString().split('T')[0],
      dayAfter: dayAfter.toISOString().split('T')[0]
    };
  }

  /**
   * Flags for scheduling status in the database.
   * @param dateStr The parameter.
   * @param targetDateStr The parameter.
   * @returns {any} The return value.
   */
  static getStatus(dateStr, targetDateStr) {
    if (dateStr === targetDateStr) return CONFIG.STATUS.SCHEDULE.SCHEDULED;
    const diff = (new Date(targetDateStr) - new Date(dateStr)) / (1000 * 60 * 60 * 24);
    if (diff === 1) return CONFIG.STATUS.SCHEDULE.PREVIEW;
    if (diff === 2) return CONFIG.STATUS.SCHEDULE.PREFETCH;
    return 'Upcoming';
  }
}

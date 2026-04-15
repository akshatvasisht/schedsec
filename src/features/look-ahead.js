import { CONFIG } from '../config.js';

/**
 * Logic for prefetching future schedules.
 */
export class PrefetchManager {
  /**
   * Calculates dates for prefetching.
   * Preview (T+1) and Prefetch (T+2)
   * @param {Date} now Reference date from which tomorrow and the day-after are derived; defaults to the current date.
   * @returns {{tomorrow: string, dayAfter: string}} ISO date strings (YYYY-MM-DD) for T+1 and T+2.
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
   * @param {string} dateStr The run date in YYYY-MM-DD format (today's date when the worker executes).
   * @param {string} targetDateStr The schedule date being generated, used to compute day offset from dateStr.
   * @returns {string} CONFIG status constant: "Scheduled" for same-day, "Preview" for T+1, "Prefetch" for T+2, or "Upcoming" otherwise.
   */
  static getStatus(dateStr, targetDateStr) {
    if (dateStr === targetDateStr) return CONFIG.STATUS.SCHEDULE.SCHEDULED;
    const diff = (new Date(targetDateStr) - new Date(dateStr)) / (1000 * 60 * 60 * 24);
    if (Math.round(diff) === 1) return CONFIG.STATUS.SCHEDULE.PREVIEW;
    if (Math.round(diff) === 2) return CONFIG.STATUS.SCHEDULE.PREFETCH;
    return 'Upcoming';
  }
}

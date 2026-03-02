import { CONFIG } from '../config.js';

/**
 * Logic for storing schedule snapshots and performing rollbacks.
 */
export class UndoManager {
  /**
   *
   * @param kv The parameter.
   * @param notionClient The parameter.
   */
  constructor(kv, notionClient) {
    this.kv = kv;
    this.notion = notionClient;
  }

  /**
   * Stores current schedule as a snapshot before regeneration.
   * @param date The parameter.
   * @param schedule The parameter.
   */
  async createSnapshot(date, schedule) {
    const key = `undo_${date}`;
    await this.kv.put(key, JSON.stringify(schedule), {
      expirationTtl: 604800 // 7 days retention
    });
  }

  /**
   * Restores a schedule from a snapshot.
   * @param date The parameter.
   * @param _scheduleDbId The parameter.
   * @returns {any} The return value.
   */
  async rollback(date, _scheduleDbId) {
    const key = `undo_${date}`;
    const snapshot = await this.kv.get(key);

    if (!snapshot) return { success: false, error: 'NO_SNAPSHOT' };

    const previousData = JSON.parse(snapshot);

    // Delete current schedule (marks as Archived/Deleted)
    // Implementation details: Ideally we'd batch delete, but Notion is page-based.

    // Re-create entries from snapshot
    // This logic usually lives in the worker calling UndoManager.

    return { success: true, data: previousData };
  }

  /**
   * Checks if a snapshot exists for the given date.
   * @param {string} date - Date string (YYYY-MM-DD).
   * @returns {Promise<boolean>}
   */
  async hasSnapshot(date) {
    const key = `undo_${date}`;
    const val = await this.kv.get(key);
    return !!val;
  }

  /**
   * Restores schedule from KV snapshot: archives current entries, recreates from snapshot.
   * @param {string} date - Date string (YYYY-MM-DD).
   * @param {string} scheduleDbId - Schedule database ID.
   * @returns {Promise<Object>} { success, restored, error? }
   */
  async restoreSnapshot(date, scheduleDbId) {
    const key = `undo_${date}`;
    const snapshot = await this.kv.get(key);
    if (!snapshot) return { success: false, error: 'NO_SNAPSHOT' };

    const previousData = JSON.parse(snapshot);
    const P = CONFIG.PROPERTIES;

    const current = await this.notion.queryDatabase(scheduleDbId, {
      property: P.SCHEDULE.DATE,
      date: { equals: date }
    });

    for (const page of current.results) {
      await this.notion.archivePage(page.id);
    }

    let restored = 0;
    for (const entry of previousData) {
      if (!entry.task_id) continue;
      await this.notion.createPage(scheduleDbId, {
        [P.SCHEDULE.DATE]: { date: { start: date } },
        [P.SCHEDULE.TASK]: { relation: [{ id: entry.task_id }] },
        [P.SCHEDULE.AI_START]: { rich_text: [{ text: { content: entry.start || '09:00' } }] },
        [P.SCHEDULE.AI_DURATION]: { number: entry.duration || 60 },
        [P.SCHEDULE.STATUS]: { select: { name: CONFIG.STATUS.SCHEDULE.SCHEDULED } }
      });
      restored++;
    }

    return { success: true, restored };
  }
}

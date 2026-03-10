import { CONFIG } from '../config.js';

/**
 * Logic for storing schedule snapshots and performing rollbacks.
 */
export class UndoManager {
  /**
   * Creates an undo manager backed by KV snapshots and the shared Notion client.
   * @param {object} kv Cloudflare KV binding used for snapshot storage.
   * @param {object} notionClient Shared Notion API client wrapper.
   */
  constructor(kv, notionClient) {
    this.kv = kv;
    this.notion = notionClient;
  }

  /**
   * Stores current schedule as a snapshot before regeneration.
   * @param {string} date Date string (YYYY-MM-DD).
   * @param {Array<object>} schedule Current schedule entries to persist in KV.
   * @returns {Promise<void>} Resolves when the snapshot is written.
   */
  async createSnapshot(date, schedule) {
    const key = `undo_${date}`;
    await this.kv.put(key, JSON.stringify(schedule), {
      expirationTtl: 604800 // 7 days retention
    });
  }

  /**
   * Restores a schedule from a snapshot.
   * Legacy helper that returns snapshot contents without mutating Notion.
   * @param {string} date Date string (YYYY-MM-DD).
   * @param {string} _scheduleDbId Unused legacy parameter preserved for compatibility.
   * @returns {Promise<object>} Snapshot payload or `NO_SNAPSHOT`.
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
   * @returns {Promise<boolean>} True when a snapshot exists for the date.
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
   * @returns {Promise<object>} Restore outcome with restored count or error code.
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

import { SchedSecError } from '../errors.js';

/**
 * Optimistic locking for Schedule DB writes to prevent data loss.
 */
export class OptimisticLock {
  /**
   * Checks for user edits (version increments) before allowing AI to overwrite.
   * Returns a pageId if the entry exists, along with the next version number.
   * @param {NotionClient} notion Shared Notion API client.
   * @param {string} scheduleDbId Target Schedule database ID.
   * @param {Object} config Global configuration object (CONFIG).
   * @param {string} date YYYY-MM-DD date string.
   * @param {string} taskId Unique task ID (NOT page ID).
   * @param {number} [expectedVersion=0] The version the caller expects to overwrite.
   * @returns {Promise<{pageId: string|null, newVersion: number}>} Lock metadata.
   */
  static async acquireWrite(notion, scheduleDbId, config, date, taskId, expectedVersion = 0) {
    const props = config.PROPERTIES.SCHEDULE;

    const existing = await notion.queryDatabase(scheduleDbId, {
      and: [
        { property: props.DATE, date: { equals: date } },
        { property: props.TASK, relation: { contains: taskId } }
      ]
    });

    if (existing.results.length > 0) {
      const page = existing.results[0];
      const currentVersion = page.properties[props.VERSION]?.number || 0;

      if (currentVersion > expectedVersion) {
        throw new SchedSecError(
          `Optimistic lock conflict: expected v${expectedVersion}, found v${currentVersion} -- user edited while generating`,
          'OPTIMISTIC_LOCK_CONFLICT'
        );
      }

      return { pageId: page.id, newVersion: currentVersion + 1 };
    }

    return { pageId: null, newVersion: 1 };
  }

  /**
   * Batch lock acquisition to avoid one Notion query per task.
   * @param {NotionClient} notion Shared Notion API client.
   * @param {string} scheduleDbId Target Schedule database ID.
   * @param {object} config Global configuration object (CONFIG).
   * @param {string} date YYYY-MM-DD date string.
   * @param {Array<string>} taskIds Task relation IDs to look up.
   * @param {number} [expectedVersion=0] Version the caller expects to overwrite.
   * @returns {Promise<Map<string, {pageId: string|null, newVersion: number, conflict: boolean}>>} Per-task lock metadata map.
   */
  static async acquireWriteBatch(notion, scheduleDbId, config, date, taskIds, expectedVersion = 0) {
    const props = config.PROPERTIES.SCHEDULE;
    const existing = await notion.queryDatabase(scheduleDbId, {
      property: props.DATE,
      date: { equals: date }
    });

    const taskSet = new Set(taskIds);
    const result = new Map();

    for (const page of existing.results) {
      const relation = page.properties[props.TASK]?.relation || [];
      const taskId = relation[0]?.id;
      if (!taskId || !taskSet.has(taskId)) continue;

      const currentVersion = page.properties[props.VERSION]?.number || 0;
      result.set(taskId, {
        pageId: page.id,
        newVersion: currentVersion + 1,
        conflict: currentVersion > expectedVersion
      });
    }

    for (const taskId of taskIds) {
      if (!result.has(taskId)) {
        result.set(taskId, {
          pageId: null,
          newVersion: 1,
          conflict: false
        });
      }
    }

    return result;
  }
}

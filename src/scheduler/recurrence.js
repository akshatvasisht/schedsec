import { CONFIG } from '../config.js';

/**
 * Logic for generating task instances from recurrence patterns.
 * Supports: Daily, Weekday, Weekend, named days, Day N (Nth of month),
 *           Biweekly-{Day}, Every-{N}-Days, {Nth}-{Day} (Nth weekday of month).
 */
export class RecurrenceManager {
  /**
   * Checks if a recurring task should have an instance for the target date.
   * @param task The parameter.
   * @param targetDateStr The parameter.
   * @returns {boolean} True if an instance should be generated.
   */
  static shouldGenerate(task, targetDateStr) {
    if (!task.recurrence || task.status !== CONFIG.STATUS.TASK.ACTIVE) return false;

    const lastGen = task.last_generated || '1970-01-01';
    if (lastGen >= targetDateStr) return false;

    // Parse explicitly to avoid `new Date('YYYY-MM-DD')` timezone shifting to previous day
    const [yr, mo, da] = targetDateStr.split('-').map(Number);
    const dateUTC = new Date(Date.UTC(yr, mo - 1, da));
    const dayName = dateUTC.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    const dayOfMonth = da;
    const recurrence = task.recurrence;

    // Simple pattern matching — original patterns
    if (recurrence === 'Daily') return true;
    if (recurrence === dayName) return true; // "Monday", "Friday", etc.
    if (recurrence === 'Weekend' && (dayName === 'Saturday' || dayName === 'Sunday')) return true;
    if (recurrence === 'Weekday' && dayName !== 'Saturday' && dayName !== 'Sunday') return true;
    if (recurrence.startsWith('Day ') && parseInt(recurrence.split(' ')[1]) === dayOfMonth) return true;

    // Biweekly: "Biweekly-Monday" — every other week on that day
    if (recurrence.startsWith('Biweekly-')) {
      const targetDay = recurrence.split('-')[1];
      if (dayName !== targetDay) return false;
      // Use epoch-based week parity: weeks since Unix epoch, check if even/odd
      const epochMs = dateUTC.getTime();
      const weekNum = Math.floor(epochMs / (7 * 24 * 60 * 60 * 1000));
      return weekNum % 2 === 0; // fires on even weeks
    }

    // Every-N-Days: "Every-3-Days" — fires every N days since last_generated
    const everyNMatch = recurrence.match(/^Every-(\d+)-Days$/);
    if (everyNMatch) {
      const n = parseInt(everyNMatch[1]);
      if (n <= 0) return false;
      const [lyr, lmo, lda] = lastGen.split('-').map(Number);
      const lastDate = new Date(Date.UTC(lyr, lmo - 1, lda));
      const diffDays = Math.round((dateUTC.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
      return diffDays >= n;
    }

    // Nth weekday of month: "2nd-Tuesday", "1st-Monday", "3rd-Friday"
    const nthWeekdayMatch = recurrence.match(/^(\d+)(?:st|nd|rd|th)-(\w+)$/);
    if (nthWeekdayMatch) {
      const nthOccurrence = parseInt(nthWeekdayMatch[1]);
      const targetDayName = nthWeekdayMatch[2];
      if (dayName !== targetDayName) return false;
      // Count which occurrence of this weekday in the current month
      const occurrence = Math.ceil(dayOfMonth / 7);
      return occurrence === nthOccurrence;
    }

    return false;
  }

  /**
   * Creates a task instance for a recurring pattern.
   * @param parentTask The parameter.
   * @param targetDateStr The parameter.
   * @returns {object} Generated task instance.
   */
  static createInstance(parentTask, targetDateStr) {
    return {
      ...parentTask,
      id: `rec_${parentTask.id}_${targetDateStr}`,
      parent_id: parentTask.id,
      deadline: targetDateStr,
      status: CONFIG.STATUS.TASK.ACTIVE,
      is_instance: true
    };
  }
}

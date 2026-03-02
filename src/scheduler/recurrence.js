import { CONFIG } from '../config.js';

/**
 * Logic for generating task instances from recurrence patterns.
 */
export class RecurrenceManager {
  /**
   * Checks if a recurring task should have an instance for the target date.
   * @param task The parameter.
   * @param targetDateStr The parameter.
   * @returns {any} The return value.
   */
  static shouldGenerate(task, targetDateStr) {
    if (!task.recurrence || task.status !== CONFIG.STATUS.TASK.ACTIVE) return false;

    const lastGen = task.last_generated || '1970-01-01';
    if (lastGen >= targetDateStr) return false;

    const date = new Date(targetDateStr);
    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
    const dayOfMonth = date.getDate();

    // Simple pattern matching
    if (task.recurrence === 'Daily') return true;
    if (task.recurrence === dayName) return true; // "Monday", "Friday", etc.
    if (task.recurrence === 'Weekend' && (dayName === 'Saturday' || dayName === 'Sunday')) return true;
    if (task.recurrence === 'Weekday' && dayName !== 'Saturday' && dayName !== 'Sunday') return true;
    if (task.recurrence.startsWith('Day ') && parseInt(task.recurrence.split(' ')[1]) === dayOfMonth) return true;

    return false;
  }

  /**
   * Creates a task instance for a recurring pattern.
   * @param parentTask The parameter.
   * @param targetDateStr The parameter.
   * @returns {any} The return value.
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

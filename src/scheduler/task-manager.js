import { CONFIG } from '../config.js';

/**
 * Categorizes tasks and handles fixed appointment logic.
 */
export class TaskManager {
  /**
   * Filters out fixed appointments that must be respected first.
   * @param {Array<object>} tasks Full task list from the Inputs DB.
   * @returns {Array<object>} Only tasks with type `FIXED_APPOINTMENT`.
   */
  static getFixedAppointments(tasks) {
    return tasks.filter(t => t.type === 'FIXED_APPOINTMENT');
  }

  /**
   * Filters regular tasks that AI needs to schedule.
   * @param {Array<object>} tasks Full task list from the Inputs DB.
   * @returns {Array<object>} Tasks with type `TASK` or `TIME_BLOCK` that are passed to the AI.
   */
  static getSchedulableTasks(tasks) {
    return tasks.filter(t => t.type === 'TASK' || t.type === 'TIME_BLOCK');
  }

  /**
   * Determines if a task consumes the user's focus budget.
   * @param {object} task Task with optional `type` and `background` fields.
   * @returns {boolean} True when the task is not a TIME_BLOCK and is not marked as background.
   */
  static isFocusConsuming(task) {
    return task.type !== 'TIME_BLOCK' && !task.background;
  }

  /**
   * Normalizes energy levels and durations using defaults.
   * @param {object} task Task with potentially missing `duration`, `energy`, or `priority` fields.
   * @returns {object} Task copy with all three fields set to CONFIG defaults when absent.
   */
  static normalizeTask(task) {
    return {
      ...task,
      duration: task.duration ?? CONFIG.DEFAULTS.TASK_DURATION,
      energy: task.energy ?? CONFIG.DEFAULTS.ENERGY_LEVEL,
      priority: task.priority ?? CONFIG.DEFAULTS.PRIORITY
    };
  }
}

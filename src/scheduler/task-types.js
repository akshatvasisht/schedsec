import { CONFIG } from '../config.js';

/**
 * Categorizes tasks and handles fixed appointment logic.
 */
export class TaskManager {
  /**
   * Filters out fixed appointments that must be respected first.
   * @param tasks The parameter.
   * @returns {any} The return value.
   */
  static getFixedAppointments(tasks) {
    return tasks.filter(t => t.type === 'FIXED_APPOINTMENT');
  }

  /**
   * Filters regular tasks that AI needs to schedule.
   * @param tasks The parameter.
   * @returns {any} The return value.
   */
  static getSchedulableTasks(tasks) {
    return tasks.filter(t => t.type === 'TASK' || t.type === 'TIME_BLOCK');
  }

  /**
   * Determines if a task consumes the user's focus budget.
   * @param task The parameter.
   * @returns {any} The return value.
   */
  static isFocusConsuming(task) {
    return task.type !== 'TIME_BLOCK' && !task.background;
  }

  /**
   * Normalizes energy levels and durations using defaults.
   * @param task The parameter.
   * @returns {any} The return value.
   */
  static normalizeTask(task) {
    return {
      ...task,
      duration: task.duration || CONFIG.DEFAULTS.TASK_DURATION,
      energy: task.energy || CONFIG.DEFAULTS.ENERGY_LEVEL,
      priority: task.priority || CONFIG.DEFAULTS.PRIORITY
    };
  }
}

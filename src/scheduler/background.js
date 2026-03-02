/**
 * Logic for handling background tasks that don't block time slots.
 */
export class BackgroundTaskManager {
  /**
   * Checks if a task is marked as a background task.
   * @param task The parameter.
   * @returns {any} The return value.
   */
  static isBackground(task) {
    return task.background === true || task.type === 'TIME_BLOCK';
  }

  /**
   * Filters out background tasks from a schedule to find "focus" blocks.
   * @param schedule The parameter.
   * @returns {any} The return value.
   */
  static getFocusTasks(schedule) {
    return schedule.filter(item => !item.background);
  }

  /**
   * Validates background task density to prevent over-scheduling.
   * @param tasks The parameter.
   * @returns {any} The return value.
   */
  static validateDensity(tasks) {
    const backgroundCount = tasks.filter(t => t.background).length;
    if (backgroundCount > 5) {
      return {
        warning: true,
        message: `${backgroundCount} background tasks detected. Ensure these truly don't require simultaneous attention.`
      };
    }
    return { warning: false };
  }
}

import { CONFIG } from '../config.js';

/**
 * Handles splitting large tasks across multiple days with energy decay.
 */
export class MultiDayScheduler {
  /**
   * Splits a task that spans multiple days.
   * Uses a 40/35/25 energy decay strategy.
   * @param task The parameter.
   * @returns {any} The return value.
   */
  static splitTask(task) {
    if (!task.estimated_days || task.estimated_days <= 1) {
      return [task];
    }

    const segments = [];
    const totalDuration = task.duration || CONFIG.DEFAULTS.TASK_DURATION;
    const days = task.estimated_days;

    // Decay weights for 3 days (can be extended)
    const weights = [0.40, 0.35, 0.25];

    for (let i = 0; i < days; i++) {
      const weight = weights[i] || (0.25 / (days - 2)); // Redistribute remaining if > 3 days
      const segmentDuration = Math.round(totalDuration * weight);

      segments.push({
        ...task,
        id: `${task.id}_day_${i + 1}`,
        duration: segmentDuration,
        day_number: i + 1,
        notes: `${task.notes || ''} (Day ${i + 1}/${days} of ${task.name})`.trim()
      });
    }

    return segments;
  }

  /**
   * Consolidates multi-day task data from history to track progress.
   * @param originalTaskId The parameter.
   * @param history The parameter.
   * @returns {any} The return value.
   */
  static calculateProgress(originalTaskId, history) {
    const segments = history.filter(s => s.task_id.startsWith(originalTaskId));
    const completed = segments.filter(s => s.status === CONFIG.STATUS.TASK.DONE);
    return {
      total: segments.length,
      completed: completed.length,
      percent: Math.round((completed.length / segments.length) * 100)
    };
  }
}

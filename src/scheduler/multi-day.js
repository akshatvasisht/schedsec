import { CONFIG } from '../config.js';

/**
 * Handles splitting large tasks across multiple days with energy decay.
 */
export class MultiDayScheduler {
  /**
   * Splits a task that spans multiple days.
   * Uses a 40/35/25 energy decay strategy.
   * @param {object} task Task with `estimated_days` and `duration` fields; returned as-is when estimated_days <= 1.
   * @returns {Array<object>} One segment per day, each with a unique `id`, proportional `duration`, and `day_number`.
   */
  static splitTask(task) {
    if (!task.estimated_days || task.estimated_days <= 1) {
      return [task];
    }

    const segments = [];
    const totalDuration = task.duration || CONFIG.DEFAULTS.TASK_DURATION;
    const days = task.estimated_days;

    // Decay weights: front-loaded 40/35/25 for 3 days; extra days share remaining equally.
    // Normalize so weights always sum to 1.0 (handles 2-day and 4+-day tasks correctly).
    const baseWeights = CONFIG.MULTI_DAY_WEIGHTS;
    const rawWeights = Array.from({ length: days }, (_, i) => baseWeights[i] ?? baseWeights[baseWeights.length - 1]);
    const weightSum = rawWeights.reduce((s, w) => s + w, 0);

    for (let i = 0; i < days; i++) {
      const segmentDuration = Math.round(totalDuration * rawWeights[i] / weightSum);

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
   * @param {string} originalTaskId Base task ID whose segments are identified by the `{id}_day_N` naming pattern.
   * @param {Array<object>} history Schedule history entries to search for matching segments.
   * @returns {{ total: number, completed: number, percent: number }} Segment counts and completion percentage.
   */
  static calculateProgress(originalTaskId, history) {
    const segments = history.filter(s => s.task_id.startsWith(originalTaskId));
    if (segments.length === 0) return { total: 0, completed: 0, percent: 0 };
    const completed = segments.filter(s => s.status === CONFIG.STATUS.TASK.DONE);
    return {
      total: segments.length,
      completed: completed.length,
      percent: Math.round((completed.length / segments.length) * 100)
    };
  }
}

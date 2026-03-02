import { addMinutes } from '../utils/time.js';
import { CONFIG } from '../config.js';
import { DependencyResolver } from './dependencies.js';
import { UrgencyCalculator } from './urgency.js';

/**
 * Deterministic fallback scheduler for when AI fails or budget is exceeded.
 */
export class FallbackScheduler {
  /**
   * Generates a sequential schedule based on priority and dependencies.
   * @param tasks The parameter.
   * @param workDayStart The parameter.
   * @returns {any} The return value.
   */
  static generate(tasks, workDayStart = CONFIG.DEFAULTS.WORK_DAY_START) {
    // Resolve dependencies
    let sorted;
    try {
      sorted = DependencyResolver.topologicalSort(tasks);
    } catch {
      // If cycle, fallback to urgency sort
      sorted = UrgencyCalculator.sortByUrgency(tasks);
    }

    // Sequential placement
    let currentTime = workDayStart;
    const schedule = [];

    for (const task of sorted) {
      const duration = task.duration || CONFIG.DEFAULTS.TASK_DURATION;

      schedule.push({
        task_id: task.id,
        start: currentTime,
        duration: duration,
        day_number: 1,
        inferred_fields: {},
        conflicts: [],
        notes: 'Sequential fallback schedule (AI unavailable)'
      });

      // Add task duration + buffer
      const nextTime = addMinutes(currentTime, duration + CONFIG.DEFAULTS.BUFFER_TIME);
      currentTime = nextTime;
    }

    return schedule;
  }
}

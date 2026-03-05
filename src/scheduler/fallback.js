import { addMinutes } from '../utils/time.js';
import { CONFIG } from '../config.js';
import { DependencyResolver } from './dependencies.js';
import { UrgencyCalculator } from './urgency.js';
import { BufferLearning } from '../features/buffer-learning.js';

/**
 * Deterministic fallback scheduler for when AI fails or budget is exceeded.
 */
export class FallbackScheduler {
  /**
   * Generates a sequential schedule based on priority and dependencies.
   * @param tasks The parameter.
   * @param workDayStart The parameter.
   * @param learnedBuffers Optional learned buffer data from BufferLearning.
   * @returns {any} The return value.
   */
  static generate(tasks, workDayStart = CONFIG.DEFAULTS.WORK_DAY_START, learnedBuffers = {}) {
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
    let prevEnergy = null;

    for (const task of sorted) {
      const duration = task.duration || CONFIG.DEFAULTS.TASK_DURATION;
      const energy = task.energy || 'Unknown';

      schedule.push({
        task_id: task.id,
        start: currentTime,
        duration: duration,
        day_number: 1,
        inferred_fields: {},
        conflicts: [],
        notes: 'Sequential fallback schedule (AI unavailable)'
      });

      // Use learned buffer if available, else default
      const buffer = prevEnergy
        ? BufferLearning.getBuffer(prevEnergy, energy, learnedBuffers)
        : CONFIG.DEFAULTS.BUFFER_TIME;

      const nextTime = addMinutes(currentTime, duration + buffer);
      currentTime = nextTime;
      prevEnergy = energy;
    }

    return schedule;
  }
}

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
   * @param {Array<object>} tasks Tasks to schedule, sorted by dependency then urgency.
   * @param {string} workDayStart Work day start time (HH:MM).
   * @param {object} learnedBuffers Optional learned buffer data from BufferLearning keyed by energy transition.
   * @param {string} workDayEnd End of work day (HH:MM). Tasks that would overflow are dropped.
   * @returns {Array<object>} Sequentially placed schedule entries with start time, duration, and day_number.
   */
  static generate(tasks, workDayStart = CONFIG.DEFAULTS.WORK_DAY_START, learnedBuffers = {}, workDayEnd = CONFIG.DEFAULTS.WORK_DAY_END) {
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

    // Convert end time to minutes for comparison
    const endMinutes = parseInt(workDayEnd.split(':')[0]) * 60 + parseInt(workDayEnd.split(':')[1]);

    for (const task of sorted) {
      const duration = task.duration || CONFIG.DEFAULTS.TASK_DURATION;
      const energy = task.energy || 'Unknown';

      const currentMinutes = parseInt(currentTime.split(':')[0]) * 60 + parseInt(currentTime.split(':')[1]);
      if (currentMinutes + duration > endMinutes) break;

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

import { diffMinutes } from '../utils/time.js';
import { CONFIG } from '../config.js';

/**
 * Advanced schedule optimization constraints.
 */
export class OptimizationEngine {
  /**
   * Checks if total task duration fits in available work hours.
   * @param {Array<object>} tasks Tasks with optional `duration` fields in minutes.
   * @param {string} workStart Work day start time (HH:MM).
   * @param {string} workEnd Work day end time (HH:MM).
   * @returns {{ feasible: boolean, message?: string, overage?: number }} Feasibility result with overage in minutes when infeasible.
   */
  static validateFeasibility(tasks, workStart = CONFIG.DEFAULTS.WORK_DAY_START, workEnd = CONFIG.DEFAULTS.WORK_DAY_END) {
    const totalDuration = tasks.reduce((sum, t) => sum + (t.duration || CONFIG.DEFAULTS.TASK_DURATION), 0);
    const availableTime = diffMinutes(workStart, workEnd);

    if (totalDuration > availableTime) {
      return {
        feasible: false,
        message: `Tasks need ${totalDuration}min but only ${availableTime}min available`,
        overage: totalDuration - availableTime
      };
    }
    return { feasible: true };
  }

  /**
   * Enforces energy budgets (e.g. max 4h deep work).
   * @param {Array<object>} tasks Tasks with `energy` and `duration` fields; energy defaults to Moderate.
   * @returns {Array<object>} Tasks with energy levels downgraded when their budget would be exceeded.
   */
  static enforceEnergyBudgets(tasks) {
    const energyUsed = { Deep: 0, Moderate: 0, Light: 0 };
    const result = [];

    for (const task of tasks) {
      const level = task.energy || 'Moderate';
      const duration = task.duration || CONFIG.DEFAULTS.TASK_DURATION;

      if (energyUsed[level] + duration > CONFIG.ENERGY_BUDGETS[level]) {
        // Downgrade energy level if budget exceeded; count against the new level's budget
        const newLevel = level === 'Deep' ? 'Moderate' : 'Light';
        energyUsed[newLevel] = (energyUsed[newLevel] || 0) + duration;
        result.push({
          ...task,
          energy: newLevel,
          notes: `${task.notes || ''} [Energy downgraded due to budget]`.trim()
        });
      } else {
        energyUsed[level] += duration;
        result.push(task);
      }
    }

    return result;
  }

  /**
   * Dynamically compresses buffers if schedule is tight.
   * @param {Array<object>} tasks Tasks with optional `duration` fields in minutes.
   * @param {number} availableTime Total available minutes in the work day.
   * @param {number} defaultBuffer Preferred buffer time in minutes between tasks.
   * @returns {number} Buffer in minutes to use between tasks, clamped to MIN_BUFFER.
   */
  static compressBuffers(tasks, availableTime, defaultBuffer = CONFIG.DEFAULTS.BUFFER_TIME) {
    const taskTime = tasks.reduce((sum, t) => sum + (t.duration || CONFIG.DEFAULTS.TASK_DURATION), 0);
    const neededWithFullBuffers = taskTime + (tasks.length - 1) * defaultBuffer;

    if (neededWithFullBuffers <= availableTime) return defaultBuffer;

    const availableForBuffers = availableTime - taskTime;
    if (tasks.length <= 1) return CONFIG.DEFAULTS.MIN_BUFFER;
    const compressedBuffer = Math.max(
      CONFIG.DEFAULTS.MIN_BUFFER,
      Math.floor(availableForBuffers / (tasks.length - 1))
    );

    return compressedBuffer;
  }
}

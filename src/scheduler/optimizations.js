import { diffMinutes } from '../utils/time.js';
import { CONFIG } from '../config.js';

/**
 * Advanced schedule optimization constraints.
 */
export class OptimizationEngine {
  /**
   * Checks if total task duration fits in available work hours.
   * @param tasks The parameter.
   * @param workStart The parameter.
   * @param workEnd The parameter.
   * @returns {any} The return value.
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
   * @param tasks The parameter.
   * @returns {any} The return value.
   */
  static enforceEnergyBudgets(tasks) {
    const energyUsed = { Deep: 0, Moderate: 0, Light: 0 };
    const result = [];

    for (const task of tasks) {
      const level = task.energy || 'Moderate';
      const duration = task.duration || CONFIG.DEFAULTS.TASK_DURATION;

      if (energyUsed[level] + duration > CONFIG.ENERGY_BUDGETS[level]) {
        // Downgrade energy level if budget exceeded
        result.push({
          ...task,
          energy: level === 'Deep' ? 'Moderate' : 'Light',
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
   * @param tasks The parameter.
   * @param availableTime The parameter.
   * @param defaultBuffer The parameter.
   * @returns {any} The return value.
   */
  static compressBuffers(tasks, availableTime, defaultBuffer = CONFIG.DEFAULTS.BUFFER_TIME) {
    const taskTime = tasks.reduce((sum, t) => sum + (t.duration || CONFIG.DEFAULTS.TASK_DURATION), 0);
    const neededWithFullBuffers = taskTime + (tasks.length - 1) * defaultBuffer;

    if (neededWithFullBuffers <= availableTime) return defaultBuffer;

    const availableForBuffers = availableTime - taskTime;
    const compressedBuffer = Math.max(
      CONFIG.DEFAULTS.MIN_BUFFER,
      Math.floor(availableForBuffers / (tasks.length - 1))
    );

    return compressedBuffer;
  }
}

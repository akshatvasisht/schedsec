import { CONFIG } from '../config.js';

/**
 * Smart Buffer Learning
 * Learns optimal buffer times between task type transitions from user edits.
 */
export class BufferLearning {
  /**
   * Extracts transition pairs from a schedule and computes average buffer durations.
   * @param {Array} schedule - Array of schedule entries sorted by start time
   * @returns {object} Map of "typeA→typeB" → { avgBuffer, samples }
   */
  static extractTransitionBuffers(schedule) {
    const transitions = {};

    for (let i = 0; i < schedule.length - 1; i++) {
      const current = schedule[i];
      const next = schedule[i + 1];

      if (!current.final_start || !next.final_start) continue;

      const currentEnd = this.addMinutes(current.final_start, current.final_duration || current.ai_duration);
      const gap = this.diffMinutes(next.final_start, currentEnd);

      if (gap >= 0 && gap <= 60) {
        const key = `${current.energy || 'Unknown'}→${next.energy || 'Unknown'}`;
        if (!transitions[key]) transitions[key] = { totalBuffer: 0, samples: 0 };
        transitions[key].totalBuffer += gap;
        transitions[key].samples++;
      }
    }

    const buffers = {};
    for (const [key, data] of Object.entries(transitions)) {
      buffers[key] = {
        avgBuffer: Math.round(data.totalBuffer / data.samples),
        samples: data.samples
      };
    }
    return buffers;
  }

  /**
   * Returns the learned buffer for a specific transition, or default.
   * @param {string} fromEnergy Energy level of the ending task (e.g. "Deep", "Moderate", "Light").
   * @param {string} toEnergy Energy level of the starting task used to look up the transition key.
   * @param {object} learnedBuffers Map of "fromEnergy→toEnergy" → { avgBuffer, samples } produced by extractTransitionBuffers.
   * @returns {number} Learned average buffer in minutes if at least 3 samples exist, otherwise a hard-coded default.
   */
  static getBuffer(fromEnergy, toEnergy, learnedBuffers) {
    const key = `${fromEnergy}→${toEnergy}`;
    if (learnedBuffers?.[key]?.samples >= 3) {
      return learnedBuffers[key].avgBuffer;
    }
    // Known defaults
    if (fromEnergy === 'Deep' && toEnergy === 'Deep') return 20;
    if (fromEnergy === 'Deep') return 15;
    if (fromEnergy === 'Moderate' && toEnergy === 'Light') return 5;
    return CONFIG.DEFAULTS.BUFFER_TIME;
  }

  /**
   * Adds minutes to a HH:MM string.
   * @param {string} timeStr Start time in "HH:MM" 24-hour format.
   * @param {number} minutes Number of minutes to add, which may wrap past midnight.
   * @returns {string} Resulting time in "HH:MM" format.
   */
  static addMinutes(timeStr, minutes) {
    const [h, m] = timeStr.split(':').map(Number);
    const total = h * 60 + m + minutes;
    return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  /**
   * Calculates the difference in minutes between two HH:MM strings.
   * @param {string} endStr End time in "HH:MM" 24-hour format.
   * @param {string} startStr Start time in "HH:MM" 24-hour format to subtract from endStr.
   * @returns {number} Signed difference in minutes (positive when end is after start).
   */
  static diffMinutes(endStr, startStr) {
    const [eh, em] = endStr.split(':').map(Number);
    const [sh, sm] = startStr.split(':').map(Number);
    return (eh * 60 + em) - (sh * 60 + sm);
  }
}

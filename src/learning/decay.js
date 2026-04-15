import { CONFIG } from '../config.js';

/**
 * Logic for decaying confidence of unused or old rules/patterns.
 */
export class ConfidenceDecay {
  /**
   * Decays confidence based on months of inactivity.
   * @param {object} pattern Pattern object with confidence and last_reinforced fields.
   * @param {Date} now Reference date used to calculate months elapsed since last reinforcement.
   * @returns {object} Updated pattern with decayed confidence and is_stale flag set.
   */
  static decayPattern(pattern, now = new Date()) {
    const lastReinforced = new Date(pattern.last_reinforced);
    const monthsInactive = Math.floor((now - lastReinforced) / (1000 * 60 * 60 * 24 * 30));

    if (monthsInactive > 0) {
      const decayFactor = Math.pow(CONFIG.LEARNING.CONFIDENCE_DECAY, monthsInactive);
      const newConfidence = pattern.confidence * decayFactor;

      return {
        ...pattern,
        confidence: parseFloat(newConfidence.toFixed(2)),
        is_stale: newConfidence < CONFIG.LEARNING.MIN_CONFIDENCE
      };
    }

    return { ...pattern, is_stale: false };
  }

  /**
   * Decays all patterns in a collection.
   * @param {object} patterns Map of pattern keys to pattern objects, as returned by context storage.
   * @param {Date} now Reference date passed through to decayPattern for each entry.
   * @returns {object} New map with the same keys but each pattern's confidence decayed.
   */
  static decayAll(patterns, now = new Date()) {
    const result = {};
    for (const [key, pattern] of Object.entries(patterns)) {
      result[key] = this.decayPattern(pattern, now);
    }
    return result;
  }
}

import { CONFIG } from '../config.js';

/**
 * Logic for decaying confidence of unused or old rules/patterns.
 */
export class ConfidenceDecay {
  /**
   * Decays confidence based on months of inactivity.
   * @param pattern The parameter.
   * @param now The parameter.
   * @returns {any} The return value.
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
   * @param patterns The parameter.
   * @param now The parameter.
   * @returns {any} The return value.
   */
  static decayAll(patterns, now = new Date()) {
    const result = {};
    for (const [key, pattern] of Object.entries(patterns)) {
      result[key] = this.decayPattern(pattern, now);
    }
    return result;
  }
}

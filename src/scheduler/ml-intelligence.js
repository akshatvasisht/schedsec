import { CONFIG } from '../config.js';

/**
 * ML-inspired intelligence logic for SchedSec.
 * Implements Bayesian updates, EMA, Multi-armed Bandit, and Anomaly Detection.
 */
export class MLIntelligence {
  /**
   * Bayesian Duration Update: blends prior estimate with new observation.
   * (prior * confidence + actual) / (confidence + 1)
   * @param prior The parameter.
   * @param confidence The parameter.
   * @param actual The parameter.
   * @returns {any} The return value.
   */
  static updateBayesianDuration(prior, confidence = 0.5, actual) {
    const newEstimate = (prior * confidence + actual) / (confidence + 1);
    const newConfidence = Math.min(0.95, confidence + 0.05);
    return {
      estimate: Math.round(newEstimate),
      confidence: newConfidence
    };
  }

  /**
   * Exponential Moving Average (EMA) Update.
   * alpha * newValue + (1 - alpha) * oldValue
   * @param oldValue The parameter.
   * @param newValue The parameter.
   * @param alpha The parameter.
   * @returns {any} The return value.
   */
  static updateEMA(oldValue, newValue, alpha = CONFIG.LEARNING.EMA_ALPHA) {
    if (typeof oldValue !== 'number') return newValue;
    return (alpha * newValue) + ((1 - alpha) * oldValue);
  }

  /**
   * Multi-Armed Bandit (Upper Confidence Bound) for slot optimization.
   * score = average_reward + exploration_term
   * @param rewards The parameter.
   * @param tries The parameter.
   * @param totalTries The parameter.
   * @returns {any} The return value.
   */
  static calculateUCB(rewards, tries, totalTries) {
    if (tries === 0) return Infinity; // Explore new slots first
    const avgReward = rewards / tries;
    const exploration = Math.sqrt(2 * Math.log(totalTries) / tries);
    return avgReward + exploration;
  }

  /**
   * Anomaly Detection using Z-scores.
   * z = (x - mean) / stddev
   * @param value The parameter.
   * @param mean The parameter.
   * @param stddev The parameter.
   * @returns {any} The return value.
   */
  static calculateZScore(value, mean, stddev) {
    if (stddev === 0) return 0;
    return (value - mean) / stddev;
  }

  /**
   * Analyzes a schedule for quality anomalies.
   * @param metrics The parameter.
   * @param baseline The parameter.
   * @returns {any} The return value.
   */
  static detectAnomalies(metrics, baseline) {
    const anomalies = [];
    const fields = ['edit_rate', 'completion_rate', 'conflict_count'];

    for (const field of fields) {
      if (baseline[field]) {
        const z = this.calculateZScore(metrics[field], baseline[field].mean, baseline[field].stddev);
        if (Math.abs(z) > 2) {
          anomalies.push({
            metric: field,
            z_score: z.toFixed(2),
            severity: Math.abs(z) > 3 ? 'CRITICAL' : 'WARNING'
          });
        }
      }
    }

    return anomalies;
  }
}

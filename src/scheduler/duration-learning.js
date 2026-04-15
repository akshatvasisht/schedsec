import { CONFIG } from '../config.js';

/**
 * ML-inspired intelligence logic for SchedSec.
 * Implements Bayesian updates, EMA, Multi-armed Bandit, and Anomaly Detection.
 */
export class MLIntelligence {
  /**
   * Bayesian Duration Update: blends prior estimate with new observation.
   * (prior * confidence + actual) / (confidence + 1)
   * @param {number} prior Previous duration estimate in minutes.
   * @param {number} confidence Confidence weight for the prior (higher = prior more trusted).
   * @param {number} actual Observed actual duration in minutes.
   * @returns {{ estimate: number, confidence: number }} Updated estimate and incremented confidence capped at 0.95.
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
   * @param {number} oldValue Current running average to decay.
   * @param {number} newValue New observation to incorporate.
   * @param {number} alpha Smoothing factor (0–1); higher values give more weight to recent observations.
   * @returns {number} Updated EMA value.
   */
  static updateEMA(oldValue, newValue, alpha = CONFIG.LEARNING.EMA_ALPHA) {
    if (typeof oldValue !== 'number') return newValue;
    return (alpha * newValue) + ((1 - alpha) * oldValue);
  }

  /**
   * Multi-Armed Bandit (Upper Confidence Bound) for slot optimization.
   * score = average_reward + exploration_term
   * @param {number} rewards Cumulative reward sum for this slot.
   * @param {number} tries Number of times this slot has been tried.
   * @param {number} totalTries Total tries across all slots.
   * @returns {number} UCB score; returns Infinity for untried slots to force exploration.
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
   * @param {number} value Observed metric value.
   * @param {number} mean Historical mean for this metric.
   * @param {number} stddev Historical standard deviation for this metric.
   * @returns {number} Z-score; returns 0 when stddev is zero to avoid division by zero.
   */
  static calculateZScore(value, mean, stddev) {
    if (stddev === 0) return 0;
    return (value - mean) / stddev;
  }

  /**
   * Analyzes a schedule for quality anomalies.
   * @param {object} metrics Current schedule metrics with `edit_rate`, `completion_rate`, and `conflict_count`.
   * @param {object} baseline Historical baseline with per-metric `mean` and `stddev` values.
   * @returns {Array<{metric: string, z_score: string, severity: string}>} List of metrics whose z-score exceeds 2.
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

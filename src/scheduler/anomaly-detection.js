/**
 * Detects anomalous schedule quality using z-score analysis.
 */
export class AnomalyDetector {
  /**
   * Compares current schedule metrics against historical baselines.
   * Flags metrics that deviate by more than 2 standard deviations.
   * @param schedule The parameter.
   * @param historicalStats The parameter.
   * @returns {any} The return value.
   */
  static detectAnomalousSchedule(schedule, historicalStats) {
    const metrics = {
      edit_rate: AnomalyDetector.calculateEditRate(schedule),
      completion_rate: AnomalyDetector.calculateCompletionRate(schedule),
      conflict_count: schedule.conflicts ? schedule.conflicts.length : 0
    };

    const baseline = {
      edit_rate: historicalStats.avg_edit_rate || 0,
      completion_rate: historicalStats.avg_completion_rate || 1,
      conflict_count: historicalStats.avg_conflicts || 0
    };

    const stddev = {
      edit_rate: historicalStats.stddev_edit_rate || 0.15,
      completion_rate: historicalStats.stddev_completion_rate || 0.15,
      conflict_count: historicalStats.stddev_conflicts || 1
    };

    const zScores = {};
    for (const metric of Object.keys(metrics)) {
      const sd = stddev[metric] || 1;
      zScores[metric] = sd > 0
        ? (metrics[metric] - baseline[metric]) / sd
        : 0;
    }

    const anomalies = Object.entries(zScores)
      .filter(([, z]) => Math.abs(z) > 2)
      .map(([metric, z]) => ({
        metric,
        z_score: parseFloat(z.toFixed(2)),
        current: metrics[metric],
        typical: baseline[metric],
        severity: Math.abs(z) > 3 ? 'CRITICAL' : 'WARNING'
      }));

    if (anomalies.length > 0) {
      return {
        is_anomalous: true,
        anomalies,
        message: `Schedule quality anomaly: ${anomalies.map(a => a.metric).join(', ')} deviated from baseline.`,
        suggested_actions: [
          'Review task complexity for today',
          'Check if learned rules are conflicting',
          'Consider reducing task count'
        ]
      };
    }

    return { is_anomalous: false, anomalies: [] };
  }

  /**
   * Calculates the edit rate (user edits / total entries).
   * @param schedule The parameter.
   * @returns {any} The return value.
   */
  static calculateEditRate(schedule) {
    const entries = schedule.entries || [];
    if (entries.length === 0) return 0;

    const edited = entries.filter(e =>
      e.final_start !== e.ai_start || e.final_duration !== e.ai_duration
    ).length;

    return edited / entries.length;
  }

  /**
   * Calculates the completion rate (done / total).
   * @param schedule The parameter.
   * @returns {any} The return value.
   */
  static calculateCompletionRate(schedule) {
    const entries = schedule.entries || [];
    if (entries.length === 0) return 1;

    const completed = entries.filter(e =>
      e.status === 'Done' || e.status === 'Completed'
    ).length;

    return completed / entries.length;
  }
}

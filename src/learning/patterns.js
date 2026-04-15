
/**
 * Logic for extracting long-term historical patterns from archived data.
 * Implements seasonal trends and duration ratio analysis.
 */
export class PatternAnalyzer {
  /**
   * Extracts trends from a collection of historical schedule entries.
   * @param {Array<object>} schedules Archived schedule entries, each with task_name, date, final_start, final_duration, ai_duration, and energy fields.
   * @returns {object} Aggregated patterns with time_prefs, duration_ratios, and seasonal keys.
   */
  static extractPatterns(schedules) {
    const patterns = {
      timePreferences: {},
      durationRatios: {},
      seasonalTrends: {}
    };

    for (const entry of schedules) {
      const taskName = entry.task_name;
      const month = new Date(entry.date).getMonth();
      const season = Math.floor((month + 1) / 3) % 4; // 0=Winter, 1=Spring, 2=Summer, 3=Autumn

      // Time Preferences
      if (entry.final_start) {
        const hour = parseInt(entry.final_start.split(':')[0]);
        if (!patterns.timePreferences[taskName]) patterns.timePreferences[taskName] = [];
        patterns.timePreferences[taskName].push(hour);
      }

      // Duration Ratios (Actual / AI)
      if (entry.final_duration && entry.ai_duration) {
        const ratio = entry.final_duration / entry.ai_duration;
        const key = entry.energy || 'Moderate';
        if (!patterns.durationRatios[key]) patterns.durationRatios[key] = [];
        patterns.durationRatios[key].push(ratio);
      }

      // Seasonal Trends
      if (!patterns.seasonalTrends[season]) patterns.seasonalTrends[season] = [];
      patterns.seasonalTrends[season].push({
        name: taskName,
        time: entry.final_start || entry.ai_start
      });
    }

    return this.aggregate(patterns);
  }

  /**
   * Aggregates raw data into averages/frequencies.
   * @param {object} data Intermediate object with timePreferences, durationRatios, and seasonalTrends arrays collected by extractPatterns.
   * @returns {object} Aggregated object with averaged time_prefs (hour), averaged duration_ratios, and raw seasonal entries.
   */
  static aggregate(data) {
    const aggregated = { time_prefs: {}, duration_ratios: {}, seasonal: {} };

    // Average time prefs
    for (const [task, hours] of Object.entries(data.timePreferences)) {
      aggregated.time_prefs[task] = Math.round(hours.reduce((a, b) => a + b, 0) / hours.length);
    }

    // Average duration ratios
    for (const [energy, ratios] of Object.entries(data.durationRatios)) {
      aggregated.duration_ratios[energy] = parseFloat((ratios.reduce((a, b) => a + b, 0) / ratios.length).toFixed(2));
    }

    // Capture dominant seasonal patterns
    aggregated.seasonal = data.seasonalTrends;

    return aggregated;
  }
}

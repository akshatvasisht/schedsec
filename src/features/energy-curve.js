
/**
 * Personal Energy Curve Tracker
 * Learns user's optimal performance windows from completion ratings.
 */
export class EnergyCurve {
  /**
   * Updates energy curve from schedule entries with completion ratings.
   * @param {object} existingCurve - Current { hourSlot: { totalRating, count } }
   * @param {Array} entries - Schedule entries with final_start and completion_rating
   * @returns {object} Updated curve
   */
  static updateCurve(existingCurve = {}, entries) {
    const curve = { ...existingCurve };

    for (const entry of entries) {
      if (!entry.final_start || !entry.completion_rating) continue;
      const hour = parseInt(entry.final_start.split(':')[0]);
      const rating = parseInt(entry.completion_rating);

      if (isNaN(hour) || isNaN(rating)) continue;

      const key = `${String(hour).padStart(2, '0')}:00`;
      if (!curve[key]) curve[key] = { totalRating: 0, count: 0 };
      curve[key].totalRating += rating;
      curve[key].count++;
    }

    return curve;
  }

  /**
   * Gets the user's peak energy window (top 2 hours by average rating).
   * Requires at least 14 days of data (count >= 14 for any slot).
   * @param curve The parameter.
   * @returns {any} The return value.
   */
  static getPeakWindow(curve) {
    const slots = Object.entries(curve)
      .filter(([, data]) => data.count >= 14)
      .map(([hour, data]) => ({
        hour,
        avgRating: data.totalRating / data.count,
        samples: data.count
      }))
      .sort((a, b) => b.avgRating - a.avgRating);

    if (slots.length < 2) return null; // Not enough data

    return {
      peakHours: slots.slice(0, 2).map(s => s.hour),
      avgRating: slots.slice(0, 2).reduce((sum, s) => sum + s.avgRating, 0) / 2,
      recommendation: `Schedule Deep tasks during ${slots[0].hour}-${slots[1].hour} for optimal performance`
    };
  }

  /**
   * Returns suggested time_preference for Deep tasks based on energy curve.
   * @param curve The parameter.
   * @returns {any} The return value.
   */
  static getSuggestedPreference(curve) {
    const peak = this.getPeakWindow(curve);
    if (!peak) return null;

    const peakHour = parseInt(peak.peakHours[0]);
    if (peakHour < 12) return 'Morning';
    if (peakHour < 17) return 'Afternoon';
    return 'Evening';
  }
}

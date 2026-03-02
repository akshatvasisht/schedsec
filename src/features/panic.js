/**
 * Logic for daily overrides (Sick mode, etc.).
 */
export class PanicManager {
  /**
   * Applies daily overrides to a task list.
   * @param tasks The parameter.
   * @param override The parameter.
   * @returns {any} The return value.
   */
  static applyOverrides(tasks, override) {
    if (!override) return tasks;

    let filtered = [...tasks];

    // Energy Filter
    if (override.energy_filter) {
      filtered = filtered.filter(t => override.energy_filter.includes(t.energy));
    }

    // Priority Filter
    if (override.priority_filter) {
      filtered = filtered.filter(t => override.priority_filter.includes(t.priority));
    }

    // Max Work Hours
    if (override.max_work_hours) {
      const maxMins = override.max_work_hours * 60;
      let totalMins = 0;
      filtered = filtered.filter(t => {
        const d = t.duration || 60;
        if (totalMins + d <= maxMins) {
          totalMins += d;
          return true;
        }
        return false;
      });
    }

    return filtered;
  }

  /**
   * Creates a default "Sick Mode" override.
   * @returns {any} The return value.
   */
  static getSickModeOverride() {
    return {
      reason: 'Woke up sick',
      max_work_hours: 3,
      energy_filter: ['Light', 'Moderate'],
      priority_filter: ['High']
    };
  }
}

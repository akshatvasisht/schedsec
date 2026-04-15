/**
 * Logic for daily overrides (Sick mode, etc.).
 */
export class PanicManager {
  /**
   * Applies daily overrides to a task list.
   * @param {Array<object>} tasks Full list of tasks to filter and cap.
   * @param {object|null} override Override descriptor containing optional energy_filter, priority_filter, and max_work_hours fields.
   * @returns {Array<object>} Filtered task list respecting the override constraints, or the original list if no override is provided.
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
   * @returns {object} Override descriptor limiting work to 3 hours of Light/Moderate High-priority tasks only.
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

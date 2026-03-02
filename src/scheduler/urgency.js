/**
 * Urgency calculation based on deadlines and task properties.
 */
export class UrgencyCalculator {
  /**
   * Calculates a score representing task urgency.
   * Higher score = higher priority for scheduling.
   * @param task The parameter.
   * @param currentDate The parameter.
   * @returns {any} The return value.
   */
  static calculateUrgency(task, currentDate = new Date()) {
    let score = 0;

    // Base Priority Score
    const priorityWeights = { 'High': 100, 'Medium': 50, 'Low': 10 };
    score += priorityWeights[task.priority] || 0;

    // Deadline Urgency
    if (task.deadline) {
      const deadlineDate = new Date(task.deadline);
      const daysRemaining = (deadlineDate - currentDate) / (1000 * 60 * 60 * 24);

      if (daysRemaining <= 1) score += 500; // Due today/tomorrow
      else if (daysRemaining <= 3) score += 200;
      else if (daysRemaining <= 7) score += 50;
    }

    // Multi-day Progress (if applicable)
    if (task.estimated_days && task.estimated_days > 1) {
      score += 30; // Slight boost for ongoing multi-day tasks
    }

    return score;
  }

  /**
   * Sorts tasks by urgency (descending).
   * @param tasks The parameter.
   * @returns {any} The return value.
   */
  static sortByUrgency(tasks) {
    return [...tasks].sort((a, b) => this.calculateUrgency(b) - this.calculateUrgency(a));
  }
}

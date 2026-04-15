/**
 * Urgency calculation based on deadlines and task properties.
 */
export class UrgencyCalculator {
  /**
   * Calculates a score representing task urgency.
   * Higher score = higher priority for scheduling.
   * @param {object} task Task with optional `priority`, `deadline`, and `estimated_days` fields.
   * @param {Date} currentDate Reference date used to compute days remaining until deadline.
   * @returns {number} Urgency score combining priority weight, deadline proximity, and multi-day boost.
   */
  static calculateUrgency(task, currentDate = new Date()) {
    let score = 0;

    // Base Priority Score
    const priorityWeights = { 'High': 100, 'Medium': 50, 'Low': 10 };
    score += priorityWeights[task.priority] || 0;

    // Deadline Urgency
    if (task.deadline) {
      const deadlineDate = new Date(task.deadline);
      if (isNaN(deadlineDate.getTime())) return score;
      const todayNormalized = new Date(currentDate.toISOString().split('T')[0]);
      const daysRemaining = (deadlineDate - todayNormalized) / (1000 * 60 * 60 * 24);

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
   * @param {Array<object>} tasks Tasks to sort; original array is not mutated.
   * @returns {Array<object>} New array with highest-urgency tasks first.
   */
  static sortByUrgency(tasks) {
    return [...tasks].sort((a, b) => this.calculateUrgency(b) - this.calculateUrgency(a));
  }
}

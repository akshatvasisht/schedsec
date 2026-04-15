/**
 * Context-Aware Task Batching
 * Groups similar tasks for adjacent scheduling to reduce context-switching.
 */
export class TaskBatching {
  // Keywords that indicate task categories
  static CATEGORY_KEYWORDS = {
    communication: ['email', 'slack', 'message', 'reply', 'respond', 'follow up', 'call'],
    admin: ['admin', 'expense', 'invoice', 'paperwork', 'form', 'submit'],
    review: ['review', 'feedback', 'check', 'approve', 'pr', 'pull request'],
    writing: ['write', 'draft', 'document', 'report', 'article', 'blog'],
    meeting: ['meeting', 'standup', 'sync', 'call', '1:1', 'retro']
  };

  /**
   * Categorizes a task based on name keywords.
   * @param {object} task Task object with a name property to match against category keywords.
   * @returns {string|null} Category name such as "communication" or "review", or null if no keyword matches.
   */
  static categorize(task) {
    const name = (task.name || '').toLowerCase();
    for (const [category, keywords] of Object.entries(this.CATEGORY_KEYWORDS)) {
      if (keywords.some(kw => name.includes(kw))) {
        return category;
      }
    }
    return null;
  }

  /**
   * Groups tasks by detected category.
   * @param {Array<object>} tasks Full list of tasks to partition by keyword category.
   * @returns {{batched: object, unbatched: Array<object>}} Object where batched maps category name to task arrays and unbatched holds tasks that matched no category.
   */
  static groupTasks(tasks) {
    const batched = {};
    const unbatched = [];

    for (const task of tasks) {
      const category = this.categorize(task);
      if (category) {
        if (!batched[category]) batched[category] = [];
        batched[category].push(task);
      } else {
        unbatched.push(task);
      }
    }

    return { batched, unbatched };
  }

  /**
   * Returns batching hints to include in the AI prompt.
   * @param {Array<object>} tasks Full list of tasks to analyse for adjacent-scheduling opportunities.
   * @returns {Array<string>} Human-readable hint strings for each category that contains two or more tasks.
   */
  static getBatchingHints(tasks) {
    const { batched } = this.groupTasks(tasks);
    const hints = [];

    for (const [category, group] of Object.entries(batched)) {
      if (group.length >= 2) {
        const names = group.map(t => t.name).join(', ');
        hints.push(`BATCH SUGGESTION: Schedule these "${category}" tasks adjacently: ${names}`);
      }
    }

    return hints;
  }
}

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
   * @param task The parameter.
   * @returns {any} The return value.
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
   * @param tasks The parameter.
   * @returns {{batched: object, unbatched: Array}} An object containing the batched and unbatched tasks.
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
   * @param tasks The parameter.
   * @returns {any} The return value.
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

/**
 * Compresses learned rules for efficient prompt inclusion.
 * Achieves ~3x compression by grouping, deduplicating, and shortening.
 */
export class PromptCompressor {
  /**
   * Compresses a list of learned rules to fit within a token budget.
   * Groups rules by condition, removes duplicates, and shortens phrasing.
   * @param rules The parameter.
   * @param maxTokens The parameter.
   * @returns {any} The return value.
   */
  static compressLearnedRules(rules, maxTokens = 500) {
    if (!rules || rules.length === 0) return '';

    // Group rules by condition keyword
    const grouped = {};
    for (const rule of rules) {
      const condition = PromptCompressor.extractCondition(rule);
      if (!grouped[condition]) grouped[condition] = [];
      grouped[condition].push(rule);
    }

    // Deduplicate within each group, keeping highest confidence
    const deduped = [];
    for (const [_condition, group] of Object.entries(grouped)) {
      const sorted = group.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
      const seen = new Set();

      for (const rule of sorted) {
        const action = PromptCompressor.extractAction(rule);
        if (!seen.has(action)) {
          seen.add(action);
          deduped.push(rule);
        }
      }
    }

    // Shorten phrasing
    const compressed = deduped.map(rule => {
      const text = typeof rule === 'string' ? rule : `${rule.condition} → ${rule.action}`;
      return PromptCompressor.shortenText(text);
    });

    // Truncate to token budget (rough estimate: 4 chars per token)
    let result = '';
    const charBudget = maxTokens * 4;

    for (const line of compressed) {
      if ((result + line + '\n').length > charBudget) break;
      result += line + '\n';
    }

    return result.trim();
  }

  /**
   * Extracts the condition part of a rule.
   * @param rule The parameter.
   * @returns {any} The return value.
   */
  static extractCondition(rule) {
    if (typeof rule === 'string') {
      const parts = rule.split('→');
      return (parts[0] || rule).trim().toLowerCase().split(/\s+/)[0];
    }
    return (rule.condition || '').toLowerCase().split(/\s+/)[0];
  }

  /**
   * Extracts the action part of a rule.
   * @param rule The parameter.
   * @returns {any} The return value.
   */
  static extractAction(rule) {
    if (typeof rule === 'string') {
      const parts = rule.split('→');
      return (parts[1] || rule).trim().toLowerCase();
    }
    return (rule.action || '').toLowerCase();
  }

  /**
   * Shortens verbose rule text while preserving meaning.
   * @param text The parameter.
   * @returns {any} The return value.
   */
  static shortenText(text) {
    return text
      .replace(/\bscheduled?\b/gi, 'sched')
      .replace(/\bpreference\b/gi, 'pref')
      .replace(/\bcompleted?\b/gi, 'done')
      .replace(/\bapproximately\b/gi, '~')
      .replace(/\bminutes?\b/gi, 'min')
      .replace(/\bhours?\b/gi, 'hr')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

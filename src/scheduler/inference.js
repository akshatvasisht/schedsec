import { CONFIG } from '../config.js';

/**
 * Logic for inferring blank task fields (Duration, Energy, Priority).
 */
export class InferenceEngine {
  /**
   * Main entry point for field inference.
   * @param task The parameter.
   * @param patterns The parameter.
   * @param rules The parameter.
   * @returns {any} The return value.
   */
  static inferFields(task, patterns = {}, rules = []) {
    const inferred = { ...task };
    const fields = ['duration', 'energy', 'priority'];

    for (const field of fields) {
      if (!inferred[field]) {
        // Step 1: Explicit Rules (from Vectorize/User edits)
        const ruleMatch = this._matchRule(inferred, field, rules);
        if (ruleMatch) {
          inferred[field] = ruleMatch;
          continue;
        }

        // Step 2-3: Pattern Matching (Keyword based)
        const patternMatch = this._matchPattern(inferred.name, field, patterns);
        if (patternMatch) {
          inferred[field] = patternMatch;
          continue;
        }

        // Step 4: System Defaults
        inferred[field] = CONFIG.DEFAULTS[field.toUpperCase()];
      }
    }

    return inferred;
  }

  /**
   * Match against structured rules.
   * @param task The parameter.
   * @param field The parameter.
   * @param rules The parameter.
   * @returns {any} The return value.
   */
  static _matchRule(task, field, rules) {
    // Basic exact match for now; semantic search happens in the worker
    const match = rules.find(r =>
      r.condition.includes(`task=${task.name}`) && r.action.includes(field)
    );
    if (match) {
      const actionValue = match.action.split('=')[1];
      return isNaN(actionValue) ? actionValue : parseInt(actionValue);
    }
    return null;
  }

  /**
   * Match keywords in task name against patterns.
   * @param taskName The parameter.
   * @param field The parameter.
   * @param patterns The parameter.
   * @returns {any} The return value.
   */
  static _matchPattern(taskName, field, patterns) {
    const keywords = taskName.toLowerCase().split(/\s+/);
    for (const kw of keywords) {
      if (patterns[kw] && patterns[kw][field]) {
        return patterns[kw][field];
      }
    }
    return null;
  }

  /**
   * Extracts keywords from a task name for pattern learning.
   * @param name The parameter.
   * @returns {any} The return value.
   */
  static extractKeywords(name) {
    return name.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3);
  }
}

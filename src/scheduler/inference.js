import { CONFIG } from '../config.js';
import { CollaborativeFilter } from './collaborative-filter.js';

/**
 * Logic for inferring blank task fields (Duration, Energy, Priority).
 */
export class InferenceEngine {
  /**
   * Main entry point for field inference.
   * @param {object} task Task with potentially blank `duration`, `energy`, or `priority` fields.
   * @param {object} patterns Keyword-to-field-value map used for name-based pattern matching.
   * @param {Array<object>} rules Structured rules from Vectorize for exact condition matching.
   * @param {Array<object>} historicalTasks Optional array of historical tasks for collaborative filtering.
   * @returns {object} Task copy with all inferred fields filled in.
   */
  static inferFields(task, patterns = {}, rules = [], historicalTasks = []) {
    const inferred = { ...task };
    const fields = ['duration', 'energy', 'priority'];

    for (const field of fields) {
      if (inferred[field] == null) {
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

        // Step 3.5: Collaborative Filtering (similar task matching)
        if (historicalTasks.length > 0) {
          const similar = CollaborativeFilter.inferFromSimilar(inferred, historicalTasks);
          if (similar[field]) {
            inferred[field] = similar[field];
            continue;
          }
        }

        // Step 4: System Defaults
        inferred[field] = CONFIG.DEFAULTS[field.toUpperCase()];
      }
    }

    return inferred;
  }

  /**
   * Match against structured rules.
   * @param {object} task Task whose name is matched against rule conditions.
   * @param {string} field Field name to extract from the matching rule's action (e.g. `'duration'`).
   * @param {Array<object>} rules Vectorize rules with `condition` and `action` strings.
   * @returns {string|number|null} Inferred value from the matched rule, or null if no rule matched.
   */
  static _matchRule(task, field, rules) {
    // Basic exact match for now; semantic search happens in the worker
    const match = rules.find(r =>
      r.condition.includes(`task=${task.name}`) && r.action.includes(field)
    );
    if (match) {
      const actionValue = match.action.split('=')[1];
      if (actionValue === undefined) return null;
      return isNaN(actionValue) ? actionValue : parseFloat(actionValue);
    }
    return null;
  }

  /**
   * Match keywords in task name against patterns.
   * @param {string} taskName Task name to tokenize and look up in the patterns map.
   * @param {string} field Field name to retrieve from the matched pattern entry.
   * @param {object} patterns Keyword-to-field-value map built from learning data.
   * @returns {any} The matched field value, or null if no pattern keyword matched.
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
   * @param {string} name Task name to tokenize.
   * @returns {Array<string>} Lowercase words longer than 3 characters with punctuation removed.
   */
  static extractKeywords(name) {
    return name.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3);
  }
}

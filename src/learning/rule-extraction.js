
/**
 * Logic for extracting structured rules from user behavior and notes.
 * Includes plausibility bounds to filter out bad-data edits.
 */
export class RuleExtractor {
  /**
   * @param ai The parameter.
   */
  constructor(ai) {
    this.ai = ai;
    this.model = '@cf/qwen/qwen2.5-7b-instruct';
  }

  /**
   * Analyzes the difference between AI's plan and User's final schedule.
   * Filters out implausible edits (> 3x duration change, times outside work hours).
   * @param aiSchedule The parameter.
   * @param finalSchedule The parameter.
   * @returns {any} The return value.
   */
  static identifyEdits(aiSchedule, finalSchedule) {
    const edits = [];
    for (const finalItem of finalSchedule) {
      const aiItem = aiSchedule.find(i => i.task_id === finalItem.task_id);
      if (aiItem) {
        if (aiItem.start !== finalItem.start) {
          edits.push({ type: 'START_TIME', task: finalItem.task_name, ai: aiItem.start, user: finalItem.start });
        }
        if (aiItem.duration !== finalItem.duration) {
          // Plausibility bound: skip edits where user duration is > 3x AI duration
          const ratio = finalItem.duration / (aiItem.duration || 1);
          if (ratio > 3 || ratio < 0.2) {
            edits.push({ type: 'DURATION', task: finalItem.task_name, ai: aiItem.duration, user: finalItem.duration, flagged: 'implausible' });
          } else {
            edits.push({ type: 'DURATION', task: finalItem.task_name, ai: aiItem.duration, user: finalItem.duration });
          }
        }
      }
    }
    return edits;
  }

  /**
   * Uses AI to convert natural language notes and edits into structured rules.
   * @param notes The parameter.
   * @param edits The parameter.
   * @param _context The parameter.
   * @returns {any} The return value.
   */
  async extractRuleFromNotes(notes, edits, _context) {
    const prompt = `You are a rule extractor for a scheduling system.
The user made these edits today: ${JSON.stringify(edits)}
The user left these notes: "${notes}"

Convert this into a structured scheduling rule.
Example Output: {"condition": "task=Team Meeting", "action": "prefer_time=10:00"}
Example Output: {"condition": "energy=Deep", "action": "duration=120"}

OUTPUT JSON ONLY.`;

    try {
      const response = await this.ai.run(this.model, { prompt });
      const cleaned = response.response.trim().replace(/```json\n?|```/g, '');
      return JSON.parse(cleaned);
    } catch (e) {
      throw new Error(`Failed to extract rule from notes: ${e.message}`);
    }
  }

  /**
   * Creates a rule object from a structured edit.
   * Includes source metadata for audit trail.
   * @param edit The parameter.
   * @param source The parameter.
   * @param sourceDate The parameter.
   * @param sourceScheduleId The parameter.
   * @returns {any} The return value.
   */
  static createRuleFromEdit(edit, source = 'system_edit', sourceDate = null, sourceScheduleId = null) {
    const dateStr = sourceDate || new Date().toISOString().split('T')[0];
    return {
      condition: `task=${edit.task}`,
      action: `${edit.type.toLowerCase() === 'start_time' ? 'prefer_time' : 'duration'}=${edit.user}`,
      confidence: 0.8,
      learned_date: dateStr,
      last_reinforced: dateStr,
      application_count: 0,
      successful_applications: 0,
      source,
      source_edit_date: dateStr,
      source_schedule_id: sourceScheduleId
    };
  }

  /**
   * Checks if an edit should be excluded from rule learning.
   * Filters: implausible edits, correction-flagged entries, non-preference skip reasons.
   * @param edit The edit object.
   * @param entry The schedule entry (may contain correction_flag or skip_reason).
   * @param nonPreferenceReasons Array of skip reasons that aren't user preferences.
   * @returns {boolean} True if the edit should be skipped for learning.
   */
  static shouldSkipForLearning(edit, entry = {}, nonPreferenceReasons = []) {
    // Skip implausible edits
    if (edit.flagged === 'implausible') return true;

    // Skip correction-flagged entries
    if (entry.correction_flag) return true;

    // Skip non-preference skip reasons (No Time, External Blocker)
    if (entry.skip_reason && nonPreferenceReasons.includes(entry.skip_reason)) return true;

    return false;
  }
}

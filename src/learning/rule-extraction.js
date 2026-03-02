
/**
 * Logic for extracting structured rules from user behavior and notes.
 */
export class RuleExtractor {
  /**
   *
   * @param ai The parameter.
   */
  constructor(ai) {
    this.ai = ai;
    this.model = '@cf/qwen/qwen2.5-7b-instruct';
  }

  /**
   * Analyzes the difference between AI's plan and User's final schedule.
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
          edits.push({ type: 'DURATION', task: finalItem.task_name, ai: aiItem.duration, user: finalItem.duration });
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
   * @param edit The parameter.
   * @param source The parameter.
   * @returns {any} The return value.
   */
  static createRuleFromEdit(edit, source = 'system_edit') {
    return {
      condition: `task=${edit.task}`,
      action: `${edit.type.toLowerCase() === 'start_time' ? 'prefer_time' : 'duration'}=${edit.user}`,
      confidence: 0.8,
      learned_date: new Date().toISOString().split('T')[0],
      last_reinforced: new Date().toISOString().split('T')[0],
      application_count: 0,
      successful_applications: 0,
      source
    };
  }
}

import { CONFIG } from '../config.js';

/**
 * Prompt Builder
 * Full AI prompt construction.
 */
export class PromptBuilder {
  /**
   * Compresses learned rules to save prompt tokens for context window efficiency.
   * @param {Array} rules Array of rule objects from Vectorize.
   * @returns {string} Semicolon-delimited compressed rule string.
   */
  static compressRules(rules) {
    if (!rules || rules.length === 0) return 'No historical rules yet.';
    return rules.map(rule => {
      const condition = rule.condition.replace('task=', '').replace('day=', '');
      const action = rule.action.replace('prefer_time=', '').replace('duration=', '');
      return `${condition} -> ${action}(${rule.confidence.toFixed(2)},${rule.application_count || 0})`;
    }).join('; ');
  }

  /**
   * Few-shot examples for deterministic JSON output.
   * @returns {any} The return value.
   */
  static getFewShotExamples() {
    return `
EXAMPLE INPUT:
[{"id":"t1","name":"Meeting","duration":60,"priority":"High","type":"TASK"}]

EXAMPLE OUTPUT:
[{"task_id":"t1","start":"09:00","duration":60,"day_number":1,"inferred_fields":{},"conflicts":[],"notes":"High priority meeting scheduled first"}]

EXAMPLE INPUT:
[{"id":"t2","name":"Deep work","duration":null,"energy":"Deep","type":"TASK"}]

EXAMPLE OUTPUT:
[{"task_id":"t2","start":"11:00","duration":120,"day_number":1,"inferred_fields":{"duration":120},"conflicts":[],"notes":"Duration inferred as 120min for deep work"}]`;
  }

  /**
   * Builds the complete prompt for Cloudflare AI (Qwen 2.5 7B).
   * @param tasks The parameter.
   * @param context The parameter.
   * @returns {any} The return value.
   */
  static buildPrompt(tasks, context) {
    const {
      date, dayName, timezone,
      workStart = CONFIG.DEFAULTS.WORK_DAY_START,
      workEnd = CONFIG.DEFAULTS.WORK_DAY_END,
      rules = [], patterns = {},
      hardConstraints = [],
      fixedAppointments = [],
      externalCalendarBlocks = [],
      availableSlots = [],
      dependencies = []
    } = context;

    const compressedRules = this.compressRules(rules);
    const patternsStr = JSON.stringify(patterns);

    return `You are SchedSec, an autonomous scheduling assistant. Output ONLY valid JSON.

CURRENT DATE: ${date} (${dayName})
TIMEZONE: ${timezone}
WORK HOURS: ${workStart}-${workEnd}

TASK TYPES:
- TASK: Flexible scheduling, system decides optimal time.
- FIXED_APPOINTMENT: Must occur at specified fixed_time (immovable). Already listed in OCCUPIED slots.
- TIME_BLOCK: Reserves time without deliverable (not completion-tracked).

OCCUPIED TIME SLOTS (immovable):
${JSON.stringify([...fixedAppointments, ...externalCalendarBlocks])}

AVAILABLE TIME SLOTS:
${JSON.stringify(availableSlots)}

ACTIVE TASKS TO SCHEDULE:
${JSON.stringify(tasks)}

TASK DEPENDENCIES (schedule in this order):
${JSON.stringify(dependencies)}

LEARNED RULES:
${compressedRules}

INFERENCE PATTERNS:
${patternsStr}

HARD CONSTRAINTS:
${hardConstraints.length > 0 ? hardConstraints.join('\n') : 'None'}

MULTI-DAY TASKS:
For tasks with estimated_days > 1, split duration using energy decay.
Example: 480min, 3 days -> Day 1: 192min (40%), Day 2: 168min (35%), Day 3: 120min (25%)

RECURRING TASKS:
Tasks with recurrence should appear every applicable day.
Check last_generated date to avoid duplicates.

DEPENDENCY RESOLUTION:
Schedule tasks in topological order. If Task B depends_on Task A:
- Task A must be scheduled BEFORE Task B.
- Add 15min buffer between dependent tasks.
- Flag circular dependencies as UNSCHEDULABLE.

TIME CONSTRAINTS (CRITICAL):
If a task has must_complete_by:
- Task must START and COMPLETE before this time.
- Latest start = must_complete_by - duration - buffer(15min).
- Example: duration=30, must_complete_by=14:45 → latest start = 14:00.

BLANK FIELD INFERENCE:
When duration/priority/energy/time_preference are missing:
1. Check inference_patterns for task name keywords.
2. Parse task name for indicators ("30min", "quick", "deep dive").
3. Use learned rules from similar tasks.
4. Default: duration=60, priority=Medium, energy=Moderate, time_preference=Anytime.

CONFLICT TYPES TO DETECT:
1. TIME_OVERLAP: Two tasks same time
2. INSUFFICIENT_BUFFER: <15min between tasks
3. PREFERENCE_VIOLATION: Task outside preferred time
4. RULE_VIOLATION: Breaks learned rule
5. DEPENDENCY_VIOLATION: Task scheduled before its dependency
6. CIRCULAR_DEPENDENCY: A depends on B, B depends on A
7. TIME_CONSTRAINT_VIOLATION: Task scheduled after must_complete_by
8. FIXED_APPOINTMENT_CONFLICT: Flexible task overlaps immovable appointment

${this.getFewShotExamples()}

OUTPUT FORMAT (ONLY valid JSON array, no markdown):
[
  {
    "task_id": "...",
    "start": "HH:MM",
    "duration": number,
    "day_number": 1,
    "inferred_fields": {},
    "conflicts": [{"type":"...","description":"...","resolution_options":["..."]}],
    "notes": "..."
  }
]

YOUR OUTPUT (JSON ONLY):`;
  }
}

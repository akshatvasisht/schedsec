import { CONFIG } from '../config.js';
import { PromptCompressor } from '../learning/prompt-compression.js';

/**
 * Builds the full prompt sent to Cloudflare AI for task placement.
 */
export class PromptBuilder {
  /**
   * Compresses learned rules to save prompt tokens for context window efficiency.
   * @param {Array} rules Array of rule objects from Vectorize.
   * @returns {string} Semicolon-delimited compressed rule string.
   */
  static compressRules(rules) {
    if (!rules || rules.length === 0) return 'No historical rules yet.';
    // Delegate to PromptCompressor for deduplication + token budget
    const compressed = PromptCompressor.compressLearnedRules(rules, 500);
    return compressed || 'No historical rules yet.';
  }

  /**
   * Few-shot examples for deterministic JSON output.
   * @returns {string} Multi-line string with two input/output example pairs used to prime the model.
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
   * Returns prompt text, estimated token count, and version.
   * @param {Array<object>} tasks Validated, inferred tasks ready for AI placement.
   * @param {object} context Scheduling context including dates, rules, slots, constraints, and hints.
   * @returns {{ prompt: string, tokenEstimate: number, version: string }} Final prompt, character-based token estimate, and prompt version tag.
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
      dependencies = [],
      slotHints = {},
      learnedBuffers = {},
      energyPeakHint = '',
      batchingHints = [],
      deadlineWarnings = []
    } = context;

    const compressedRules = this.compressRules(rules);
    const patternsStr = JSON.stringify(patterns);
    const version = CONFIG.DEFAULTS.PROMPT_VERSION;

    const prompt = `You are SchedSec, an autonomous scheduling assistant. Output ONLY valid JSON.
PROMPT VERSION: ${version}

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

${Object.keys(slotHints).length > 0 ? `SLOT HINTS (learned optimal time slots per task):
${Object.entries(slotHints).map(([id, slot]) => `${id}: ${slot}`).join(', ')}` : ''}

${energyPeakHint ? `ENERGY PEAK: ${energyPeakHint}` : ''}

${batchingHints.length > 0 ? `BATCHING HINTS:
${batchingHints.join('\n')}` : ''}

${Object.keys(learnedBuffers).length > 0 ? `LEARNED BUFFER TIMES (between energy transitions):
${Object.entries(learnedBuffers).map(([k, v]) => `${k}: ${v.avgBuffer}min (${v.samples} samples)`).join(', ')}` : ''}

${deadlineWarnings.length > 0 ? `DEADLINE WARNINGS:
${deadlineWarnings.map(w => `⚠️ ${w.task}: needs ${w.needed} days but only ${w.available} available`).join('\n')}` : ''}

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

    // Token overflow protection: progressively drop optional sections
    const tokenEstimate = Math.ceil(prompt.length / 4);
    const TOKEN_LIMIT = 6000;
    let finalPrompt = prompt;
    let finalTokenEstimate = tokenEstimate;

    if (tokenEstimate > TOKEN_LIMIT) {
      // Drop sections in priority order until under budget
      const optionalSections = [
        { label: 'BATCHING HINTS', regex: /\nBATCHING HINTS:[\s\S]*?(?=\n[A-Z]|$)/m },
        { label: 'SLOT HINTS', regex: /\nSLOT HINTS:[\s\S]*?(?=\n[A-Z]|$)/m },
        { label: 'ENERGY PEAK', regex: /\nENERGY PEAK:[\s\S]*?(?=\n[A-Z]|$)/m },
        { label: 'LEARNED BUFFERS', regex: /\nLEARNED BUFFER TIMES:[\s\S]*?(?=\n[A-Z]|$)/m },
      ];
      for (const section of optionalSections) {
        if (Math.ceil(finalPrompt.length / 4) <= TOKEN_LIMIT) break;
        finalPrompt = finalPrompt.replace(section.regex, '');
      }
      finalTokenEstimate = Math.ceil(finalPrompt.length / 4);
    }

    return { prompt: finalPrompt, tokenEstimate: finalTokenEstimate, version };
  }
}

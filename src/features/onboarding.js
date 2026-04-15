/**
 * Onboarding Questionnaire
 * Maps user answers to inference patterns, context defaults, and KV scheduling config.
 * Supports partial updates (patch mode) and full reset (reset mode).
 */
export class OnboardingManager {
  static QUESTIONS = [
    // ── Existing preference questions ──────────────────────────────────────────
    {
      id: 'deep_work_time',
      question: 'When do you do your best deep work?',
      options: ['Early morning (6–9 AM)', 'Morning (9–12 PM)', 'Afternoon (1–4 PM)', 'Evening (5–8 PM)'],
      maps_to: 'inference_patterns_v2 → deep_work.time_preference',
      type: 'select'
    },
    {
      id: 'meeting_length',
      question: 'How long are your typical meetings?',
      options: ['15–30 min', '30–60 min', '60–90 min', '90+ min'],
      maps_to: 'inference_patterns_v2 → meeting.duration',
      type: 'select'
    },
    {
      id: 'lunch_time',
      question: 'What time do you usually take lunch?',
      options: ['11:00–12:00', '12:00–13:00', '13:00–14:00', 'I skip lunch'],
      maps_to: 'hard_constraints → lunch block',
      type: 'select'
    },
    {
      id: 'work_hours',
      question: 'How many hours per day do you want to work?',
      options: ['4 hours (9–13:00)', '6 hours (9–15:00)', '8 hours (9–17:00)', '10 hours (8–18:00)'],
      maps_to: 'work_hours → start/end',
      type: 'select'
    },
    {
      id: 'meeting_preference',
      question: 'Do you prefer morning or afternoon for meetings?',
      options: ['Morning', 'Afternoon', 'No preference'],
      maps_to: 'inference_patterns_v2 → meeting.time_preference',
      type: 'select'
    },

    // ── New: Scheduling & system config ───────────────────────────────────────
    {
      id: 'timezone',
      question: 'What is your IANA timezone? (e.g. America/Chicago, Europe/London, Asia/Kolkata)',
      maps_to: 'KV:sched_timezone + context:user_timezone_current',
      type: 'text',
      validate: (v) => {
        try {
          Intl.DateTimeFormat(undefined, { timeZone: v });
          return true;
        } catch {
          return false;
        }
      },
      hint: 'Full list: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones'
    },
    {
      id: 'preview_time',
      question: 'What time do you want your PREVIEW schedule generated? (local time, HH:MM, e.g. 21:30)',
      maps_to: 'KV:sched_preview_time → used to compute UTC cron string',
      type: 'time',
      hint: 'This runs the night before — set it to when you review your next-day plan.'
    },
    {
      id: 'final_time',
      question: 'What time do you want your FINAL schedule locked in? (local time, HH:MM, e.g. 05:30)',
      maps_to: 'KV:sched_final_time → used to compute UTC cron string',
      type: 'time',
      hint: 'This runs the morning of — set it before you start work.'
    },

    // ── New: Work days ─────────────────────────────────────────────────────────
    {
      id: 'work_days',
      question: 'Which days do you work? (comma-separated, e.g. Mon,Tue,Wed,Thu,Fri)',
      options: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      maps_to: 'context:work_days',
      type: 'multiselect',
      default: 'Mon,Tue,Wed,Thu,Fri'
    },

    // ── New: Break preference ─────────────────────────────────────────────────
    {
      id: 'buffer_style',
      question: 'How do you prefer to work?',
      options: [
        'Pomodoro — short tasks with 5–10 min breaks',
        'Marathon — long uninterrupted blocks, minimal breaks',
        'Adaptive — let the AI decide based on task energy'
      ],
      maps_to: 'context:buffer_style → buffer time per transition',
      type: 'select'
    },

    // ── New: Push alerts (optional) ───────────────────────────────────────────
    {
      id: 'ntfy_topic',
      question: 'ntfy.sh topic for push error alerts? (leave blank to skip)',
      maps_to: 'KV:ntfy_topic (optional)',
      type: 'optional_text',
      hint: 'Free push notifications. Create a unique topic at ntfy.sh. Leave blank to use Logs DB only.'
    }
  ];

  /**
   * Applies onboarding answers to context DB and KV.
   * @param {object} answers - Map of question ID → answer value.
   * @param {object} context - ContextManager instance.
   * @param {object} [kv] - Cloudflare KV binding (required for time/timezone/ntfy answers).
   * @param {boolean} [reset] - If true, clear patterns + constraints before applying.
   * @returns {Promise<object>} Result summary.
   */
  static async applyAnswers(answers, context, kv = null, reset = false) {
    // Reset mode: wipe learned patterns and constraints before applying
    if (reset) {
      await context.set('inference_patterns_v2', null, 'Reset by onboarding');
      await context.set('hard_constraints', [], 'Reset by onboarding');
    }

    const patterns = (await context.get('inference_patterns_v2')) || {};
    const applied = [];

    // ── Q1: Deep work time preference ─────────────────────────────────────────
    if (answers.deep_work_time !== undefined) {
      const timeMap = { 0: 'Morning', 1: 'Morning', 2: 'Afternoon', 3: 'Evening' };
      if (!patterns.deep_work) patterns.deep_work = {};
      patterns.deep_work.time_preference = timeMap[answers.deep_work_time];
      applied.push('deep_work.time_preference');
    }

    // ── Q2: Meeting duration ───────────────────────────────────────────────────
    if (answers.meeting_length !== undefined) {
      const durationMap = { 0: 25, 1: 45, 2: 75, 3: 90 };
      if (!patterns.meeting) patterns.meeting = {};
      patterns.meeting.duration = durationMap[answers.meeting_length];
      applied.push('meeting.duration');
    }

    // ── Q3: Lunch time constraint ──────────────────────────────────────────────
    if (answers.lunch_time !== undefined) {
      const lunchMap = { 0: 'lunch_11:00-12:00', 1: 'lunch_12:00-13:00', 2: 'lunch_13:00-14:00' };
      const constraints = (await context.get('hard_constraints')) || [];
      const filtered = constraints.filter(c => !c.startsWith('lunch_'));
      if (answers.lunch_time < 3) filtered.push(lunchMap[answers.lunch_time]);
      await context.set('hard_constraints', filtered, 'Set by onboarding');
      applied.push('hard_constraints.lunch');
    }

    // ── Q4: Work hours ─────────────────────────────────────────────────────────
    if (answers.work_hours !== undefined) {
      const hoursMap = {
        0: { start: '09:00', end: '13:00' },
        1: { start: '09:00', end: '15:00' },
        2: { start: '09:00', end: '17:00' },
        3: { start: '08:00', end: '18:00' }
      };
      await context.set('work_hours', hoursMap[answers.work_hours], 'Set by onboarding');
      applied.push('work_hours');
    }

    // ── Q5: Meeting time preference ────────────────────────────────────────────
    if (answers.meeting_preference !== undefined) {
      const prefMap = { 0: 'Morning', 1: 'Afternoon', 2: 'Anytime' };
      if (!patterns.meeting) patterns.meeting = {};
      patterns.meeting.time_preference = prefMap[answers.meeting_preference];
      applied.push('meeting.time_preference');
    }

    // ── Q6: Timezone ───────────────────────────────────────────────────────────
    if (answers.timezone) {
      await context.set('user_timezone_current', {
        current: answers.timezone,
        schedule_timezone: answers.timezone,
        history: []
      }, 'Set by onboarding');
      if (kv) {
        await kv.put('sched_timezone', answers.timezone);
      }
      applied.push('timezone');
    }

    // ── Q7: Preview time ───────────────────────────────────────────────────────
    if (answers.preview_time) {
      if (!OnboardingManager.isValidTime(answers.preview_time)) {
        throw new Error(`Invalid preview_time format: "${answers.preview_time}". Use HH:MM (24h).`);
      }
      if (kv) await kv.put('sched_preview_time', answers.preview_time);
      applied.push('sched_preview_time');
    }

    // ── Q8: Final time ─────────────────────────────────────────────────────────
    if (answers.final_time) {
      if (!OnboardingManager.isValidTime(answers.final_time)) {
        throw new Error(`Invalid final_time format: "${answers.final_time}". Use HH:MM (24h).`);
      }
      if (kv) await kv.put('sched_final_time', answers.final_time);
      applied.push('sched_final_time');
    }

    // ── Q9: Work days ──────────────────────────────────────────────────────────
    if (answers.work_days) {
      const dayMap = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
      const normalised = answers.work_days
        .split(',')
        .map(d => dayMap[d.trim()] || d.trim())
        .filter(Boolean);
      await context.set('work_days', normalised, 'Set by onboarding');
      applied.push('work_days');
    }

    // ── Q10: Buffer / break style ──────────────────────────────────────────────
    if (answers.buffer_style !== undefined) {
      const styleMap = {
        0: { name: 'pomodoro', buffer_minutes: 10 },
        1: { name: 'marathon', buffer_minutes: 5 },
        2: { name: 'adaptive', buffer_minutes: 15 }  // default
      };
      await context.set('buffer_style', styleMap[answers.buffer_style], 'Set by onboarding');
      applied.push('buffer_style');
    }

    // ── Q11: ntfy.sh topic (sensitive — KV only, not Notion) ──────────────────
    if (answers.ntfy_topic && kv) {
      await kv.put('ntfy_topic', answers.ntfy_topic);
      applied.push('ntfy_topic');
    }

    // Persist updated inference patterns
    if (Object.keys(patterns).length > 0) {
      await context.set('inference_patterns_v2', patterns, 'Updated by onboarding');
    }

    return { success: true, applied, reset };
  }

  /**
   * Validates HH:MM 24-hour format.
   * @param {string} timeStr - Time string to validate, e.g. "21:30".
   * @returns {boolean} True if the string is a valid 24-hour HH:MM time.
   */
  static isValidTime(timeStr) {
    if (!/^\d{2}:\d{2}$/.test(timeStr)) return false;
    const [h, m] = timeStr.split(':').map(Number);
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
  }
}

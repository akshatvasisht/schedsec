
/**
 * Onboarding Questionnaire
 * Maps user answers to inference patterns and context defaults.
 */
export class OnboardingManager {
  static QUESTIONS = [
    {
      id: 'deep_work_time',
      question: 'When do you do your best deep work?',
      options: ['Early morning (6-9 AM)', 'Morning (9-12 PM)', 'Afternoon (1-4 PM)', 'Evening (5-8 PM)'],
      maps_to: 'time_preference for Deep energy tasks'
    },
    {
      id: 'meeting_length',
      question: 'How long are your typical meetings?',
      options: ['15-30 min', '30-60 min', '60-90 min', '90+ min'],
      maps_to: 'duration for meeting tasks'
    },
    {
      id: 'lunch_time',
      question: 'What time do you usually take lunch?',
      options: ['11:00-12:00', '12:00-13:00', '13:00-14:00', 'I skip lunch'],
      maps_to: 'hard_constraints lunch block'
    },
    {
      id: 'work_hours',
      question: 'How many hours per day do you want to work?',
      options: ['4 hours', '6 hours', '8 hours', '10+ hours'],
      maps_to: 'work_hours duration'
    },
    {
      id: 'meeting_preference',
      question: 'Do you prefer morning or afternoon for meetings?',
      options: ['Morning', 'Afternoon', 'No preference'],
      maps_to: 'time_preference for meeting tasks'
    }
  ];

  /**
   * Applies onboarding answers to override bootstrap defaults.
   * @param answers The parameter.
   * @param context The parameter.
   * @returns {any} The return value.
   */
  static async applyAnswers(answers, context) {
    const patterns = await context.get('inference_patterns_v2') || {};

    // Deep work time preference
    if (answers.deep_work_time !== undefined) {
      const timeMap = { 0: 'Morning', 1: 'Morning', 2: 'Afternoon', 3: 'Evening' };
      if (patterns.deep_work) {
        patterns.deep_work.time_preference = timeMap[answers.deep_work_time];
      }
    }

    // Meeting duration
    if (answers.meeting_length !== undefined) {
      const durationMap = { 0: 25, 1: 45, 2: 75, 3: 90 };
      if (patterns.meeting) {
        patterns.meeting.duration = durationMap[answers.meeting_length];
      }
    }

    // Lunch time
    if (answers.lunch_time !== undefined && answers.lunch_time < 3) {
      const lunchMap = { 0: 'lunch_11:00-12:00', 1: 'lunch_12:00-13:00', 2: 'lunch_13:00-14:00' };
      const constraints = await context.get('hard_constraints') || [];
      const filtered = constraints.filter(c => !c.startsWith('lunch_'));
      filtered.push(lunchMap[answers.lunch_time]);
      await context.set('hard_constraints', filtered);
    }

    // Work hours
    if (answers.work_hours !== undefined) {
      const hoursMap = { 0: { start: '09:00', end: '13:00' }, 1: { start: '09:00', end: '15:00' }, 2: { start: '09:00', end: '17:00' }, 3: { start: '08:00', end: '18:00' } };
      await context.set('work_hours', hoursMap[answers.work_hours]);
    }

    // Meeting time preference
    if (answers.meeting_preference !== undefined) {
      const prefMap = { 0: 'Morning', 1: 'Afternoon', 2: 'Anytime' };
      if (patterns.meeting) {
        patterns.meeting.time_preference = prefMap[answers.meeting_preference];
      }
    }

    await context.set('inference_patterns_v2', patterns);
    return { success: true };
  }
}

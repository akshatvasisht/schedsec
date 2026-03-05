import { describe, it, expect, vi } from 'vitest';
import { BufferLearning } from '../../src/features/buffer-learning.js';
import { EnergyCurve } from '../../src/features/energy-curve.js';
import { TaskBatching } from '../../src/features/task-batching.js';
import { PlanningManager } from '../../src/features/planning.js';
import { UndoManager } from '../../src/features/undo.js';
import { OnboardingManager } from '../../src/features/onboarding.js';
import { PanicManager } from '../../src/features/panic.js';
import { validateTriggerToken, generateTriggerToken } from '../../src/trigger.js';

// ── OnboardingManager ─────────────────────────────────────────────────────────

/**
 * Build a minimal mock ContextManager.
 * @param {object} initial - Initial store values.
 * @returns {object} Mock context with get/set/store.
 */
function mockContext(initial = {}) {
  const store = { ...initial };
  return {
    get: vi.fn(async (key) => store[key] ?? null),
    set: vi.fn(async (key, value) => { store[key] = value; }),
    _store: store
  };
}

/**
 * Build a minimal mock KV binding.
 * @returns {object} Mock KV with get/put/store.
 */
function mockKv() {
  const store = {};
  return {
    get: vi.fn(async (key) => store[key] ?? null),
    put: vi.fn(async (key, value) => { store[key] = value; }),
    _store: store
  };
}

describe('OnboardingManager', () => {
  describe('applyAnswers — preference questions', () => {
    it('maps deep_work_time 0 → Morning, 2 → Afternoon', async () => {
      const ctx = mockContext();
      await OnboardingManager.applyAnswers({ deep_work_time: 0 }, ctx);
      expect(ctx._store['inference_patterns_v2'].deep_work.time_preference).toBe('Morning');

      const ctx2 = mockContext();
      await OnboardingManager.applyAnswers({ deep_work_time: 2 }, ctx2);
      expect(ctx2._store['inference_patterns_v2'].deep_work.time_preference).toBe('Afternoon');
    });

    it('maps meeting_length 0 → 25min, 3 → 90min', async () => {
      const ctx = mockContext();
      await OnboardingManager.applyAnswers({ meeting_length: 0 }, ctx);
      expect(ctx._store['inference_patterns_v2'].meeting.duration).toBe(25);

      const ctx2 = mockContext();
      await OnboardingManager.applyAnswers({ meeting_length: 3 }, ctx2);
      expect(ctx2._store['inference_patterns_v2'].meeting.duration).toBe(90);
    });

    it('sets lunch hard constraint', async () => {
      const ctx = mockContext({ hard_constraints: [] });
      await OnboardingManager.applyAnswers({ lunch_time: 1 }, ctx);
      expect(ctx._store['hard_constraints']).toContain('lunch_12:00-13:00');
    });

    it('skips lunch constraint when lunch_time === 3 (skip lunch)', async () => {
      const ctx = mockContext({ hard_constraints: [] });
      await OnboardingManager.applyAnswers({ lunch_time: 3 }, ctx);
      const stored = ctx._store['hard_constraints'];
      expect(!stored || stored.length === 0 || !stored.some(c => c.startsWith('lunch_'))).toBe(true);
    });

    it('maps work_hours 0 → 9-13:00, 2 → 9-17:00', async () => {
      const ctx = mockContext();
      await OnboardingManager.applyAnswers({ work_hours: 0 }, ctx);
      expect(ctx._store['work_hours']).toEqual({ start: '09:00', end: '13:00' });

      const ctx2 = mockContext();
      await OnboardingManager.applyAnswers({ work_hours: 2 }, ctx2);
      expect(ctx2._store['work_hours']).toEqual({ start: '09:00', end: '17:00' });
    });

    it('maps meeting_preference 0 → Morning, 2 → Anytime', async () => {
      const ctx = mockContext();
      await OnboardingManager.applyAnswers({ meeting_preference: 0 }, ctx);
      expect(ctx._store['inference_patterns_v2'].meeting.time_preference).toBe('Morning');

      const ctx2 = mockContext();
      await OnboardingManager.applyAnswers({ meeting_preference: 2 }, ctx2);
      expect(ctx2._store['inference_patterns_v2'].meeting.time_preference).toBe('Anytime');
    });
  });

  describe('applyAnswers — new questions', () => {
    it('writes timezone to context + KV', async () => {
      const ctx = mockContext();
      const kv = mockKv();
      await OnboardingManager.applyAnswers({ timezone: 'America/Chicago' }, ctx, kv);
      expect(ctx._store['user_timezone_current'].current).toBe('America/Chicago');
      expect(kv._store['sched_timezone']).toBe('America/Chicago');
    });

    it('writes valid preview_time to KV', async () => {
      const ctx = mockContext();
      const kv = mockKv();
      await OnboardingManager.applyAnswers({ preview_time: '21:30' }, ctx, kv);
      expect(kv._store['sched_preview_time']).toBe('21:30');
    });

    it('throws on invalid preview_time format', async () => {
      const ctx = mockContext();
      const kv = mockKv();
      await expect(
        OnboardingManager.applyAnswers({ preview_time: '9:30pm' }, ctx, kv)
      ).rejects.toThrow('Invalid preview_time format');
    });

    it('writes valid final_time to KV', async () => {
      const ctx = mockContext();
      const kv = mockKv();
      await OnboardingManager.applyAnswers({ final_time: '05:30' }, ctx, kv);
      expect(kv._store['sched_final_time']).toBe('05:30');
    });

    it('throws on invalid final_time', async () => {
      const ctx = mockContext();
      await expect(
        OnboardingManager.applyAnswers({ final_time: '25:00' }, ctx)
      ).rejects.toThrow('Invalid final_time format');
    });

    it('maps work_days string to full day names', async () => {
      const ctx = mockContext();
      await OnboardingManager.applyAnswers({ work_days: 'Mon,Wed,Fri' }, ctx);
      expect(ctx._store['work_days']).toEqual(['Monday', 'Wednesday', 'Friday']);
    });

    it('maps buffer_style 0 → pomodoro, 1 → marathon, 2 → adaptive', async () => {
      for (const [idx, name] of [[0, 'pomodoro'], [1, 'marathon'], [2, 'adaptive']]) {
        const ctx = mockContext();
        await OnboardingManager.applyAnswers({ buffer_style: idx }, ctx);
        expect(ctx._store['buffer_style'].name).toBe(name);
      }
    });

    it('writes ntfy_topic to KV when provided', async () => {
      const ctx = mockContext();
      const kv = mockKv();
      await OnboardingManager.applyAnswers({ ntfy_topic: 'my-schedsec-alerts' }, ctx, kv);
      expect(kv._store['ntfy_topic']).toBe('my-schedsec-alerts');
    });
  });

  describe('partial updates', () => {
    it('only updates provided keys, leaves others intact', async () => {
      const ctx = mockContext({
        inference_patterns_v2: { deep_work: { time_preference: 'Evening', duration: 120 } },
        work_hours: { start: '08:00', end: '18:00' }
      });
      await OnboardingManager.applyAnswers({ meeting_length: 1 }, ctx);
      // deep_work should be unchanged
      expect(ctx._store['inference_patterns_v2'].deep_work.time_preference).toBe('Evening');
      // meeting should now have duration
      expect(ctx._store['inference_patterns_v2'].meeting.duration).toBe(45);
      // work_hours untouched
      expect(ctx._store['work_hours']).toEqual({ start: '08:00', end: '18:00' });
    });
  });

  describe('reset mode', () => {
    it('clears inference_patterns_v2 before applying', async () => {
      const ctx = mockContext({
        inference_patterns_v2: { custom_rule: { confidence: 0.9 } }
      });
      await OnboardingManager.applyAnswers({ deep_work_time: 0 }, ctx, null, true);
      // Should only have deep_work from fresh apply, not the old custom_rule
      expect(ctx._store['inference_patterns_v2'].custom_rule).toBeUndefined();
      expect(ctx._store['inference_patterns_v2'].deep_work).toBeDefined();
    });

    it('returns reset: true in result', async () => {
      const ctx = mockContext();
      const result = await OnboardingManager.applyAnswers({}, ctx, null, true);
      expect(result.reset).toBe(true);
    });
  });

  describe('isValidTime', () => {
    it('accepts valid 24h times', () => {
      expect(OnboardingManager.isValidTime('00:00')).toBe(true);
      expect(OnboardingManager.isValidTime('21:30')).toBe(true);
      expect(OnboardingManager.isValidTime('23:59')).toBe(true);
    });

    it('rejects out-of-range times', () => {
      expect(OnboardingManager.isValidTime('24:00')).toBe(false);
      expect(OnboardingManager.isValidTime('21:60')).toBe(false);
    });

    it('rejects wrong format', () => {
      expect(OnboardingManager.isValidTime('9:30')).toBe(false);
      expect(OnboardingManager.isValidTime('9:30pm')).toBe(false);
      expect(OnboardingManager.isValidTime('')).toBe(false);
    });
  });
});



/**
 * Extended * Core regression suite for smart features.
 */

// ─── BufferLearning ──────────────────────────────────────────────────────────

describe('BufferLearning', () => {
  describe('extractTransitionBuffers', () => {
    it('computes average buffer between energy type transitions', () => {
      const schedule = [
        { final_start: '09:00', ai_duration: 60, final_duration: 60, energy: 'Deep' },
        { final_start: '10:15', ai_duration: 30, final_duration: 30, energy: 'Light' }, // 15 min gap
        { final_start: '10:50', ai_duration: 30, final_duration: 30, energy: 'Light' }  // 5 min gap
      ];
      const buffers = BufferLearning.extractTransitionBuffers(schedule);
      expect(buffers['Deep→Light']).toBeDefined();
      expect(buffers['Deep→Light'].avgBuffer).toBe(15);
      expect(buffers['Light→Light']).toBeDefined();
      expect(buffers['Light→Light'].avgBuffer).toBe(5);
    });

    it('skips entries without final_start', () => {
      const schedule = [
        { final_start: '09:00', ai_duration: 60, final_duration: 60, energy: 'Deep' },
        { ai_duration: 30, energy: 'Light' } // no final_start
      ];
      const buffers = BufferLearning.extractTransitionBuffers(schedule);
      expect(Object.keys(buffers).length).toBe(0);
    });

    it('ignores gaps > 60 min (likely includes a break)', () => {
      const schedule = [
        { final_start: '09:00', ai_duration: 60, final_duration: 60, energy: 'Deep' },
        { final_start: '11:30', ai_duration: 60, final_duration: 60, energy: 'Light' } // 90 min gap
      ];
      const buffers = BufferLearning.extractTransitionBuffers(schedule);
      expect(Object.keys(buffers).length).toBe(0);
    });

    it('returns empty object for empty schedule', () => {
      expect(BufferLearning.extractTransitionBuffers([])).toEqual({});
    });
  });

  describe('getBuffer', () => {
    it('returns learned buffer when samples >= 3', () => {
      const learned = { 'Deep→Light': { avgBuffer: 20, samples: 5 } };
      expect(BufferLearning.getBuffer('Deep', 'Light', learned)).toBe(20);
    });

    it('returns default for insufficient samples', () => {
      const learned = { 'Deep→Light': { avgBuffer: 20, samples: 1 } };
      const result = BufferLearning.getBuffer('Deep', 'Light', learned);
      expect(result).toBe(15); // Deep→anything default
    });

    it('uses hardcoded Deep→Deep default of 20', () => {
      expect(BufferLearning.getBuffer('Deep', 'Deep', {})).toBe(20);
    });

    it('uses hardcoded Moderate→Light default of 5', () => {
      expect(BufferLearning.getBuffer('Moderate', 'Light', {})).toBe(5);
    });

    it('falls back to CONFIG buffer when no match', () => {
      const result = BufferLearning.getBuffer('Light', 'Moderate', {});
      expect(result).toBe(15); // CONFIG.DEFAULTS.BUFFER_TIME
    });
  });

  describe('utility methods', () => {
    it('addMinutes advances time correctly', () => {
      expect(BufferLearning.addMinutes('09:00', 75)).toBe('10:15');
      expect(BufferLearning.addMinutes('23:30', 60)).toBe('00:30');
    });

    it('diffMinutes computes gap correctly', () => {
      expect(BufferLearning.diffMinutes('10:15', '10:00')).toBe(15);
      expect(BufferLearning.diffMinutes('09:00', '09:00')).toBe(0);
    });
  });
});

// ─── EnergyCurve ─────────────────────────────────────────────────────────────

describe('EnergyCurve', () => {
  describe('updateCurve', () => {
    it('accumulates ratings per hour slot', () => {
      const entries = [
        { final_start: '09:30', completion_rating: 5 },
        { final_start: '09:45', completion_rating: 4 },
        { final_start: '14:00', completion_rating: 3 }
      ];
      const curve = EnergyCurve.updateCurve({}, entries);
      expect(curve['09:00'].totalRating).toBe(9); // 5+4
      expect(curve['09:00'].count).toBe(2);
      expect(curve['14:00'].totalRating).toBe(3);
      expect(curve['14:00'].count).toBe(1);
    });

    it('skips entries without rating or time', () => {
      const entries = [
        { final_start: '09:00' }, // no rating
        { completion_rating: 4 }   // no time
      ];
      const curve = EnergyCurve.updateCurve({}, entries);
      expect(Object.keys(curve).length).toBe(0);
    });

    it('merges into existing curve data', () => {
      const existing = { '09:00': { totalRating: 10, count: 3 } };
      const entries = [{ final_start: '09:00', completion_rating: 5 }];
      const curve = EnergyCurve.updateCurve(existing, entries);
      expect(curve['09:00'].totalRating).toBe(15);
      expect(curve['09:00'].count).toBe(4);
    });
  });

  describe('getPeakWindow', () => {
    it('returns null with insufficient data (< 14 samples per slot)', () => {
      const curve = {
        '09:00': { totalRating: 40, count: 10 },
        '10:00': { totalRating: 35, count: 10 }
      };
      expect(EnergyCurve.getPeakWindow(curve)).toBeNull();
    });

    it('returns top 2 hours when data is sufficient', () => {
      const curve = {
        '09:00': { totalRating: 70, count: 14 }, // avg 5.0
        '10:00': { totalRating: 56, count: 14 }, // avg 4.0
        '14:00': { totalRating: 42, count: 14 }, // avg 3.0
        '15:00': { totalRating: 28, count: 14 }  // avg 2.0
      };
      const peak = EnergyCurve.getPeakWindow(curve);
      expect(peak).not.toBeNull();
      expect(peak.peakHours).toContain('09:00');
      expect(peak.peakHours).toContain('10:00');
      expect(peak.peakHours.length).toBe(2);
    });
  });

  describe('getSuggestedPreference', () => {
    it('returns Morning for morning peak hours', () => {
      const curve = {
        '09:00': { totalRating: 70, count: 14 },
        '10:00': { totalRating: 56, count: 14 }
      };
      expect(EnergyCurve.getSuggestedPreference(curve)).toBe('Morning');
    });

    it('returns Afternoon for afternoon peak', () => {
      const curve = {
        '13:00': { totalRating: 70, count: 14 },
        '14:00': { totalRating: 56, count: 14 }
      };
      expect(EnergyCurve.getSuggestedPreference(curve)).toBe('Afternoon');
    });

    it('returns null with insufficient data', () => {
      expect(EnergyCurve.getSuggestedPreference({})).toBeNull();
    });
  });
});

// ─── TaskBatching ────────────────────────────────────────────────────────────

describe('TaskBatching', () => {
  describe('categorize', () => {
    it('detects communication tasks', () => {
      expect(TaskBatching.categorize({ name: 'Reply to email' })).toBe('communication');
      expect(TaskBatching.categorize({ name: 'Slack messages' })).toBe('communication');
    });

    it('detects admin tasks', () => {
      expect(TaskBatching.categorize({ name: 'Submit expense report' })).toBe('admin');
    });

    it('detects review tasks', () => {
      expect(TaskBatching.categorize({ name: 'Review PR #42' })).toBe('review');
    });

    it('detects writing tasks', () => {
      expect(TaskBatching.categorize({ name: 'Write quarterly report' })).toBe('writing');
    });

    it('detects meeting tasks', () => {
      expect(TaskBatching.categorize({ name: 'Team standup' })).toBe('meeting');
    });

    it('returns null for uncategorizable tasks', () => {
      expect(TaskBatching.categorize({ name: 'Deep work session' })).toBeNull();
    });

    it('handles missing name gracefully', () => {
      expect(TaskBatching.categorize({})).toBeNull();
    });
  });

  describe('groupTasks', () => {
    it('groups categorizable tasks and separates unbatched', () => {
      const tasks = [
        { name: 'Reply to email' },
        { name: 'Slack update' },
        { name: 'Deep focus time' },
        { name: 'Review PR' }
      ];
      const { batched, unbatched } = TaskBatching.groupTasks(tasks);
      expect(batched.communication.length).toBe(2);
      expect(batched.review.length).toBe(1);
      expect(unbatched.length).toBe(1);
      expect(unbatched[0].name).toBe('Deep focus time');
    });

    it('returns all unbatched when no keywords match', () => {
      const tasks = [{ name: 'Meditate' }, { name: 'Workout' }];
      const { batched, unbatched } = TaskBatching.groupTasks(tasks);
      expect(Object.keys(batched).length).toBe(0);
      expect(unbatched.length).toBe(2);
    });
  });

  describe('getBatchingHints', () => {
    it('generates hints for categories with ≥ 2 tasks', () => {
      const tasks = [
        { name: 'Reply to email' },
        { name: 'Follow up on slack' },
        { name: 'Submit expense' }
      ];
      const hints = TaskBatching.getBatchingHints(tasks);
      expect(hints.length).toBe(1); // only communication has ≥ 2
      expect(hints[0]).toContain('communication');
    });

    it('returns no hints when no category has ≥ 2 tasks', () => {
      const tasks = [
        { name: 'Reply to email' },
        { name: 'Review PR' },
        { name: 'Deep focus' }
      ];
      const hints = TaskBatching.getBatchingHints(tasks);
      expect(hints.length).toBe(0);
    });
  });
});

// ─── PlanningManager ─────────────────────────────────────────────────────────

describe('PlanningManager', () => {
  describe('generateScenario', () => {
    it('returns preview with modifications applied', () => {
      const tasks = [
        { id: 't1', name: 'Task A', type: 'TASK', duration: 60, status: 'Active' },
        { id: 't2', name: 'Task B', type: 'TASK', duration: 30, status: 'Active' }
      ];
      const mods = { add_tasks: [], remove_tasks: ['t2'], modify_tasks: [] };
      const result = PlanningManager.generateScenario(tasks, mods);
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.modifications_applied).toEqual(mods);
    });

    it('adds tasks when modifications.add_tasks provided', () => {
      const tasks = [{ id: 't1', name: 'A', type: 'TASK', status: 'Active' }];
      const mods = {
        add_tasks: [{ name: 'New', type: 'TASK', duration: 45 }],
        remove_tasks: [],
        modify_tasks: []
      };
      const result = PlanningManager.generateScenario(tasks, mods);
      expect(result.data.length).toBeGreaterThan(1);
    });
  });

  describe('generateWhatIf', () => {
    it('uses provided tasks when given', async () => {
      const tasks = [
        { id: 't1', name: 'A', type: 'TASK', duration: 60, status: 'Active' }
      ];
      const result = await PlanningManager.generateWhatIf(tasks, {}, null, '2026-03-01');
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('returns empty scenario when no tasks and no env', async () => {
      const result = await PlanningManager.generateWhatIf([], {}, null, '2026-03-01');
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });
});

// ─── UndoManager ─────────────────────────────────────────────────────────────

describe('UndoManager', () => {
  it('hasSnapshot returns false when no snapshot', async () => {
    const kv = { get: vi.fn().mockResolvedValue(null) };
    const undo = new UndoManager(kv, {});
    expect(await undo.hasSnapshot('2026-03-01')).toBe(false);
  });

  it('hasSnapshot returns true when snapshot exists', async () => {
    const kv = { get: vi.fn().mockResolvedValue('[]') };
    const undo = new UndoManager(kv, {});
    expect(await undo.hasSnapshot('2026-03-01')).toBe(true);
  });

  it('restoreSnapshot returns NO_SNAPSHOT when empty', async () => {
    const kv = { get: vi.fn().mockResolvedValue(null) };
    const notion = { queryDatabase: vi.fn(), archivePage: vi.fn(), createPage: vi.fn() };
    notion.queryDatabase.mockResolvedValue({ results: [] });
    const undo = new UndoManager(kv, notion);
    const result = await undo.restoreSnapshot('2026-03-01', 'db-id');
    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_SNAPSHOT');
  });
});

// ─── Trigger Token ───────────────────────────────────────────────────────────

describe('Trigger token', () => {
  const secret = 'test-secret-123';

  it('validateTriggerToken accepts token from generateTriggerToken', async () => {
    const token = await generateTriggerToken('regenerate', '2026-03-01', secret);
    const valid = await validateTriggerToken('regenerate', '2026-03-01', token, secret);
    expect(valid).toBe(true);
  });

  it('validateTriggerToken rejects wrong action', async () => {
    const token = await generateTriggerToken('regenerate', '2026-03-01', secret);
    const valid = await validateTriggerToken('undo', '2026-03-01', token, secret);
    expect(valid).toBe(false);
  });

  it('validateTriggerToken rejects wrong date', async () => {
    const token = await generateTriggerToken('regenerate', '2026-03-01', secret);
    const valid = await validateTriggerToken('regenerate', '2026-03-02', token, secret);
    expect(valid).toBe(false);
  });

  it('validateTriggerToken rejects empty secret', async () => {
    const valid = await validateTriggerToken('regenerate', '2026-03-01', 'abc', '');
    expect(valid).toBe(false);
  });
});

// ── PanicManager ─────────────────────────────────────────────────────────────

describe('PanicManager', () => {
  describe('applyOverrides', () => {
    const tasks = [
      { id: '1', name: 'Meeting', energy: 'Light', priority: 'High', duration: 60 },
      { id: '2', name: 'Deep Work', energy: 'Deep', priority: 'High', duration: 120 },
      { id: '3', name: 'Admin', energy: 'Light', priority: 'Low', duration: 30 }
    ];

    it('returns original tasks if no override', () => {
      expect(PanicManager.applyOverrides(tasks, null)).toEqual(tasks);
    });

    it('filters by energy and priority', () => {
      const filtered = PanicManager.applyOverrides(tasks, {
        energy_filter: ['Light'], priority_filter: ['High']
      });
      expect(filtered.length).toBe(1);
      expect(filtered[0].id).toBe('1');
    });

    it('enforces max_work_hours by dropping overflowing tasks', () => {
      // 120 mins max = 2 hours.
      const override = { max_work_hours: 2 };
      // task 1 (60), task 2 (120 - drops because total 180 > 120), task 3 (30 - added, total 90 <= 120)
      const filtered = PanicManager.applyOverrides(tasks, override);
      expect(filtered.length).toBe(2);
      expect(filtered.map(t => t.id)).toEqual(['1', '3']);
    });
  });
});

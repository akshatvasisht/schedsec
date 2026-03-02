import { describe, it, expect, vi } from 'vitest';
import { BufferLearning } from '../../src/features/buffer-learning.js';
import { EnergyCurve } from '../../src/features/energy-curve.js';
import { TaskBatching } from '../../src/features/task-batching.js';
import { PlanningManager } from '../../src/features/planning.js';
import { UndoManager } from '../../src/features/undo.js';
import { validateTriggerToken, generateTriggerToken } from '../../src/trigger.js';

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

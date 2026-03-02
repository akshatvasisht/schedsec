import { describe, it, expect } from 'vitest';
import { UrgencyCalculator } from '../../src/scheduler/urgency.js';
import { FallbackScheduler } from '../../src/scheduler/fallback.js';
import { BackgroundTaskManager } from '../../src/scheduler/background.js';
import { TaskManager } from '../../src/scheduler/task-types.js';
import { RecurrenceManager } from '../../src/scheduler/recurrence.js';
import { MLIntelligence } from '../../src/scheduler/ml-intelligence.js';

/**
 * Extended Scheduler Tests — Docs-Driven
 * Core regression suite for scheduler constraint validation algorithms.
 */

// ─── UrgencyCalculator ───────────────────────────────────────────────────────

describe('UrgencyCalculator', () => {
  const today = new Date('2026-02-26');

  describe('calculateUrgency', () => {
    it('scores overdue/due-today tasks highest', () => {
      const task = { priority: 'High', deadline: '2026-02-26' }; // Due today
      const score = UrgencyCalculator.calculateUrgency(task, today);
      // High base (100) + due-today bonus (500) = 600
      expect(score).toBeGreaterThanOrEqual(500);
    });

    it('scores due-tomorrow tasks higher than due-next-week', () => {
      const tomorrow = { priority: 'Medium', deadline: '2026-02-27' };
      const nextWeek = { priority: 'Medium', deadline: '2026-03-05' };
      const scoreTomorrow = UrgencyCalculator.calculateUrgency(tomorrow, today);
      const scoreNextWeek = UrgencyCalculator.calculateUrgency(nextWeek, today);
      expect(scoreTomorrow).toBeGreaterThan(scoreNextWeek);
    });

    it('gives no deadline bonus when no deadline set', () => {
      const noDeadline = { priority: 'Low' };
      const score = UrgencyCalculator.calculateUrgency(noDeadline, today);
      expect(score).toBeLessThan(50); // Only base priority
    });

    it('boosts multi-day in-progress tasks', () => {
      const multiDay = { priority: 'Medium', estimated_days: 3 };
      const singleDay = { priority: 'Medium' };
      const multi = UrgencyCalculator.calculateUrgency(multiDay, today);
      const single = UrgencyCalculator.calculateUrgency(singleDay, today);
      expect(multi).toBeGreaterThan(single);
    });

    it('handles unknown priority gracefully', () => {
      const task = { priority: 'Unknown' };
      const score = UrgencyCalculator.calculateUrgency(task, today);
      expect(score).toBeGreaterThanOrEqual(0);
    });
  });

  describe('sortByUrgency', () => {
    it('orders tasks by descending urgency', () => {
      const tasks = [
        { id: 'low', priority: 'Low' },
        { id: 'high', priority: 'High', deadline: '2026-02-26' },
        { id: 'med', priority: 'Medium' }
      ];
      const sorted = UrgencyCalculator.sortByUrgency(tasks);
      expect(sorted[0].id).toBe('high');
      expect(sorted[sorted.length - 1].id).toBe('low');
    });

    it('does not mutate the original array', () => {
      const tasks = [{ id: 'a', priority: 'Low' }, { id: 'b', priority: 'High' }];
      const sorted = UrgencyCalculator.sortByUrgency(tasks);
      expect(sorted).not.toBe(tasks);
      expect(tasks[0].id).toBe('a'); // unchanged
    });
  });
});

// ─── FallbackScheduler ───────────────────────────────────────────────────────

describe('FallbackScheduler', () => {
  it('produces a schedule with one entry per task', () => {
    const tasks = [
      { id: 't1', name: 'Task A', duration: 60, priority: 'High', dependsOn: [] },
      { id: 't2', name: 'Task B', duration: 30, priority: 'Low', dependsOn: [] }
    ];
    const schedule = FallbackScheduler.generate(tasks);
    expect(schedule.length).toBe(2);
    expect(schedule[0].task_id).toBeDefined();
    expect(schedule[0].start).toMatch(/^\d{2}:\d{2}$/);
  });

  it('adds buffer between sequential tasks', () => {
    const tasks = [
      { id: 't1', name: 'A', duration: 60, priority: 'Medium', dependsOn: [] },
      { id: 't2', name: 'B', duration: 60, priority: 'Medium', dependsOn: [] }
    ];
    const schedule = FallbackScheduler.generate(tasks);
    // Second task should not start immediately after first
    expect(schedule[1].start).not.toBe(schedule[0].start);
  });

  it('handles circular dependency gracefully (falls back to urgency sort)', () => {
    const tasks = [
      { id: 't1', name: 'A', duration: 30, priority: 'High', dependsOn: ['t2'] },
      { id: 't2', name: 'B', duration: 30, priority: 'Low', dependsOn: ['t1'] }
    ];
    // Should NOT throw — fallback catches the cycle and uses urgency
    const schedule = FallbackScheduler.generate(tasks);
    expect(schedule.length).toBe(2);
  });

  it('respects dependency order when no cycle exists', () => {
    const tasks = [
      { id: 't1', name: 'Depends on t2', duration: 30, priority: 'High', dependsOn: ['t2'] },
      { id: 't2', name: 'No deps', duration: 30, priority: 'Low', dependsOn: [] }
    ];
    const schedule = FallbackScheduler.generate(tasks);
    const ids = schedule.map(s => s.task_id);
    expect(ids.indexOf('t2')).toBeLessThan(ids.indexOf('t1'));
  });

  it('uses default duration for tasks missing duration', () => {
    const tasks = [
      { id: 't1', name: 'No duration', priority: 'Medium', dependsOn: [] }
    ];
    const schedule = FallbackScheduler.generate(tasks);
    expect(schedule[0].duration).toBe(60); // CONFIG.DEFAULTS.TASK_DURATION
  });
});

// ─── BackgroundTaskManager ───────────────────────────────────────────────────

describe('BackgroundTaskManager', () => {
  describe('isBackground', () => {
    it('returns true for tasks with background flag', () => {
      expect(BackgroundTaskManager.isBackground({ background: true })).toBe(true);
    });

    it('returns true for TIME_BLOCK tasks', () => {
      expect(BackgroundTaskManager.isBackground({ type: 'TIME_BLOCK' })).toBe(true);
    });

    it('returns false for regular tasks', () => {
      expect(BackgroundTaskManager.isBackground({ type: 'TASK', background: false })).toBe(false);
    });
  });

  describe('getFocusTasks', () => {
    it('filters out background tasks', () => {
      const schedule = [
        { task_id: 't1', background: true },
        { task_id: 't2', background: false },
        { task_id: 't3' }
      ];
      const focus = BackgroundTaskManager.getFocusTasks(schedule);
      expect(focus.length).toBe(2);
      expect(focus.every(t => !t.background)).toBe(true);
    });
  });

  describe('validateDensity', () => {
    it('warns when more than 5 background tasks', () => {
      const tasks = Array.from({ length: 7 }, (_, i) => ({ id: `t${i}`, background: true }));
      const result = BackgroundTaskManager.validateDensity(tasks);
      expect(result.warning).toBe(true);
      expect(result.message).toContain('7');
    });

    it('no warning at 5 or fewer background tasks', () => {
      const tasks = [
        { id: 't1', background: true },
        { id: 't2', background: false },
        { id: 't3', background: true }
      ];
      const result = BackgroundTaskManager.validateDensity(tasks);
      expect(result.warning).toBe(false);
    });
  });
});

// ─── TaskManager ─────────────────────────────────────────────────────────────

describe('TaskManager', () => {
  const allTypes = [
    { id: 't1', type: 'FIXED_APPOINTMENT', duration: 60 },
    { id: 't2', type: 'TASK', duration: 120 },
    { id: 't3', type: 'TIME_BLOCK', duration: 90 },
    { id: 't4', type: 'TASK', duration: 30 }
  ];

  it('extracts only FIXED_APPOINTMENT tasks', () => {
    const fixed = TaskManager.getFixedAppointments(allTypes);
    expect(fixed.length).toBe(1);
    expect(fixed[0].id).toBe('t1');
  });

  it('extracts TASK and TIME_BLOCK as schedulable', () => {
    const schedulable = TaskManager.getSchedulableTasks(allTypes);
    expect(schedulable.length).toBe(3);
    expect(schedulable.map(t => t.type)).not.toContain('FIXED_APPOINTMENT');
  });

  it('identifies focus-consuming tasks (not TIME_BLOCK, not background)', () => {
    expect(TaskManager.isFocusConsuming({ type: 'TASK', background: false })).toBe(true);
    expect(TaskManager.isFocusConsuming({ type: 'TIME_BLOCK' })).toBe(false);
    expect(TaskManager.isFocusConsuming({ type: 'TASK', background: true })).toBe(false);
  });

  it('normalizeTask fills defaults for missing fields', () => {
    const bare = { id: 't1', name: 'Test' };
    const normalized = TaskManager.normalizeTask(bare);
    expect(normalized.duration).toBe(60);   // DEFAULTS.TASK_DURATION
    expect(normalized.energy).toBe('Moderate'); // DEFAULTS.ENERGY_LEVEL
    expect(normalized.priority).toBe('Medium'); // DEFAULTS.PRIORITY
  });

  it('normalizeTask preserves existing values', () => {
    const full = { id: 't1', duration: 120, energy: 'Deep', priority: 'High' };
    const normalized = TaskManager.normalizeTask(full);
    expect(normalized.duration).toBe(120);
    expect(normalized.energy).toBe('Deep');
    expect(normalized.priority).toBe('High');
  });
});

// ─── RecurrenceManager ───────────────────────────────────────────────────────

describe('RecurrenceManager', () => {
  describe('shouldGenerate', () => {
    const baseTask = { status: 'Active', last_generated: '1970-01-01' };

    it('generates for Daily recurrence on any day', () => {
      const task = { ...baseTask, recurrence: 'Daily' };
      expect(RecurrenceManager.shouldGenerate(task, '2026-02-26')).toBe(true);
    });

    it('generates for matching weekday', () => {
      // new Date('2026-02-26') resolves to Wednesday in US timezones (UTC midnight shift)
      const task = { ...baseTask, recurrence: 'Wednesday' };
      expect(RecurrenceManager.shouldGenerate(task, '2026-02-26')).toBe(true);
    });

    it('does not generate for non-matching weekday', () => {
      const task = { ...baseTask, recurrence: 'Monday' };
      expect(RecurrenceManager.shouldGenerate(task, '2026-02-26')).toBe(false);
    });

    it('generates Weekend recurrence on Saturday', () => {
      // 2026-03-01 resolves to Saturday in US timezones
      const task = { ...baseTask, recurrence: 'Weekend' };
      expect(RecurrenceManager.shouldGenerate(task, '2026-03-01')).toBe(true);
    });

    it('does not generate Weekend recurrence on weekday', () => {
      const task = { ...baseTask, recurrence: 'Weekend' };
      expect(RecurrenceManager.shouldGenerate(task, '2026-02-26')).toBe(false);
    });

    it('generates Weekday recurrence on Thursday', () => {
      const task = { ...baseTask, recurrence: 'Weekday' };
      expect(RecurrenceManager.shouldGenerate(task, '2026-02-26')).toBe(true);
    });

    it('does not regenerate if already generated for date', () => {
      const task = { ...baseTask, recurrence: 'Daily', last_generated: '2026-02-26' };
      expect(RecurrenceManager.shouldGenerate(task, '2026-02-26')).toBe(false);
    });

    it('returns false if no recurrence set', () => {
      const task = { ...baseTask, recurrence: null };
      expect(RecurrenceManager.shouldGenerate(task, '2026-02-26')).toBe(false);
    });

    it('returns false for non-Active tasks', () => {
      const task = { ...baseTask, recurrence: 'Daily', status: 'Paused' };
      expect(RecurrenceManager.shouldGenerate(task, '2026-02-26')).toBe(false);
    });
  });

  describe('createInstance', () => {
    it('creates instance with correct shape', () => {
      const parent = { id: 'parent1', name: 'Standup', duration: 15, recurrence: 'Daily', status: 'Active' };
      const instance = RecurrenceManager.createInstance(parent, '2026-02-26');
      expect(instance.id).toContain('rec_parent1_2026-02-26');
      expect(instance.parent_id).toBe('parent1');
      expect(instance.is_instance).toBe(true);
      expect(instance.deadline).toBe('2026-02-26');
    });
  });
});

// ─── MLIntelligence ──────────────────────────────────────────────────────────

describe('MLIntelligence', () => {
  describe('updateBayesianDuration', () => {
    it('blends prior and actual correctly', () => {
      // prior=60, confidence=0.5, actual=90
      // (60*0.5 + 90) / (0.5 + 1) = 120 / 1.5 = 80
      const result = MLIntelligence.updateBayesianDuration(60, 0.5, 90);
      expect(result.estimate).toBe(80);
      expect(result.confidence).toBe(0.55);
    });

    it('converges toward actual over multiple updates', () => {
      let est = 60, conf = 0.5;
      for (let i = 0; i < 5; i++) {
        const r = MLIntelligence.updateBayesianDuration(est, conf, 90);
        est = r.estimate;
        conf = r.confidence;
      }
      // After 5 updates with actual=90, estimate should be closer to 90
      expect(est).toBeGreaterThan(70);
      expect(est).toBeLessThanOrEqual(90);
    });

    it('caps confidence at 0.95', () => {
      let conf = 0.92;
      const r = MLIntelligence.updateBayesianDuration(60, conf, 60);
      expect(r.confidence).toBeLessThanOrEqual(0.95);
    });
  });

  describe('updateEMA', () => {
    it('blends old and new with alpha=0.3', () => {
      // 0.3*50 + 0.7*100 = 15 + 70 = 85
      const result = MLIntelligence.updateEMA(100, 50, 0.3);
      expect(result).toBeCloseTo(85, 1);
    });

    it('returns new value when old is not a number', () => {
      expect(MLIntelligence.updateEMA('old', 42)).toBe(42);
    });
  });

  describe('calculateUCB', () => {
    it('returns Infinity for untried slots (exploration)', () => {
      expect(MLIntelligence.calculateUCB(0, 0, 10)).toBe(Infinity);
    });

    it('balances exploitation and exploration', () => {
      // Well-tried good slot vs less-tried slot
      const goodSlot = MLIntelligence.calculateUCB(20, 5, 20); // avg=4 + exploration
      const newSlot = MLIntelligence.calculateUCB(3, 1, 20);   // avg=3 + higher exploration
      // Both should be finite
      expect(goodSlot).toBeGreaterThan(0);
      expect(newSlot).toBeGreaterThan(0);
    });
  });

  describe('calculateZScore', () => {
    it('returns 0 when stddev is 0', () => {
      expect(MLIntelligence.calculateZScore(5, 5, 0)).toBe(0);
    });

    it('computes correct z-score', () => {
      // (10 - 5) / 2.5 = 2.0
      expect(MLIntelligence.calculateZScore(10, 5, 2.5)).toBe(2);
    });
  });

  describe('detectAnomalies', () => {
    it('flags metrics with z-score > 2', () => {
      const metrics = { edit_rate: 0.8, completion_rate: 0.3, conflict_count: 5 };
      const baseline = {
        edit_rate: { mean: 0.1, stddev: 0.05 },
        completion_rate: { mean: 0.9, stddev: 0.1 },
        conflict_count: { mean: 1, stddev: 1 }
      };
      const anomalies = MLIntelligence.detectAnomalies(metrics, baseline);
      expect(anomalies.length).toBeGreaterThan(0);
      expect(anomalies.some(a => a.metric === 'edit_rate')).toBe(true);
    });

    it('reports no anomalies when metrics are normal', () => {
      const metrics = { edit_rate: 0.1, completion_rate: 0.9, conflict_count: 1 };
      const baseline = {
        edit_rate: { mean: 0.1, stddev: 0.1 },
        completion_rate: { mean: 0.9, stddev: 0.1 },
        conflict_count: { mean: 1, stddev: 1 }
      };
      const anomalies = MLIntelligence.detectAnomalies(metrics, baseline);
      expect(anomalies.length).toBe(0);
    });

    it('classifies z > 3 as CRITICAL', () => {
      const metrics = { edit_rate: 1.0 };
      const baseline = { edit_rate: { mean: 0.1, stddev: 0.05 } };
      const anomalies = MLIntelligence.detectAnomalies(metrics, baseline);
      expect(anomalies[0].severity).toBe('CRITICAL');
    });
  });
});

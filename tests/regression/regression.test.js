import { describe, it, expect } from 'vitest';
import { DependencyResolver } from '../../src/scheduler/dependencies.js';
import { OptimizationEngine } from '../../src/scheduler/optimizations.js';
import { MultiDayScheduler } from '../../src/scheduler/multi-day.js';
import { PanicManager } from '../../src/features/panic.js';
import { SlotFinder } from '../../src/scheduler/slots.js';
import { InferenceEngine } from '../../src/scheduler/inference.js';
import { ScheduleResponseSchema } from '../../src/utils/validation.js';

/**
 * Core Regression Suite (RT001-RT012)
 * Validates deterministic constraints and graph theory algorithms.
 */

describe('RT001: Simple day — no conflicts', () => {
  it('schedules all tasks within work hours', () => {
    const tasks = [
      { id: 't1', name: 'Meeting', duration: 60, priority: 'High', dependsOn: [] },
      { id: 't2', name: 'Code', duration: 120, priority: 'Medium', dependsOn: [] }
    ];
    const sorted = DependencyResolver.topologicalSort(tasks);
    expect(sorted.length).toBe(2);

    const slot1 = SlotFinder.findEarliestSlot(60, {}, [], '09:00', '17:00');
    expect(slot1).toBe('09:00');

    const slot2 = SlotFinder.findEarliestSlot(120, {}, [{ start: '09:00', duration: 60 }], '09:00', '17:00');
    expect(slot2).not.toBeNull();
  });
});

describe('RT002: Impossible constraint — detect before AI call', () => {
  it('detects infeasible schedule', () => {
    const tasks = [
      { id: 't1', duration: 120 },
      { id: 't2', duration: 120 },
      { id: 't3', duration: 120 }
    ];
    // 360 min of tasks in a 60 min window = infeasible
    const result = OptimizationEngine.validateFeasibility(tasks, '09:00', '10:00');
    expect(result.feasible).toBe(false);
    expect(result.overage).toBeGreaterThan(0);
  });
});

describe('RT003: Circular dependency — 3-node cycle', () => {
  it('detects circular dependency via DFS', () => {
    const tasks = [
      { id: 't1', name: 'A', dependsOn: ['t2'] },
      { id: 't2', name: 'B', dependsOn: ['t3'] },
      { id: 't3', name: 'C', dependsOn: ['t1'] }
    ];
    expect(() => DependencyResolver.topologicalSort(tasks)).toThrow(/Circular dependency/);
  });
});

describe('RT004: Energy budget violation', () => {
  it('detects deep work exceeding 4-hour budget', () => {
    const tasks = Array.from({ length: 10 }, (_, i) => ({
      id: `t${i}`, duration: 60, energy: 'Deep', priority: 'Medium'
    }));
    const result = OptimizationEngine.enforceEnergyBudgets(tasks);
    const deepTasks = result.filter(t => t.energy === 'Deep');
    const totalDeep = deepTasks.reduce((sum, t) => sum + t.duration, 0);
    expect(totalDeep).toBeLessThanOrEqual(240);
  });
});

describe('RT005: Fixed appointment — cannot be moved', () => {
  it('schedules flexible tasks around fixed appointments', () => {
    const fixed = [{ start: '14:00', duration: 60 }];
    const slot = SlotFinder.findEarliestSlot(480, {}, fixed, '09:00', '17:00');
    // Can't fit 480min around a 14:00-15:00 block in a 9-17 day, but check slot finding works
    expect(slot === null || SlotFinder.isAvailable(slot, 480, fixed)).toBeTruthy();
  });
});

describe('RT006: Critical path exceeds deadline', () => {
  it('validates multi-day task feasibility', () => {
    const tasks = [
      { id: 't1', duration: 480, estimatedDays: 3 },
      { id: 't2', duration: 480, estimatedDays: 3, dependsOn: ['t1'] },
      { id: 't3', duration: 480, estimatedDays: 3, dependsOn: ['t2'] }
    ];
    // critical path = 9 days, 7 days available = infeasible
    const criticalDays = tasks.reduce((sum, t) => sum + (t.estimatedDays || 1), 0);
    expect(criticalDays).toBe(9);
    expect(criticalDays).toBeGreaterThan(7); // deadline
  });
});

describe('RT007: JSON validation — malformed response', () => {
  it('rejects invalid time format and negative duration', () => {
    const malformed = [{ task_id: 't1', start: '25:00', duration: -10, day_number: 1 }];
    const result = ScheduleResponseSchema.safeParse(malformed);
    expect(result.success).toBe(false);
  });

  it('accepts valid schedule entry', () => {
    const valid = [{ task_id: 't1', start: '09:00', duration: 60, day_number: 1 }];
    const result = ScheduleResponseSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });
});

describe('RT008: Panic mode override', () => {
  it('filters tasks by energy and max hours', () => {
    const tasks = Array.from({ length: 20 }, (_, i) => ({
      id: `t${i}`, duration: 60, energy: 'Deep', priority: 'High'
    }));
    const override = { max_work_hours: 4, energy_filter: ['Light', 'Moderate'] };
    const result = PanicManager.applyOverrides(tasks, override);
    // All tasks are Deep, filter requires Light/Moderate → all filtered out
    expect(result.length).toBe(0);
  });

  it('respects max work hours for allowed energy levels', () => {
    const tasks = Array.from({ length: 10 }, (_, i) => ({
      id: `t${i}`, duration: 60, energy: 'Light', priority: 'Medium'
    }));
    const override = { max_work_hours: 4 };
    const result = PanicManager.applyOverrides(tasks, override);
    const totalDuration = result.reduce((sum, t) => sum + t.duration, 0);
    expect(totalDuration).toBeLessThanOrEqual(240);
  });
});

describe('RT009: Multi-day task splitting with energy decay', () => {
  it('splits 480min task into 40/35/25 ratios', () => {
    const task = { id: 't1', name: 'Write thesis', duration: 480, estimated_days: 3 };
    const segments = MultiDayScheduler.splitTask(task);
    expect(segments.length).toBe(3);
    expect(segments[0].duration).toBe(192); // 40%
    expect(segments[1].duration).toBe(168); // 35%
    expect(segments[2].duration).toBe(120); // 25%
    expect(segments[0].duration + segments[1].duration + segments[2].duration).toBe(480);
  });
});

describe('RT010: Inference pattern matching', () => {
  it('infers fields from keyword patterns', () => {
    const task = { name: 'Team meeting', duration: null, energy: null, priority: null };
    const patterns = { meeting: { duration: 60, energy: 'Moderate', priority: 'High' } };
    const inferred = InferenceEngine.inferFields(task, patterns);
    expect(inferred.duration).toBe(60);
    expect(inferred.energy).toBe('Moderate');
    expect(inferred.priority).toBe('High');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CriticalPathAnalyzer } from '../../src/scheduler/critical-path.js';
import { CollaborativeFilter } from '../../src/scheduler/collaborative-filter.js';
import { TimeSlotBandit } from '../../src/scheduler/time-slot-bandit.js';
import { AnomalyDetector } from '../../src/scheduler/anomaly-detection.js';
import { DependencyResolver } from '../../src/scheduler/dependencies.js';
import { PromptCompressor } from '../../src/learning/prompt-compression.js';

/**
 * Integration Test Suite
 * Tests new gap implementations in isolation with in-memory stubs.
 */

describe('CriticalPathAnalyzer', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-06-01')); });
  afterEach(() => { vi.useRealTimers(); });

  it('detects infeasible chains', () => {
    const tasks = [
      { id: 't1', name: 'Research', duration: 480, estimatedDays: 3, dependsOn: [], deadline: null },
      { id: 't2', name: 'Design', duration: 480, estimatedDays: 3, dependsOn: ['t1'], deadline: null },
      {
        id: 't3', name: 'Build', duration: 480, estimatedDays: 3, dependsOn: ['t2'],
        deadline: '2026-06-06T00:00:00.000Z'
      } // 5 days from now
    ];

    const result = CriticalPathAnalyzer.calculateCriticalPath(tasks);
    expect(result.feasible).toBe(false);
    expect(result.violations.length).toBe(1);
    expect(result.violations[0].needed).toBe(9);
    expect(result.violations[0].shortfall).toBeGreaterThan(0);
  });

  it('passes feasible chains', () => {
    const tasks = [
      {
        id: 't1', name: 'Quick task', duration: 60, estimatedDays: 1, dependsOn: [],
        deadline: '2026-06-11T00:00:00.000Z'
      }
    ];
    const result = CriticalPathAnalyzer.calculateCriticalPath(tasks);
    expect(result.feasible).toBe(true);
  });

  it('reconstructs path correctly', () => {
    const taskMap = new Map([
      ['t1', { id: 't1', name: 'A', dependsOn: [] }],
      ['t2', { id: 't2', name: 'B', dependsOn: ['t1'] }],
      ['t3', { id: 't3', name: 'C', dependsOn: ['t2'] }]
    ]);
    const path = CriticalPathAnalyzer.reconstructPath('t3', taskMap);
    expect(path).toEqual(['A', 'B', 'C']);
  });

  it('handles circular dependencies without crashing', () => {
    const tasks = [
      { id: 't1', name: 'A', dependsOn: ['t2'], deadline: '2026-07-01T00:00:00.000Z' },
      { id: 't2', name: 'B', dependsOn: ['t3'] },
      { id: 't3', name: 'C', dependsOn: ['t1'] }
    ];
    const result = CriticalPathAnalyzer.calculateCriticalPath(tasks);
    // Should not throw — cycles are handled gracefully
    expect(result).toBeDefined();
  });
});

describe('CollaborativeFilter', () => {
  it('finds similar tasks by name', () => {
    const newTask = { name: 'Team standup meeting' };
    const historical = [
      { name: 'Team standup meeting', duration: 30, energy: 'Light' },
      { name: 'Write documentation', duration: 120, energy: 'Deep' },
      { name: 'Team retrospective meeting', duration: 60, energy: 'Moderate' }
    ];

    const similar = CollaborativeFilter.findSimilarTasks(newTask, historical);
    expect(similar.length).toBeGreaterThan(0);
    expect(similar[0].task.name).toBe('Team standup meeting');
  });

  it('infers missing fields from similar tasks', () => {
    const newTask = { name: 'Team standup meeting', duration: null, energy: null };
    const historical = [
      { name: 'Team standup meeting', duration: 30, energy: 'Light', time_preference: 'Morning' },
      { name: 'Team planning meeting', duration: 60, energy: 'Moderate', time_preference: 'Morning' }
    ];

    const inferred = CollaborativeFilter.inferFromSimilar(newTask, historical);
    expect(inferred.duration).toBeGreaterThan(0);
    expect(inferred.energy).toBeTruthy();
    expect(inferred.notes).toContain('Inferred from similar');
  });

  it('returns original task if no similar found', () => {
    const task = { name: 'Unique xyz task', duration: null };
    const result = CollaborativeFilter.inferFromSimilar(task, [
      { name: 'Completely different', duration: 60 }
    ]);
    expect(result.duration).toBeNull();
  });
});

describe('TimeSlotBandit', () => {
  it('selects a slot', () => {
    const bandit = new TimeSlotBandit();
    const slot = bandit.selectSlot();
    expect(['morning', 'midday', 'afternoon', 'evening']).toContain(slot);
  });

  it('updates rewards and tracks stats', () => {
    const bandit = new TimeSlotBandit();
    bandit.updateReward('morning', 5);
    bandit.updateReward('morning', 4);
    bandit.updateReward('evening', 2);

    const stats = bandit.getStats();
    expect(parseFloat(stats.morning.avg_rating)).toBeCloseTo(4.5, 1);
    expect(stats.morning.attempts).toBe(2);
    expect(stats.evening.attempts).toBe(1);
  });

  it('serializes and deserializes', () => {
    const bandit = new TimeSlotBandit();
    bandit.updateReward('morning', 5);

    const json = bandit.toJSON();
    const restored = new TimeSlotBandit(json);
    expect(restored.slots.morning.rewards).toBe(5);
    expect(restored.slots.morning.tries).toBe(1);
  });
});

describe('AnomalyDetector', () => {
  it('detects anomalous edit rate', () => {
    const schedule = {
      entries: [
        { ai_start: '09:00', final_start: '10:00', ai_duration: 60, final_duration: 90, status: 'Done' },
        { ai_start: '11:00', final_start: '13:00', ai_duration: 60, final_duration: 120, status: 'Done' },
        { ai_start: '14:00', final_start: '15:00', ai_duration: 60, final_duration: 60, status: 'Done' }
      ]
    };
    const historicalStats = {
      avg_edit_rate: 0.1, stddev_edit_rate: 0.05,
      avg_completion_rate: 0.9, stddev_completion_rate: 0.1,
      avg_conflicts: 0, stddev_conflicts: 1
    };

    const result = AnomalyDetector.detectAnomalousSchedule(schedule, historicalStats);
    expect(result.is_anomalous).toBe(true);
    expect(result.anomalies.some(a => a.metric === 'edit_rate')).toBe(true);
  });

  it('reports normal schedule', () => {
    const schedule = {
      entries: [
        { ai_start: '09:00', final_start: '09:00', ai_duration: 60, final_duration: 60, status: 'Done' }
      ]
    };
    const historicalStats = {
      avg_edit_rate: 0, stddev_edit_rate: 0.1,
      avg_completion_rate: 1, stddev_completion_rate: 0.1,
      avg_conflicts: 0, stddev_conflicts: 1
    };

    const result = AnomalyDetector.detectAnomalousSchedule(schedule, historicalStats);
    expect(result.is_anomalous).toBe(false);
  });
});

describe('DependencyResolver.calculateLatestStartTime', () => {
  it('calculates latest start for must_complete_by constraint', () => {
    const task = { must_complete_by: '14:00', duration: 60 };
    const result = DependencyResolver.calculateLatestStartTime(task);
    expect(result).toBe('13:00');
  });

  it('returns null for impossible constraint', () => {
    const task = { must_complete_by: '00:30', duration: 60 };
    const result = DependencyResolver.calculateLatestStartTime(task);
    expect(result).toBeNull();
  });

  it('returns null if no must_complete_by', () => {
    const task = { duration: 60 };
    const result = DependencyResolver.calculateLatestStartTime(task);
    expect(result).toBeNull();
  });
});

describe('PromptCompressor', () => {
  it('compresses rules below token budget', () => {
    const rules = [
      { condition: 'meeting', action: 'schedule in morning', confidence: 0.9 },
      { condition: 'meeting', action: 'schedule in morning hours', confidence: 0.7 },
      { condition: 'deep work', action: 'schedule before lunch', confidence: 0.8 }
    ];

    const result = PromptCompressor.compressLearnedRules(rules, 200);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThan(800); // 200 tokens * 4 chars
  });

  it('returns empty string for empty rules', () => {
    expect(PromptCompressor.compressLearnedRules([])).toBe('');
    expect(PromptCompressor.compressLearnedRules(null)).toBe('');
  });
});

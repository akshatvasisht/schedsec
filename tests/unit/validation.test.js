import { describe, it, expect } from 'vitest';
import {
  TaskSchema,
  LearnedRuleSchema,
  InferencePatternSchema,
  ScheduleEntrySchema,
  ScheduleResponseSchema
} from '../../src/utils/validation.js';

/**
 * Extended Validation Tests — Docs-Driven
 * Tests Zod schemas beyond the ScheduleResponseSchema coverage in RT007.
 */

// ─── TaskSchema ──────────────────────────────────────────────────────────────

describe('TaskSchema', () => {
  it('validates a fully-specified task', () => {
    const task = {
      id: 'task-001',
      name: 'Write report',
      type: 'TASK',
      duration: 120,
      priority: 'High',
      energy: 'Deep',
      deadline: '2026-03-01',
      dependsOn: ['task-000'],
      recurrence: 'Daily',
      status: 'Active'
    };
    const result = TaskSchema.safeParse(task);
    expect(result.success).toBe(true);
  });

  it('validates a minimal task (nullable/optional fields omitted)', () => {
    const task = {
      id: 'task-002',
      name: 'Quick task',
      type: 'TASK',
      status: 'Active'
    };
    const result = TaskSchema.safeParse(task);
    expect(result.success).toBe(true);
    expect(result.data.dependsOn).toEqual([]); // default
  });

  it('rejects task missing required id', () => {
    const task = { name: 'No ID', type: 'TASK', status: 'Active' };
    const result = TaskSchema.safeParse(task);
    expect(result.success).toBe(false);
  });

  it('rejects task missing required name', () => {
    const task = { id: '1', type: 'TASK', status: 'Active' };
    const result = TaskSchema.safeParse(task);
    expect(result.success).toBe(false);
  });

  it('rejects invalid task type enum', () => {
    const task = { id: '1', name: 'Test', type: 'INVALID_TYPE', status: 'Active' };
    const result = TaskSchema.safeParse(task);
    expect(result.success).toBe(false);
  });

  it('rejects invalid priority enum', () => {
    const task = { id: '1', name: 'Test', type: 'TASK', priority: 'Urgent', status: 'Active' };
    const result = TaskSchema.safeParse(task);
    expect(result.success).toBe(false);
  });

  it('rejects invalid energy enum', () => {
    const task = { id: '1', name: 'Test', type: 'TASK', energy: 'Extreme', status: 'Active' };
    const result = TaskSchema.safeParse(task);
    expect(result.success).toBe(false);
  });

  it('accepts all three valid task types', () => {
    for (const type of ['TASK', 'FIXED_APPOINTMENT', 'TIME_BLOCK']) {
      const result = TaskSchema.safeParse({ id: '1', name: 'T', type, status: 'Active' });
      expect(result.success).toBe(true);
    }
  });

  it('accepts null for nullable optional fields', () => {
    const task = {
      id: '1', name: 'Test', type: 'TASK', status: 'Active',
      duration: null, priority: null, energy: null, deadline: null, recurrence: null
    };
    const result = TaskSchema.safeParse(task);
    expect(result.success).toBe(true);
  });
});

// ─── LearnedRuleSchema ───────────────────────────────────────────────────────

describe('LearnedRuleSchema', () => {
  it('validates a complete learned rule', () => {
    const rule = {
      condition: 'task=Exercise AND day=Monday',
      action: 'prefer_time=06:30',
      confidence: 0.85,
      learned_date: '2026-02-15',
      last_reinforced: '2026-02-20',
      application_count: 12,
      successful_applications: 10,
      vector_id: 'rule_abc123',
      source: 'user_edit'
    };
    const result = LearnedRuleSchema.safeParse(rule);
    expect(result.success).toBe(true);
  });

  it('validates rule without optional vector_id', () => {
    const rule = {
      condition: 'task=Meeting',
      action: 'schedule_afternoon',
      confidence: 0.6,
      learned_date: '2026-01-01',
      last_reinforced: '2026-01-15',
      application_count: 3,
      successful_applications: 2,
      source: 'bootstrap'
    };
    const result = LearnedRuleSchema.safeParse(rule);
    expect(result.success).toBe(true);
  });

  it('rejects rule missing required condition', () => {
    const rule = {
      action: 'schedule_morning',
      confidence: 0.5,
      learned_date: '2026-01-01',
      last_reinforced: '2026-01-01',
      application_count: 0,
      successful_applications: 0,
      source: 'bootstrap'
    };
    const result = LearnedRuleSchema.safeParse(rule);
    expect(result.success).toBe(false);
  });

  it('rejects rule missing required source', () => {
    const rule = {
      condition: 'test',
      action: 'test',
      confidence: 0.5,
      learned_date: '2026-01-01',
      last_reinforced: '2026-01-01',
      application_count: 0,
      successful_applications: 0
    };
    const result = LearnedRuleSchema.safeParse(rule);
    expect(result.success).toBe(false);
  });
});

// ─── InferencePatternSchema ──────────────────────────────────────────────────

describe('InferencePatternSchema', () => {
  it('validates a complete inference pattern', () => {
    const pattern = {
      samples: 15,
      confidence: 0.85,
      last_updated: '2026-02-20T10:00:00Z',
      last_reinforced: '2026-02-20T10:00:00Z',
      duration: 60,
      priority: 'High',
      energy: 'Deep',
      time_preference: 'Morning',
      variance: 5.2
    };
    const result = InferencePatternSchema.safeParse(pattern);
    expect(result.success).toBe(true);
  });

  it('validates a minimal pattern (optional fields omitted)', () => {
    const pattern = {
      samples: 0,
      confidence: 0.5,
      last_updated: '2026-01-01',
      last_reinforced: '2026-01-01'
    };
    const result = InferencePatternSchema.safeParse(pattern);
    expect(result.success).toBe(true);
  });

  it('rejects confidence outside 0-1 range', () => {
    const tooHigh = {
      samples: 1, confidence: 1.5,
      last_updated: '2026-01-01', last_reinforced: '2026-01-01'
    };
    expect(InferencePatternSchema.safeParse(tooHigh).success).toBe(false);

    const tooLow = {
      samples: 1, confidence: -0.1,
      last_updated: '2026-01-01', last_reinforced: '2026-01-01'
    };
    expect(InferencePatternSchema.safeParse(tooLow).success).toBe(false);
  });

  it('rejects missing required samples', () => {
    const pattern = {
      confidence: 0.5,
      last_updated: '2026-01-01',
      last_reinforced: '2026-01-01'
    };
    expect(InferencePatternSchema.safeParse(pattern).success).toBe(false);
  });
});

// ─── ScheduleEntrySchema (extended edge cases) ──────────────────────────────

describe('ScheduleEntrySchema (extended)', () => {
  it('accepts minimum valid duration (5 min)', () => {
    const entry = { task_id: 't1', start: '09:00', duration: 5 };
    const result = ScheduleEntrySchema.safeParse(entry);
    expect(result.success).toBe(true);
  });

  it('accepts maximum valid duration (480 min)', () => {
    const entry = { task_id: 't1', start: '09:00', duration: 480 };
    const result = ScheduleEntrySchema.safeParse(entry);
    expect(result.success).toBe(true);
  });

  it('rejects duration below minimum (4 min)', () => {
    const entry = { task_id: 't1', start: '09:00', duration: 4 };
    const result = ScheduleEntrySchema.safeParse(entry);
    expect(result.success).toBe(false);
  });

  it('rejects duration above maximum (481 min)', () => {
    const entry = { task_id: 't1', start: '09:00', duration: 481 };
    const result = ScheduleEntrySchema.safeParse(entry);
    expect(result.success).toBe(false);
  });

  it('defaults day_number to 1 when omitted', () => {
    const entry = { task_id: 't1', start: '09:00', duration: 60 };
    const result = ScheduleEntrySchema.safeParse(entry);
    expect(result.success).toBe(true);
    expect(result.data.day_number).toBe(1);
  });

  it('defaults inferred_fields to empty object', () => {
    const entry = { task_id: 't1', start: '09:00', duration: 60 };
    const result = ScheduleEntrySchema.safeParse(entry);
    expect(result.data.inferred_fields).toEqual({});
  });

  it('defaults conflicts to empty array', () => {
    const entry = { task_id: 't1', start: '09:00', duration: 60 };
    const result = ScheduleEntrySchema.safeParse(entry);
    expect(result.data.conflicts).toEqual([]);
  });

  it('rejects time format without leading zero', () => {
    const entry = { task_id: 't1', start: '9:00', duration: 60 };
    const result = ScheduleEntrySchema.safeParse(entry);
    expect(result.success).toBe(false);
  });

  it('rejects empty task_id', () => {
    const entry = { task_id: '', start: '09:00', duration: 60 };
    const result = ScheduleEntrySchema.safeParse(entry);
    expect(result.success).toBe(false);
  });

  it('ScheduleResponseSchema accepts empty array', () => {
    const result = ScheduleResponseSchema.safeParse([]);
    expect(result.success).toBe(true);
  });
});

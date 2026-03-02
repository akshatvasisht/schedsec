import { z } from 'zod';

/**
 * Zod schemas for validating data at runtime.
 */

// --- Notion Inputs ---
export const TaskSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['TASK', 'FIXED_APPOINTMENT', 'TIME_BLOCK']),
  duration: z.number().nullable().optional(),
  priority: z.enum(['High', 'Medium', 'Low']).nullable().optional(),
  energy: z.enum(['Deep', 'Moderate', 'Light']).nullable().optional(),
  deadline: z.string().nullable().optional(),
  dependsOn: z.array(z.string()).optional().default([]),
  recurrence: z.string().nullable().optional(),
  status: z.string()
});

// --- AI Output ---
export const ConflictSchema = z.object({
  type: z.string(),
  description: z.string(),
  resolution_options: z.array(z.string())
});

export const ScheduleEntrySchema = z.object({
  task_id: z.string().min(1, 'task_id must not be empty'),
  start: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format'),
  duration: z.number().min(5).max(480),
  day_number: z.number().int().min(1).optional().default(1),
  inferred_fields: z.record(z.any()).optional().default({}),
  conflicts: z.array(ConflictSchema).optional().default([]),
  notes: z.string().optional()
});

export const ScheduleResponseSchema = z.array(ScheduleEntrySchema);

// --- Context DB ---
export const ContextEntrySchema = z.object({
  key: z.string(),
  value: z.string(), // JSON string
  lastSync: z.string().optional()
});

// --- ML Intelligence / Patterns ---
export const InferencePatternSchema = z.object({
  samples: z.number(),
  confidence: z.number().min(0).max(1),
  last_updated: z.string(),
  last_reinforced: z.string(),
  duration: z.number().optional(),
  priority: z.string().optional(),
  energy: z.string().optional(),
  time_preference: z.string().optional(),
  variance: z.number().optional()
});

export const LearnedRuleSchema = z.object({
  condition: z.string(),
  action: z.string(),
  confidence: z.number(),
  learned_date: z.string(),
  last_reinforced: z.string(),
  application_count: z.number(),
  successful_applications: z.number(),
  vector_id: z.string().optional(),
  source: z.string()
});

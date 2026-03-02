import { NotionClient } from './notion-client.js';
import { Logger } from './logger.js';
import { ContextManager } from './context.js';
import { VectorizeManager } from './learning/vectorize.js';
import { CONFIG } from './config.js';

const P = CONFIG.PROPERTIES;

/**
 * Cold Start Seeding
 * @param env The parameter.
 * @returns {any} The return value.
 */
export async function bootstrapSystem(env) {
  const notion = new NotionClient(env.NOTION_API_KEY);
  const logger = new Logger(notion, env.LOGS_DB_ID);
  const context = new ContextManager(notion, env.CONTEXT_DB_ID);
  const vectorize = new VectorizeManager(env);

  // Check if already seeded
  const existingPatterns = await context.get('inference_patterns_v2');
  if (existingPatterns) {
    return { success: true, seeded: 0, reason: 'ALREADY_SEEDED' };
  }

  // Seed 5 default inference patterns with full metadata
  const defaultPatterns = {
    'meeting': {
      duration: 60, priority: 'High', energy: 'Moderate', time_preference: 'Morning',
      samples: 0, confidence: 0.5, variance: 0, source: 'bootstrap',
      last_updated: new Date().toISOString().split('T')[0],
      last_reinforced: new Date().toISOString().split('T')[0]
    },
    'workout': {
      duration: 45, priority: 'Medium', energy: 'Deep', time_preference: 'Morning',
      samples: 0, confidence: 0.5, variance: 0, source: 'bootstrap',
      last_updated: new Date().toISOString().split('T')[0],
      last_reinforced: new Date().toISOString().split('T')[0]
    },
    'email': {
      duration: 15, priority: 'Low', energy: 'Light', time_preference: 'Afternoon',
      samples: 0, confidence: 0.5, variance: 0, source: 'bootstrap',
      last_updated: new Date().toISOString().split('T')[0],
      last_reinforced: new Date().toISOString().split('T')[0]
    },
    'deep_work': {
      duration: 120, priority: 'High', energy: 'Deep', time_preference: 'Morning',
      samples: 0, confidence: 0.5, variance: 0, source: 'bootstrap',
      last_updated: new Date().toISOString().split('T')[0],
      last_reinforced: new Date().toISOString().split('T')[0]
    },
    'admin': {
      duration: 30, priority: 'Low', energy: 'Light', time_preference: 'Afternoon',
      samples: 0, confidence: 0.5, variance: 0, source: 'bootstrap',
      last_updated: new Date().toISOString().split('T')[0],
      last_reinforced: new Date().toISOString().split('T')[0]
    }
  };
  await context.set('inference_patterns_v2', defaultPatterns, 'Bootstrap inference patterns');

  // Seed 2 bootstrap learned rules with Vectorize embeddings
  const bootstrapRules = [
    {
      id: 'bootstrap_001',
      text: 'Schedule deep work tasks in morning when energy is highest',
      condition: 'energy=Deep',
      action: 'prefer_time=09:00-12:00',
      confidence: 0.6, samples: 0, source: 'bootstrap'
    },
    {
      id: 'bootstrap_002',
      text: 'Keep meetings short and schedule in afternoon',
      condition: 'task_type=meeting',
      action: 'duration=60 AND time=14:00-16:00',
      confidence: 0.6, samples: 0, source: 'bootstrap'
    }
  ];

  for (const rule of bootstrapRules) {
    try {
      await vectorize.insertRule(rule.id, rule.text, rule);
    } catch (e) {
      await logger.warn('Failed to seed bootstrap rule in Vectorize', { error: e.message, rule: rule.id });
    }
  }

  // Store rule manifest in Context DB
  await context.set('learned_rules_vectors', {
    rules: bootstrapRules.map(r => ({
      id: r.id, text: r.text, vector_id: r.id,
      confidence: r.confidence, created: new Date().toISOString().split('T')[0],
      last_used: null, use_count: 0
    })),
    vectorize_namespace: 'learned_rules'
  });

  // Seed 3 example tasks in Inputs DB
  const exampleTasks = [
    {
      [P.INPUTS.TASK_NAME]: { title: [{ text: { content: 'Morning standup' } }] },
      [P.INPUTS.TYPE]: { select: { name: 'FIXED_APPOINTMENT' } },
      [P.INPUTS.FIXED_TIME]: { date: { start: '2026-01-01T09:00:00' } },
      [P.INPUTS.DURATION]: { number: 15 },
      [P.INPUTS.PRIORITY]: { select: { name: 'High' } },
      [P.INPUTS.ENERGY]: { select: { name: 'Moderate' } },
      [P.INPUTS.RECURRENCE]: { select: { name: 'Daily' } },
      [P.INPUTS.STATUS]: { select: { name: CONFIG.STATUS.TASK.ACTIVE } },
      [P.INPUTS.NOTES]: { rich_text: [{ text: { content: 'Example recurring meeting — edit or delete' } }] }
    },
    {
      [P.INPUTS.TASK_NAME]: { title: [{ text: { content: 'Focus time' } }] },
      [P.INPUTS.TYPE]: { select: { name: 'TIME_BLOCK' } },
      [P.INPUTS.DURATION]: { number: 120 },
      [P.INPUTS.ENERGY]: { select: { name: 'Deep' } },
      [P.INPUTS.TIME_PREFERENCE]: { select: { name: 'Morning' } },
      [P.INPUTS.STATUS]: { select: { name: CONFIG.STATUS.TASK.ACTIVE } },
      [P.INPUTS.NOTES]: { rich_text: [{ text: { content: 'Example deep work block — customize as needed' } }] }
    },
    {
      [P.INPUTS.TASK_NAME]: { title: [{ text: { content: 'Email review' } }] },
      [P.INPUTS.TYPE]: { select: { name: 'TASK' } },
      [P.INPUTS.DURATION]: { number: 30 },
      [P.INPUTS.PRIORITY]: { select: { name: 'Low' } },
      [P.INPUTS.ENERGY]: { select: { name: 'Light' } },
      [P.INPUTS.TIME_PREFERENCE]: { select: { name: 'Afternoon' } },
      [P.INPUTS.RECURRENCE]: { select: { name: 'Daily' } },
      [P.INPUTS.STATUS]: { select: { name: CONFIG.STATUS.TASK.ACTIVE } },
      [P.INPUTS.NOTES]: { rich_text: [{ text: { content: 'Example light task — modify or remove' } }] }
    }
  ];

  for (const task of exampleTasks) {
    await notion.createPage(env.INPUTS_DB_ID, task);
  }

  // Seed Context DB defaults
  await context.set('work_hours', { start: '09:00', end: '17:00' });
  await context.set('hard_constraints', ['lunch_12:00-13:00']);
  await context.set('user_timezone_current', {
    current: CONFIG.DEFAULTS.TIMEZONE,
    schedule_timezone: CONFIG.DEFAULTS.TIMEZONE,
    history: []
  });
  await context.set('external_calendar_blocks', []);
  await context.set('ai_quality_metrics', {
    current_week: {
      avg_user_edits_per_day: 0, duration_accuracy: 1.0,
      time_slot_acceptance: 1.0, rule_learning_rate: 0,
      json_failure_rate: 0
    },
    thresholds: CONFIG.QUALITY_THRESHOLDS,
    alerts: []
  });

  await logger.info('Cold start initialization complete', {
    patterns: Object.keys(defaultPatterns).length,
    rules: bootstrapRules.length,
    tasks: exampleTasks.length
  });

  return { success: true, seeded: Object.keys(defaultPatterns).length + bootstrapRules.length + exampleTasks.length };
}

/**
 * Clean up bootstrap data after system matures.
 * @param env The parameter.
 * @returns {any} The return value.
 */
export async function cleanupBootstrapData(env) {
  const notion = new NotionClient(env.NOTION_API_KEY);
  const context = new ContextManager(notion, env.CONTEXT_DB_ID);
  const logger = new Logger(notion, env.LOGS_DB_ID);

  const patterns = await context.get('inference_patterns_v2');
  if (!patterns) return;

  let removed = 0;
  let promoted = 0;

  for (const [key, pattern] of Object.entries(patterns)) {
    if (pattern.source === 'bootstrap' && pattern.samples === 0) {
      delete patterns[key];
      removed++;
      await logger.info(`Removed unused bootstrap pattern: ${key}`);
    } else if (pattern.source === 'bootstrap' && pattern.samples >= CONFIG.LEARNING.BOOTSTRAP_PROMOTE_SAMPLES) {
      pattern.source = 'learned';
      pattern.confidence = Math.min(0.85, 0.5 + (pattern.samples * 0.05));
      promoted++;
    }
  }

  await context.set('inference_patterns_v2', patterns);
  return { removed, promoted };
}

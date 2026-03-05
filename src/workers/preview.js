import { NotionClient } from '../notion-client.js';
import { Logger } from '../logger.js';
import { ContextManager } from '../context.js';
import { CONFIG } from '../config.js';
import { ScheduleResponseSchema } from '../utils/validation.js';
import { InvalidJSONError, AISchedulingError } from '../errors.js';
import { InferenceEngine } from '../scheduler/inference.js';
import { OptimizationEngine } from '../scheduler/optimizations.js';
import { DependencyResolver } from '../scheduler/dependencies.js';
import { RecurrenceManager } from '../scheduler/recurrence.js';
import { TaskManager } from '../scheduler/task-manager.js';
import { MultiDayScheduler } from '../scheduler/multi-day.js';
import { PromptBuilder } from '../scheduler/prompt.js';
import { FallbackScheduler } from '../scheduler/fallback.js';
import { VectorizeManager } from '../learning/vectorize.js';
import { IdempotencyManager } from '../features/idempotency.js';
import { PanicManager } from '../features/panic.js';
import { PrefetchManager } from '../features/look-ahead.js';
import { OptimisticLock } from '../scheduler/optimistic-lock.js';
import { CriticalPathAnalyzer } from '../scheduler/critical-path.js';
import { BanditManager } from '../scheduler/time-slot-bandit.js';
import { BufferLearning } from '../features/buffer-learning.js';
import { EnergyCurve } from '../features/energy-curve.js';
import { TaskBatching } from '../features/task-batching.js';
import { SlotFinder } from '../scheduler/slots.js';

const P = CONFIG.PROPERTIES;

/**
 * Pipeline for generating schedule previews (drafts).
 * Handles task fetching, recurrence, AI inference, and optimistic locking.
 * @param {Object} env Environment bindings (AI, KV, D1, etc.).
 * @param {string} dateStr Target date (YYYY-MM-DD).
 * @param {string} [statusOverride=null] Optional status (e.g. PREFETCH).
 * @returns {Promise<Object>} Execution summary.
 */
export async function handlePreview(env, dateStr, statusOverride = null) {
  const notion = new NotionClient(env.NOTION_API_KEY);
  const logger = new Logger(notion, env.LOGS_DB_ID, env);
  const context = new ContextManager(notion, env.CONTEXT_DB_ID);
  const idempotency = new IdempotencyManager(env.KV);
  const vectorize = new VectorizeManager(env);

  // Idempotency Check
  const idempotencyKey = idempotency.generateKey(dateStr, statusOverride || 'preview');
  const existing = await idempotency.check(idempotencyKey);
  if (existing === 'completed') {
    await logger.info(`Preview already completed for ${dateStr}, skipping`);
    return { success: true, skipped: true };
  }
  await idempotency.lock(idempotencyKey);

  try {
    // Panic Mode Check
    const dailyOverride = await context.get('daily_override');

    // Fetch Active Tasks
    const taskResponse = await notion.queryDatabase(env.INPUTS_DB_ID, {
      property: P.INPUTS.STATUS,
      select: { equals: CONFIG.STATUS.TASK.ACTIVE }
    });

    let tasks = taskResponse.results.map(page => {
      const props = page.properties;
      return {
        id: page.id,
        name: props[P.INPUTS.TASK_NAME]?.title?.[0]?.plain_text || '',
        type: props[P.INPUTS.TYPE]?.select?.name || 'TASK',
        background: props[P.INPUTS.BACKGROUND]?.checkbox || false,
        duration: props[P.INPUTS.DURATION]?.number || null,
        priority: props[P.INPUTS.PRIORITY]?.select?.name || null,
        energy: props[P.INPUTS.ENERGY]?.select?.name || null,
        timePreference: props[P.INPUTS.TIME_PREFERENCE]?.select?.name || null,
        deadline: props[P.INPUTS.DEADLINE]?.date?.start || null,
        mustCompleteBy: props[P.INPUTS.MUST_COMPLETE_BY]?.date?.start || null,
        fixedTime: props[P.INPUTS.FIXED_TIME]?.date?.start || null,
        notes: props[P.INPUTS.NOTES]?.rich_text?.[0]?.plain_text || '',
        estimatedDays: props[P.INPUTS.ESTIMATED_DAYS]?.number || null,
        multiDayState: (() => { try { return JSON.parse(props[P.INPUTS.MULTI_DAY_STATE]?.rich_text?.[0]?.plain_text || 'null'); } catch { return null; } })(),
        dependsOn: props[P.INPUTS.DEPENDS_ON]?.relation?.map(r => r.id) || [],
        recurrence: props[P.INPUTS.RECURRENCE]?.select?.name || null,
        recurrenceState: (() => { try { return JSON.parse(props[P.INPUTS.RECURRENCE_STATE]?.rich_text?.[0]?.plain_text || 'null'); } catch { return null; } })(),
        lastGenerated: props[P.INPUTS.LAST_GENERATED]?.date?.start || null,
        status: props[P.INPUTS.STATUS]?.select?.name
      };
    });

    // Process Recurring Tasks
    for (const task of tasks) {
      if (RecurrenceManager.shouldGenerate(task, dateStr)) {
        const instance = RecurrenceManager.createInstance(task, dateStr);
        tasks.push(instance);
      }
    }

    // Apply Panic Mode Overrides
    if (dailyOverride) {
      tasks = PanicManager.applyOverrides(tasks, dailyOverride);
    }

    // Inference & Normalization
    const patterns = await context.get('inference_patterns_v2') || {};
    const rules = await context.get('learned_rules_vectors') || {};
    tasks = tasks.map(t => InferenceEngine.inferFields(t, patterns, rules.rules || []));

    // Handle Multi-Day Tasks
    const expanded = [];
    for (const task of tasks) {
      expanded.push(...MultiDayScheduler.splitTask(task));
    }
    tasks = expanded;

    // Separate Fixed vs Schedulable
    const fixedAppointments = TaskManager.getFixedAppointments(tasks).map(t => ({
      task_id: t.id, start: t.fixedTime?.split('T')[1]?.substring(0, 5) || '09:00',
      duration: t.duration || CONFIG.DEFAULTS.TASK_DURATION, name: t.name
    }));
    const schedulableTasks = TaskManager.getSchedulableTasks(tasks);

    // Dependency Resolution
    let sortedTasks;
    try {
      sortedTasks = DependencyResolver.topologicalSort(schedulableTasks);
    } catch (cycleError) {
      await logger.error('Dependency cycle detected', { error: cycleError.message });
      sortedTasks = schedulableTasks; // Proceed without ordering
    }

    // Critical Path Analysis — surface deadline risks without blocking
    const criticalPath = CriticalPathAnalyzer.calculateCriticalPath(sortedTasks);
    if (!criticalPath.feasible) {
      await logger.warn(`Deadline risk: ${criticalPath.message}`);
    }

    // Feasibility Check
    const feasibility = OptimizationEngine.validateFeasibility(sortedTasks);
    if (!feasibility.feasible) {
      await logger.warn(feasibility.message);
    }

    // Energy Budget Enforcement
    sortedTasks = OptimizationEngine.enforceEnergyBudgets(sortedTasks);

    // Semantic Rule Retrieval
    const dayName = new Date(dateStr).toLocaleDateString('en-US', { weekday: 'long' });
    const searchQuery = VectorizeManager.buildSearchQuery(dateStr, dayName, sortedTasks);
    let relevantRules = [];
    try {
      relevantRules = await vectorize.searchRelevantRules(searchQuery);
    } catch (e) {
      await logger.warn('Vectorize search failed, proceeding without semantic rules', { error: e.message });
    }

    // Load Hard Constraints and Calendar Blocks
    const hardConstraints = await context.get('hard_constraints') || [];
    const externalBlocks = await context.get('external_calendar_blocks') || [];
    const workHours = await context.get('work_hours') || { start: CONFIG.DEFAULTS.WORK_DAY_START, end: CONFIG.DEFAULTS.WORK_DAY_END };
    const userTimezone = await context.get('user_timezone_current');

    // Load bandit slot hints per energy category
    let slotHints = {};
    try {
      const bandits = await BanditManager.loadAll(context);
      for (const task of sortedTasks) {
        const energy = (task.energy || 'Moderate').toLowerCase();
        const bandit = BanditManager.getOrCreate(bandits, energy);
        slotHints[task.id] = bandit.selectSlot();
      }
    } catch { /* non-critical */ }

    // Load learned buffer times
    let learnedBuffers = {};
    try {
      learnedBuffers = JSON.parse(await env.KV.get('learned_buffers') || '{}');
    } catch { /* non-critical */ }

    // Energy curve peak window
    let energyPeakHint = '';
    try {
      const energyCurve = await context.get('energy_curve') || {};
      const peak = EnergyCurve.getPeakWindow(energyCurve);
      if (peak) energyPeakHint = peak.recommendation;
    } catch { /* non-critical */ }

    // Task batching hints
    const batchingHints = TaskBatching.getBatchingHints(sortedTasks);

    // Build Prompt Context
    const promptContext = {
      date: dateStr,
      dayName,
      timezone: userTimezone?.current || CONFIG.DEFAULTS.TIMEZONE,
      workStart: workHours.start,
      workEnd: workHours.end,
      rules: relevantRules,
      patterns,
      hardConstraints,
      fixedAppointments,
      externalCalendarBlocks: externalBlocks,
      availableSlots: [],
      dependencies: sortedTasks.map(t => t.id),
      slotHints,
      learnedBuffers,
      energyPeakHint,
      batchingHints,
      deadlineWarnings: criticalPath.feasible ? [] : criticalPath.violations
    };

    const promptResult = PromptBuilder.buildPrompt(sortedTasks, promptContext);
    const prompt = promptResult.prompt;
    const promptVersion = promptResult.version;

    // Track context size for stats (context_size_avg)
    try {
      await env.KV.put('prompt_token_count', String(promptResult.tokenEstimate), { expirationTtl: 604800 });
    } catch { /* non-critical */ }

    // AI Generation with Zod Validation & Retry
    let schedule = null;
    let aiAttempts = 0;
    let lastRawResponse = null;
    const maxRetries = 3;

    while (!schedule && aiAttempts < maxRetries) {
      aiAttempts++;
      try {
        const aiResult = await env.AI.run('@cf/qwen/qwen2.5-7b-instruct', { prompt: prompt });
        const rawResponse = aiResult.response.trim().replace(/```json\n?|```/g, '');
        lastRawResponse = rawResponse;
        const parsed = JSON.parse(rawResponse);
        const validation = ScheduleResponseSchema.safeParse(parsed);

        if (validation.success) {
          schedule = validation.data;
        } else {
          await logger.warn(`AI output validation failed (attempt ${aiAttempts})`, {
            errors: validation.error.issues.map(i => `${i.path}: ${i.message}`)
          });
        }
      } catch (parseError) {
        await logger.warn(`AI JSON parse failed (attempt ${aiAttempts})`, { error: parseError.message });
      }
    }

    // Fallback if AI fails — use SlotFinder for constraint-aware placement
    if (!schedule) {
      const jsonError = new InvalidJSONError(lastRawResponse || '', aiAttempts);
      await logger.error('AI failed after 3 attempts, using fallback scheduler', {
        code: jsonError.code,
        attempts: aiAttempts
      });
      schedule = FallbackScheduler.generate(sortedTasks, workHours.start, learnedBuffers);
    }

    // Track AI quality metrics
    const qualityMetrics = await context.get('ai_quality_metrics') || { current_week: {} };
    qualityMetrics.current_week.json_failure_rate = (aiAttempts > 1)
      ? ((aiAttempts - 1) / maxRetries)
      : (qualityMetrics.current_week.json_failure_rate || 0);
    await context.set('ai_quality_metrics', qualityMetrics);

    // Write to Schedule DB with Optimistic Locking
    const writeStatus = statusOverride || CONFIG.STATUS.SCHEDULE.PREVIEW;
    for (const entry of schedule) {
      let version = 1;

      // Build enriched notes: xAI transparency + multi-day visibility + prompt version
      const noteParts = [];
      if (entry.notes) noteParts.push(entry.notes);
      // xAI: surface inferred fields so user knows what the AI decided
      if (entry.inferred_fields && Object.keys(entry.inferred_fields).length > 0) {
        const inferences = Object.entries(entry.inferred_fields)
          .map(([k, v]) => `${k}=${v}`).join(', ');
        noteParts.push(`[SchedSec: inferred ${inferences}]`);
      }
      // Multi-day Day N/M visibility
      const dayNum = entry.day_number || 1;
      const parentTask = sortedTasks.find(t => t.id === entry.task_id);
      if (parentTask && parentTask.estimatedDays && parentTask.estimatedDays > 1) {
        noteParts.push(`[Day ${dayNum}/${parentTask.estimatedDays}]`);
      }
      noteParts.push(`[prompt:${promptVersion}]`);
      const enrichedNotes = noteParts.join(' ').substring(0, 2000);

      try {
        const lock = await OptimisticLock.acquireWrite(notion, env.SCHEDULE_DB_ID, CONFIG, dateStr, entry.task_id);
        version = lock.newVersion;
        if (lock.pageId) {
          // Update existing
          await notion.updatePage(lock.pageId, {
            [P.SCHEDULE.AI_START]: { rich_text: [{ text: { content: entry.start } }] },
            [P.SCHEDULE.AI_DURATION]: { number: entry.duration },
            [P.SCHEDULE.STATUS]: { select: { name: writeStatus } },
            [P.SCHEDULE.NOTES]: { rich_text: [{ text: { content: enrichedNotes } }] },
            [P.SCHEDULE.DAY_NUMBER]: { number: dayNum },
            [P.SCHEDULE.VERSION]: { number: version },
            [P.SCHEDULE.LAST_MODIFIED]: { date: { start: new Date().toISOString() } },
            [P.SCHEDULE.MODIFIED_BY]: { select: { name: 'AI' } }
          });
          continue;
        }
      } catch (lockError) {
        await logger.info(`Skipping overwrite for ${entry.task_id}: ${lockError.message}`);
        continue;
      }

      // Create new
      await notion.createPage(env.SCHEDULE_DB_ID, {
        [P.SCHEDULE.DATE]: { date: { start: dateStr } },
        [P.SCHEDULE.TASK]: { relation: [{ id: entry.task_id }] },
        [P.SCHEDULE.AI_START]: { rich_text: [{ text: { content: entry.start } }] },
        [P.SCHEDULE.AI_DURATION]: { number: entry.duration },
        [P.SCHEDULE.STATUS]: { select: { name: writeStatus } },
        [P.SCHEDULE.NOTES]: { rich_text: [{ text: { content: enrichedNotes } }] },
        [P.SCHEDULE.DAY_NUMBER]: { number: dayNum },
        [P.SCHEDULE.VERSION]: { number: version },
        [P.SCHEDULE.LAST_MODIFIED]: { date: { start: new Date().toISOString() } },
        [P.SCHEDULE.MODIFIED_BY]: { select: { name: 'AI' } }
      });
    }

    await logger.info(`Preview generated for ${dateStr}`, { count: schedule.length, aiAttempts });
    await idempotency.complete(idempotencyKey);

    // Prefetch T+2
    if (!statusOverride) {
      const dates = PrefetchManager.getDates(new Date(dateStr));
      try {
        await handlePreview(env, dates.dayAfter, CONFIG.STATUS.SCHEDULE.PREFETCH);
      } catch (prefetchError) {
        await logger.warn('T+2 prefetch failed (non-critical)', { error: prefetchError.message });
      }
    }

    return { success: true, count: schedule.length, aiAttempts };

  } catch (error) {
    await idempotency.release(idempotencyKey);
    await logger.error(`Preview generation failed: ${error.message}`, { stack: error.stack });
    throw error;
  }
}

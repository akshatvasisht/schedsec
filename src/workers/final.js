import { NotionClient } from '../notion-client.js';
import { Logger } from '../logger.js';
import { ContextManager } from '../context.js';
import { CONFIG } from '../config.js';
import { RuleExtractor } from '../learning/rule-extraction.js';
import { MLIntelligence } from '../scheduler/duration-learning.js';
import { VectorizeManager } from '../learning/vectorize.js';
import { IdempotencyManager } from '../features/idempotency.js';
import { UndoManager } from '../features/undo.js';
import { handlePreview } from './preview.js';
import { BanditManager } from '../scheduler/time-slot-bandit.js';
import { BufferLearning } from '../features/buffer-learning.js';
import { EnergyCurve } from '../features/energy-curve.js';

const P = CONFIG.PROPERTIES;

/**
 * Daily Final Generator
 * Analyzes yesterday's user edits to extract rules, then finalizes today's schedule.
 * Includes: plausibility filtering, correction flag awareness, end-of-day mining.
 * @param {object} env Environment bindings (AI, KV, D1, etc.).
 * @param {string} dateStr Today's date (YYYY-MM-DD).
 * @returns {Promise<object>} Execution summary with learning stats.
 */
export async function handleFinal(env, dateStr) {
  const notion = new NotionClient(env.NOTION_API_KEY);
  const logger = new Logger(notion, env.LOGS_DB_ID, env);
  const context = new ContextManager(notion, env.CONTEXT_DB_ID);
  const idempotency = new IdempotencyManager(env.KV);
  const undo = new UndoManager(env.KV, notion);
  const extractor = new RuleExtractor(env.AI);
  const vectorize = new VectorizeManager(env);

  // Idempotency Check
  const key = idempotency.generateKey(dateStr, 'final');
  const existing = await idempotency.check(key);
  if (existing === 'completed') {
    return { success: true, skipped: true };
  }
  await idempotency.lock(key);

  try {
    // Fetch yesterday's schedule to learn from edits
    const yesterday = new Date(dateStr);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const scheduleResponse = await notion.queryDatabase(env.SCHEDULE_DB_ID, {
      property: P.SCHEDULE.DATE,
      date: { equals: yesterdayStr }
    });

    // Extract schedule data with full fields (including correction flag for filtering)
    const scheduleHistory = scheduleResponse.results.map(page => {
      const props = page.properties;
      return {
        page_id: page.id,
        task_id: props[P.SCHEDULE.TASK]?.relation?.[0]?.id,
        task_name: props[P.SCHEDULE.NOTES]?.rich_text?.[0]?.plain_text || '',
        ai_start: props[P.SCHEDULE.AI_START]?.rich_text?.[0]?.plain_text,
        ai_duration: props[P.SCHEDULE.AI_DURATION]?.number,
        final_start: props[P.SCHEDULE.FINAL_START]?.rich_text?.[0]?.plain_text,
        final_duration: props[P.SCHEDULE.FINAL_DURATION]?.number,
        actual_duration: props[P.SCHEDULE.ACTUAL_DURATION]?.number,
        completion_rating: props[P.SCHEDULE.COMPLETION_RATING]?.select?.name,
        your_notes: props[P.SCHEDULE.YOUR_NOTES]?.rich_text?.[0]?.plain_text || '',
        status: props[P.SCHEDULE.STATUS]?.select?.name,
        // New fields for ML filtering
        correction_flag: props.Correction_Flag?.checkbox || false,
        skip_reason: props.Skip_Reason?.select?.name || null,
        date: yesterdayStr
      };
    });

    // Identify user edits (with plausibility bounds built into identifyEdits)
    const aiSchedule = scheduleHistory.map(s => ({
      task_id: s.task_id, task_name: s.task_name, start: s.ai_start, duration: s.ai_duration
    }));
    const finalSchedule = scheduleHistory.map(s => ({
      task_id: s.task_id, task_name: s.task_name,
      start: s.final_start || s.ai_start,
      duration: s.final_duration || s.ai_duration
    }));

    const edits = RuleExtractor.identifyEdits(aiSchedule, finalSchedule);
    const nonPreferenceReasons = CONFIG.SKIP_REASONS.NON_PREFERENCE_REASONS;

    // Extract structured rules from edits (filtered by plausibility + correction flag)
    let learnedRulesCount = 0;
    let skippedRulesCount = 0;
    for (const edit of edits) {
      // Find the associated schedule entry for this edit
      const entry = scheduleHistory.find(s => s.task_name === edit.task) || {};

      // Check if this edit should be skipped for learning
      if (RuleExtractor.shouldSkipForLearning(edit, entry, nonPreferenceReasons)) {
        skippedRulesCount++;
        continue;
      }

      const rule = RuleExtractor.createRuleFromEdit(edit, 'system_edit', yesterdayStr, entry.page_id);
      const ruleId = `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const ruleText = `${rule.condition} → ${rule.action}`;

      try {
        await vectorize.insertRule(ruleId, ruleText, rule);
        learnedRulesCount++;
      } catch (e) {
        await logger.warn('Failed to store rule in Vectorize', { error: e.message, rule: ruleText });
      }
    }

    // Extract rules from user's Your_Notes fields
    for (const entry of scheduleHistory) {
      // Skip correction-flagged entries for note-based learning too
      if (entry.correction_flag) continue;

      if (entry.your_notes && entry.your_notes.length > 5) {
        const rulesFromNotes = await extractor.extractRuleFromNotes(
          entry.your_notes,
          edits.filter(e => e.task === entry.task_name),
          { date: yesterdayStr }
        );
        if (rulesFromNotes) {
          const ruleId = `note_rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const ruleText = `${rulesFromNotes.condition} → ${rulesFromNotes.action}`;
          try {
            await vectorize.insertRule(ruleId, ruleText, {
              ...rulesFromNotes,
              confidence: 0.9,
              source: 'user_note',
              learned_date: dateStr,
              last_reinforced: dateStr,
              application_count: 0,
              successful_applications: 0,
              source_edit_date: yesterdayStr,
              source_schedule_id: entry.page_id
            });
            learnedRulesCount++;
          } catch (e) {
            await logger.warn('Failed to store note-derived rule', { error: e.message });
          }
        }
      }
    }

    // End-of-day completion mining: scan entries marked Done/Skipped that were
    // updated after the previous final run (captured by checking if status
    // differs from what was scheduled — Done/Skipped entries have useful signal)
    const completedEntries = scheduleHistory.filter(
      s => s.status === CONFIG.STATUS.SCHEDULE.DONE && s.actual_duration
    );
    const skippedEntries = scheduleHistory.filter(
      s => s.status === CONFIG.STATUS.SCHEDULE.SKIPPED
    );

    // Update ML patterns (Duration accuracy via EMA)
    const patterns = await context.get('inference_patterns_v2') || {};
    for (const entry of completedEntries) {
      if (entry.actual_duration && entry.ai_duration && !entry.correction_flag) {
        const taskKeywords = entry.task_name.toLowerCase().split(/\s+/);
        for (const kw of taskKeywords) {
          if (patterns[kw]) {
            patterns[kw].duration = MLIntelligence.updateEMA(
              patterns[kw].duration, entry.actual_duration
            );
            patterns[kw].samples = (patterns[kw].samples || 0) + 1;
            patterns[kw].last_updated = dateStr;
            patterns[kw].last_reinforced = dateStr;
          }
        }
      }
    }

    // Track skip patterns (only for preference-based skips)
    for (const entry of skippedEntries) {
      if (entry.skip_reason && !nonPreferenceReasons.includes(entry.skip_reason)) {
        const taskKeywords = entry.task_name.toLowerCase().split(/\s+/);
        for (const kw of taskKeywords) {
          if (!patterns[kw]) patterns[kw] = {};
          patterns[kw].skip_count = (patterns[kw].skip_count || 0) + 1;
          patterns[kw].last_skipped = dateStr;
        }
      }
    }
    await context.set('inference_patterns_v2', patterns);

    // Bayesian duration updates for tasks with actual completion data
    for (const entry of completedEntries) {
      if (entry.actual_duration && entry.ai_duration && !entry.correction_flag) {
        const taskKeywords = entry.task_name.toLowerCase().split(/\s+/);
        for (const kw of taskKeywords) {
          if (patterns[kw] && patterns[kw].duration) {
            const confidence = Math.min(0.95, 0.50 + ((patterns[kw].samples || 0) * 0.05));
            const bayesian = MLIntelligence.updateBayesianDuration(
              patterns[kw].duration, confidence, entry.actual_duration
            );
            patterns[kw].duration = bayesian.estimate;
            patterns[kw].confidence = bayesian.confidence;
          }
        }
      }
    }
    // Persist Bayesian-updated patterns
    await context.set('inference_patterns_v2', patterns);

    // Learn buffer times from finalized schedule transitions
    try {
      const finalEntries = scheduleHistory
        .filter(s => s.final_start)
        .map(s => ({
          final_start: s.final_start,
          final_duration: s.final_duration || s.ai_duration,
          energy: s.completion_rating ? 'rated' : 'Unknown'
        }));
      if (finalEntries.length >= 2) {
        const learnedBuffers = BufferLearning.extractTransitionBuffers(finalEntries);
        await env.KV.put('learned_buffers', JSON.stringify(learnedBuffers), { expirationTtl: 2592000 });
      }
    } catch { /* non-critical */ }

    // Update energy curve from completion ratings
    try {
      const ratedEntries = scheduleHistory.filter(s => s.completion_rating && s.final_start);
      if (ratedEntries.length > 0) {
        const existingCurve = await context.get('energy_curve') || {};
        const updatedCurve = EnergyCurve.updateCurve(existingCurve, ratedEntries);
        await context.set('energy_curve', updatedCurve, 'Updated by final generator');
      }
    } catch { /* non-critical */ }

    // Update bandit rewards from completed tasks
    try {
      const bandits = await BanditManager.loadAll(context);
      for (const entry of completedEntries) {
        if (entry.final_start) {
          const hour = parseInt(entry.final_start.split(':')[0]);
          const slot = hour < 12 ? 'morning' : hour < 14 ? 'midday' : hour < 17 ? 'afternoon' : 'evening';
          const energy = 'completed';
          const bandit = BanditManager.getOrCreate(bandits, energy);
          bandit.updateReward(slot, 1); // reward = 1 for Done
        }
      }
      for (const entry of skippedEntries) {
        if (entry.final_start || entry.ai_start) {
          const timeStr = entry.final_start || entry.ai_start;
          const hour = parseInt(timeStr.split(':')[0]);
          const slot = hour < 12 ? 'morning' : hour < 14 ? 'midday' : hour < 17 ? 'afternoon' : 'evening';
          const energy = 'completed';
          const bandit = BanditManager.getOrCreate(bandits, energy);
          bandit.updateReward(slot, 0); // reward = 0 for Skipped
        }
      }
      await BanditManager.saveAll(bandits, context);
    } catch { /* non-critical */ }

    // Update AI quality metrics
    const qualityMetrics = await context.get('ai_quality_metrics') || { current_week: {} };
    const totalEntries = scheduleHistory.length;
    const editedEntries = scheduleHistory.filter(s => s.final_start && s.final_start !== s.ai_start).length;
    qualityMetrics.current_week.avg_user_edits_per_day = editedEntries;
    qualityMetrics.current_week.time_slot_acceptance = totalEntries > 0
      ? ((totalEntries - editedEntries) / totalEntries)
      : 1.0;
    qualityMetrics.current_week.rule_learning_rate = learnedRulesCount;

    if (totalEntries > 0) {
      const withActual = scheduleHistory.filter(s => s.actual_duration && s.ai_duration);
      if (withActual.length > 0) {
        qualityMetrics.current_week.duration_accuracy =
          withActual.reduce((sum, s) => sum + Math.min(s.actual_duration, s.ai_duration) / Math.max(s.actual_duration, s.ai_duration), 0) / withActual.length;
      }
    }
    await context.set('ai_quality_metrics', qualityMetrics);

    // Create Undo snapshot for today before generating
    const todaySchedule = await notion.queryDatabase(env.SCHEDULE_DB_ID, {
      property: P.SCHEDULE.DATE,
      date: { equals: dateStr }
    });
    if (todaySchedule.results.length > 0) {
      await undo.createSnapshot(dateStr, todaySchedule.results.map(p => ({
        id: p.id,
        task_id: p.properties[P.SCHEDULE.TASK]?.relation?.[0]?.id,
        start: p.properties[P.SCHEDULE.AI_START]?.rich_text?.[0]?.plain_text,
        duration: p.properties[P.SCHEDULE.AI_DURATION]?.number
      })));
    }

    // Generate today's final schedule
    const result = await handlePreview(env, dateStr, CONFIG.STATUS.SCHEDULE.SCHEDULED);

    await logger.info(`Final generator completed for ${dateStr}`, {
      learned_rules: learnedRulesCount,
      skipped_rules: skippedRulesCount,
      edits_detected: edits.length,
      completed_entries: completedEntries.length,
      skipped_entries: skippedEntries.length,
      schedule_count: result.count
    });

    await idempotency.complete(key);
    return {
      success: true,
      learned_rules: learnedRulesCount,
      skipped_rules: skippedRulesCount,
      edits: edits.length,
      schedule: result
    };

  } catch (error) {
    await idempotency.release(key);
    await logger.error(`Final generator failed: ${error.message}`, { stack: error.stack });
    throw error;
  }
}

import { NotionClient } from '../notion-client.js';
import { Logger } from '../logger.js';
import { ContextManager } from '../context.js';
import { CONFIG } from '../config.js';
import { RuleExtractor } from '../learning/rule-extraction.js';
import { MLIntelligence } from '../scheduler/ml-intelligence.js';
import { VectorizeManager } from '../learning/vectorize.js';
import { IdempotencyManager } from '../features/idempotency.js';
import { UndoManager } from '../features/undo.js';
import { handlePreview } from './preview.js';

const P = CONFIG.PROPERTIES;

/**
 * Daily Final Generator
 * Analyzes yesterday's user edits to extract rules, then finalizes today's schedule.
 * @param {Object} env Environment bindings (AI, KV, D1, etc.).
 * @param {string} dateStr Today's date (YYYY-MM-DD).
 * @returns {Promise<Object>} Execution summary with learning stats.
 */
export async function handleFinal(env, dateStr) {
  const notion = new NotionClient(env.NOTION_API_KEY);
  const logger = new Logger(notion, env.LOGS_DB_ID);
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

    // Extract schedule data with full fields
    const scheduleHistory = scheduleResponse.results.map(page => {
      const props = page.properties;
      return {
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
        date: yesterdayStr
      };
    });

    // Identify user edits
    const aiSchedule = scheduleHistory.map(s => ({
      task_id: s.task_id, task_name: s.task_name, start: s.ai_start, duration: s.ai_duration
    }));
    const finalSchedule = scheduleHistory.map(s => ({
      task_id: s.task_id, task_name: s.task_name,
      start: s.final_start || s.ai_start,
      duration: s.final_duration || s.ai_duration
    }));

    const edits = RuleExtractor.identifyEdits(aiSchedule, finalSchedule);

    // Extract structured rules from edits
    let learnedRulesCount = 0;
    for (const edit of edits) {
      const rule = RuleExtractor.createRuleFromEdit(edit);
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
              successful_applications: 0
            });
            learnedRulesCount++;
          } catch (e) {
            await logger.warn('Failed to store note-derived rule', { error: e.message });
          }
        }
      }
    }

    // Update ML patterns (Duration accuracy via EMA)
    const patterns = await context.get('inference_patterns_v2') || {};
    for (const entry of scheduleHistory) {
      if (entry.actual_duration && entry.ai_duration) {
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
    await context.set('inference_patterns_v2', patterns);

    // Update AI quality metrics
    const qualityMetrics = await context.get('ai_quality_metrics') || { current_week: {} };
    const totalEntries = scheduleHistory.length;
    const editedEntries = scheduleHistory.filter(s => s.final_start && s.final_start !== s.ai_start).length;
    qualityMetrics.current_week.avg_user_edits_per_day = editedEntries;
    qualityMetrics.current_week.time_slot_acceptance = totalEntries > 0
      ? ((totalEntries - editedEntries) / totalEntries)
      : 1.0;

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
      edits_detected: edits.length,
      schedule_count: result.count
    });

    await idempotency.complete(key);
    return { success: true, learned_rules: learnedRulesCount, edits: edits.length, schedule: result };

  } catch (error) {
    await idempotency.release(key);
    await logger.error(`Final generator failed: ${error.message}`, { stack: error.stack });
    throw error;
  }
}

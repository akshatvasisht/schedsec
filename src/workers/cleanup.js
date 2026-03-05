import { NotionClient } from '../notion-client.js';
import { Logger } from '../logger.js';
import { ContextManager } from '../context.js';
import { PatternAnalyzer } from '../learning/patterns.js';
import { ConfidenceDecay } from '../learning/decay.js';
import { cleanupBootstrapData } from '../bootstrap.js';
import { CONFIG } from '../config.js';

const P = CONFIG.PROPERTIES;

/**
 * Data Janitor Worker (Triggered 1st of month)
 * Pattern extraction, CSV archival, confidence decay, log purge.
 * @param env The parameter.
 * @returns {any} The return value.
 */
export async function handleCleanup(env) {
  const notion = new NotionClient(env.NOTION_API_KEY);
  const logger = new Logger(notion, env.LOGS_DB_ID, env);
  const context = new ContextManager(notion, env.CONTEXT_DB_ID);

  const now = new Date();
  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setDate(now.getDate() - 90);
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(now.getDate() - 30);

  let patternsExtracted = 0;
  let logsDeleted = 0;
  let schedulesArchived = 0;

  // Extract patterns from old schedules BEFORE archiving
  const oldSchedules = await notion.queryDatabase(env.SCHEDULE_DB_ID, {
    property: P.SCHEDULE.DATE,
    date: { before: ninetyDaysAgo.toISOString().split('T')[0] }
  });

  if (oldSchedules.results.length > 0) {
    const historicalData = oldSchedules.results.map(p => {
      const props = p.properties;
      return {
        date: props[P.SCHEDULE.DATE]?.date?.start,
        task_name: props[P.SCHEDULE.NOTES]?.rich_text?.[0]?.plain_text || 'Unknown',
        final_start: props[P.SCHEDULE.FINAL_START]?.rich_text?.[0]?.plain_text,
        ai_start: props[P.SCHEDULE.AI_START]?.rich_text?.[0]?.plain_text,
        final_duration: props[P.SCHEDULE.FINAL_DURATION]?.number,
        ai_duration: props[P.SCHEDULE.AI_DURATION]?.number,
        actual_duration: props[P.SCHEDULE.ACTUAL_DURATION]?.number,
        energy: 'Moderate', // Would come from task relation
        completion_rating: props[P.SCHEDULE.COMPLETION_RATING]?.select?.name
      };
    });

    // Extract aggregated patterns
    const patterns = PatternAnalyzer.extractPatterns(historicalData);
    const existing = await context.get('historical_patterns') || {};
    const merged = { ...existing, ...patterns };
    await context.set('historical_patterns', merged, 'Merged from cleanup');
    patternsExtracted = historicalData.length;

    // CSV Archive to R2
    const csvRows = historicalData.map(d =>
      `"${d.date}","${d.task_name}","${d.ai_start}","${d.final_start}","${d.ai_duration}","${d.final_duration}","${d.actual_duration}"`
    );
    const csvContent = 'Date,Task,AI_Start,Final_Start,AI_Duration,Final_Duration,Actual_Duration\n' + csvRows.join('\n');
    const month = now.toISOString().substring(0, 7);
    await env.R2_BUCKET.put(`archive_schedules_${month}.csv`, csvContent);

    // Archive old schedule pages
    for (const page of oldSchedules.results) {
      await notion.archivePage(page.id);
      schedulesArchived++;
    }
  }

  // Apply Confidence Decay to patterns
  const patterns = await context.get('inference_patterns_v2');
  if (patterns) {
    const decayed = ConfidenceDecay.decayAll(patterns, now);
    // Remove stale patterns
    for (const [key, p] of Object.entries(decayed)) {
      if (p.is_stale) {
        delete decayed[key];
        await logger.info(`Removed stale pattern: ${key} (confidence=${p.confidence})`);
      }
    }
    await context.set('inference_patterns_v2', decayed);
  }

  // Clean up bootstrap data if applicable
  await cleanupBootstrapData(env);

  // Purge old logs (>30 days)
  const oldLogs = await notion.queryDatabase(env.LOGS_DB_ID, {
    property: P.LOGS.TIMESTAMP,
    date: { before: thirtyDaysAgo.toISOString() }
  });
  for (const log of oldLogs.results) {
    await notion.archivePage(log.id);
    logsDeleted++;
  }

  // Auto-archive paused tasks inactive for 90+ days
  let pausedArchived = 0;
  const pausedTasks = await notion.queryDatabase(env.INPUTS_DB_ID, {
    and: [
      { property: P.INPUTS.STATUS, select: { equals: CONFIG.STATUS.TASK.PAUSED } },
      { property: P.INPUTS.UPDATED_TIME, date: { before: ninetyDaysAgo.toISOString().split('T')[0] } }
    ]
  });
  for (const task of pausedTasks.results) {
    await notion.archivePage(task.id);
    pausedArchived++;
  }

  // Delete stale preview entries (>30 days old)
  let previewsDeleted = 0;
  const stalePreviews = await notion.queryDatabase(env.SCHEDULE_DB_ID, {
    and: [
      { property: P.SCHEDULE.STATUS, select: { equals: CONFIG.STATUS.SCHEDULE.PREVIEW } },
      { property: P.SCHEDULE.DATE, date: { before: thirtyDaysAgo.toISOString().split('T')[0] } }
    ]
  });
  for (const preview of stalePreviews.results) {
    await notion.archivePage(preview.id);
    previewsDeleted++;
  }

  // Pattern staleness alerting — warn about unused high-confidence patterns
  if (patterns) {
    const decayed = await context.get('inference_patterns_v2') || {};
    for (const [key, p] of Object.entries(decayed)) {
      const lastUsed = p.last_used ? new Date(p.last_used) : new Date(0);
      const daysSinceUse = Math.floor((now - lastUsed) / (1000 * 60 * 60 * 24));

      if (daysSinceUse > 90 && (p.confidence || 0) > 0.70) {
        await logger.warn(`Pattern '${key}' unused for ${daysSinceUse} days but high confidence — consider archiving`);
      }
    }
  }

  await logger.info('Data janitor completed', {
    patternsExtracted, schedulesArchived, logsDeleted, pausedArchived, previewsDeleted
  });
  return { success: true, patternsExtracted, schedulesArchived, logsDeleted, pausedArchived, previewsDeleted };
}

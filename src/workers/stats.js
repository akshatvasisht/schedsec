import { NotionClient } from '../notion-client.js';
import { Logger } from '../logger.js';
import { ContextManager } from '../context.js';
import { CONFIG } from '../config.js';

const P = CONFIG.PROPERTIES;

/**
 * Weekly Stats Aggregator (Triggered Sunday 11:59 PM)
 * Calculates analytics based on completion rate and rule inferences.
 * @param env The parameter.
 * @returns {any} The return value.
 */
export async function handleStats(env) {
  const notion = new NotionClient(env.NOTION_API_KEY);
  const logger = new Logger(notion, env.LOGS_DB_ID);
  const context = new ContextManager(notion, env.CONTEXT_DB_ID);

  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 7);
  const weekAgoStr = weekAgo.toISOString().split('T')[0];

  // Fetch last 7 days of schedules
  const response = await notion.queryDatabase(env.SCHEDULE_DB_ID, {
    property: P.SCHEDULE.DATE,
    date: { on_or_after: weekAgoStr }
  });

  const entries = response.results.map(p => {
    const props = p.properties;
    return {
      status: props[P.SCHEDULE.STATUS]?.select?.name,
      ai_start: props[P.SCHEDULE.AI_START]?.rich_text?.[0]?.plain_text,
      final_start: props[P.SCHEDULE.FINAL_START]?.rich_text?.[0]?.plain_text,
      ai_duration: props[P.SCHEDULE.AI_DURATION]?.number,
      final_duration: props[P.SCHEDULE.FINAL_DURATION]?.number,
      actual_duration: props[P.SCHEDULE.ACTUAL_DURATION]?.number,
      completion_rating: props[P.SCHEDULE.COMPLETION_RATING]?.select?.name,
      date: props[P.SCHEDULE.DATE]?.date?.start
    };
  });

  // Compute all metrics
  const totalTasks = entries.length;
  const completedTasks = entries.filter(e => e.status === CONFIG.STATUS.SCHEDULE.DONE).length;
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // Duration Accuracy
  const withActual = entries.filter(e => e.actual_duration && e.ai_duration);
  const avgDurationAccuracy = withActual.length > 0
    ? Math.round(withActual.reduce((sum, e) => sum + (Math.min(e.actual_duration, e.ai_duration) / Math.max(e.actual_duration, e.ai_duration)), 0) / withActual.length * 100)
    : 100;

  // Most Productive Time
  const ratedEntries = entries.filter(e => e.completion_rating && e.final_start);
  const hourProductivity = {};
  for (const e of ratedEntries) {
    const hour = parseInt(e.final_start.split(':')[0]);
    if (!hourProductivity[hour]) hourProductivity[hour] = { total: 0, count: 0 };
    hourProductivity[hour].total += parseInt(e.completion_rating);
    hourProductivity[hour].count++;
  }
  let mostProductiveTime = 'N/A';
  let maxAvg = 0;
  for (const [hour, data] of Object.entries(hourProductivity)) {
    const avg = data.total / data.count;
    if (avg > maxAvg) { maxAvg = avg; mostProductiveTime = `${hour}:00-${parseInt(hour) + 1}:00`; }
  }

  // AI Edit Rate (edits per day)
  const editedEntries = entries.filter(e => e.final_start && e.ai_start && e.final_start !== e.ai_start);
  const aiEditRate = parseFloat((editedEntries.length / 7).toFixed(1));

  // Time Slot Acceptance
  const timeSlotAcceptance = totalTasks > 0
    ? Math.round(((totalTasks - editedEntries.length) / totalTasks) * 100)
    : 100;

  // Rule Learning Rate
  const qualityMetrics = await context.get('ai_quality_metrics') || { current_week: {} };
  const ruleLearningRate = qualityMetrics.current_week.rule_learning_rate || 0;
  const jsonFailureRate = parseFloat((qualityMetrics.current_week.json_failure_rate || 0).toFixed(2));

  // Context Size
  const contextSizeAvg = 0; // Tracked during prompt generation

  // Quality Alerts
  const alerts = [];
  const thresholds = CONFIG.QUALITY_THRESHOLDS;

  if (aiEditRate > thresholds.MAX_EDITS_PER_DAY) {
    alerts.push({ type: 'HIGH_EDIT_RATE', threshold: thresholds.MAX_EDITS_PER_DAY, actual: aiEditRate, severity: 'WARNING', message: 'User editing schedules more than usual — AI quality may be degrading' });
  }
  if (avgDurationAccuracy / 100 < thresholds.MIN_DURATION_ACCURACY) {
    alerts.push({ type: 'LOW_DURATION_ACCURACY', threshold: thresholds.MIN_DURATION_ACCURACY, actual: avgDurationAccuracy / 100, severity: 'WARNING', message: 'Duration estimates are inaccurate — review inference patterns' });
  }
  if (jsonFailureRate > thresholds.MAX_JSON_FAILURES) {
    alerts.push({ type: 'JSON_FAILURES', threshold: thresholds.MAX_JSON_FAILURES, actual: jsonFailureRate, severity: 'ERROR', message: 'High JSON failure rate — consider adding few-shot examples' });
  }
  if (timeSlotAcceptance / 100 < thresholds.MIN_TIME_SLOT_ACCEPTANCE) {
    alerts.push({ type: 'LOW_SLOT_ACCEPTANCE', threshold: thresholds.MIN_TIME_SLOT_ACCEPTANCE, actual: timeSlotAcceptance / 100, severity: 'WARNING', message: 'AI time slot suggestions are frequently rejected' });
  }

  // Write to Stats DB
  await notion.createPage(env.STATS_DB_ID, {
    [P.STATS.WEEK_OF]: { date: { start: weekAgoStr } },
    [P.STATS.TOTAL_TASKS]: { number: totalTasks },
    [P.STATS.COMPLETED_TASKS]: { number: completedTasks },
    [P.STATS.COMPLETION_RATE]: { number: completionRate },
    [P.STATS.AVG_DURATION_ACCURACY]: { number: avgDurationAccuracy },
    [P.STATS.MOST_PRODUCTIVE_TIME]: { rich_text: [{ text: { content: mostProductiveTime } }] },
    [P.STATS.AI_EDIT_RATE]: { number: aiEditRate },
    [P.STATS.TIME_SLOT_ACCEPTANCE]: { number: timeSlotAcceptance },
    [P.STATS.RULE_LEARNING_RATE]: { number: ruleLearningRate },
    [P.STATS.JSON_FAILURE_RATE]: { number: jsonFailureRate },
    [P.STATS.CONTEXT_SIZE_AVG]: { number: contextSizeAvg },
    [P.STATS.GENERATED]: { date: { start: now.toISOString() } },
    [P.STATS.QUALITY_ALERTS]: { rich_text: [{ text: { content: JSON.stringify(alerts).substring(0, 2000) } }] }
  });

  await logger.info('Weekly stats generated', { completionRate, totalTasks, alerts: alerts.length });
  return { completionRate, totalTasks, completedTasks, aiEditRate, avgDurationAccuracy, alerts };
}

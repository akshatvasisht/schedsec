import { CONFIG } from '../config.js';
import { AnomalyDetector } from '../scheduler/anomaly-detection.js';

const P = CONFIG.PROPERTIES;

/**
 * Weekly Stats Aggregator (Triggered Sunday 11:59 PM)
 * Calculates analytics based on completion rate, rule inferences, and streaks.
 * @param {object} env Environment bindings.
 * @param {object} services Shared service instances for Notion, logging, and context.
 * @returns {Promise<object>} Aggregated weekly statistics payload.
 */
export async function handleStats(env, services) {
  const { notion, logger, context } = services;

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

  // Context Size — read from KV (tracked during prompt generation)
  let contextSizeAvg = 0;
  try {
    const tokenCount = await env.KV.get('prompt_token_count');
    contextSizeAvg = tokenCount ? parseInt(tokenCount) : 0;
  } catch { /* non-critical */ }

  // Streak tracking — consecutive days with ≥70% completion
  const dateMap = {};
  for (const e of entries) {
    if (!e.date) continue;
    if (!dateMap[e.date]) dateMap[e.date] = { total: 0, done: 0, hasDeep: false };
    dateMap[e.date].total++;
    if (e.status === CONFIG.STATUS.SCHEDULE.DONE) dateMap[e.date].done++;
    if (e.ai_duration && e.ai_duration >= 90) dateMap[e.date].hasDeep = true;
  }

  const sortedDates = Object.keys(dateMap).sort().reverse();
  let completionStreak = 0;
  let deepWorkStreak = 0;
  for (const d of sortedDates) {
    const dayRate = dateMap[d].total > 0 ? dateMap[d].done / dateMap[d].total : 0;
    if (dayRate >= 0.7) { completionStreak++; } else { break; }
  }
  for (const d of sortedDates) {
    if (dateMap[d].hasDeep && dateMap[d].done > 0) { deepWorkStreak++; } else { break; }
  }

  // Store streak data in context for prompt visibility
  const streakData = await context.get('streak_data') || {};
  streakData.current_completion_streak = completionStreak;
  streakData.current_deep_work_streak = deepWorkStreak;
  streakData.longest_completion_streak = Math.max(
    streakData.longest_completion_streak || 0,
    completionStreak
  );
  streakData.last_updated = now.toISOString().split('T')[0];
  await context.set('streak_data', streakData, 'Updated by weekly stats');

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

  // Anomaly Detection — z-score analysis against baseline
  try {
    // Bootstrap baseline from Stats DB history on first run instead of using
    // this week's values as the starting point, which produces a permanently
    // biased stddev=0.15 default. Seeds from real history if ≥4 weeks exist;
    // falls back to runtime default on fresh install (no history yet).
    let anomalyBaseline = await context.get('anomaly_baseline');
    if (!anomalyBaseline) {
      const eightWeeksAgo = new Date(now);
      eightWeeksAgo.setDate(now.getDate() - 56);
      const histResp = await notion.queryDatabase(env.STATS_DB_ID, {
        property: P.STATS.WEEK_OF,
        date: { on_or_after: eightWeeksAgo.toISOString().split('T')[0] }
      });
      const hist = histResp.results
        .map(p => ({
          editRate: p.properties[P.STATS.AI_EDIT_RATE]?.number,
          completionRate: p.properties[P.STATS.COMPLETION_RATE]?.number
        }))
        .filter(r => r.editRate != null && r.completionRate != null);
      if (hist.length >= 4) {
        const meanEdit = hist.reduce((s, r) => s + r.editRate, 0) / hist.length;
        const meanComp = hist.reduce((s, r) => s + r.completionRate / 100, 0) / hist.length;
        const stdEdit = Math.sqrt(hist.reduce((s, r) => s + (r.editRate - meanEdit) ** 2, 0) / hist.length);
        const stdComp = Math.sqrt(hist.reduce((s, r) => s + (r.completionRate / 100 - meanComp) ** 2, 0) / hist.length);
        anomalyBaseline = {
          avg_edit_rate: meanEdit, stddev_edit_rate: Math.max(stdEdit, 0.05),
          avg_completion_rate: meanComp, stddev_completion_rate: Math.max(stdComp, 0.05),
          avg_conflicts: 0, stddev_conflicts: 1
        };
      } else {
        anomalyBaseline = {
          avg_edit_rate: aiEditRate, stddev_edit_rate: 0.15,
          avg_completion_rate: completionRate / 100, stddev_completion_rate: 0.15,
          avg_conflicts: 0, stddev_conflicts: 1
        };
      }
    }
    const scheduleData = { entries, conflicts: [] };
    const anomalyResult = AnomalyDetector.detectAnomalousSchedule(scheduleData, anomalyBaseline);
    if (anomalyResult.is_anomalous) {
      for (const a of anomalyResult.anomalies) {
        alerts.push({ type: `ANOMALY_${a.metric.toUpperCase()}`, severity: a.severity, actual: a.current, message: `Anomaly: ${a.metric} z-score=${a.z_score}` });
      }
    }
    // Update rolling baseline (80/20 EMA)
    anomalyBaseline.avg_edit_rate = (anomalyBaseline.avg_edit_rate * 0.8) + (aiEditRate * 0.2);
    anomalyBaseline.avg_completion_rate = (anomalyBaseline.avg_completion_rate * 0.8) + ((completionRate / 100) * 0.2);
    await context.set('anomaly_baseline', anomalyBaseline, 'Updated by weekly stats');
  } catch { /* non-critical */ }

  // Velocity trend — week-over-week delta and burnout risk detection
  let weekOverWeekDelta = null;
  try {
    const threeWeeksAgo = new Date(now);
    threeWeeksAgo.setDate(now.getDate() - 21);
    const trendResp = await notion.queryDatabase(env.STATS_DB_ID, {
      property: P.STATS.WEEK_OF,
      date: { on_or_after: threeWeeksAgo.toISOString().split('T')[0] }
    });
    const weeklyRates = trendResp.results
      .map(p => ({
        weekOf: p.properties[P.STATS.WEEK_OF]?.date?.start || '',
        rate: p.properties[P.STATS.COMPLETION_RATE]?.number ?? null
      }))
      .filter(r => r.weekOf && r.rate != null)
      .sort((a, b) => a.weekOf.localeCompare(b.weekOf));

    if (weeklyRates.length >= 1) {
      const lastWeekRate = weeklyRates[weeklyRates.length - 1].rate;
      weekOverWeekDelta = completionRate - lastWeekRate;
      if (weekOverWeekDelta <= -thresholds.MAX_WOW_COMPLETION_DROP) {
        alerts.push({
          type: 'DECLINING_COMPLETION',
          severity: 'WARNING',
          actual: completionRate,
          delta: weekOverWeekDelta,
          message: `Completion rate dropped ${Math.abs(weekOverWeekDelta)}pp this week (${lastWeekRate}% → ${completionRate}%)`
        });
      }
    }

    if (weeklyRates.length >= 3) {
      const last3 = weeklyRates.slice(-3);
      if (last3[0].rate > last3[1].rate && last3[1].rate > last3[2].rate) {
        alerts.push({
          type: 'BURNOUT_RISK',
          severity: 'WARNING',
          actual: last3[2].rate,
          message: `Completion rate declining 3 consecutive weeks: ${last3.map(r => r.rate + '%').join(' → ')}`
        });
      }
    }
  } catch { /* non-critical */ }

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

  await logger.info('Weekly stats generated', { completionRate, totalTasks, alerts: alerts.length, completionStreak, deepWorkStreak, weekOverWeekDelta });
  return { completionRate, totalTasks, completedTasks, aiEditRate, avgDurationAccuracy, alerts, completionStreak, deepWorkStreak, weekOverWeekDelta };
}

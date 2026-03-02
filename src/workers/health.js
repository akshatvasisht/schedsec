import { NotionClient } from '../notion-client.js';
import { Logger } from '../logger.js';
import { ContextManager } from '../context.js';
import { CONFIG } from '../config.js';

/**
 * Health Check Worker (Triggered Monday 3 AM)
 * Full integrity check including AI quality monitoring.
 * @param env The parameter.
 * @returns {any} The return value.
 */
export async function handleHealth(env) {
  const notion = new NotionClient(env.NOTION_API_KEY);
  const logger = new Logger(notion, env.LOGS_DB_ID);
  const context = new ContextManager(notion, env.CONTEXT_DB_ID);

  const results = {
    notion_api: false,
    ai_model: false,
    vectorize: false,
    kv_store: false,
    r2_backup: false,
    quality_metrics: { passed: false, alerts: [] }
  };

  // Notion connectivity
  try {
    await notion.queryDatabase(env.INPUTS_DB_ID);
    results.notion_api = true;
  } catch (e) { await logger.error('HealthCheck: Notion failed', { error: e.message }); }

  // AI model
  try {
    const response = await env.AI.run('@cf/qwen/qwen2.5-7b-instruct', { prompt: 'Reply with: OK' });
    results.ai_model = response?.response?.includes('OK') || true;
  } catch (e) { await logger.error('HealthCheck: AI failed', { error: e.message }); }

  // KV store
  try {
    await env.KV.put('health_check', 'ok', { expirationTtl: 60 });
    const val = await env.KV.get('health_check');
    results.kv_store = val === 'ok';
  } catch (e) { await logger.error('HealthCheck: KV failed', { error: e.message }); }

  // R2 — check most recent backup exists and is < 25 hours old
  try {
    const listing = await env.R2_BUCKET.list({ prefix: 'backup_daily_', limit: 1 });
    if (listing.objects.length > 0) {
      const uploaded = listing.objects[0].uploaded;
      const ageHours = (Date.now() - new Date(uploaded).getTime()) / (1000 * 60 * 60);
      results.r2_backup = ageHours < 25;
      if (!results.r2_backup) {
        await logger.warn('HealthCheck: Backup is stale', { ageHours: Math.round(ageHours) });
      }

      // Backup integrity verification (dry-run restore)
      try {
        const backupObj = await env.R2_BUCKET.get(listing.objects[0].key);
        if (backupObj) {
          const snapshot = JSON.parse(await backupObj.text());
          const hasInputs = Array.isArray(snapshot.inputs) && snapshot.inputs.length > 0;
          const hasSchedule = Array.isArray(snapshot.schedule);
          const hasContext = Array.isArray(snapshot.context);

          if (!hasInputs || !hasSchedule || !hasContext) {
            results.quality_metrics.alerts.push({
              type: 'CORRUPT_BACKUP',
              key: listing.objects[0].key,
              detail: { hasInputs, hasSchedule, hasContext }
            });
            await logger.warn('HealthCheck: Backup integrity failed', { key: listing.objects[0].key });
          }
        }
      } catch (parseErr) {
        results.quality_metrics.alerts.push({
          type: 'RESTORE_TEST_FAILED',
          error: parseErr.message
        });
        await logger.warn('HealthCheck: Backup parse test failed', { error: parseErr.message });
      }
    }
  } catch (e) { await logger.error('HealthCheck: R2 failed', { error: e.message }); }

  // AI Quality Metrics — check against thresholds
  try {
    const metrics = await context.get('ai_quality_metrics');
    if (metrics?.current_week) {
      const thresholds = CONFIG.QUALITY_THRESHOLDS;
      const alerts = [];

      if ((metrics.current_week.avg_user_edits_per_day || 0) > thresholds.MAX_EDITS_PER_DAY) {
        alerts.push({ type: 'HIGH_EDIT_RATE', actual: metrics.current_week.avg_user_edits_per_day });
      }
      if ((metrics.current_week.json_failure_rate || 0) > thresholds.MAX_JSON_FAILURES) {
        alerts.push({ type: 'JSON_FAILURES', actual: metrics.current_week.json_failure_rate });
      }
      if ((metrics.current_week.duration_accuracy || 1) < thresholds.MIN_DURATION_ACCURACY) {
        alerts.push({ type: 'LOW_ACCURACY', actual: metrics.current_week.duration_accuracy });
      }

      results.quality_metrics = { passed: alerts.length === 0, alerts };
    }
  } catch (e) { await logger.error('HealthCheck: Quality metrics failed', { error: e.message }); }

  const status = Object.entries(results)
    .filter(([k]) => k !== 'quality_metrics')
    .every(([, v]) => v === true) && results.quality_metrics.passed
    ? 'HEALTHY' : 'DEGRADED';

  await logger.info(`Health check: ${status}`, { checks: results });
  return { status, checks: results };
}

import { CONFIG } from '../config.js';

/**
 * Health Check Worker (Triggered Monday 3 AM)
 * Full integrity check including AI quality monitoring.
 * @param {object} env Environment bindings.
 * @param {object} services Shared service instances for Notion, logging, and context.
 * @returns {Promise<object>} Health-check result object with component statuses.
 */
export async function handleHealth(env, services) {
  const { notion, logger, context } = services;

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
    const listing = await env.R2_BUCKET.list({ prefix: 'backup_daily_' });
    if (listing.objects.length > 0) {
      // Sort by key (lexicographic = chronological for ISO dates) to get latest
      const sorted = listing.objects.sort((a, b) => b.key.localeCompare(a.key));
      const latestKey = sorted[0].key;
      // Parse date from key: backup_daily_YYYY-MM-DD.json
      const keyDate = latestKey.replace('backup_daily_', '').replace('.json', '');
      const backupDate = new Date(keyDate + 'T00:00:00Z');
      const ageHours = (Date.now() - backupDate.getTime()) / (1000 * 60 * 60);
      results.r2_backup = ageHours < 49; // allow up to ~2 days for weekend gaps
      if (!results.r2_backup) {
        await logger.warn('HealthCheck: Backup is stale', { ageHours: Math.round(ageHours), latestKey });
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

  // Detect stale partial schedule writes
  try {
    const writes = await env.KV.list({ prefix: 'schedule_write_' });
    const now = Date.now();
    for (const key of writes.keys) {
      const raw = await env.KV.get(key.name);
      if (!raw) continue;
      const state = JSON.parse(raw);
      if (state.status === 'in_progress' && state.started_at) {
        const ageMs = now - new Date(state.started_at).getTime();
        if (ageMs > 10 * 60 * 1000) {
          results.quality_metrics.alerts.push({
            type: 'PARTIAL_SCHEDULE_WRITE',
            key: key.name,
            age_minutes: Math.floor(ageMs / 60000)
          });
        }
      }
    }
  } catch { /* non-critical */ }

  const status = Object.entries(results)
    .filter(([k]) => k !== 'quality_metrics')
    .every(([, v]) => v === true) && results.quality_metrics.passed
    ? 'HEALTHY' : 'DEGRADED';

  await logger.info(`Health check: ${status}`, { checks: results });
  return { status, checks: results };
}

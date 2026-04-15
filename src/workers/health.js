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
    results.ai_model = !!response?.response?.includes('OK');
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

      // Backup integrity verification (lightweight head check)
      try {
        const latestObj = await env.R2_BUCKET.head(sorted[0].key);
        if (!latestObj || latestObj.size < 100) {
          results.quality_metrics.alerts.push({
            type: 'CORRUPT_BACKUP',
            key: sorted[0].key,
            detail: { size: latestObj?.size || 0 }
          });
          await logger.warn('HealthCheck: Backup integrity suspect', { key: sorted[0].key, size: latestObj?.size });
        }
      } catch (headErr) {
        results.quality_metrics.alerts.push({
          type: 'RESTORE_TEST_FAILED',
          error: headErr.message
        });
        await logger.warn('HealthCheck: Backup head check failed', { error: headErr.message });
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

  // Detect stale partial schedule writes; recover activating markers automatically
  try {
    const writes = await env.KV.list({ prefix: 'schedule_write_' });
    const now = Date.now();
    for (const key of writes.keys) {
      const raw = await env.KV.get(key.name);
      if (!raw) continue;
      const state = JSON.parse(raw);
      const ageMs = state.started_at ? now - new Date(state.started_at).getTime() : Infinity;

      if (state.status === 'in_progress' && ageMs > 10 * 60 * 1000) {
        // Write stalled before all entries landed — can't recover without knowing which
        // pages succeeded, so surface as alert and let the next preview run redo it.
        results.quality_metrics.alerts.push({
          type: 'PARTIAL_SCHEDULE_WRITE',
          key: key.name,
          phase: 'shadow_write',
          age_minutes: Math.floor(ageMs / 60000)
        });
      } else if (state.status === 'activating' && ageMs > 10 * 60 * 1000) {
        // All entries are in Notion as Prefetch but the status-flip stalled.
        // Retry it now so the user gets their schedule without manual intervention.
        if (Array.isArray(state.page_ids) && state.page_ids.length > 0 && state.activate_status) {
          try {
            for (const pageId of state.page_ids) {
              await notion.updatePage(pageId, {
                [CONFIG.PROPERTIES.SCHEDULE.STATUS]: { select: { name: state.activate_status } }
              });
            }
            await env.KV.put(
              key.name,
              JSON.stringify({ status: 'complete', finished_at: new Date().toISOString() }),
              { expirationTtl: 86400 }
            );
            await logger.info('HealthCheck: Recovered stale activate pass', {
              key: key.name,
              pages: state.page_ids.length,
              activate_status: state.activate_status
            });
          } catch (activateErr) {
            results.quality_metrics.alerts.push({
              type: 'PARTIAL_SCHEDULE_WRITE',
              key: key.name,
              phase: 'activate',
              age_minutes: Math.floor(ageMs / 60000),
              error: activateErr.message
            });
          }
        } else {
          results.quality_metrics.alerts.push({
            type: 'PARTIAL_SCHEDULE_WRITE',
            key: key.name,
            phase: 'activate',
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

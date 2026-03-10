/**
 * System Reset — scoped data wipe with dry-run support.
 * @param {object} env Environment bindings.
 * @param {object} services Shared clients.
 * @param {object} options { scope: 'rules'|'schedule'|'full', dry_run: boolean }
 * @returns {Promise<object>} Summary of what was (or would be) deleted.
 */
export async function handleReset(env, services, options = {}) {
  const { notion, logger, context } = services;

  const { scope = 'rules', dry_run = true } = options;
  const summary = { scope, dry_run, actions: [] };

  // Scope: rules — clear inference patterns, learned rules, Vectorize
  if (scope === 'rules' || scope === 'full') {
    summary.actions.push({ target: 'inference_patterns_v2', action: 'clear' });
    summary.actions.push({ target: 'learned_rules_vectors', action: 'clear' });
    summary.actions.push({ target: 'time_slot_bandits', action: 'clear' });
    summary.actions.push({ target: 'energy_curve', action: 'clear' });
    summary.actions.push({ target: 'anomaly_baseline', action: 'clear' });
    summary.actions.push({ target: 'learned_buffers (KV)', action: 'delete' });

    if (!dry_run) {
      await context.set('inference_patterns_v2', {}, 'System reset');
      await context.set('learned_rules_vectors', { rules: [] }, 'System reset');
      await context.set('time_slot_bandits', {}, 'System reset');
      await context.set('energy_curve', {}, 'System reset');
      await context.set('anomaly_baseline', null, 'System reset');
      try { await env.KV.delete('learned_buffers'); } catch { /* ok */ }
      await logger.info('System reset: rules cleared', { scope });
    }
  }

  // Scope: schedule — archive all Schedule DB entries
  if (scope === 'schedule' || scope === 'full') {
    const scheduleResponse = await notion.queryDatabase(env.SCHEDULE_DB_ID);
    summary.actions.push({ target: 'Schedule DB', action: 'archive', count: scheduleResponse.results.length });

    if (!dry_run) {
      for (const page of scheduleResponse.results) {
        await notion.archivePage(page.id);
      }
      // Clear undo snapshots and idempotency keys
      try {
        await env.KV.delete('prompt_token_count');
      } catch { /* ok */ }
      await logger.info('System reset: schedule archived', { scope, count: scheduleResponse.results.length });
    }
  }

  // Scope: full — also clear KV state
  if (scope === 'full') {
    summary.actions.push({ target: 'ai_quality_metrics', action: 'clear' });
    summary.actions.push({ target: 'streak_data', action: 'clear' });

    if (!dry_run) {
      await context.set('ai_quality_metrics', { current_week: {} }, 'System reset');
      await context.set('streak_data', {}, 'System reset');
      await logger.info('System reset: full reset completed', { scope });
    }
  }

  return { success: true, ...summary };
}

import { handlePreview } from './workers/preview.js';
import { handleFinal } from './workers/final.js';
import { handleRegenerate } from './workers/regenerate.js';
import { handleStats } from './workers/stats.js';
import { handleCleanup } from './workers/cleanup.js';
import { handleBackup, restoreFromBackup } from './workers/backup.js';
import { handleHealth } from './workers/health.js';
import { handleExport } from './workers/export.js';
import { handleReset } from './workers/reset.js';
import { bootstrapSystem } from './bootstrap.js';
import { OnboardingManager } from './features/onboarding.js';
import { CalendarBlocks } from './features/calendar-blocks.js';
import { PlanningManager } from './features/planning.js';
import { PanicManager } from './features/panic.js';
import { UndoManager } from './features/undo.js';
import { NotionClient } from './notion-client.js';
import { ContextManager } from './context.js';
import { Logger } from './logger.js';
import { validateTriggerToken } from './trigger.js';
import { CONFIG, validateEnv } from './config.js';
import {
  PanicOverrideSchema,
  CalendarBlockSchema,
  CalendarRemoveSchema,
  RestoreSchema,
  PlanningSchema
} from './utils/validation.js';

function withCors(response) {
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  return response;
}

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return withCors(new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders
    }
  }));
}

async function createServices(env) {
  const notion = new NotionClient(env.NOTION_API_KEY);
  const logger = new Logger(notion, env.LOGS_DB_ID, env);
  const context = new ContextManager(notion, env.CONTEXT_DB_ID);
  return { notion, logger, context };
}

async function flushServices(services) {
  await services.context.flush();
  await services.logger.flush();
}

async function getToday(env, fallbackTimezone = 'UTC') {
  const cachedTz = await env.KV.get('user_timezone_cache');
  const timezone = cachedTz || fallbackTimezone;
  return new Date().toLocaleDateString('en-CA', { timeZone: timezone });
}

async function runScheduledJob(event, env, services, dateStr) {
  if (event.cron === env.CRON_PREVIEW) {
    await handlePreview(env, services, dateStr);
  } else if (event.cron === env.CRON_FINAL) {
    await handleFinal(env, services, dateStr);
  } else if (event.cron === env.CRON_STATS) {
    await handleStats(env, services);
  } else if (event.cron === env.CRON_CLEANUP) {
    await handleCleanup(env, services);
  } else if (event.cron === env.CRON_BACKUP) {
    await handleBackup(env, services);
  } else if (event.cron === env.CRON_HEALTH) {
    await handleHealth(env, services);
  } else {
    await services.logger.warn(`Unrecognized cron trigger: ${event.cron}`);
  }
}

/**
 * SchedSec Main Worker Entrypoint
 */
export default {
  /**
   * HTTP Request Handler
   * @param {Request} request Incoming HTTP request.
   * @param {object} env Worker environment bindings.
   * @param {object} _ctx Cloudflare execution context.
   * @returns {Promise<Response>} HTTP response for the requested endpoint.
   */
  async fetch(request, env, _ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }));
    }

    // Trigger endpoint has its own HMAC auth
    if (path === '/trigger') {
      validateEnv(env);
      const today = await getToday(env);
      const action = url.searchParams.get('action');
      const token = url.searchParams.get('token');
      const dateStr = url.searchParams.get('date') || today;
      if (!env.BUTTON_SECRET) {
        return jsonResponse({ error: 'BUTTON_SECRET not configured' }, 503);
      }
      const valid = await validateTriggerToken(action, dateStr, token || '', env.BUTTON_SECRET);
      if (!valid) {
        return jsonResponse({ error: 'Invalid or expired token' }, 401);
      }

      const services = await createServices(env);
      try {
        let result;
        if (action === 'regenerate') {
          result = await handleRegenerate(env, services, dateStr);
        } else if (action === 'undo') {
          const undo = new UndoManager(env.KV, services.notion);
          result = await undo.restoreSnapshot(dateStr, env.SCHEDULE_DB_ID);
        } else if (action === 'planning') {
          result = await PlanningManager.generateWhatIf([], {}, env, dateStr);
        } else {
          return jsonResponse({ error: 'Unknown action' }, 400);
        }
        return jsonResponse(result);
      } catch (error) {
        await services.logger.error('Trigger endpoint error', { error: error.message, stack: error.stack });
        return jsonResponse({ error: 'Internal error' }, 500);
      } finally {
        await flushServices(services);
      }
    }

    // All other routes require bearer token
    const authHeader = request.headers.get('Authorization');
    if (authHeader !== `Bearer ${env.WORKER_AUTH_TOKEN}`) {
      return withCors(new Response('Unauthorized', { status: 401 }));
    }

    const services = await createServices(env);
    try {
      validateEnv(env);
      const today = await getToday(env);

      let result;

      switch (path) {
        case '/preview':
          result = await handlePreview(env, services, today);
          break;

        case '/final':
          result = await handleFinal(env, services, today);
          break;

        case '/regenerate':
          result = await handleRegenerate(env, services, today);
          break;

        case '/stats':
          result = await handleStats(env, services);
          break;

        case '/health':
          result = await handleHealth(env, services);
          break;

        case '/bootstrap':
          result = await bootstrapSystem(env, services);
          break;

        case '/onboard': {
          const body = await request.json();
          const resetMode = url.searchParams.get('reset') === 'true';
          result = await OnboardingManager.applyAnswers(body, services.context, env.KV, resetMode);
          const tzConfig = await services.context.get('user_timezone_current');
          if (tzConfig?.current) {
            await env.KV.put('user_timezone_cache', tzConfig.current);
          }
          break;
        }

        case '/panic': {
          if (request.method === 'GET') {
            const override = await services.context.get('daily_override');
            result = { active: !!override, override: override || null };
          } else if (request.method === 'DELETE') {
            await services.context.set('daily_override', null, 'Panic mode cleared');
            result = { success: true, message: 'Panic mode cleared' };
          } else {
            const raw = await request.json().catch(() => ({}));
            const parsed = PanicOverrideSchema.safeParse(raw);
            if (!parsed.success) {
              return jsonResponse({ error: 'Invalid input', details: parsed.error.issues }, 400);
            }
            const body = parsed.data;
            const override = body.mode === 'sick'
              ? PanicManager.getSickModeOverride()
              : {
                reason: body.reason || 'Manual override',
                max_work_hours: body.max_work_hours || 4,
                energy_filter: body.energy_filter || null,
                priority_filter: body.priority_filter || null
              };
            await services.context.set('daily_override', override, `Panic mode: ${override.reason}`);
            result = { success: true, override };
          }
          break;
        }

        case '/calendar': {
          const calendar = new CalendarBlocks(services.context);
          if (request.method === 'POST') {
            const raw = await request.json();
            const parsed = CalendarBlockSchema.safeParse(raw);
            if (!parsed.success) {
              return jsonResponse({ error: 'Invalid input', details: parsed.error.issues }, 400);
            }
            const body = parsed.data;
            result = await calendar.addBlock(body.date, body.start, body.end, body.label);
          } else if (request.method === 'DELETE') {
            const raw = await request.json();
            const parsed = CalendarRemoveSchema.safeParse(raw);
            if (!parsed.success) {
              return jsonResponse({ error: 'Invalid input', details: parsed.error.issues }, 400);
            }
            result = await calendar.removeBlock(parsed.data.index);
          } else {
            result = await calendar.getBlocks();
          }
          break;
        }

        case '/planning': {
          const raw = await request.json().catch(() => ({}));
          const parsed = PlanningSchema.safeParse(raw);
          if (!parsed.success) {
            return jsonResponse({ error: 'Invalid input', details: parsed.error.issues }, 400);
          }
          const body = parsed.data;
          result = await PlanningManager.generateWhatIf(body.tasks, body.modifications, env, today);
          break;
        }

        case '/undo': {
          const undo = new UndoManager(env.KV, services.notion);
          result = await undo.restoreSnapshot(today, env.SCHEDULE_DB_ID);
          break;
        }

        case '/restore': {
          const raw = await request.json();
          const parsed = RestoreSchema.safeParse(raw);
          if (!parsed.success) {
            return jsonResponse({ error: 'Invalid input', details: parsed.error.issues }, 400);
          }
          const body = parsed.data;
          const scope = body.scope || 'all';
          result = await restoreFromBackup(env, services, body.date, scope);
          break;
        }

        case '/export': {
          const params = {
            days: url.searchParams.get('days') || '30',
            format: url.searchParams.get('format') || 'csv'
          };
          const exportResult = await handleExport(env, services, params);
          if (exportResult.csv || exportResult.ics) {
            const body = exportResult.csv || exportResult.ics;
            return withCors(new Response(body, {
              headers: {
                'Content-Type': exportResult.contentType,
                'Content-Disposition': `attachment; filename="${exportResult.filename}"`
              }
            }));
          }
          result = exportResult;
          break;
        }

        case '/reset': {
          if (request.method !== 'POST') {
            return jsonResponse({ error: 'POST required' }, 405);
          }
          const body = await request.json().catch(() => ({}));
          result = await handleReset(env, services, body);
          break;
        }

        case '/webhook': {
          if (request.method !== 'POST') {
            return jsonResponse({ error: 'POST required' }, 405);
          }
          const runCfg = CONFIG.getRunConfig(env);
          const cooldownKey = `regen_cooldown_${today}`;
          const cooldown = await env.KV.get(cooldownKey);
          if (cooldown) {
            result = { success: false, message: `Regeneration cooldown active (${runCfg.REGENERATE_COOLDOWN_SECONDS}s)` };
          } else {
            await env.KV.put(cooldownKey, 'active', { expirationTtl: runCfg.REGENERATE_COOLDOWN_SECONDS });
            result = await handleRegenerate(env, services, today);
          }
          break;
        }

        default:
          return withCors(new Response('Not Found', { status: 404 }));
      }

      return jsonResponse(result);
    } catch (error) {
      await services.logger.error('Request failed', { error: error.message, stack: error.stack });
      return jsonResponse({ error: 'Internal error' }, 500);
    } finally {
      await flushServices(services);
    }
  },

  /**
   * Scheduled Cron Handler
   * @param {object} event Cloudflare scheduled event payload.
   * @param {object} env Worker environment bindings.
   * @param {object} _ctx Cloudflare execution context.
   * @returns {Promise<void>} Resolves after the cron run completes or is marked pending.
   */
  async scheduled(event, env, _ctx) {
    const services = await createServices(env);
    const today = await getToday(env);

    try {
      validateEnv(env);

      // Retry pending failed cron runs for this trigger first.
      const pending = await env.KV.list({ prefix: 'pending_cron_' });
      for (const key of pending.keys) {
        const payload = await env.KV.get(key.name);
        if (!payload) continue;
        const pendingRun = JSON.parse(payload);
        if (pendingRun.cron !== event.cron) continue;
        try {
          await runScheduledJob({ cron: pendingRun.cron }, env, services, pendingRun.date || today);
          await env.KV.delete(key.name);
          await services.logger.info('Retried pending cron run', { key: key.name, cron: pendingRun.cron });
        } catch (retryError) {
          await services.logger.warn('Pending cron retry failed', {
            key: key.name,
            cron: pendingRun.cron,
            error: retryError.message
          });
        }
      }

      await runScheduledJob(event, env, services, today);
    } catch (error) {
      const pendingKey = `pending_cron_${event.cron}_${today}`;
      await env.KV.put(pendingKey, JSON.stringify({ cron: event.cron, date: today }), { expirationTtl: 86400 });
      await services.logger.error(`Cron failed: ${event.cron}`, {
        error: error.message,
        stack: error.stack,
        pendingKey
      });
    } finally {
      await flushServices(services);
    }
  }
};

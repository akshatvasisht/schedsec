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

/**
 * SchedSec Main Worker Entrypoint
 */
export default {
  /**
   * HTTP Request Handler
   * @param request The parameter.
   * @param env The parameter.
   * @param _ctx The parameter.
   * @returns {any} The return value.
   */
  async fetch(request, env, _ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const authHeader = request.headers.get('Authorization');

    const today = new Date().toISOString().split('T')[0];

    if (path === '/trigger') {
      const action = url.searchParams.get('action');
      const token = url.searchParams.get('token');
      const dateStr = url.searchParams.get('date') || today;
      if (!env.BUTTON_SECRET) {
        return new Response(JSON.stringify({ error: 'BUTTON_SECRET not configured' }), {
          status: 503, headers: { 'Content-Type': 'application/json' }
        });
      }
      const valid = await validateTriggerToken(action, dateStr, token || '', env.BUTTON_SECRET);
      if (!valid) {
        return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
          status: 401, headers: { 'Content-Type': 'application/json' }
        });
      }
      const notion = new NotionClient(env.NOTION_API_KEY);
      try {
        let result;
        if (action === 'regenerate') {
          result = await handleRegenerate(env, dateStr);
        } else if (action === 'undo') {
          const undo = new UndoManager(env.KV, notion);
          result = await undo.restoreSnapshot(dateStr, env.SCHEDULE_DB_ID);
        } else if (action === 'planning') {
          result = await PlanningManager.generateWhatIf([], {}, env, dateStr);
        } else {
          return new Response(JSON.stringify({ error: 'Unknown action' }), {
            status: 400, headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    if (authHeader !== `Bearer ${env.WORKER_AUTH_TOKEN}`) {
      return new Response('Unauthorized', { status: 401 });
    }
    const notion = new NotionClient(env.NOTION_API_KEY);
    const context = new ContextManager(notion, env.CONTEXT_DB_ID);

    try {
      let result;

      switch (path) {
        case '/preview':
          result = await handlePreview(env, today);
          break;

        case '/final':
          result = await handleFinal(env, today);
          break;

        case '/regenerate':
          result = await handleRegenerate(env, today);
          break;

        case '/stats':
          result = await handleStats(env);
          break;

        case '/health':
          result = await handleHealth(env);
          break;

        case '/bootstrap':
          result = await bootstrapSystem(env);
          break;

        case '/onboard': {
          const body = await request.json();
          const resetMode = url.searchParams.get('reset') === 'true';
          result = await OnboardingManager.applyAnswers(body, context, env.KV, resetMode);
          break;
        }

        case '/panic': {
          if (request.method === 'GET') {
            const override = await context.get('daily_override');
            result = { active: !!override, override: override || null };
          } else if (request.method === 'DELETE') {
            await context.set('daily_override', null, 'Panic mode cleared');
            result = { success: true, message: 'Panic mode cleared' };
          } else {
            const body = await request.json().catch(() => ({}));
            const override = body.mode === 'sick'
              ? PanicManager.getSickModeOverride()
              : {
                reason: body.reason || 'Manual override',
                max_work_hours: body.max_work_hours || 4,
                energy_filter: body.energy_filter || null,
                priority_filter: body.priority_filter || null
              };
            await context.set('daily_override', override, `Panic mode: ${override.reason}`);
            result = { success: true, override };
          }
          break;
        }

        case '/calendar': {
          const body = await request.json();
          const calendar = new CalendarBlocks(context);
          if (request.method === 'POST') {
            result = await calendar.addBlock(body.date, body.start, body.end, body.label);
          } else if (request.method === 'DELETE') {
            result = await calendar.removeBlock(body.index);
          } else {
            result = await calendar.getBlocks();
          }
          break;
        }

        case '/planning': {
          const body = await request.json().catch(() => ({}));
          result = await PlanningManager.generateWhatIf(body.tasks, body.modifications, env, today);
          break;
        }

        case '/undo': {
          const undo = new UndoManager(env.KV, notion);
          result = await undo.restoreSnapshot(today, env.SCHEDULE_DB_ID);
          break;
        }

        case '/restore': {
          const body = await request.json();
          if (!body.date) {
            return new Response(JSON.stringify({ error: 'date parameter required (YYYY-MM-DD)' }), {
              status: 400, headers: { 'Content-Type': 'application/json' }
            });
          }
          const scope = body.scope || 'all';
          result = await restoreFromBackup(env, body.date, scope);
          break;
        }

        case '/export': {
          const params = {
            days: url.searchParams.get('days') || '30',
            format: url.searchParams.get('format') || 'csv'
          };
          const exportResult = await handleExport(env, params);
          if (exportResult.csv) {
            return new Response(exportResult.csv, {
              headers: {
                'Content-Type': 'text/csv',
                'Content-Disposition': `attachment; filename="${exportResult.filename}"`
              }
            });
          }
          result = exportResult;
          break;
        }

        case '/reset': {
          if (request.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'POST required' }), {
              status: 405, headers: { 'Content-Type': 'application/json' }
            });
          }
          const body = await request.json().catch(() => ({}));
          result = await handleReset(env, body);
          break;
        }

        case '/webhook': {
          if (request.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'POST required' }), {
              status: 405, headers: { 'Content-Type': 'application/json' }
            });
          }
          // Rate-limit: max 1 regen per 30min
          const cooldownKey = `regen_cooldown_${today}`;
          const cooldown = await env.KV.get(cooldownKey);
          if (cooldown) {
            result = { success: false, message: 'Regeneration cooldown active (30 min)' };
          } else {
            await env.KV.put(cooldownKey, 'active', { expirationTtl: 1800 });
            result = await handleRegenerate(env, today);
          }
          break;
        }

        default:
          return new Response('Not Found', { status: 404 });
      }

      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },

  /**
   * Scheduled Cron Handler
   * @param event The parameter.
   * @param env The parameter.
   * @param _ctx The parameter.
   */
  async scheduled(event, env, _ctx) {
    const today = new Date().toISOString().split('T')[0];
    const notion = new NotionClient(env.NOTION_API_KEY);
    const logger = new Logger(notion, env.LOGS_DB_ID, env);

    try {
      if (event.cron === env.CRON_PREVIEW) {
        await handlePreview(env, today);
      } else if (event.cron === env.CRON_FINAL) {
        await handleFinal(env, today);
      } else if (event.cron === env.CRON_STATS) {
        await handleStats(env);
      } else if (event.cron === env.CRON_CLEANUP) {
        await handleCleanup(env);
      } else if (event.cron === env.CRON_BACKUP) {
        await handleBackup(env);
      } else if (event.cron === env.CRON_HEALTH) {
        await handleHealth(env);
      } else {
        await logger.warn(`Unrecognized cron trigger: ${event.cron}`);
      }
    } catch (error) {
      await logger.error(`Cron failed: ${event.cron}`, { error: error.message, stack: error.stack });
    }
  }
};

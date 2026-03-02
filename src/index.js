import { handlePreview } from './workers/preview.js';
import { handleFinal } from './workers/final.js';
import { handleRegenerate } from './workers/regenerate.js';
import { handleStats } from './workers/stats.js';
import { handleCleanup } from './workers/cleanup.js';
import { handleBackup, restoreFromBackup } from './workers/backup.js';
import { handleHealth } from './workers/health.js';
import { bootstrapSystem } from './cold-start.js';
import { OnboardingManager } from './features/onboarding.js';
import { CalendarBlocks } from './features/calendar-blocks.js';
import { PlanningManager } from './features/planning.js';
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
          result = await OnboardingManager.applyAnswers(body, context);
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
          result = await restoreFromBackup(env, body.date);
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
    const logger = new Logger(notion, env.LOGS_DB_ID);

    try {
      switch (event.cron) {
        case '30 1 * * *':   // 9:30 PM EST = 1:30 AM UTC (Preview)
          await handlePreview(env, today);
          break;
        case '30 9 * * *':   // 5:30 AM EST = 9:30 AM UTC (Final)
          await handleFinal(env, today);
          break;
        case '59 23 * * 0':  // Sunday 11:59 PM (Stats)
          await handleStats(env);
          break;
        case '0 0 1 * *':    // 1st of month (Cleanup)
          await handleCleanup(env);
          break;
        case '0 2 * * *':    // 2 AM daily (Backup)
          await handleBackup(env);
          break;
        case '0 3 * * 1':    // Monday 3 AM (Health)
          await handleHealth(env);
          break;
      }
    } catch (error) {
      await logger.error(`Cron failed: ${event.cron}`, { error: error.message, stack: error.stack });
    }
  }
};

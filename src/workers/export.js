import { NotionClient } from '../notion-client.js';
import { Logger } from '../logger.js';
import { CONFIG } from '../config.js';

const P = CONFIG.PROPERTIES;

/**
 * User Data Export — provides schedule history as CSV.
 * @param {object} env Environment bindings.
 * @param {object} params Query parameters ({ days, format }).
 * @returns {Promise<Response>} CSV response or JSON error.
 */
export async function handleExport(env, params = {}) {
    const notion = new NotionClient(env.NOTION_API_KEY);
    const logger = new Logger(notion, env.LOGS_DB_ID, env);

    const days = parseInt(params.days) || 30;
    const format = params.format || 'csv';

    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().split('T')[0];

    const response = await notion.queryDatabase(env.SCHEDULE_DB_ID, {
        property: P.SCHEDULE.DATE,
        date: { on_or_after: sinceStr }
    });

    const rows = response.results.map(page => {
        const props = page.properties;
        return {
            date: props[P.SCHEDULE.DATE]?.date?.start || '',
            task: props[P.SCHEDULE.NOTES]?.rich_text?.[0]?.plain_text || '',
            ai_start: props[P.SCHEDULE.AI_START]?.rich_text?.[0]?.plain_text || '',
            final_start: props[P.SCHEDULE.FINAL_START]?.rich_text?.[0]?.plain_text || '',
            ai_duration: props[P.SCHEDULE.AI_DURATION]?.number || '',
            final_duration: props[P.SCHEDULE.FINAL_DURATION]?.number || '',
            actual_duration: props[P.SCHEDULE.ACTUAL_DURATION]?.number || '',
            status: props[P.SCHEDULE.STATUS]?.select?.name || '',
            energy: props[P.SCHEDULE.NOTES]?.rich_text?.[0]?.plain_text || ''
        };
    });

    if (format === 'json') {
        return { success: true, count: rows.length, data: rows };
    }

    // CSV format
    const headers = ['Date', 'Task', 'AI_Start', 'Final_Start', 'AI_Duration', 'Final_Duration', 'Actual_Duration', 'Status'];
    const csvRows = rows.map(r =>
        [r.date, `"${r.task.replace(/"/g, '""')}"`, r.ai_start, r.final_start, r.ai_duration, r.final_duration, r.actual_duration, r.status].join(',')
    );
    const csv = [headers.join(','), ...csvRows].join('\n');

    await logger.info(`Data exported: ${rows.length} entries, last ${days} days`);

    return {
        success: true,
        count: rows.length,
        csv,
        contentType: 'text/csv',
        filename: `schedsec_export_${sinceStr}.csv`
    };
}

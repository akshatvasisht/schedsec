import { CONFIG } from '../config.js';

const P = CONFIG.PROPERTIES;

/**
 * User Data Export — provides schedule history as CSV.
 * @param {object} env Environment bindings.
 * @param {object} services Shared service instances for Notion and logging.
 * @param {object} params Query parameters ({ days, format }).
 * @returns {Promise<object>} Export payload containing JSON rows or CSV contents.
 */
export async function handleExport(env, services, params = {}) {
  const { notion, logger } = services;
  const days = Number.parseInt(params.days, 10) || 30;
  const format = params.format === 'json' ? 'json' : 'csv';

  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split('T')[0];

  const [scheduleResponse, inputsResponse] = await Promise.all([
    notion.queryDatabase(env.SCHEDULE_DB_ID, {
      property: P.SCHEDULE.DATE,
      date: { on_or_after: sinceStr }
    }),
    notion.queryDatabase(env.INPUTS_DB_ID)
  ]);

  const inputTaskById = new Map(
    inputsResponse.results.map(page => ([
      page.id,
      {
        name: page.properties[CONFIG.PROPERTIES.INPUTS.TASK_NAME]?.title?.[0]?.plain_text || '',
        energy: page.properties[CONFIG.PROPERTIES.INPUTS.ENERGY]?.select?.name || ''
      }
    ]))
  );

  const rows = scheduleResponse.results.map(page => {
    const props = page.properties;
    const taskId = props[P.SCHEDULE.TASK]?.relation?.[0]?.id || '';
    const inputTask = inputTaskById.get(taskId);
    return {
      date: props[P.SCHEDULE.DATE]?.date?.start || '',
      task: inputTask?.name || taskId || '',
      ai_start: props[P.SCHEDULE.AI_START]?.rich_text?.[0]?.plain_text || '',
      final_start: props[P.SCHEDULE.FINAL_START]?.rich_text?.[0]?.plain_text || '',
      ai_duration: props[P.SCHEDULE.AI_DURATION]?.number || '',
      final_duration: props[P.SCHEDULE.FINAL_DURATION]?.number || '',
      actual_duration: props[P.SCHEDULE.ACTUAL_DURATION]?.number || '',
      status: props[P.SCHEDULE.STATUS]?.select?.name || '',
      energy: inputTask?.energy || '',
      notes: props[P.SCHEDULE.NOTES]?.rich_text?.[0]?.plain_text || ''
    };
  });

  if (format === 'json') {
    return { success: true, count: rows.length, data: rows };
  }

  // CSV format
  const headers = ['Date', 'Task', 'AI_Start', 'Final_Start', 'AI_Duration', 'Final_Duration', 'Actual_Duration', 'Status', 'Energy', 'Notes'];
  const csvRows = rows.map(r =>
    [
      r.date,
      `"${r.task.replace(/"/g, '""')}"`,
      r.ai_start,
      r.final_start,
      r.ai_duration,
      r.final_duration,
      r.actual_duration,
      r.status,
      r.energy,
      `"${r.notes.replace(/"/g, '""')}"`
    ].join(',')
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

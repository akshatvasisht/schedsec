import { CONFIG } from '../config.js';

const P = CONFIG.PROPERTIES;

/**
 * Escapes special characters for iCalendar text values per RFC 5545 §3.3.11.
 * @param {string} str - Raw string.
 * @returns {string} Escaped string safe for SUMMARY/DESCRIPTION fields.
 */
function icsEscape(str) {
  return str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/**
 * Folds a single iCalendar content line to max 75 octets per RFC 5545 §3.1.
 * @param {string} line - Single unfolded property line.
 * @returns {string} Folded line with CRLF + space continuations.
 */
function icsFold(line) {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  let i = 75;
  while (i < line.length) {
    parts.push(' ' + line.slice(i, i + 74));
    i += 74;
  }
  return parts.join('\r\n');
}

/**
 * User Data Export — provides schedule history as CSV, JSON, or iCalendar (.ics).
 * @param {object} env Environment bindings.
 * @param {object} services Shared service instances for Notion and logging.
 * @param {object} params Query parameters ({ days, format }).
 * @returns {Promise<object>} Export payload with rows (json), csv string, or ics string.
 */
export async function handleExport(env, services, params = {}) {
  const { notion, logger } = services;
  const days = Number.parseInt(params.days, 10) || 30;
  const format = ['json', 'ics'].includes(params.format) ? params.format : 'csv';

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
      id: page.id,
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

  if (format === 'ics') {
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//SchedSec//SchedSec//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      icsFold('X-WR-CALNAME:SchedSec Schedule')
    ];

    for (const row of rows) {
      const startTime = row.final_start || row.ai_start;
      if (!row.date || !startTime) continue;

      const [yr, mo, da] = row.date.split('-');
      const [sh, sm] = startTime.split(':').map(s => s.padStart(2, '0'));
      const startMins = parseInt(sh) * 60 + parseInt(sm);
      const durationMins = Number(row.final_duration || row.ai_duration) || 60;
      const endMins = startMins + durationMins;
      const eh = String(Math.floor(endMins / 60) % 24).padStart(2, '0');
      const em = String(endMins % 60).padStart(2, '0');

      const dtstart = `${yr}${mo}${da}T${sh}${sm}00`;
      const dtend = `${yr}${mo}${da}T${eh}${em}00`;

      const descParts = [
        row.energy ? `Energy: ${row.energy}` : '',
        row.status ? `Status: ${row.status}` : '',
        row.notes ? `Notes: ${row.notes}` : ''
      ].filter(Boolean);

      lines.push('BEGIN:VEVENT');
      lines.push(`DTSTART:${dtstart}`);
      lines.push(`DTEND:${dtend}`);
      lines.push(icsFold(`SUMMARY:${icsEscape(row.task)}`));
      if (descParts.length) lines.push(icsFold(`DESCRIPTION:${icsEscape(descParts.join(' | '))}`));
      lines.push(`UID:${row.id}@schedsec`);
      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');
    const ics = lines.join('\r\n') + '\r\n';

    await logger.info(`ICS exported: ${rows.length} entries, last ${days} days`);
    return {
      success: true,
      count: rows.length,
      ics,
      contentType: 'text/calendar',
      filename: `schedsec_${sinceStr}.ics`
    };
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

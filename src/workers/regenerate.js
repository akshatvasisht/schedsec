import { handlePreview } from './preview.js';
import { UndoManager } from '../features/undo.js';
import { NotionClient } from '../notion-client.js';
import { CONFIG } from '../config.js';

/**
 * Manual Regenerate Worker
 * Allows user to force a re-generation of today's schedule.
 * @param env The parameter.
 * @param dateStr The parameter.
 * @returns {any} The return value.
 */
export async function handleRegenerate(env, dateStr) {
  const notion = new NotionClient(env.NOTION_API_KEY);
  const undo = new UndoManager(env.KV, notion);

  // Fetch current schedule for the date
  const currentScheduleResponse = await notion.queryDatabase(env.SCHEDULE_DB_ID, {
    property: CONFIG.PROPERTIES.SCHEDULE.DATE,
    date: { equals: dateStr }
  });

  const currentSchedule = currentScheduleResponse.results.map(page => ({
    id: page.id,
    task_id: page.properties[CONFIG.PROPERTIES.SCHEDULE.TASK].relation[0]?.id,
    start: page.properties[CONFIG.PROPERTIES.SCHEDULE.AI_START].rich_text[0]?.plain_text,
    duration: page.properties[CONFIG.PROPERTIES.SCHEDULE.AI_DURATION].number
  }));

  // Take undo snapshot
  if (currentSchedule.length > 0) {
    await undo.createSnapshot(dateStr, currentSchedule);
  }

  // Delete current entries
  for (const item of currentSchedule) {
    await notion.archivePage(item.id);
  }

  // Trigger re-generation (uses Preview logic)
  return await handlePreview(env, dateStr);
}

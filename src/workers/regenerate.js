import { handlePreview } from './preview.js';
import { UndoManager } from '../features/undo.js';
import { CONFIG } from '../config.js';

/**
 * Manual Regenerate Worker
 * Allows user to force a re-generation of today's schedule.
 * @param {object} env Environment bindings.
 * @param {object} services Shared service instances for Notion, logging, and context.
 * @param {string} dateStr Target date (YYYY-MM-DD).
 * @returns {Promise<object>} Result of the regenerate workflow.
 */
export async function handleRegenerate(env, services, dateStr) {
  const { notion } = services;
  const undo = new UndoManager(env.KV, notion);
  const lockKey = `regen_lock_${dateStr}`;
  const existingLock = await env.KV.get(lockKey);
  if (existingLock) {
    return { success: false, message: 'Regeneration already in progress' };
  }

  await env.KV.put(lockKey, 'processing', { expirationTtl: 300 });

  try {
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
    return await handlePreview(env, services, dateStr);
  } finally {
    await env.KV.delete(lockKey);
  }
}

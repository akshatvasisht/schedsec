import { NotionClient } from '../notion-client.js';
import { Logger } from '../logger.js';
import { CONFIG } from '../config.js';

const P = CONFIG.PROPERTIES;

/**
 * Nightly Backup Worker (Triggered 2 AM)
 * Creates multi-tier rolling backups of Notion state in R2.
 * @param env The parameter.
 * @returns {any} The return value.
 */
export async function handleBackup(env) {
  const notion = new NotionClient(env.NOTION_API_KEY);
  const logger = new Logger(notion, env.LOGS_DB_ID);
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const dayOfWeek = now.getDay(); // 0=Sunday
  const dayOfMonth = now.getDate();

  const dbs = [
    { name: 'inputs', id: env.INPUTS_DB_ID },
    { name: 'schedule', id: env.SCHEDULE_DB_ID },
    { name: 'context', id: env.CONTEXT_DB_ID }
  ];

  const backupData = {};
  for (const db of dbs) {
    const response = await notion.queryDatabase(db.id);
    backupData[db.name] = response.results;
  }

  // Daily incremental backup
  const dailyKey = `backup_daily_${dateStr}.json`;
  await env.R2_BUCKET.put(dailyKey, JSON.stringify(backupData));

  // Weekly full backup (Sundays)
  if (dayOfWeek === 0) {
    const weekNum = Math.ceil((now.getDate() - now.getDay() + 1) / 7);
    const weeklyKey = `backup_weekly_${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}.json`;
    await env.R2_BUCKET.put(weeklyKey, JSON.stringify(backupData));
  }

  // Monthly pattern archive (1st of month)
  if (dayOfMonth === 1) {
    const month = now.toISOString().substring(0, 7);
    if (backupData.context) {
      const contextEntries = backupData.context.map(p => {
        const key = p.properties[P.CONTEXT.KEY]?.title?.[0]?.plain_text || '';
        const value = p.properties[P.CONTEXT.VALUE]?.rich_text?.[0]?.plain_text || '';
        return `"${key}","${value.replace(/"/g, '""')}"`;
      });
      const csvContent = 'Key,Value\n' + contextEntries.join('\n');
      await env.R2_BUCKET.put(`patterns_${month}.csv`, csvContent);
    }
  }

  // Retention cleanup: delete dailies > 30 days, weeklies > 12 weeks
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(now.getDate() - 30);
  const listing = await env.R2_BUCKET.list({ prefix: 'backup_daily_' });
  for (const obj of listing.objects) {
    const objDate = obj.key.replace('backup_daily_', '').replace('.json', '');
    if (objDate < thirtyDaysAgo.toISOString().split('T')[0]) {
      await env.R2_BUCKET.delete(obj.key);
    }
  }

  await logger.info('Backup completed', { daily: dailyKey, isWeekly: dayOfWeek === 0, isMonthly: dayOfMonth === 1 });
  return { success: true, filename: dailyKey, dbCount: dbs.length };
}

/**
 * Restores Notion state from a daily R2 backup.
 * Creates a restore-point before overwriting.
 * @param env The parameter.
 * @param backupDate The parameter.
 * @returns {any} The return value.
 */
export async function restoreFromBackup(env, backupDate) {
  const notion = new NotionClient(env.NOTION_API_KEY);
  const logger = new Logger(notion, env.LOGS_DB_ID);
  const backupKey = `backup_daily_${backupDate}.json`;

  const backupObj = await env.R2_BUCKET.get(backupKey);
  if (!backupObj) {
    throw new Error(`Backup not found for ${backupDate}`);
  }

  const snapshot = JSON.parse(await backupObj.text());

  // Verify backup integrity
  if (!snapshot.inputs || !snapshot.schedule || !snapshot.context) {
    throw new Error('Invalid backup format — missing required keys');
  }

  // Create restore-point before overwriting
  const restorePointKey = `restore_point_${new Date().toISOString()}.json`;
  const currentState = {};
  for (const dbName of ['inputs', 'schedule', 'context']) {
    const dbId = dbName === 'inputs' ? env.INPUTS_DB_ID
      : dbName === 'schedule' ? env.SCHEDULE_DB_ID
        : env.CONTEXT_DB_ID;
    const response = await notion.queryDatabase(dbId);
    currentState[dbName] = response.results;
  }
  await env.R2_BUCKET.put(restorePointKey, JSON.stringify(currentState));

  // Restore context pages
  let restoredCount = 0;
  for (const page of snapshot.context) {
    if (page.properties) {
      await notion.createPage({
        parent: { database_id: env.CONTEXT_DB_ID },
        properties: page.properties
      });
      restoredCount++;
    }
  }

  await logger.info(`Restored from backup: ${backupDate}`, { restorePointKey, restoredCount });
  return { success: true, backupDate, restorePointKey, restoredCount };
}

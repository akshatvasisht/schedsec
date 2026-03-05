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
  const logger = new Logger(notion, env.LOGS_DB_ID, env);
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const dayOfWeek = now.getDay(); // 0=Sunday
  const dayOfMonth = now.getDate();

  const dbs = [
    { name: 'inputs', id: env.INPUTS_DB_ID },
    { name: 'schedule', id: env.SCHEDULE_DB_ID },
    { name: 'context', id: env.CONTEXT_DB_ID },
    { name: 'stats', id: env.STATS_DB_ID }
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

  // Retention cleanup: delete dailies > 30 days
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(now.getDate() - 30);
  const dailyListing = await env.R2_BUCKET.list({ prefix: 'backup_daily_' });
  for (const obj of dailyListing.objects) {
    const objDate = obj.key.replace('backup_daily_', '').replace('.json', '');
    if (objDate < thirtyDaysAgo.toISOString().split('T')[0]) {
      await env.R2_BUCKET.delete(obj.key);
    }
  }

  // Retention cleanup: delete weeklies > 12 weeks (84 days)
  const twelveWeeksAgo = new Date(now);
  twelveWeeksAgo.setDate(now.getDate() - 84);
  const weeklyListing = await env.R2_BUCKET.list({ prefix: 'backup_weekly_' });
  for (const obj of weeklyListing.objects) {
    // Parse YYYY-W## from key, compare upload date as fallback
    const keyDate = obj.key.replace('backup_weekly_', '').replace('.json', '');
    const [yearStr, weekStr] = keyDate.split('-W');
    const year = parseInt(yearStr);
    const week = parseInt(weekStr);
    // Approximate: week 1 starts Jan 1, each week = 7 days
    const approxDate = new Date(year, 0, 1 + (week - 1) * 7);
    if (approxDate < twelveWeeksAgo) {
      await env.R2_BUCKET.delete(obj.key);
    }
  }

  await logger.info('Backup completed', { daily: dailyKey, isWeekly: dayOfWeek === 0, isMonthly: dayOfMonth === 1 });
  return { success: true, filename: dailyKey, dbCount: dbs.length };
}

/**
 * Restores Notion state from a daily R2 backup.
 * Creates a restore-point before overwriting.
 * Supports scoped restore: context, inputs, schedule, or all.
 * @param env The parameter.
 * @param backupDate The parameter.
 * @param scope The parameter.
 * @returns {any} The return value.
 */
export async function restoreFromBackup(env, backupDate, scope = 'all') {
  const notion = new NotionClient(env.NOTION_API_KEY);
  const logger = new Logger(notion, env.LOGS_DB_ID, env);
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

  // DB name → env binding mapping
  const dbMap = {
    inputs: env.INPUTS_DB_ID,
    schedule: env.SCHEDULE_DB_ID,
    context: env.CONTEXT_DB_ID
  };

  // Determine which DBs to restore
  const dbsToRestore = scope === 'all'
    ? ['inputs', 'schedule', 'context']
    : [scope];

  // Create restore-point before overwriting
  const restorePointKey = `restore_point_${new Date().toISOString()}.json`;
  const currentState = {};
  for (const dbName of Object.keys(dbMap)) {
    const response = await notion.queryDatabase(dbMap[dbName]);
    currentState[dbName] = response.results;
  }
  await env.R2_BUCKET.put(restorePointKey, JSON.stringify(currentState));

  // Archive current pages, then restore from backup
  let restoredCount = 0;
  for (const dbName of dbsToRestore) {
    if (!snapshot[dbName] || !dbMap[dbName]) continue;

    // Archive existing pages (mark as archived in Notion)
    const existing = await notion.queryDatabase(dbMap[dbName]);
    for (const page of existing.results) {
      await notion.updatePage(page.id, {}, true); // archive=true
    }

    // Re-create from backup
    for (const page of snapshot[dbName]) {
      if (page.properties) {
        await notion.createPage(dbMap[dbName], page.properties);
        restoredCount++;
      }
    }
  }

  await logger.info(`Restored from backup: ${backupDate}`, { restorePointKey, restoredCount, scope });
  return { success: true, backupDate, restorePointKey, restoredCount, scope };
}

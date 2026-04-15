#!/usr/bin/env node

/**
 * Verifies Notion database schemas match CONFIG.PROPERTIES.
 * Run from project root. Requires .dev.vars with NOTION_API_KEY and DB IDs.
 */

import { Client } from '@notionhq/client';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { CONFIG } from '../src/config.js';

function loadDevVars() {
  const path = join(process.cwd(), '.dev.vars');
  if (!existsSync(path)) {
    console.error('.dev.vars not found');
    process.exit(1);
  }
  const content = readFileSync(path, 'utf-8');
  const vars = {};
  for (const line of content.split('\n')) {
    const m = line.match(/^([A-Z_]+)="?(.+)"?$/);
    if (m) vars[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return vars;
}

const required = {
  INPUTS: Object.values(CONFIG.PROPERTIES.INPUTS),
  SCHEDULE: Object.values(CONFIG.PROPERTIES.SCHEDULE),
  CONTEXT: Object.values(CONFIG.PROPERTIES.CONTEXT),
  LOGS: Object.values(CONFIG.PROPERTIES.LOGS),
  STATS: Object.values(CONFIG.PROPERTIES.STATS)
};

const dbEnvKeys = {
  INPUTS: 'INPUTS_DB_ID',
  SCHEDULE: 'SCHEDULE_DB_ID',
  CONTEXT: 'CONTEXT_DB_ID',
  LOGS: 'LOGS_DB_ID',
  STATS: 'STATS_DB_ID'
};

async function verify() {
  const vars = loadDevVars();
  const apiKey = vars.NOTION_API_KEY || process.env.NOTION_API_KEY;
  if (!apiKey) {
    console.error('NOTION_API_KEY not set');
    process.exit(1);
  }

  const client = new Client({ auth: apiKey });
  let failed = 0;

  for (const [dbName, propNames] of Object.entries(required)) {
    const dbId = vars[dbEnvKeys[dbName]] || process.env[dbEnvKeys[dbName]];
    if (!dbId) {
      console.log(`[SKIP] ${dbName}: no ${dbEnvKeys[dbName]}`);
      continue;
    }

    try {
      const db = await client.databases.retrieve({ database_id: dbId });
      const schema = db.properties;
      const missing = propNames.filter(p => !schema[p]);
      if (missing.length > 0) {
        console.error(`[FAIL] ${dbName}: missing properties: ${missing.join(', ')}`);
        failed++;
      } else {
        console.log(`[OK] ${dbName}`);
      }
    } catch (err) {
      const hint = err.status === 401
        ? ' (check NOTION_API_KEY)'
        : err.status === 404
          ? ' (check DB ID or integration access)'
          : '';
      console.error(`[FAIL] ${dbName}: ${err.message}${hint}`);
      failed++;
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

verify();

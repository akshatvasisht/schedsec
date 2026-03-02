#!/usr/bin/env node

/**
 * Generates trigger URLs for Notion buttons.
 * Reads BUTTON_SECRET from .dev.vars. Run from project root.
 *
 * Usage: node scripts/generate-trigger-urls.js [baseUrl] [date]
 * Example: node scripts/generate-trigger-urls.js https://schedsec.workers.dev 2026-03-01
 */

import { createHmac } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

function loadDevVars() {
  const path = join(process.cwd(), '.dev.vars');
  if (!existsSync(path)) {
    console.error('.dev.vars not found. Create it with BUTTON_SECRET.');
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

function hmacHex(action, dateStr, secret) {
  const payload = `${action}:${dateStr}`;
  return createHmac('sha256', secret).update(payload).digest('hex');
}

const vars = loadDevVars();
const secret = vars.BUTTON_SECRET || process.env.BUTTON_SECRET;
if (!secret) {
  console.error('BUTTON_SECRET not set in .dev.vars or env');
  process.exit(1);
}

const baseUrl = process.argv[2] || 'https://YOUR_WORKER_URL';
const dateStr = process.argv[3] || new Date().toISOString().split('T')[0];

const actions = ['regenerate', 'undo', 'planning'];
console.log(`Trigger URLs for ${dateStr}:\n`);
for (const action of actions) {
  const token = hmacHex(action, dateStr, secret);
  const url = `${baseUrl}/trigger?action=${action}&token=${token}&date=${dateStr}`;
  console.log(`${action}:`);
  console.log(url);
  console.log();
}

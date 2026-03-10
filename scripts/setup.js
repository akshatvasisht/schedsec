#!/usr/bin/env node

/**
 * SchedSec Interactive Setup Script
 * Provisions Cloudflare infrastructure (KV, R2, Vectorize), injects IDs
 * into wrangler.toml, prompts for Notion credentials, writes .dev.vars, and
 * optionally pushes secrets to production.
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';
import { randomBytes } from 'crypto';
import { join } from 'path';

const WRANGLER_PATH = join(process.cwd(), 'wrangler.toml');
const DEV_VARS_PATH = join(process.cwd(), '.dev.vars');

// --- Prompt Helper ---
const rl = createInterface({ input: process.stdin, output: process.stdout });
const prompt = (q) => new Promise(resolve => {
  rl.question(q, resolve);
});

// --- Wrangler Runner ---
function runWrangler(command) {
  try {
    return execSync(`npx wrangler ${command}`, { encoding: 'utf-8' }).trim();
  } catch (e) {
    if (e.stdout && e.stdout.includes('already exists')) return 'ALREADY_EXISTS';
    console.error(`\nFailed: npx wrangler ${command}`);
    console.error(e.stderr || e.message);
    process.exit(1);
  }
}

// --- Token Generator ---
function generateToken() {
  return `schedsec_${randomBytes(24).toString('hex')}`;
}

console.log('\nSchedSec Setup\n--------------');

// 1. Check Wrangler
try {
  execSync('npx wrangler --version', { stdio: 'ignore' });
} catch {
  console.error('Wrangler not found. Run `npm install` first.');
  process.exit(1);
}

if (!existsSync(WRANGLER_PATH)) {
  console.error('wrangler.toml not found.');
  process.exit(1);
}

let tomlContent = readFileSync(WRANGLER_PATH, 'utf-8');

// 2. Provision Infrastructure
console.log('\nProvisioning Cloudflare infrastructure...\n');

console.log('-> Creating KV Namespace (schedsec-store)...');
const kvOutput = runWrangler('kv:namespace create "schedsec-store"');
let kvId = '';
if (kvOutput !== 'ALREADY_EXISTS') {
  const m = kvOutput.match(/id = "([a-f0-9]+)"/);
  if (m) kvId = m[1];
} else {
  console.log('   (Already exists — check Cloudflare Dashboard for ID)');
}

console.log('-> Creating R2 Bucket (schedsec-backups)...');
runWrangler('r2 bucket create "schedsec-backups"');

// bge-base-en-v1.5 outputs 768-dimensional vectors
console.log('-> Creating Vectorize Index (schedsec-learned-rules, 768 dims)...');
runWrangler('vectorize create "schedsec-learned-rules" --dimensions=768 --metric=cosine');

// 3. Inject IDs into wrangler.toml
if (kvId) {
  tomlContent = tomlContent.replace(
    /\[\[kv_namespaces\]\]\nbinding = "KV"\nid = "[^"]+"/,
    `[[kv_namespaces]]\nbinding = "KV"\nid = "${kvId}"`
  );
}
writeFileSync(WRANGLER_PATH, tomlContent);
console.log('\nwrangler.toml updated.');

// 4. Prompt for Notion Credentials
console.log('\nNotion Setup');
console.log('  Duplicate the template at: https://mirage-earth-76c.notion.site/SchedSec-Dashboard-317c470f750180dd98d1fcbd34266400');
console.log('  Then create an Internal Integration at: https://www.notion.so/my-integrations\n');

const notionKey = await prompt('Notion API Key (secret_...): ');
const inputsDbId = await prompt('Inputs DB ID: ');
const scheduleDbId = await prompt('Schedule DB ID: ');
const contextDbId = await prompt('Context DB ID: ');
const logsDbId = await prompt('Logs DB ID: ');
const statsDbId = await prompt('Stats DB ID: ');
const ntfyTopic = await prompt('ntfy.sh topic for alerts (leave blank to skip): ');

const authToken = generateToken();
const buttonSecret = generateToken();

// 5. Write .dev.vars
const devVarsContent = `NOTION_API_KEY="${notionKey}"
INPUTS_DB_ID="${inputsDbId}"
SCHEDULE_DB_ID="${scheduleDbId}"
CONTEXT_DB_ID="${contextDbId}"
LOGS_DB_ID="${logsDbId}"
STATS_DB_ID="${statsDbId}"
WORKER_AUTH_TOKEN="${authToken}"
BUTTON_SECRET="${buttonSecret}"
NTFY_TOPIC="${ntfyTopic}"
`;
writeFileSync(DEV_VARS_PATH, devVarsContent);
console.log('\n.dev.vars written.');
console.log(`WORKER_AUTH_TOKEN: ${authToken}`);
console.log(`BUTTON_SECRET:     ${buttonSecret}`);
console.log('(Save these — you will need them for your Notion buttons)\n');

// 6. Optionally push secrets to Cloudflare production
const pushNow = await prompt('Push secrets to Cloudflare now? (y/N): ');
if (pushNow.trim().toLowerCase() === 'y') {
  const secrets = {
    NOTION_API_KEY: notionKey,
    INPUTS_DB_ID: inputsDbId,
    SCHEDULE_DB_ID: scheduleDbId,
    CONTEXT_DB_ID: contextDbId,
    LOGS_DB_ID: logsDbId,
    STATS_DB_ID: statsDbId,
    WORKER_AUTH_TOKEN: authToken,
    BUTTON_SECRET: buttonSecret,
    ...(ntfyTopic ? { NTFY_TOPIC: ntfyTopic } : {})
  };
  for (const [key, value] of Object.entries(secrets)) {
    console.log(`  Pushing ${key}...`);
    execSync(`echo "${value}" | npx wrangler secret put ${key}`, { stdio: 'inherit' });
  }
  console.log('\nAll secrets pushed.');

  const deployNow = await prompt('Deploy to Cloudflare now? (y/N): ');
  if (deployNow.trim().toLowerCase() === 'y') {
    execSync('npx wrangler deploy', { stdio: 'inherit' });
  }
}

rl.close();
console.log('\nSetup complete. Next: run `npm run onboard` to personalise your schedule.\n');

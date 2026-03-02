#!/usr/bin/env node

/**
 * SchedSec Interactive Setup Script
 * Automates the provisioning of Cloudflare infrastructure (KV, D1, R2, Vectorize)
 * and injects the generated IDs into wrangler.toml.
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const WRANGLER_PATH = join(process.cwd(), 'wrangler.toml');
const DEV_VARS_PATH = join(process.cwd(), '.dev.vars');

console.log('Starting SchedSec Automated Setup...\n');

// 1. Check dependencies
try {
  console.log('Checking for Wrangler CLI...');
  execSync('npx wrangler --version', { stdio: 'ignore' });
} catch {
  console.error('Cloudflare Wrangler is not installed or accessible.');
  console.error('Please run `npm install` first.');
  process.exit(1);
}

if (!existsSync(WRANGLER_PATH)) {
  console.error('wrangler.toml not found in the current directory.');
  process.exit(1);
}

let tomlContent = readFileSync(WRANGLER_PATH, 'utf-8');

// Helper to run wrangler commands and capture output
function runWrangler(command) {
  try {
    return execSync(`npx wrangler ${command}`, { encoding: 'utf-8' }).trim();
  } catch (e) {
    if (e.stdout && e.stdout.includes('already exists')) {
      return 'ALREADY_EXISTS';
    }
    console.error(`\nFailed to execute: npx wrangler ${command}`);
    console.error(e.stderr || e.message);
    process.exit(1);
  }
}

// 2. Provision Infrastructure
console.log('\nProvisioning Cloudflare Infrastructure (this may take a minute)...\n');

// KV Namespace
console.log('-> Creating KV Namespace (schedsec-store)...');
const kvOutput = runWrangler('kv:namespace create "schedsec-store"');
let kvId = '';
if (kvOutput !== 'ALREADY_EXISTS') {
  const idMatch = kvOutput.match(/id = "([a-f0-9]+)"/);
  if (idMatch) kvId = idMatch[1];
} else {
  console.log('   (KV already exists. If you need the ID, check your Cloudflare Dashboard.)');
}

// R2 Bucket
console.log('-> Creating R2 Bucket (schedsec-backups)...');
runWrangler('r2 bucket create "schedsec-backups"');

// D1 Database
console.log('-> Creating D1 Database (schedsec-cache)...');
const d1Output = runWrangler('d1 create "schedsec-cache"');
let d1Id = '';
if (d1Output !== 'ALREADY_EXISTS') {
  const idMatch = d1Output.match(/database_id = "([a-f0-9-]+)"/);
  if (idMatch) d1Id = idMatch[1];
} else {
  console.log('   (D1 Database already exists.)');
}

// Vectorize Index
console.log('-> Creating Vectorize Index (schedsec-learned-rules) (dimensions: 768)...');
runWrangler('vectorize create "schedsec-learned-rules" --dimensions=768 --metric=cosine');


// 3. Inject IDs into wrangler.toml
console.log('\n Updating wrangler.toml...');

if (kvId) {
  // Replace the dummy KV namespace ID in wrangler.toml
  tomlContent = tomlContent.replace(
    /\[\[kv_namespaces\]\]\nbinding = "KV"\nid = "[^"]+"/,
    `[[kv_namespaces]]\nbinding = "KV"\nid = "${kvId}"`
  );
}

if (d1Id) {
  // Replace the dummy D1 database ID in wrangler.toml
  tomlContent = tomlContent.replace(
    /\[\[d1_databases\]\]\nbinding = "DB"\ndatabase_name = "schedsec-cache"\ndatabase_id = "[^"]+"/,
    `[[d1_databases]]\nbinding = "DB"\ndatabase_name = "schedsec-cache"\ndatabase_id = "${d1Id}"`
  );
}

writeFileSync(WRANGLER_PATH, tomlContent);
console.log('wrangler.toml updated successfully.');

// 4. Create .dev.vars if it doesn't exist
if (!existsSync(DEV_VARS_PATH)) {
  console.log('\nGenerating blank .dev.vars file...');
  const devVarsContent = `NOTION_API_KEY=""
INPUTS_DB_ID=""
SCHEDULE_DB_ID=""
CONTEXT_DB_ID=""
LOGS_DB_ID=""
STATS_DB_ID=""
WORKER_AUTH_TOKEN="${Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)}"
BUTTON_SECRET="${Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)}"
NTFY_TOPIC=""
`;
  writeFileSync(DEV_VARS_PATH, devVarsContent);
  console.log('.dev.vars created. Remember to fill in your Notion credentials!');
}

console.log('\nCloudflare infrastructure setup complete!\n');
console.log('Next Steps:');
console.log('1. Construct your 5 Notion databases according to the schema in docs/SETUP.md');
console.log('2. Paste your Notion API Key and Database IDs into .dev.vars');
console.log('3. Run `npm run dev` to test locally');
console.log('4. Run `npx wrangler secret put NOTION_API_KEY` (and the others) for deployment');

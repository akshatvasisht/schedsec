#!/usr/bin/env node

/**
 * SchedSec Interactive Onboarding Wizard
 *
 * Walks through all scheduling preferences, calls POST /onboard on the local
 * or deployed worker, computes correct UTC cron strings from the user's
 * timezone + preferred times, and patches wrangler.toml + src/index.js so
 * the crons are immediately correct — no manual editing needed.
 *
 * Usage:
 *   node scripts/onboard.js               # Full onboarding (all 11 questions)
 *   node scripts/onboard.js --times-only  # Only update preview/final times
 *   node scripts/onboard.js --reset       # Full onboarding, clears learned patterns first
 */

import readline from 'readline';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const ROOT = process.cwd();
const WRANGLER_PATH = join(ROOT, 'wrangler.toml');
const INDEX_PATH = join(ROOT, 'src', 'index.js');
const DEV_VARS_PATH = join(ROOT, '.dev.vars');

const ARGS = process.argv.slice(2);
const TIMES_ONLY = ARGS.includes('--times-only');
const RESET_MODE = ARGS.includes('--reset');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// ── Prompt helpers ────────────────────────────────────────────────────────────

/**
 * Prompts the user with a question and returns the trimmed answer.
 * @param {string} question - The prompt to display.
 * @returns {Promise<string>} The user's answer.
 */
function ask(question) {
  return new Promise(resolve => {
    rl.question(question, answer => resolve(answer.trim()));
  });
}

/**
 * Displays numbered options and returns the 0-based index the user chose.
 * @param {string} question - Question text to display.
 * @param {string[]} options - Array of option strings.
 * @param {number} [defaultIdx] - Default 0-based index if user presses Enter.
 * @returns {Promise<number>} 0-based index of selected option.
 */
async function askSelect(question, options, defaultIdx = undefined) {
  console.log(`\n${question}`);
  options.forEach((opt, i) => console.log(`  ${i + 1}. ${opt}`));
  if (defaultIdx !== undefined) console.log(`  (default: ${defaultIdx + 1})`);

  while (true) {
    const raw = await ask('→ Choose (1-' + options.length + '): ');
    if (!raw && defaultIdx !== undefined) return defaultIdx;
    const n = parseInt(raw);
    if (!isNaN(n) && n >= 1 && n <= options.length) return n - 1;
    console.log(`  ⚠ Please enter a number between 1 and ${options.length}.`);
  }
}

/**
 * Asks for a free-text value with optional validation.
 * @param {string} question - Question text to display.
 * @param {object} opts - Options object.
 * @param {Function} [opts.validate] - Optional validation function returning boolean.
 * @param {string} [opts.hint] - Optional hint displayed before the prompt.
 * @param {boolean} [opts.optional] - If true, allows empty response.
 * @returns {Promise<string>} The validated user input.
 */
async function askText(question, { validate, hint, optional = false } = {}) {
  if (hint) console.log(`  ℹ  ${hint}`);
  while (true) {
    const raw = await ask(`\n${question}\n→ `);
    if (!raw && optional) return '';
    if (!raw && !optional) { console.log('  ⚠ This field is required.'); continue; }
    if (validate && !validate(raw)) { console.log('  ⚠ Invalid value. Try again.'); continue; }
    return raw;
  }
}

/**
 * Asks for a comma-separated multiselect from a fixed options list.
 * @param {string} question - Question text to display.
 * @param {string[]} options - Valid option strings.
 * @param {string} defaultVal - Default value string if user presses Enter.
 * @returns {Promise<string>} Comma-separated valid selections.
 */
async function askMultiselect(question, options, defaultVal) {
  console.log(`\n${question}`);
  console.log(`  Options: ${options.join(', ')}`);
  console.log(`  (default: ${defaultVal})`);
  const raw = await ask('→ Enter comma-separated values (or press Enter for default): ');
  if (!raw) return defaultVal;
  const valid = raw.split(',').map(s => s.trim()).filter(s => options.includes(s));
  if (valid.length === 0) { console.log('  ⚠ No valid values found, using default.'); return defaultVal; }
  return valid.join(',');
}

// ── Validation helpers ────────────────────────────────────────────────────────

/**
 * Returns true if the given string is a valid IANA timezone identifier.
 * @param {string} tz - Timezone string to validate.
 * @returns {boolean} True if valid.
 */
function isValidTimezone(tz) {
  try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return true; } catch { return false; }
}

/**
 * Returns true if the string matches HH:MM 24-hour format with valid range.
 * @param {string} t - Time string to validate.
 * @returns {boolean} True if valid.
 */
function isValidTime(t) {
  if (!/^\d{2}:\d{2}$/.test(t)) return false;
  const [h, m] = t.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

// ── Cron computation ──────────────────────────────────────────────────────────

/**
 * Converts a local HH:MM time + IANA timezone to a UTC cron string.
 * Uses the current timezone offset (accounts for DST at time of running).
 * Re-run `npm run configure-times` after DST transitions for precision.
 * @param {string} localHHMM - Local time string, e.g. "21:30".
 * @param {string} ianaTimezone - IANA timezone, e.g. "America/Chicago".
 * @returns {{ cronString: string, utcDisplay: string, warning: string|null }} Result.
 */
function localTimeToCronUtc(localHHMM, ianaTimezone) {
  const [lh, lm] = localHHMM.split(':').map(Number);
  const now = new Date();

  /**
   * Formats a Date as "HH:MM" in the given timezone.
   * @param {string} tz - IANA timezone.
   * @returns {string} Formatted time string.
   */
  const fmt = (tz) => new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false
  }).format(now).replace('24:', '00:');

  const [localNowH, localNowM] = fmt(ianaTimezone).split(':').map(Number);
  const [utcNowH, utcNowM] = fmt('UTC').split(':').map(Number);

  const localNowTotal = localNowH * 60 + localNowM;
  const utcNowTotal = utcNowH * 60 + utcNowM;
  const offsetMins = utcNowTotal - localNowTotal;

  const targetLocalMins = lh * 60 + lm;
  const targetUtcMins = ((targetLocalMins + offsetMins) + 1440) % 1440;

  const uh = Math.floor(targetUtcMins / 60);
  const um = targetUtcMins % 60;

  const warning = offsetMins % 30 !== 0
    ? 'DST offset detected. Re-run `npm run configure-times` after DST changes to stay accurate.'
    : null;

  return {
    cronString: `${um} ${uh} * * *`,
    utcDisplay: `${String(uh).padStart(2, '0')}:${String(um).padStart(2, '0')} UTC`,
    warning
  };
}

// ── File patching ─────────────────────────────────────────────────────────────

/**
 * Patches `wrangler.toml`, replacing both the [vars] assignments and the corresponding strings in [triggers].
 * @param {string} previewCron - New preview cron string (UTC).
 * @param {string} finalCron - New final cron string (UTC).
 * @returns {void}
 */
function patchWranglerToml(previewCron, finalCron) {
  let content = readFileSync(WRANGLER_PATH, 'utf-8');

  const oldP = content.match(/CRON_PREVIEW\s*=\s*"([^"]+)"/)?.[1];
  const oldF = content.match(/CRON_FINAL\s*=\s*"([^"]+)"/)?.[1];

  if (oldP && oldF) {
    // Replace [vars]
    content = content.replace(/CRON_PREVIEW\s*=\s*"[^"]+"/, `CRON_PREVIEW = "${previewCron}"`);
    content = content.replace(/CRON_FINAL\s*=\s*"[^"]+"/, `CRON_FINAL = "${finalCron}"`);
    // Replace first occurrence in [triggers] (replace acts on first match natively for string arg)
    content = content.replace(`"${oldP}"`, `"${previewCron}"`);
    content = content.replace(`"${oldF}"`, `"${finalCron}"`);
  }

  writeFileSync(WRANGLER_PATH, content, 'utf-8');
}

// ── .dev.vars loader ──────────────────────────────────────────────────────────

/**
 * Reads key=value pairs from `.dev.vars` and returns them as a plain object.
 * @returns {Record<string, string>} Parsed env vars.
 */
function loadDevVars() {
  if (!existsSync(DEV_VARS_PATH)) return {};
  const raw = readFileSync(DEV_VARS_PATH, 'utf-8');
  const vars = {};
  for (const line of raw.split('\n')) {
    const match = line.match(/^([A-Z_]+)="([^"]*)"/);
    if (match) vars[match[1]] = match[2];
  }
  return vars;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║   SchedSec Onboarding Wizard         ║');
  if (TIMES_ONLY) console.log('║   Mode: Update scheduling times only  ║');
  if (RESET_MODE) console.log('║   Mode: FULL RESET — clears patterns  ║');
  console.log('╚══════════════════════════════════════╝\n');

  const devVars = loadDevVars();
  const authToken = devVars.WORKER_AUTH_TOKEN || '';

  const defaultUrl = 'http://localhost:8787';
  const workerUrl = await ask(`Worker URL (default: ${defaultUrl}): `) || defaultUrl;

  const answers = {};

  if (!TIMES_ONLY) {
    console.log('\n── Scheduling Preferences ─────────────────────────────────────');

    answers.deep_work_time = await askSelect(
      'When do you do your best deep work?',
      ['Early morning (6–9 AM)', 'Morning (9–12 PM)', 'Afternoon (1–4 PM)', 'Evening (5–8 PM)'],
      1
    );

    answers.meeting_length = await askSelect(
      'How long are your typical meetings?',
      ['15–30 min', '30–60 min', '60–90 min', '90+ min'],
      1
    );

    answers.lunch_time = await askSelect(
      'What time do you usually take lunch?',
      ['11:00–12:00', '12:00–13:00', '13:00–14:00', 'I skip lunch'],
      1
    );

    answers.work_hours = await askSelect(
      'How many hours per day do you want to work?',
      ['4 hours (9–13:00)', '6 hours (9–15:00)', '8 hours (9–17:00)', '10 hours (8–18:00)'],
      2
    );

    answers.meeting_preference = await askSelect(
      'Do you prefer morning or afternoon for meetings?',
      ['Morning', 'Afternoon', 'No preference'],
      2
    );

    answers.work_days = await askMultiselect(
      'Which days do you work?',
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      'Mon,Tue,Wed,Thu,Fri'
    );

    answers.buffer_style = await askSelect(
      'How do you prefer to work?',
      [
        'Pomodoro — short tasks with 5–10 min breaks between',
        'Marathon — long uninterrupted blocks, minimal breaks',
        'Adaptive — let the AI decide based on task energy'
      ],
      2
    );

    answers.ntfy_topic = await askText(
      'ntfy.sh topic for push error alerts? (leave blank to skip)',
      { optional: true, hint: 'Free push alerts via ntfy.sh. Leave blank to use Logs DB only.' }
    );
  }

  console.log('\n── Scheduling Times ────────────────────────────────────────────');

  answers.timezone = await askText(
    'What is your IANA timezone? (e.g. America/Chicago, Europe/London)',
    { validate: isValidTimezone, hint: 'Full list at https://en.wikipedia.org/wiki/List_of_tz_database_time_zones' }
  );

  answers.preview_time = await askText(
    "Preview schedule time — when do you review tomorrow's plan? (HH:MM, 24h)",
    { validate: isValidTime, hint: 'e.g. 21:30 = 9:30 PM. Runs the night before.' }
  );

  answers.final_time = await askText(
    'Final schedule time — when should your schedule lock in? (HH:MM, 24h)',
    { validate: isValidTime, hint: 'e.g. 05:30 = 5:30 AM. Runs the morning of.' }
  );

  // Compute UTC crons
  const preview = localTimeToCronUtc(answers.preview_time, answers.timezone);
  const final_ = localTimeToCronUtc(answers.final_time, answers.timezone);

  console.log('\n── Computed UTC Cron Strings ───────────────────────────────────');
  console.log(`  Preview: ${answers.preview_time} ${answers.timezone} → "${preview.cronString}" (${preview.utcDisplay})`);
  console.log(`  Final:   ${answers.final_time} ${answers.timezone} → "${final_.cronString}" (${final_.utcDisplay})`);
  if (preview.warning) console.log(`  ⚠  DST notice: ${preview.warning}`);

  // Call POST /onboard
  if (!TIMES_ONLY) {
    console.log('\n── Applying Preferences ────────────────────────────────────────');
    try {
      const resp = await fetch(`${workerUrl}/onboard${RESET_MODE ? '?reset=true' : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify(answers)
      });
      const json = await resp.json();
      if (json.success) {
        console.log(`  ✓ Applied: ${json.applied?.join(', ')}`);
        if (json.reset) console.log('  ✓ Learned patterns cleared (reset mode)');
      } else {
        console.error('  ✗ Worker returned error:', json);
      }
    } catch (err) {
      console.error(`  ✗ Could not reach worker at ${workerUrl}. Ensure it is running.`);
      console.error(`    (${err.message})`);
      console.log('\n  ⚠ Preferences NOT saved to Notion. Cron files will still be patched.');
    }
  }

  // Patch files
  console.log('\n── Patching Configuration Files ────────────────────────────────');
  try {
    patchWranglerToml(preview.cronString, final_.cronString);
    console.log('  ✓ wrangler.toml variables and triggers updated');
  } catch (err) {
    console.error('  ✗ Failed to patch wrangler.toml:', err.message);
  }

  // Offer deploy
  console.log('');
  const shouldDeploy = await ask('Deploy now to apply new cron schedule? (y/N): ');
  if (shouldDeploy.toLowerCase() === 'y') {
    console.log('\nDeploying...');
    try {
      execSync('npx wrangler deploy', { stdio: 'inherit' });
      console.log('\n✓ Deployed successfully!');
    } catch {
      console.error('\n✗ Deploy failed. Run `npm run deploy` manually.');
    }
  } else {
    console.log('\nSkipped deploy. Run `npm run deploy` when ready.');
    console.log('Until deployed, the old cron schedule remains active in Cloudflare.');
  }

  console.log('\n╔══════════════════════════════════════╗');
  console.log('║   Onboarding complete ✓              ║');
  console.log('╚══════════════════════════════════════╝\n');

  rl.close();
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  rl.close();
  process.exit(1);
});

# SchedSec Setup Guide

This guide details the steps to deploy SchedSec as a personal, self-hosted scheduling assistant.

## Prerequisites
* **Cloudflare Account**: [Sign up here](https://dash.cloudflare.com/sign-up). You will need access to Workers, KV, R2, and Vectorize.
* **Notion Account**: [Sign up here](https://www.notion.so/signup).
* **Node.js**: >= 18.0.0.
* **Wrangler CLI**: Follow the [official installation guide](https://developers.cloudflare.com/workers/wrangler/install-and-update/).

---

## 1. Quick Start: Notion & Cloudflare

### A. Notion Template
Instead of building databases manually, use the official SchedSec Dashboard template:
1. Open the [SchedSec Dashboard Template](https://mirage-earth-76c.notion.site/SchedSec-Dashboard-317c470f750180dd98d1fcbd34266400?source=copy_link).
2. Click **Duplicate** in the top-right corner to copy it to your workspace.

### B. Automated Infrastructure Setup
Clone the repository and run the setup script to provision Cloudflare resources (KV, R2, Vectorize) automatically using the CLI:
```bash
cd schedsec
npm install
npx wrangler login 
npm run setup
```
> [!IMPORTANT]
> **Manual Verification**: The setup script attempts to inject resource IDs into `wrangler.toml`. Please verify that the KV namespace `id` matches the resource shown in your [Cloudflare Dashboard](https://dash.cloudflare.com).

---

## 2. Notion Integration Setup

SchedSec requires an **Internal Integration** to communicate with your databases.

1. Go to the [Notion Integrations Dashboard](https://www.notion.so/my-integrations).
2. Click **+ New integration**.
3. **Integration Type**: Select **Internal** (this is the default).
4. **Name**: `SchedSec AI`.
5. **Capabilities**: Ensure **Read content**, **Update content**, and **Insert content** are all checked.
6. **Save** and note the **Internal Integration Secret**.

### Grant Access
You must grant your integration access to your Dashboard page:
1. Open the **SchedSec Dashboard** page in Notion (the top-level page containing the databases).
2. Click the `...` menu in the top-right corner.
3. Select **Add connections** and search for `SchedSec AI`. This will automatically grant access to all 5 databases within that page.

---

## 3. Configuration & Deployment

### Environment Variables
`npm run setup` prompts for these interactively and writes `.dev.vars` for you. If you prefer to fill them manually:

```env
NOTION_API_KEY="secret_your_notion_integration_secret"
INPUTS_DB_ID="your_inputs_db_id"
SCHEDULE_DB_ID="your_schedule_db_id"
CONTEXT_DB_ID="your_context_db_id"
LOGS_DB_ID="your_logs_db_id"
STATS_DB_ID="your_stats_db_id"
WORKER_AUTH_TOKEN="generate_a_secure_random_string"
BUTTON_SECRET="generate_another_random_string"
```

### Finding Database IDs
Each database ID is in its Notion URL. Open a database as a **full page** (not inline), then copy the ID from the URL:

```
https://www.notion.so/yourworkspace/317c470f750180dd98d1fcbd34266400?v=...
                                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                    This 32-character hex string is the DB ID
```

Do this for all five databases: Inputs, Schedule, Context, Logs, and Stats.

### Production Deployment
Upload your secrets to Cloudflare securely and push the code:
```bash
npx wrangler secret put NOTION_API_KEY # (Repeat for all keys in .dev.vars)
npm run deploy
```

---

## 4. Notion UI Setup (Form + Templates + Schedule Views + Buttons)

### A. Capture Form (Inputs DB)
Create a Notion **Form** view on the Inputs database (`+ Add a view` → `Form`). Add fields: `Task` (required), `Deadline`, `Duration`, `Priority`, `Task_Type`, `Energy`, `Time_Preference`, `Fixed_Time`, `Recurrence`, `Notes`. Hide system-managed fields (`Status`, `Background`, `Must_Complete_By`, `Depends_On`, `Learned_Rules`, `Multi_Day_State`, `Recurrence_State`, `Last_Generated`, `Estimated_Days`, `Weekly_Target`, `Created`, `Updated`).

### B. Database Templates (Inputs DB)
In the Inputs database, click the dropdown beside **New** → **+ New template** and create three:

- **Quick Task** (default): `Status=Active`, `Task_Type=TASK`, `Priority=Medium`, `Energy=Moderate`, `Time_Preference=Anytime`
- **Appointment**: `Status=Active`, `Task_Type=FIXED_APPOINTMENT`
- **Time Block**: `Status=Active`, `Task_Type=TIME_BLOCK`

### C. Schedule Views (Schedule DB)
Create two views on the **Schedule** database:

1. **Today** (table or list):
   - Filter: `Date is today`
   - Sort: `AI_Start` ascending
2. **Calendar**:
   - View type: Calendar
   - Date property: `Date`
   - Show at least: `Status`, `AI_Start`, `AI_Duration`

### D. Dashboard Linked Schedule (Dashboard Page)
Show today's schedule directly on the top-level dashboard:

1. In **SchedSec Dashboard**, type `/linked` and select **Schedule**.
2. Apply:
   - Filter: `Date is today`
   - Sort: `AI_Start` ascending
3. Show only key properties: `Task_Link`, `AI_Start`, `AI_Duration`, `Status`.

### E. Dashboard Buttons
Place trigger buttons at the top of your **SchedSec Dashboard** page:
1. **Generate Trigger URLs**:
   ```bash
   npm run trigger-urls https://YOUR_WORKER_URL_FROM_DEPLOYMENT
   ```
2. **Create Buttons**: In Notion, type `/button` and create buttons for `Regenerate`, `Undo`, and `Planning Mode`. Set each button's action to **Open URL** and paste the corresponding link from step 1.

---

## 5. Verification

### A. Verify Schema
Confirm your Notion databases have the correct properties:
```bash
npm run verify-schema
```
This checks all five databases against the property names SchedSec expects. Fix any `[FAIL]` entries in Notion before continuing.

### B. Health Check
After deploying, verify the worker is running:
```bash
curl -H "Authorization: Bearer YOUR_WORKER_AUTH_TOKEN" https://YOUR_WORKER_URL/health
```

### C. Bootstrap
Seed your Context DB with starter patterns, learned rules, and example tasks:
```bash
curl -X POST -H "Authorization: Bearer YOUR_WORKER_AUTH_TOKEN" https://YOUR_WORKER_URL/bootstrap
```
This is idempotent — running it twice will not duplicate data. The example tasks (Morning standup, Focus time, Email review) can be edited or deleted from your Inputs DB after verifying the system works.

---

## 6. Run Mode (Standard vs Budget)

SchedSec supports two run modes, configured via `RUN_MODE` in `wrangler.toml`:

| Setting | `standard` (default) | `budget` |
|---|---|---|
| AI retries per generation | 3 | 1 |
| T+2 prefetch | Enabled | Disabled |
| Regenerate cooldown | 30 minutes | 60 minutes |
| Deterministic fallback | After 3 AI failures | After 1 AI failure |

**When to use `budget`**: If you are on the Cloudflare Free plan or want to minimize AI/resource usage. Scheduling quality is preserved because the deterministic constraint solver (dependencies, energy budgets, fixed appointments) runs regardless of mode. The AI only handles semantic task placement.

To switch, edit `wrangler.toml`:
```toml
[vars]
RUN_MODE = "budget"
```
Then redeploy with `npm run deploy`.

---

## 7. Onboarding — Personalise Your Schedule

After deploying and verifying, run the onboarding wizard to configure your scheduling preferences. This is what tells SchedSec *when* to run, *how* you like to work, and what your personal energy and meeting patterns look like.

```bash
npm run onboard
```

The wizard asks 11 questions, applies your answers to the Context DB, and automatically updates your cron schedule to match your timezone and preferred times — then offers to deploy immediately.

### What onboarding configures

| Question | Configures |
|---|---|
| Deep work time | AI inference: when to schedule Deep energy tasks |
| Typical meeting length | AI inference: default meeting duration |
| Lunch time | Hard constraint: lunch block in every schedule |
| Hours per day | Work window start/end time |
| Meeting preference | AI inference: morning vs afternoon meetings |
| **Timezone** | All cron times, schedule timezone label |
| **Preview schedule time** | Cron trigger: when tomorrow's preview generates |
| **Final schedule time** | Cron trigger: when today's schedule locks in |
| Work days | Which days AI generates schedules for |
| Break style | Buffer time between tasks (Pomodoro / Marathon / Adaptive) |
| ntfy.sh topic | Push alerts for errors (optional) |

### Changing just your scheduling times

If you move to a new timezone or want to shift your preview/final times without re-doing all preferences:

```bash
npm run configure-times
```

This asks only 3 questions (timezone, preview time, final time), patches `wrangler.toml` + `src/index.js`, and offers to redeploy.

> [!IMPORTANT]
> Cloudflare cron schedules are **static** — they must be deployed to take effect. The wizard will patch your local files and offer to deploy. If you skip the deploy step, run `npm run deploy` manually when ready.

### Re-running onboarding (update preferences)

To update any subset of preferences without clearing what you've learned:

```bash
npm run onboard          # apply new answers on top of existing
```

To start completely fresh (clears learned AI patterns and hard constraints):

```bash
node scripts/onboard.js --reset
```

### Manual / headless usage

If you prefer curl over the interactive script:

```bash
curl -X POST https://YOUR_WORKER_URL/onboard \
  -H "Authorization: Bearer YOUR_WORKER_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "deep_work_time": 1,
    "meeting_length": 1,
    "lunch_time": 1,
    "work_hours": 2,
    "meeting_preference": 0,
    "timezone": "America/Chicago",
    "preview_time": "21:30",
    "final_time": "05:30",
    "work_days": "Mon,Tue,Wed,Thu,Fri",
    "buffer_style": 2,
    "ntfy_topic": ""
  }'
```

All option values are **0-indexed** (first option = 0). After a manual call, you'll need to compute the UTC cron strings yourself and update `wrangler.toml` + `src/index.js` manually — or run `npm run configure-times` to have the script handle it.

---

## 8. Mobile Shortcuts & Automation

All SchedSec endpoints are accessible over HTTP with a bearer token, so any HTTP-capable automation tool (iOS Shortcuts, Android Tasker, curl scripts) can trigger actions directly.

### iOS Shortcuts

**Step 1 — Store your credentials** (do this once):

1. Open **Shortcuts → Settings → iCloud** and note you can store values in a Personal Automation or use the "Text" action as a constant.
2. Create a new shortcut called **"SchedSec Auth"** with a single **Text** action containing `Bearer YOUR_WORKER_AUTH_TOKEN`. Name the output `SchedSec Token`. You'll reference this from other shortcuts.

**Step 2 — Create a shortcut for each action:**

| Action | Method | Endpoint |
|---|---|---|
| Force regenerate today's schedule | `GET` | `/regenerate` |
| Undo last regeneration | `GET` | `/undo` |
| View weekly stats | `GET` | `/stats` |
| Check system health | `GET` | `/health` |
| Trigger preview (test) | `GET` | `/preview` |

For each shortcut, use a **"Get Contents of URL"** action:
- **URL**: `https://YOUR_WORKER_URL/regenerate` (replace endpoint as needed)
- **Method**: GET
- **Headers**: Add header `Authorization` → value from **SchedSec Auth** shortcut (or paste the token directly)

**Step 3 — Add to Home Screen or Back Tap:**

Tap the shortcut → **Share** → **Add to Home Screen** for a one-tap button. Or go to **Settings → Accessibility → Touch → Back Tap** and assign a shortcut to double/triple tap.

### Other Automation Tools

```bash
# curl — regenerate from any terminal
curl -H "Authorization: Bearer YOUR_WORKER_AUTH_TOKEN" https://YOUR_WORKER_URL/regenerate

# curl — export this week's schedule as ICS and open in calendar
curl -H "Authorization: Bearer YOUR_WORKER_AUTH_TOKEN" \
  "https://YOUR_WORKER_URL/export?format=ics&days=7" -o schedule.ics
```

Replace `YOUR_WORKER_URL` with your deployed worker URL (visible in `wrangler deploy` output or Cloudflare Dashboard → Workers) and `YOUR_WORKER_AUTH_TOKEN` with the value from your Wrangler secrets.


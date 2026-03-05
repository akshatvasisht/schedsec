# Interface & API Documentation

## Cloudflare Worker HTTP Endpoints

SchedSec utilizes a monorepo Cloudflare Worker `src/index.js` which acts as both a scheduled Cron processor and a manual HTTP API. All endpoints are accessed via the Worker's public or custom domain.

### Authentication
All HTTP requests except `/trigger` require a standard authorization header matching your configured `WORKER_AUTH_TOKEN` secret.
```http
Authorization: Bearer <your_secure_random_string>
```

### Button Trigger (No Bearer)
`GET /trigger` uses HMAC token validation for Notion buttons. See [docs/BUTTONS_AND_VIEWS.md](BUTTONS_AND_VIEWS.md) for setup.

---

## Core Operational Endpoints

### `GET /preview`
**Description:** Manually triggers the Preview Generator worker to draft the upcoming day's schedule. Normally triggered via Cron (configured by `npm run onboard`).
* **Parameters:** None
* **Returns:** `{ "success": true, "count": 12, "aiAttempts": 1 }`

### `GET /final`
**Description:** Manually triggers the Final Generator worker. Learns from manual Notion edits and finalizes today's timeline. Normally triggered via Cron (configured by `npm run onboard`).
* **Parameters:** None
* **Returns:** `{ "success": true, "learned_rules": 2, "edits": 2 }`

### `GET /regenerate`
**Description:** Forces a complete regeneration of today's schedule. Captures an immediate Undo snapshot, wipes today's schedule entries, and calls the Preview pipeline.
* **Parameters:** None
* **Returns:** `{ "success": true, "count": 10 }`

### `GET /stats`
**Description:** Manually triggers the weekly stats aggregator. Calculates completion rate, AI edit percentage, and updates the Stats DB.
* **Parameters:** None
* **Returns:** `{ "completionRate": 85, "totalTasks": 45, "alerts": [] }`

### `GET /health`
**Description:** Executes a full system health check across Notion, KV, AI models, and Vectorize.
* **Parameters:** None
* **Returns:** `{ "status": "HEALTHY", "checks": { ... } }`

---

## Configuration Endpoints

### `POST /bootstrap`
**Description:** Cold-starts the system. Seeds default inference patterns, provides example tasks in the Inputs DB, and seeds bootstrap rules into Vectorize.
* **Parameters:** None
* **Returns:** `{ "success": true, "seeded": 10 }`

### `POST /onboard`
**Description:** Ingests user answers from the onboarding flow to customize inference behaviors and default schedules (e.g. tracking lunch breaks).
* **Parameters:** 
  ```json
  {
    "deep_work_time": 1,
    "meeting_length": 1,
    "lunch_time": 1,
    "work_hours": 2,
    "meeting_preference": 1
  }
  ```
* **Returns:** `{ "success": true }`

### `POST /calendar` (and `GET`, `DELETE`)
**Description:** Manages the manual configuration of external calendar blocks.
* **Parameters:** `date` (YYYY-MM-DD), `start` (HH:MM), `end` (HH:MM), `label`
* **Returns:** Array of all active external calendar blocks.

### `POST /planning`
**Description:** Generates a what-if schedule scenario without writing to Notion.
* **Parameters:** `{ "tasks": [...], "modifications": { "add_tasks", "remove_tasks", "modify_tasks" } }`
* **Returns:** `{ "success": true, "data": [...], "modifications_applied": {...} }`

### `GET /undo`
**Description:** Restores today's schedule from the last Undo snapshot (taken before Regenerate).
* **Parameters:** None
* **Returns:** `{ "success": true, "restored": 5 }` or `{ "success": false, "error": "NO_SNAPSHOT" }`

### `GET /trigger`
**Description:** Secure trigger for Notion buttons. No Bearer auth; uses HMAC token.
* **Parameters:** `action` (regenerate|undo|planning), `token` (hex HMAC), `date` (optional, default today)
* **Returns:** Same as the underlying action.

---

## Error Handling

Standard Cloudflare Worker HTTP status codes are used. Detailed error reasons are provided in the response body.

* **401 Unauthorized:** Invalid or missing `Authorization: Bearer` token.
* **500 Internal Server Error:** Unexpected exceptions (Dependency Cycles, Notion rate limits). Check the Notion Logs DB for full stack traces.

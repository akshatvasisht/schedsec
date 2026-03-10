# API Reference

SchedSec exposes a single Cloudflare Worker (`src/index.js`) that serves both scheduled automation and a small authenticated HTTP API.

## Authentication

All endpoints except `/trigger` require:

```http
Authorization: Bearer <WORKER_AUTH_TOKEN>
```

`GET /trigger` is intended for Notion buttons and uses an HMAC token derived from `BUTTON_SECRET`. Tokens are time-bucketed and expire automatically after roughly two hours. Setup instructions live in [`docs/SETUP.md`](SETUP.md#e-dashboard-buttons).

## CORS

The Worker sends permissive CORS headers on API responses:

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS`
- `Access-Control-Allow-Headers: Authorization, Content-Type`

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/preview` | Bearer | Generate a preview schedule for today. |
| `GET` | `/final` | Bearer | Learn from recent edits and finalize today's schedule. |
| `GET` | `/regenerate` | Bearer | Snapshot, clear, and fully rebuild today's schedule. |
| `GET` | `/stats` | Bearer | Compute weekly statistics and alerts. |
| `GET` | `/health` | Bearer | Run the full health-check suite. |
| `POST` | `/bootstrap` | Bearer | Seed a fresh install with starter context, rules, and example tasks. |
| `POST` | `/onboard` | Bearer | Apply onboarding answers to context/KV. |
| `GET` / `POST` / `DELETE` | `/calendar` | Bearer | Manage external calendar blocks. |
| `POST` | `/planning` | Bearer | Generate an in-memory what-if schedule. |
| `GET` | `/undo` | Bearer | Restore today's schedule from the latest snapshot. |
| `POST` | `/restore` | Bearer | Restore one or more databases from an R2 backup. |
| `GET` | `/export` | Bearer | Export recent schedule history as CSV or JSON. |
| `POST` | `/reset` | Bearer | Run a scoped reset (`rules`, `schedule`, or `full`). |
| `GET` / `POST` / `DELETE` | `/panic` | Bearer | Read, set, or clear the current daily override. |
| `POST` | `/webhook` | Bearer | Trigger regenerate with cooldown protection. |
| `GET` | `/trigger` | HMAC | Notion-button trigger for `regenerate`, `undo`, or `planning`. |

## Selected Request/Response Shapes

### `POST /onboard`

Minimal example:

```json
{
  "deep_work_time": 1,
  "meeting_length": 1,
  "lunch_time": 1,
  "work_hours": 2,
  "meeting_preference": 1,
  "timezone": "America/Chicago",
  "preview_time": "21:30",
  "final_time": "05:30"
}
```

Returns:

```json
{
  "success": true
}
```

### `POST /planning`

```json
{
  "tasks": [],
  "modifications": {
    "add_tasks": [],
    "remove_tasks": [],
    "modify_tasks": []
  }
}
```

Returns an in-memory scenario without writing to Notion:

```json
{
  "success": true,
  "data": [],
  "modifications_applied": {}
}
```

### `GET /export`

Query params:

- `days`: lookback window, default `30`
- `format`: `csv` or `json`, default `csv`

CSV returns an attachment. JSON returns:

```json
{
  "success": true,
  "count": 42,
  "data": []
}
```

### `POST /restore`

```json
{
  "date": "2026-03-09",
  "scope": "all"
}
```

### `POST /reset`

```json
{
  "scope": "rules",
  "dry_run": true
}
```

### `GET /trigger`

Query params:

- `action`: `regenerate`, `undo`, or `planning`
- `token`: hex-encoded HMAC token
- `date`: optional `YYYY-MM-DD`, defaults to the Worker's computed "today"

Returns the same payload as the underlying action.

## Error Handling

The API uses standard HTTP status codes with JSON error payloads where possible.

- `401 Unauthorized`: Missing or invalid bearer token, or invalid/expired trigger token
- `400 Bad Request`: Invalid route parameters or malformed request body
- `405 Method Not Allowed`: Wrong HTTP method for the endpoint
- `500 Internal Server Error`: Unexpected runtime failure

Operational failures are also written to the Notion Logs database through the buffered logger.

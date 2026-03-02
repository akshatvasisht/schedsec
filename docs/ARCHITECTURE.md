# SchedSec Architecture

This document details the architectural decisions, system components, and data flow for SchedSec.

---

## Glossary

* **Context DB:** A Notion database storing system configurations, hard constraints, and learned rules.
* **Idempotency Key:** A unique identifier (stored in Cloudflare KV) ensuring a worker does not execute the same task twice within a specific timeframe.
* **Inputs DB:** The Notion database where the user enters raw tasks, meetings, and deadlines.
* **Optimistic Locking:** A concurrency control method using a `Version` property in Notion to prevent the AI from overwriting a user's manual schedule edits.
* **Schedule DB:** The Notion database where SchedSec outputs the generated daily timeline.

## System Overview
SchedSec uses a **Three-Layer Serverless Architecture**:
1.  **Data Layer:** Notion API acts as the primary User Interface and data store.
2.  **Intelligence Layer:** Cloudflare Workers orchestrate logic, leveraging Cloudflare AI (Qwen) for reasoning and algorithms for constraint validation.
3.  **Memory Layer:** Cloudflare KV (idempotency, undo state), Vectorize (semantic rules), and R2 (backups/archives) provide long-term state.

## Directory Structure
```
/src
├── config.js              # Global constants and Notion property mappings
├── index.js               # Main Cloudflare Worker entrypoint (HTTP + Cron)
├── notion-client.js       # Rate-limited Notion API wrapper
├── workers/               # Core worker pipelines (preview, final, cleanup, etc.)
├── scheduler/             # AI prompting, optimizations, multi-day, routing
├── learning/              # Rule extraction, semantic search, confidence decay
├── features/              # Smart features (batching, onboarding, energy curve)
└── utils/                 # Time manipulation, Zod validation
/tests                     # Vitest regression and unit tests
```

## Tech Stack & Decision Record

| Category | Technology | Rationale |
| :--- | :--- | :--- |
| **Runtime** | Cloudflare Workers | Serverless execution with built-in Cron triggers, extreme low latency, and generous free tiers. |
| **Database/UI** | Notion API | Eliminates the need to build a custom frontend GUI. Users manage tasks in a familiar workspace. |
| **AI Inference** | CF Workers AI (Qwen) | Native integration with Workers, no external API keys required, capable of JSON-constrained output. |
| **State Storage** | CF KV & Vectorize | High read-speed key-value storage for idempotency; native vector DB for semantic rule retrieval. |

## Data Flow

### The Daily Pipeline (Preview & Final)
1.  **Input:** User adds tasks to the Notion Inputs DB.
2.  **Preview (9:30 PM):**
    *   `preview.js` fetches active tasks.
    *   Algorithmic resolving: Recurrence processing, multi-day splitting, dependency topological sort.
    *   AI Generation: Semantic search retrieves rules. AI maps tasks to time slots via prompt engineering.
    *   Output: Draft schedule written to Notion Schedule DB (Status: Preview).
3.  **Final (5:30 AM):**
    *   `final.js` reads the Schedule DB.
    *   Compares `AI_Start` vs `Final_Start` (user edits).
    *   Extracts rules from edits, updates EMA models, creates an Undo snapshot in KV.
    *   Output: Finalizes schedule (Status: Scheduled).

## Design Constraints & Trade-offs

* **Decision:** Hybrid AI + Algorithmic approach (AI for placement, Algorithms for constraint checking).
  * **Alternative Considered:** Pure LLM generation.
  * **Rationale:** Pure LLMs frequently hallucinate time math and violate hard constraints (like lunch breaks). Algorithms guarantee safety; the LLM handles context-aware placement.
* **Decision:** Notion as the primary database.
  * **Alternative Considered:** Cloudflare D1 with a custom React frontend.
  * **Rationale:** The primary goal is frictionless user adoption. Users already live in Notion. Building a custom frontend adds maintenance overhead for negative UX value.

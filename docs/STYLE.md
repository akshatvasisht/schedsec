# Coding & Style Standards (Audit Guide)

This document outlines the coding conventions, stylistic choices, and architectural rules for SchedSec. It serves as the primary instructions for subsequent AI audits.

---

## 1. Architectural Integrity

* **Zero-State Rule**: Cloudflare Workers must execute completely statelessly between invocations. All persistent state must be written to Notion, KV, or Vectorize.
* **Separation of Concerns**: The AI (`prompt.js`, Qwen model) determines *placement*, while Deterministic Algorithms (`multi-day.js`, `optimizations.js`) validate *safety and constraints*. Never ask the AI to do strict math (e.g., duration splitting).
* **Idempotency**: All Cron workers MUST check `IdempotencyManager` as step 1. If an event is retried, the system must not duplicate Notion writes.

## 2. Coding Standards (JavaScript/ES6+)

* **Modules**: Use ES6 `import`/`export` syntax exclusively. Do not use CommonJS `require()`.
* **Classes vs Functions**: Use static classes (`class Manager { static doWork() }`) for namespaces grouping pure functions. Avoid `new ClassInstance()` unless maintaining local memory state within a single HTTP request boundary (e.g., `NotionClient`).
* **Asynchronous Logic**: Use `async`/`await`. Avoid `.then()` chaining.
* **Error Handling**: Throw specific custom errors defined in `errors.js` (e.g., `DependencyCycleError`). Never throw raw strings.
* **JSDoc**: All public methods and classes must have brief JSDoc comments explaining purpose and return values. Type annotations are optional but recommended for complex objects.

### Code Style Guidelines

* **Indentation**: 2 spaces. No tabs.
* **Quotes**: Use single quotes string literals, except when interpolating variables (`template literals`).
* **Semicolons**: Required at the end of statements.
* **Comments**: Do not use numbered comments (e.g., `// 1. Do X`) unless absolutely necessary.
* **Variable Naming**: `camelCase` for instances/variables, `PascalCase` for classes, `UPPER_SNAKE_CASE` for global constants.
* **Constants**: All Notion property mappings and hardcoded thresholds MUST live in `config.js` (`CONFIG.PROPERTIES`, `CONFIG.DEFAULTS`). Do not hardcode "Magic Strings" in worker logic.

## 3. Data Flow & External API Rules

* **Notion Requests**: All Notion API interactions MUST go through `NotionClient` to ensure 3 req/sec rate limiting. Do not install the official `@notionhq/client` in individual workers.
* **Concurrency**: Prefer sequential execution `for (const x of arr)` over `Promise.all()` when mutating Notion state to prevent optimistic locking conflicts and 429 rate limits.
* **Optimistic Locking**: Whenever updating the `Schedule DB`, you must use `OptimisticLock.acquireWrite()` to prevent the worker from silently overwriting a user's recent manual edit.

## 4. Testing Conventions

* **Framework**: Vitest.
* **Structure**: Maintain the 10 Core Regression Cases (`RT001` - `RT010`) in `regression.test.js`.
* **Focus**: Test deterministic algorithm outputs (cycle detection, slot finding). Do not attempt to mock AI prompt generation outputs — those are brittle. Test validation logic instead (`validation.js`).

## 5. Audit Checklist

When auditing the codebase based on this `STYLE.md` file, the following should be checked:
1. Missing `OptimisticLock` checks in workers writing to Notion.
2. Missing JSDoc headers on exported methods.
3. Hardcoded strings that should use `CONFIG.PROPERTIES`.
4. Extraneous `try/catch` blocks that swallow errors instead of using the `logger.js` central utility.
5. Inconsistent spacing or indentation.

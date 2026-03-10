# Testing Guidelines

## Strategy
SchedSec relies on **[Vitest](https://vitest.dev/)** for automated testing. Our testing philosophy prioritizes **Deterministic Verification over AI Mocking**. 

Because LLM outputs (Qwen 2.5 7B) are inherently probabilistic, we do **not** write string-matching tests against AI output. Instead, our tests focus strictly on the deterministic algorithms that enforce safety constraints before the AI is invoked, and the validation schemas that verify the AI's output format.

### Test Types
* **Unit Tests (`tests/unit/`):** Fast, isolated tests for date manipulation, buffering, learning, and time math.
* **Integration Tests (`tests/integration/`):** Cross-module workflow integrations.
* **Regression Tests (`tests/regression/regression.test.js`):** The core regression suite. These validate complex algorithmic logic like dependency cycle detection and energy budget enforcement.

---

## Running Tests

### Automated Suite
Run the full suite using npm:
```bash
npm test
```

Run the linter as part of the same verification pass:

```bash
npm run lint
```

To run tests in watch mode during development:
```bash
npm run test:watch
```

---

## The Core Regression Suite (RT001 - RT010)

All changes to the `scheduler/` algorithms MUST pass the Top 10 Regression Scenarios. These tests define the contract of SchedSec's strict constraint environment.

| Test ID | Scenario | Purpose |
|---|---|---|
| **RT001** | Simple Day | Verifies basic non-conflicting topology sorting and slot finding. |
| **RT002** | Impossible Constraint | Verifies feasibility detection (e.g., trying to fit 3 hours of tasks into 1 hour of available time). |
| **RT003** | Circular Dependency | Verifies the DFS cycle detector correctly halts generating if A -> B -> C -> A. |
| **RT004** | Energy Budget Violation | Verifies tasks get deferred or split when a day exceeds maximum `Deep` work allowance. |
| **RT005** | Fixed Appointment Conflicts | Verifies that flexible tasks cannot overwrite `FIXED_APPOINTMENT` properties. |
| **RT006** | Critical Path Deadlines | Verifies multi-day task constraint splitting. |
| **RT007** | Zod Schema Validation | Verifies that malformed AI responses trigger validation errors before reaching Notion. |
| **RT008** | Panic Mode | Verifies priority overrides correctly filter out non-essential tasks. |
| **RT009** | Multi-day Decay | Verifies the custom 40/35/25 multi-day energy decay ratio. |
| **RT010** | Semantic Matches | Verifies correct rule inference parsing. |

---

## Writing New Tests

* **No External Hardware/Network:** Tests must be perfectly isolated. Do NOT hit the Notion API or Cloudflare AI endpoint in the test suite.
* **Pattern:** Follow arrange, act, assert.
* **File Naming:** Place all tests in the `/tests` directory and use the `.test.js` suffix.

### Dealing with Dates
When writing tests that involve "today", either use the `dateStr` dependency injection pattern or mock the system clock internally (Vitest provides `vi.useFakeTimers()`) to prevent tests from failing natively when crossing midnight boundaries.

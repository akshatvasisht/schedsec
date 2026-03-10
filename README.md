<p align="center">
  <img 
    width="200" 
    height="200" 
    alt="SchedSec Logo" 
    src="docs/images/logo.svg" 
  />
</p>

![JavaScript](https://img.shields.io/badge/JavaScript-ES6%2B-yellow?logo=javascript&logoColor=white)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-Serverless-f38020?logo=cloudflare&logoColor=white)
![Notion API](https://img.shields.io/badge/Notion_API-Integration-black?logo=notion&logoColor=white)
![Qwen Model](https://img.shields.io/badge/AI-Qwen_2.5_7B-1E90FF)
![Cloudflare Vectorize](https://img.shields.io/badge/Cloudflare_Vectorize-Database-f38020?logo=cloudflare&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-Testing-6e9f18?logo=vitest&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

SchedSec is a self-hosted, serverless scheduling assistant that generates your daily task schedule automatically using a hybrid approach: deterministic constraint solvers handle the math (dependencies, energy budgets, fixed appointments), while Cloudflare Workers AI handles semantic placement. It learns from your edits over time and runs entirely on your own Cloudflare and Notion accounts with no subscription or third-party data sharing.

## How It Works

Each day, a Cron-triggered pipeline runs in two stages:

1. **Preview** (overnight) — Fetches your active tasks, resolves dependencies (DAG topological sort), enforces energy budgets, finds free time slots around fixed appointments, and prompts Qwen 2.5 7B to place tasks semantically. Writes a draft schedule to Notion.
2. **Final** (morning) — Reads any manual edits you made to the draft, learns from them (EMA inference updates, rule extraction to Vectorize), and locks the schedule.

The system never stores your data anywhere except your own Notion workspace and Cloudflare account.

## Performance

- Constraint adherence: 100% (dependency cycles, energy caps, and fixed appointments are enforced deterministically before the AI is called)
- Algorithmic latency: <50ms for dependency resolution and slot finding
- Schedule generation: ~3–5s via Qwen 2.5 7B on Cloudflare Edge

## Documentation

- **[SETUP.md](docs/SETUP.md)** — Get running in minutes: Notion template, `npm run setup`, `npm run onboard`
- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** — System components, data flow, and constraint algorithms
- **[API.md](docs/API.md)** — HTTP endpoints, authentication, and Notion button setup
- **[TESTING.md](docs/TESTING.md)** — Running tests and the core regression suite
- **[STYLE.md](docs/STYLE.md)** — Coding standards and architectural invariants

## License

See **[LICENSE](LICENSE)** file for details.

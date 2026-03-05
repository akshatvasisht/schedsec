![JavaScript](https://img.shields.io/badge/JavaScript-ES6%2B-yellow?logo=javascript&logoColor=white)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-Serverless-f38020?logo=cloudflare&logoColor=white)
![Notion API](https://img.shields.io/badge/Notion_API-Integration-black?logo=notion&logoColor=white)
![Qwen Model](https://img.shields.io/badge/AI-Qwen_2.5_7B-1E90FF)
![Vectorize](https://img.shields.io/badge/Vector_DB-Cloudflare_Vectorize-FF8C00)
![Vitest](https://img.shields.io/badge/Vitest-Testing-6e9f18?logo=vitest&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)
SchedSec is an autonomous, serverless 'Scheduling Secretary' designed to automate the cognitive load of daily planning. Instead of relying solely on LLMs, SchedSec uses a hybrid architecture: deterministic constraint solvers combined with LLM-based semantic placement. It adapts to user habits, extracting rules to vector embeddings for semantic retrieval, enabling accurate, private scheduling without expensive SaaS subscriptions.

### The Philosophy: Hybrid Scheduling

SchedSec addresses an LLM weakness: mathematical reasoning. Pure LLMs often overlap tasks, ignore constraints, or violate dependency trees when scheduling. SchedSec solves this by offloading feasibility to deterministic solvers, using the LLM solely for semantic placement.

### How SchedSec Works

SchedSec extends into an autonomous learning system by leveraging an end-to-end algorithmic -> semantic -> feedback pipeline:

1. **Constraint Validation Layer (Optimization Engine)**
   Resolves topological dependencies, calculates energy budgets, and pre-computes available free blocks.
2. **Context Retrieval Layer (Cloudflare Vectorize)**
   Searches the historical graph for semantic rules (e.g., "Deep work shouldn't follow a 1-hour meeting").
3. **Generation Layer (Cloudflare Workers AI)**
   Prompts Qwen 2.5 7B with verified free slots and context rules to generate a deterministic JSON timeline.
4. **Learning Layer (Final Generator Worker)**
   Analyzes manual user edits (diffs) made to the AI's schedule during the day, updating internal inference matrices via Exponential Moving Average (EMA) and extracting new rules for Vectorize.

## Impact

Traditional smart calendars are subscription-based black boxes. SchedSec operates transparently via Notion, giving users manual control while offloading computation to Cloudflare's serverless edge.

### Performance

- **Constraint Adherence**: 100% adherence to mathematical constraints (fixed appointments, dead-ends, multi-day splits) via the hybrid architecture.
- **Algorithmic Latency**: <50ms for dependency resolution and slot finding.
- **Inference Latency**: ~3-5s for full daily schedule generation via Qwen 2.5 7B on Cloudflare Edge.

### Applications

**Automated Daily Planning**
- Offloads scheduling by providing a customized, constraint-checked draft schedule every morning based on inferred priorities.

**Dynamic Workload Balancing**
- People handling multiple projects can drop tasks into the Notion inbox and let the system split execution over multiple days via internal 40/35/25 energy decay algorithms.

**High-Security Ecosystems**
- Users retain 100% ownership of their data in Notion and run the compute logic on their own Cloudflare tenant, completely avoiding third-party data ingestion, completely free.

## Documentation

- **[SETUP.md](docs/SETUP.md)**: Deployment, resource provisioning, and Notion integration.
- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)**: System design, Data/Intelligence/Memory layers, and D1/Vectorize schemas.
- **[API.md](docs/API.md)**: Worker HTTP endpoints, HMAC security, and authentication.
- **[TESTING.md](docs/TESTING.md)**: Local development and regression suite guidelines.
- **[STYLE.md](docs/STYLE.md)**: Coding standards and project architectural invariants.

## License

See **[LICENSE](LICENSE)** file for details.

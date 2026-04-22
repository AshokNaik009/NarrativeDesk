# NarrativeDesk

Reference implementation of an end-to-end HITL agentic trading pipeline. Designed to study how guardrailed, human-approved LLM agents behave on real (paper) orders. Ingests news and price data, runs LLM analysis with credibility scoring, enforces safety guardrails, and requires human approval before executing any trade on Alpaca's paper trading API. **Not** a returns-generating system or alpha source.

![Dashboard — live activity feed with sidebar navigation, GST timestamps, filter chips, and per-event "view checks" link](docs/screenshots/dashboard.png)


--- 

## Architecture

NarrativeDesk is a five-layer pipeline. Each layer is independently testable, has explicit guardrails, and writes a full audit trail to Postgres. No trade reaches execution without passing every prior layer.

```
┌──────────────────────────────────────────────────────────────────────┐
│  LAYER 0 — INGESTION (News + Crypto Signals)                         │
├──────────────────────────────────────────────────────────────────────┤
│  News:                       │  Crypto-Native Signals:              │
│  • Finnhub (60s)             │  • Binance Funding Rates (5m)        │
│  • Price feed WebSocket      │  • Liquidation Cascades (real-time)  │
│                              │  • DefiLlama Stablecoin Spikes (15m) │
│                              │  • Etherscan Whale Transfers (5m)    │
└──────────────────────────────────┬───────────────────────────────────┘
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│  LAYER 1 — FILTER & CREDIBILITY                                      │
├──────────────────────────────────────────────────────────────────────┤
│  EventFilter  →  Credibility Sub-Agent (Gemini 2.0 Flash, 1–5)       │
│    • watchlist match        • dedupe (Jaccard similarity)            │
│    • source reputation      • rate limit + min-length                │
│  Drops ~70% of noise before any expensive LLM call.                  │
└──────────────────────────────────┬───────────────────────────────────┘
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│  LAYER 2 — REASONING                                                 │
├──────────────────────────────────────────────────────────────────────┤
│  Main Agent — Groq Llama 3.3 70B  →  OpenRouter free-model fallback  │
│  Output (Zod-validated JSON):                                        │
│    { classification: ignore | monitor | act,                         │
│      reasoning, thesis_delta, trade_plan }                           │
│  (trade_plan: entry_zone, invalidation, target, timeframe, conviction) │
└──────────────────────────────────┬───────────────────────────────────┘
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│  LAYER 3 — GUARDRAILS (hard-coded, non-negotiable)                   │
├──────────────────────────────────────────────────────────────────────┤
│    1. Max 10% position size          4. 15-min per-coin cooldown     │
│    2. Max 3 concurrent positions     5. 5% stop-loss                 │
│    3. Max 5 trades / 24h                                             │
│  Any violation → block before human sees it.                         │
└──────────────────────────────────┬───────────────────────────────────┘
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│  LAYER 4 — HITL APPROVAL                                             │
├──────────────────────────────────────────────────────────────────────┤
│  Pending Approval (15-min timeout, HTMX dashboard)                   │
│    • Human: Approve / Reject / Edit  (tag + freetext)                │
│    • Devil's-advocate counter-thesis (second Groq call)              │
│    • Idempotent state machine (ApprovalStateMachine.ts)              │
└──────────────────────────────────┬───────────────────────────────────┘
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│  LAYER 5 — EXECUTION & INVALIDATION                                  │
├──────────────────────────────────────────────────────────────────────┤
│  Execution Loop → Alpaca Paper Trading                               │
│    • 10s poll interval, 30s post-approval delay                      │
│  Invalidation Watcher                                                │
│    • 30s loop, auto-closes on price/time trigger                     │
│  Outcome → logged with entry, close, P&L, reason, post-mortem        │
└──────────────────────────────────────────────────────────────────────┘
```

### Data flow at a glance

| Stage | Latency budget | Persists to | Observable via |
|-------|---------------|-------------|----------------|
| Ingestion | 60s (news) / live (prices) | `events` | Activity tab |
| Filter | <50ms | `filter_decisions` | Activity tab (chip: *filtered*) |
| Credibility | 1–3s | `subagent_invocations` | Event detail modal |
| Main Agent | 2–10s | `agent_invocations`, `proposed_decisions` | Decisions tab |
| Guardrails | <10ms | `guardrail_decisions` | Event detail modal |
| HITL | 15-min window | `pending_approvals` | Approvals tab |
| Execution | 10s poll | `executed_trades` | Portfolio tab |
| Invalidation | 30s poll | `executed_trades` (close) | Portfolio + Decisions |

### Design principles

- **Fail closed.** Any layer that can't decide blocks the trade. No default-allow anywhere.
- **Everything is logged.** 12 Postgres tables capture the full lifecycle of every event — including the ones that got dropped. This audit trail is the core product.
- **Humans are the last line of defense, not the first.** The agent must already be right before a human ever sees the proposal.
- **LLM output is always Zod-validated.** A malformed JSON blob is a rejection, not a parse error.
- **This is a decision-logger, not an alpha engine.** The system's value is in demonstrating repeatable HITL agentic patterns and capturing ground truth on what decisions were made and why.

---

## Roadmap

The full phased plan lives in **[`docs/ROADMAP.md`](docs/ROADMAP.md)**. These phases turn the reference implementation into a defensible decision-logger and research tool:

| Phase | Title | Status | Addresses |
|-------|-------|--------|-----------|
| 0 | Honest reframing (README + `LIMITATIONS.md`) | ✅ Complete | Repositioned as HITL reference + decision-logger |
| 1 | Structured `TradePlan` schema (entry/invalidation/target/size/conviction) | ✅ Complete | Coarse signals → measurable R-multiples + Edit modal |
| 2 | Crypto-native signals (Binance funding/OI/liquidations, DefiLlama, Etherscan) | ✅ Complete | News-only weakness → 5× signal cadence |
| 3 | Backtest harness replaying stored events vs. HODL | ⏳ In progress | No backtest evidence yet |
| 4 | Decision-logger / bias analyzer dashboard | To-do | HITL approval biases (time-of-day, conviction, thesis-type) |
| 5 | Hyperliquid / Bybit testnet execution adapter *(optional)* | To-do | Venue mismatch (crypto perps, funding, liquidations visible) |

To start a fresh session on any phase: `Begin Phase <N> from docs/ROADMAP.md`.

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Server | Express 5, HTMX (server-rendered, no React/SPA) |
| LLM - Main Agent | Groq Llama 3.3 70B (fallback: OpenRouter free models) |
| LLM - Credibility | Google Gemini 2.0 Flash (dual-key, per-cycle budget) |
| Schema Validation | Zod (all LLM outputs validated) |
| Database | PostgreSQL (15 tables, all indexed, full audit trail) |
| Market Data | **News:** Finnhub (REST 60s) ⋄ **Crypto Signals:** Binance funding (5m), liquidations (real-time WebSocket), DefiLlama stables + DEX (15m), Etherscan whales (5m) |
| Execution | Alpaca Paper Trading API |
| Tests | Vitest (unit + integration, ESM) |
| Language | TypeScript (strict mode, noUncheckedIndexedAccess, ESM) |

---

## Dashboard

The HTMX dashboard at `http://localhost:3000` uses a **collapsible sidebar** (hamburger in the navbar toggles it at any width; state persists in `localStorage`) and a top navbar with the **system pulse** (worker heartbeat + pending-approval badge, updated every 10s via `GET /pulse`) and a **Chat** button that opens the agent chat modal. All section content auto-refreshes via HTMX.

| Tab | Endpoint | Refresh | What it shows |
|-----|----------|---------|---------------|
| **Activity** | `GET /activity` | 15s | Live timeline with filter chips (passed / filtered out / agent decision) to sort rows, clickable rows that open a detail modal (full event lifecycle), and **infinite scroll** via `GET /activity/older` when you scroll past the first 40 rows |
| **Approvals** | `GET /approvals` | 3s | Pending trade proposals with countdown timer, approve/reject/edit buttons, tag classification, reasoning, and a red **devil's-advocate counter-thesis** panel generated by a second Groq call |
| **Portfolio** | `GET /portfolio` | 10s | Cash, total value, open positions, live invalidation distance |
| **Decisions** | `GET /decisions` | 10s | Last 20 agent decisions with classification, action, approval status, P&L, and auto-generated post-mortems for closed trades |
| **Thesis** | `GET /thesis` | 15s+30s | Current market thesis plus a clickable version-history timeline — click any version to see its full content in a modal |
| **Chat** | `GET/POST /chat` | on-demand | Bubble-style chat with the agent. Uses current thesis + portfolio + last 10 decisions as context (Groq Llama 3.3 70B). Conversation history persists in `chat_messages` |

### Detail modal

Clicking an Activity row or a Thesis version opens a shared modal overlay. For events, the modal hits `GET /activity/event/:eventId` and renders the full lifecycle: raw event → filter decision → agent invocation → proposed decision(s).

### Filter chips

Activity rows carry a `data-kind` attribute (`passed` / `filtered` / `decision`). The chip bar at the top toggles visibility client-side — toggles persist across the 15s HTMX swap via an `htmx:afterSwap` reapply hook.

---

## Quick Start

### Prerequisites
- Node.js 20+
- PostgreSQL 14+

### Setup

```bash
git clone https://github.com/AshokNaik009/NarrativeDesk.git
cd NarrativeDesk
npm install

# Create .env (see Environment Variables below)
cp .env.example .env

# Apply schema to your Postgres
node run-schema.js

# Build
npm run build
```

### Run Locally

Open two terminals:

```bash
# Terminal 1 — Web server (dashboard + API)
npm run dev:web

# Terminal 2 — Background worker (ingestion, agent, execution)
npm run dev:worker
```

Open `http://localhost:3000` — the Activity tab will start populating within 60 seconds as Finnhub news arrives.

---

## Environment Variables

```bash
# LLM APIs
GROQ_API_KEY=                    # https://console.groq.com
GOOGLE_API_KEY=                  # https://makersuite.google.com/app/apikey
GOOGLE_API_KEY_SECONDARY=        # (optional) fallback Gemini key for rate limits
OPENROUTER_API_KEY=              # https://openrouter.ai/keys

# Database
DATABASE_URL=postgresql://user:pass@host/db

# Market Data
FINHUB_API_KEY=                  # https://finnhub.io/dashboard/api-tokens

# Trading
ALPACA_API_KEY=                  # https://app.alpaca.markets/paper
ALPACA_API_SECRET=

# Dashboard
DASHBOARD_SECRET=my-secret-123   # Auth header for external API calls to /approvals
```

---

## Database

12 tables in `src/db/schema.sql`:

| Table | Purpose |
|-------|---------|
| `events` | Raw ingested news + price events |
| `filter_decisions` | Pass/reject decision for each event |
| `agent_invocations` | Main agent LLM call logs (tokens, latency, output) |
| `subagent_invocations` | Credibility sub-agent results (rating 1-5) |
| `proposed_decisions` | Agent's classification + reasoning + action |
| `pending_approvals` | HITL approval state (pending/approved/rejected/edited/expired) |
| `guardrail_decisions` | Guardrail pass/block per decision |
| `executed_trades` | Filled trades with entry/close price, P&L |
| `thesis_versions` | Agent's evolving market thesis |
| `portfolio_snapshots` | Periodic portfolio state snapshots |
| `outcome_prices` | Price tracking at decision time + 15m/1h/4h/24h |
| `error_logs` | System errors for debugging |

---

## Guardrail Rules

The `GuardrailEngine` enforces 5 safety rules before any decision reaches human approval. These protect against runaway agent behavior:

1. **Max Position Size**: No single trade > 10% of portfolio
2. **Max Concurrent Positions**: No more than 3 open at once
3. **Daily Trade Limit**: Max 5 trades per 24 hours
4. **Cooldown**: 15-minute minimum between trades on the same coin
5. **Stop-Loss**: 5% max loss threshold

Note: These are *paper trading* guardrails. Any real-money deployment would need additional constraints (leverage limits, liquidation distance, tail-risk hedging).

---

## Observability & Decision Logging

### API Endpoints

```bash
# Service health (DB, Groq, Gemini status)
curl http://localhost:3000/health | jq

# Activity metrics (events/h, agent calls, approvals)
curl http://localhost:3000/metrics | jq

# Full Layer 2-4 decision log report
curl http://localhost:3000/metrics/full?days=7 | jq
```

### Decision Report

```bash
# Generate markdown decision log (default: 7 days)
npm run report

# Generate 30-day decision log
npm run report:30d
```

Reports are written to `reports/metrics-YYYY-MM-DD.md` and include:
- **Layer 2**: Classification breakdown, thesis delta frequency, credibility correlation
- **Layer 3**: Guardrail blocks, invalidation accuracy, avg hold duration
- **Layer 4**: Approval/rejection rates, time-to-decision, tag breakdown, rejection-vs-hindsight

These metrics document *what decisions were made and why*, not trading returns. Phase 3 (backtest harness) will add P&L analysis. Phase 4 (bias analyzer) will add per-tag and per-time-window outcome analysis.

---

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch
```

### Unit Tests
- `EventFilter` — dedupe (Jaccard similarity), watchlist, rate-limit, source reputation
- `DecisionSchemaValidator` — LLM JSON output parsing + Zod validation
- `GuardrailEngine` — position limits, concurrent trades, cooldowns, stop-loss
- `InvalidationEvaluator` — price-based + time-based trigger evaluation
- `ApprovalStateMachine` — idempotent state transitions (pending -> approved/rejected/edited/expired)

### Integration Tests
- `finnhub.integration` — news fetching, normalization, watchlist matching, error handling
- `binance.integration` — WebSocket connection, ticker normalization, symbol mapping, reconnect
- `routes.integration` — health, metrics, dashboard HTML, auth middleware, approve/reject/edit validation
- `alpaca.integration` — order submission, auth headers, fills, retry backoff, position close

---

## Project Structure

```
src/
  agent/
    llm.ts               # Groq + Gemini + OpenRouter LLM clients
    thesis.ts             # Thesis versioning & persistence
  execution/
    alpaca.ts             # Alpaca paper trading API client
  filter/
    EventFilter.ts        # 5-check event filter (watchlist, dedupe, reputation, rate, length)
    DecisionSchemaValidator.ts  # Zod schema validation for LLM output
  guardrails/
    GuardrailEngine.ts    # 5 safety rules evaluated pre-approval
    InvalidationEvaluator.ts   # Trade invalidation condition evaluator
  hitl/
    ApprovalStateMachine.ts    # Idempotent approval state transitions
  ingestion/
    finnhub.ts            # Finnhub REST news polling
    binance.ts            # Binance WebSocket price stream
  metrics/
    MetricsCalculator.ts  # Layer 2-4 metrics computation
    generateReport.ts     # CLI markdown report generator
    EvalExporter.ts       # Decision lifecycle export for eval harness
  db/
    client.ts             # Postgres pool, query helper, schema init
    schema.sql            # Full 12-table schema with indexes
  dashboard/views/
    approvals.html        # HTMX dashboard (5 tabs, dark theme)
  utils/
    health.ts             # /health and /metrics endpoint logic
    connectivity-check.ts # API key validation utility
  config.ts               # Env var configuration
  types.ts                # TypeScript interfaces & Zod schemas
  server.ts               # Express server (dashboard + REST API)
  worker.ts               # Background loops (ingestion, agent, execution, invalidation)
```

---

## Deployment (Render)

### Services to create:

1. **PostgreSQL** — `narrativedesk-db`
2. **Web Service** — `narrativedesk-web` (build: `npm install && npm run build`, start: `npm run start:web`)
3. **Background Worker** — `narrativedesk-worker` (same build, start: `npm run start:worker`)

Both web and worker need the same environment variables. Set `DASHBOARD_SECRET` explicitly in Render (not loaded from `.env`).

```bash
# Apply schema to Render DB
DATABASE_URL="<render-postgres-url>" node run-schema.js

# Verify
curl https://narrativedesk.onrender.com/health | jq
```

The worker includes a self-ping to keep the Render free-tier web service alive (every 10 minutes).

---

## API Reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | - | HTMX dashboard |
| GET | `/health` | - | Service status + metrics |
| GET | `/metrics` | - | Activity counts |
| GET | `/metrics/full?days=7` | - | Full Layer 2-4 report |
| GET | `/activity` | - | Live activity feed (HTMX partial) |
| GET | `/approvals` | HTMX or secret | Pending approvals (HTML or JSON) |
| GET | `/approvals/:id` | secret | Single approval detail |
| POST | `/approvals/:id/approve` | secret | Approve (body: `{tag, freetext?}`) |
| POST | `/approvals/:id/reject` | secret | Reject (body: `{tag, freetext?}`) |
| POST | `/approvals/:id/edit` | secret | Edit + approve (body: `{tag, freetext?, edited_size_pct}`) |
| GET | `/portfolio` | - | Portfolio state (HTMX partial) |
| GET | `/thesis` | - | Current thesis (HTMX partial) |
| GET | `/decisions` | - | Recent decisions (HTMX partial) |

---

## License

MIT

## Author

Built by [AshokNaik009](https://github.com/AshokNaik009)

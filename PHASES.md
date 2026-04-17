# NarrativeDesk — Implementation Phases

> **Data sources changed**: Using Finnhub (not CryptoPanic) for news. Alpaca deferred until keys are set up.

---

## Phase 0: Foundation & Infrastructure — DONE
### Goal
Establish the core system architecture, database schema, and deployment pipeline.

**Deliverables:**
- [x] Postgres schema (10 tables) deployed to Render (`src/db/schema.sql`)
- [x] DB client with SSL + connection pool (`src/db/client.ts`)
- [x] .env configuration with Groq, Gemini, OpenRouter, Finnhub, Render Postgres
- [x] TypeScript project scaffolded (tsconfig, npm, src/ directory structure)
- [x] Config module with all env vars and defaults (`src/config.ts`)
- [x] Zod schemas for Decision, Credibility, Event (`src/types.ts`)
- [x] DB schema initialized on Render Postgres (verified 10 tables live)
- [x] DB connection verified end-to-end
- [x] npm scripts: `dev:worker`, `dev:web`, `build`, `start:worker`, `start:web`, `db:init`
- [x] Entry points: `src/worker.ts` and `src/server.ts`
- [x] Zero TypeScript compilation errors

**Status:** COMPLETE

---

## Phase 1: Ingestion & Filtering — DONE
### Goal
Build the real-time data pipeline and non-LLM filter layer.

**Deliverables:**
- [x] Finnhub adapter: fetch crypto news + quotes (`src/ingestion/finnhub.ts`)
- [x] Binance WebSocket adapter: ingest price ticks (`src/ingestion/binance.ts`)
- [x] EventFilter module (pure): dedupe, watchlist, rate-limit, source reputation (`src/filter/EventFilter.ts`)
- [x] Database insert flow for events and filter decisions
- [x] Worker entry point wired: Finnhub polls every 60s, Binance WS connected
- [x] Verified live: 20 news items fetched, 10 passed filter, price ticks flowing
- [ ] Unit tests for EventFilter (~15-20 tests) — deferred to Phase 7

**Status:** COMPLETE (tests deferred)

---

## Phase 2: LLM Agent Core
### Goal
Implement the main agent and credibility sub-agent.

**Deliverables:**
- [x] Main agent via Groq SDK (llama-3.3-70b-versatile) (`src/agent/llm.ts`)
- [x] Agent system prompt (default hold, novel high-conviction, mandate invalidation)
- [x] Credibility sub-agent via Gemini 2.0 Flash
- [x] DecisionSchemaValidator module (pure) (`src/filter/DecisionSchemaValidator.ts`)
- [x] Agent invocation logging function
- [x] Thesis file manager (read/write/diff with Postgres sync) (`src/agent/thesis.ts`)
- [x] Worker pipeline wired: event → credibility → main agent → decision persistence
- [ ] Unit tests for DecisionSchemaValidator (~12-15 tests) — deferred to Phase 7

**Status:** ~95% complete (all core logic done, tests deferred to Phase 7)

---

## Phase 3: Guardrails & Safety
### Goal
Enforce hard constraints before any trade reaches human review.

**Deliverables:**
- [x] GuardrailEngine module (pure) (`src/guardrails/GuardrailEngine.ts`)
- [x] InvalidationEvaluator module (pure) (`src/guardrails/InvalidationEvaluator.ts`)
- [ ] Portfolio state query (deferred until Alpaca keys ready)
- [ ] Rejection flow with structured feedback to agent
- [ ] Guardrail decision logging to DB
- [ ] Unit tests for GuardrailEngine (~15 tests)
- [ ] Unit tests for InvalidationEvaluator (~10 tests)

**Status:** ~40% complete (pure modules done, integration pending)

---

## Phase 4: Human-in-the-Loop & Dashboard
### Goal
Build the approval loop and minimal web UI.

**Deliverables:**
- [x] ApprovalStateMachine module (pure) (`src/hitl/ApprovalStateMachine.ts`)
- [ ] Express web service scaffolding
- [ ] HTMX dashboard: pending approvals with 15m countdown
- [ ] Approval form: approve, reject, edit-size, wait
- [ ] Self-tag dropdown (reason enum)
- [ ] Dashboard polling every 2-3 seconds
- [ ] Unit tests for ApprovalStateMachine (~12 tests)

**Status:** ~20% complete (state machine done, no dashboard yet)

---

## Phase 5: Trade Execution & Monitoring
### Goal
Connect to Alpaca and implement invalidation watcher.

**Deliverables:**
- [ ] Alpaca paper trading client (deferred — no API keys yet)
- [ ] Approved trade → execution flow
- [ ] Invalidation watcher background loop
- [ ] Portfolio snapshot logging

**Status:** Not started (blocked on Alpaca keys)

---

## Phase 6: End-to-End Plumbing
### Goal
Wire all phases together into a running system.

**Deliverables:**
- [ ] Worker entry point: ingestion → filter → agent → guardrails → approval queue
- [ ] Thesis versioning and diff tracking
- [ ] Self-ping mechanism (worker → web every 10m)
- [ ] Error handling for failed LLM calls

**Status:** Not started

---

## Phase 7: Testing & Hardening
### Goal
Ensure reliability before going live.

**Deliverables:**
- [x] Unit tests for all 5 pure modules (EventFilter, DecisionSchemaValidator, GuardrailEngine, InvalidationEvaluator, ApprovalStateMachine)
  - EventFilter: 15 tests (`src/filter/__tests__/EventFilter.test.ts`)
  - DecisionSchemaValidator: 12 tests (`src/filter/__tests__/DecisionSchemaValidator.test.ts`)
  - GuardrailEngine: 15 tests (`src/guardrails/__tests__/GuardrailEngine.test.ts`)
  - InvalidationEvaluator: 10 tests (`src/guardrails/__tests__/InvalidationEvaluator.test.ts`)
  - ApprovalStateMachine: 12 tests (`src/hitl/__tests__/ApprovalStateMachine.test.ts`)
  - Total: 64 tests written, pending vitest setup fix
- [ ] Integration tests: Finnhub adapter, dashboard routes
- [ ] Rate-limit token bucket for LLM clients
- [ ] Groq → OpenRouter fallback on rate limit

**Status:** ~50% complete (all unit tests written, test runner setup pending)

---

## Phase 8: Deployment & Go-Live
### Goal
Get the system running on Render free tier.

**Deliverables:**
- [ ] Background worker on Render
- [ ] Web service on Render
- [x] Postgres on Render (provisioned, URL in .env)
- [ ] GitHub → Render auto-deploy
- [ ] End-to-end verification

**Status:** ~10% (DB provisioned only)

---

## Phase 9–11: Observation, Measurement, Writeup
(Unchanged — these come after deployment)

---

## Summary Timeline

| Phase | Status | Key blocker |
|-------|--------|-------------|
| 0 | **DONE** | — |
| 1 | **DONE** | Tests deferred |
| 2 | **DONE** | — |
| 3 | ~40% | Alpaca keys for portfolio state query |
| 4 | ~20% | Need Express + HTMX dashboard |
| 5 | 0% | Blocked on Alpaca keys |
| 6 | 0% | Need Phase 3 guardrails + Phase 4 approval UI |
| 7 | ~50% | Test runner setup (vitest rolldown native binding issue) |
| 8 | ~10% | Needs all phases complete |

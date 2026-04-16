# NarrativeDesk — Implementation Phases

## Phase 0: Foundation & Infrastructure (Weekend 1 — Days 1-2)
### Goal
Establish the core system architecture, database schema, and deployment pipeline.

**Deliverables:**
- [ ] Postgres schema (events, filter_decisions, agent_invocations, subagent_invocations, thesis_versions, proposed_decisions, pending_approvals, executed_trades, portfolio_snapshots, outcome_prices)
- [ ] Render setup: three services scaffolded (background worker, web service, Postgres)
- [ ] .env configuration template with all LLM/API keys
- [ ] pnpm workspace structure (root + worker + web)
- [ ] LangChain model wrappers for Groq, Gemini, OpenRouter (model-agnostic)
- [ ] Basic deployment CI/CD (Render GitHub integration)

**Blockers None**

---

## Phase 1: Ingestion & Filtering (Weekend 1 — Days 1-2)
### Goal
Build the real-time data pipeline and non-LLM filter layer.

**Deliverables:**
- [ ] CryptoPanic adapter: poll headlines every minute
- [ ] Binance WebSocket adapter: ingest price ticks
- [ ] EventFilter module (pure): dedupe, watchlist, rate-limit, source reputation
- [ ] Database insert flow for normalized events and filter decisions
- [ ] Logging of all filter decisions to filter_decisions table
- [ ] Unit tests for EventFilter (~15-20 tests)

**Blockers:** Phase 0 (schema, DB connection)

---

## Phase 2: LLM Agent Core (Weekend 1 — Days 2-3)
### Goal
Implement the main agent and credibility sub-agent.

**Deliverables:**
- [ ] Main agent scaffolding with deepagentsjs
- [ ] Agent system prompt (default hold, novel high-conviction, mandate invalidation)
- [ ] Credibility sub-agent (Gemini) with narrow scope
- [ ] placePaperTrade tool with strict Zod schema
- [ ] DecisionSchemaValidator module (pure): handle LLM output flakiness
- [ ] Thesis file read/write via agent virtual FS with Postgres sync
- [ ] Agent invocation logging (tokens, latency, schema compliance)
- [ ] Unit tests for DecisionSchemaValidator (~12-15 tests)

**Blockers:** Phase 1 (filter decisions arriving), Phase 0 (LLM clients)

---

## Phase 3: Guardrails & Safety (Weekend 1 — Day 3)
### Goal
Enforce hard constraints before any trade reaches human review.

**Deliverables:**
- [ ] GuardrailEngine module (pure): enforce max 10%, max 3 positions, max 5 trades/24h, 15m cooldown, 5% stop-loss
- [ ] Portfolio state query from Alpaca
- [ ] Rejection flow with structured feedback to agent
- [ ] Guardrail decision logging
- [ ] Unit tests for GuardrailEngine (~15 tests)
- [ ] Unit tests for InvalidationEvaluator (~10 tests)

**Blockers:** Phase 2 (proposed decisions), Phase 1 (portfolio state)

---

## Phase 4: Human-in-the-Loop & Dashboard (Weekend 1 — Days 3-4)
### Goal
Build the approval loop and minimal web UI.

**Deliverables:**
- [ ] ApprovalStateMachine module (pure): pending → {approved, rejected, edited, expired}
- [ ] Idempotency on approval actions (approval ID deduplication)
- [ ] 15-minute auto-expiration with deadline enforcement
- [ ] pending_approvals table with HITL state
- [ ] Express web service scaffolding
- [ ] HTMX dashboard UI: pending approvals list with 15m countdown
- [ ] Approval form: approve, reject, edit-size, tell-agent-to-wait
- [ ] Self-tag dropdown (reason enum)
- [ ] Dashboard polling every 2-3 seconds
- [ ] Unit tests for ApprovalStateMachine (~12 tests)

**Blockers:** Phase 3 (guardrails pass), Phase 0 (web service)

---

## Phase 5: Trade Execution & Monitoring (Weekend 1 — Day 4)
### Goal
Connect to Alpaca and implement invalidation watcher.

**Deliverables:**
- [ ] Alpaca paper trading client integration
- [ ] Approved trade → Alpaca execution flow
- [ ] executed_trades table with entry price, invalidation condition
- [ ] InvalidationEvaluator module (pure): check if invalidation trigger fired
- [ ] Background loop: poll market state every 1-5 minutes, evaluate all open positions
- [ ] Auto-close on triggered invalidation with logging
- [ ] Portfolio snapshot query and logging
- [ ] Alpaca integration tests (paper sandbox)

**Blockers:** Phase 4 (approval state), Phase 0 (Alpaca API setup)

---

## Phase 6: End-to-End Plumbing (Weekend 1 — Day 4)
### Goal
Wire all phases together into a running system.

**Deliverables:**
- [ ] Agent loop orchestration: {events} → filter → agent → guardrails → approval queue
- [ ] Agent rejection feedback loop: guardrail rejection → thesis update
- [ ] Thesis versioning and diff tracking
- [ ] Self-ping mechanism: background worker → web service every 10 minutes (prevent sleep)
- [ ] Error handling and dead-letter queues for failed LLM calls
- [ ] Logging layer: all decisions, agent calls, sub-agent calls logged to Postgres
- [ ] Integration tests for ingestion → execution flow

**Blockers:** All earlier phases

---

## Phase 7: Testing & Hardening (Weekend 1 — End)
### Goal
Ensure reliability before going live.

**Deliverables:**
- [ ] Integration tests: dashboard routes (supertest + test DB)
- [ ] Integration tests: ingestion adapters (recorded fixtures)
- [ ] Integration tests: Alpaca client (paper sandbox)
- [ ] Schema validation for all Postgres inserts
- [ ] Rate-limit token bucket wrapper around LLM clients
- [ ] Graceful error handling for Groq rate limits (fall back to OpenRouter)
- [ ] Test coverage: 90%+ on five unit-tested modules

**Blockers:** All earlier phases

---

## Phase 8: Deployment & Go-Live (End of Weekend 1)
### Goal
Get the system running on Render free tier.

**Deliverables:**
- [ ] Render database provisioning (free Postgres)
- [ ] Background worker service on Render (free tier)
- [ ] Web service on Render (free tier)
- [ ] GitHub → Render auto-deploy on push to main
- [ ] All environment variables configured on Render dashboard
- [ ] Health checks: worker self-ping, web service readiness
- [ ] Verify end-to-end: news → filter → agent → approval → trade → logging

**Blockers:** Phase 6 (plumbing complete)

---

## Phase 9: Live Running & Observation (Weekdays between weekends)
### Goal
Generate real data, identify bugs, gather signal for metrics.

**Activities:**
- Monitor dashboard for pending approvals
- Approve, reject, and edit trade proposals
- Tag each decision with reason
- Watch for edge cases: rate limits, stale approvals, missed invalidations
- Log observations for Phase 10

**Success Criteria:**
- System runs 24/7 without crashes
- At least 30–80 agent invocations
- At least 3–10 executed trades
- No duplicate trades (idempotency works)
- Invalidation triggers accurate when checked

---

## Phase 10: Measurement & Polish (Weekend 2)
### Goal
Extract learnings from the live run, measure agent quality, ship final UI.

**Deliverables:**
- [ ] MetricsCalculator module: compute Layers 1–4 metrics
  - Layer 1 (component): model, tokens, latency, schema compliance
  - Layer 2 (decision): classification breakdown, thesis deltas, sub-agent correlation
  - Layer 3 (trade): win rate, profit factor, invalidation accuracy
  - Layer 4 (HITL): approval rate, time-to-decision, expiration rate, edit rate
- [ ] Weekly metrics report job (markdown export, checked into repo)
- [ ] Decision log exporter: format for CC-SKILLS-Evals harness
- [ ] Dashboard enhancements:
  - [ ] Portfolio view (current positions, P&L, cash)
  - [ ] Recent decisions view (last 20 with outcomes)
  - [ ] Current thesis view (live markdown)
- [ ] Bug fixes from Phase 9 observations
- [ ] Integration tests for MetricsCalculator and exporters

**Blockers:** Phase 9 (live data collected)

---

## Phase 11: Documentation & Writeup
### Goal
Capture the narrative and architecture for the blog post.

**Deliverables:**
- [ ] Blog post draft: "Real-time Narrative Reasoning Under HITL Constraints"
- [ ] Architecture diagram (ingestion → filter → agent → approval → execution)
- [ ] Key findings:
  - Latency profile (how fast is approval-to-execution?)
  - Agent quality (approval rate, rejection reasons, outcome correlation)
  - HITL dynamics (human judgment patterns, edit rate)
- [ ] Lessons for the series: real-time ≠ streaming, state persistence matters, HITL is the real product

**Blockers:** Phase 10 (metrics and polish)

---

## Summary Timeline

| Phase | Effort | Target Dates |
|-------|--------|--------------|
| 0–7 | 4 days | Weekend 1 (setup + implementation) |
| 8 | 1 day | End of Weekend 1 (go-live) |
| 9 | 5 days | Weekdays (observation, ~30-80 invocations) |
| 10 | 2 days | Weekend 2 (measurement + polish) |
| 11 | 1 day | Post-project (writeup) |

**Total: ~2 weekends + 1 week = ~3 weeks**

---

## Success Criteria (End of Phase 11)

- [ ] System runs stably on Render free tier with zero marginal cost
- [ ] At least 50+ agent invocations logged with full component metrics
- [ ] At least 5+ executed trades with outcome tracking at +15m, +1h, +4h, +24h
- [ ] Decision log exportable to CC-SKILLS-Evals format
- [ ] Approval/rejection patterns and timing metrics logged
- [ ] Blog post published with clear narrative on real-time + HITL tradeoffs
- [ ] Repository is public, well-documented, and reproducible


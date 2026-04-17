# NarrativeDesk Implementation Plan — Phases 3-8

## Overview
Close all remaining phases by implementing guardrails, dashboard, execution, testing, and deployment. Each task is independent and can be executed in parallel.

---

## PHASE 3: Guardrails & Safety (40% → 100%)

### Task 3.1: Portfolio State Query Client
**File:** `src/execution/alpaca.ts`

Create Alpaca API client to fetch live portfolio state:
- Query account endpoint: `/v2/account` → cash, total_value
- Query positions endpoint: `/v2/positions` → open positions with entry prices
- Parse response into PortfolioState type
- Add retry logic (3 attempts with exponential backoff)
- Cache portfolio state for 30 seconds to avoid API throttling
- Export: `queryPortfolioState(): Promise<PortfolioState>`

**Dependencies:** config.alpacaApiKey, types.PortfolioState

---

### Task 3.2: Guardrail Integration into Worker
**File:** `src/worker.ts` (modify existing processEvent function)

Wire guardrails into the agent pipeline after decision:
1. After main agent returns a decision with classification="act"
2. Query portfolio state using Task 3.1
3. Get trade history from DB (last 24h from executed_trades table)
4. Call `evaluateGuardrails(action, portfolio, history)` from GuardrailEngine
5. If guardrail blocks: log rejection decision, skip approval creation, log reason
6. If guardrail passes: proceed to Phase 4 (create pending approval)
7. Log all guardrail checks to `guardrail_decisions` table

**New DB table:** `guardrail_decisions` with columns: decision_id, allowed, reason, created_at

---

### Task 3.3: Guardrail Logging to Database
**File:** `src/db/schema.sql` (add table)

Add table to track all guardrail evaluations:
```sql
CREATE TABLE IF NOT EXISTS guardrail_decisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  decision_id UUID NOT NULL REFERENCES proposed_decisions(id),
  allowed BOOLEAN NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_guardrail_decisions_decision ON guardrail_decisions(decision_id);
```

---

## PHASE 4: Human-in-the-Loop Dashboard (20% → 100%)

### Task 4.1: Express Routes for Approvals
**File:** `src/server.ts` (add routes)

Implement REST API endpoints:
- `GET /approvals` → list pending approvals with details (headline, decision, thesis_delta, action, expires_at)
- `GET /approvals/:id` → single approval details
- `POST /approvals/:id/approve` → body: {tag, freetext?} → update status to "approved"
- `POST /approvals/:id/reject` → body: {tag, freetext?} → update status to "rejected"
- `POST /approvals/:id/edit` → body: {tag, freetext?, edited_size_pct} → update status to "edited"
- All endpoints require DASHBOARD_SECRET header validation
- Return JSON with consistent schema

**Dependencies:** ApprovalStateMachine, pending_approvals table

---

### Task 4.2: HTMX Dashboard UI
**File:** `src/dashboard/views/approvals.html`

Build interactive approval dashboard:
- Pending approvals list with countdown timer (15 min → red)
- For each approval: headline, decision, action (BUY/SELL X% of coin at invalidation), expires in Xm
- Approve button + tag selector (dropdown from APPROVE_TAGS)
- Reject button + tag selector (dropdown from REJECT_TAGS)
- Edit button + new size_pct input
- Auto-refresh every 2 seconds (HTMX polling)
- Show approved/rejected count in summary
- Dark mode (match existing dashboard colors)

**Dependencies:** Task 4.1 routes, HTMX CDN

---

### Task 4.3: Dashboard Route Handler
**File:** `src/server.ts` (add GET /)

Update home page to serve HTMX dashboard:
- `GET /` → return HTML with HTMX dashboard (from Task 4.2)
- Keep existing `/health` endpoint
- Add HTMX script tags + endpoint wiring

---

## PHASE 5: Trade Execution & Monitoring (0% → 100%)

### Task 5.1: Alpaca Trade Execution Client
**File:** `src/execution/alpaca.ts` (extend)

Add trade execution functions:
- `executeApprovedTrade(approval: PendingApproval) → Promise<{alpaca_order_id, entry_price}>`
  - Query Alpaca /v2/orders endpoint with order details
  - side: approval.side (buy/sell), symbol: approval.coin + USDT, qty: size_pct of portfolio value
  - time_in_force: "day"
  - Parse response, extract order_id and entry price
  - Return order details
- `getOrderStatus(order_id: string) → Promise<OrderStatus>`
  - Query /v2/orders/{order_id}
  - Return status, filled_price, etc.

**Dependencies:** Task 3.1 (portfolio queries)

---

### Task 5.2: Approval → Execution Pipeline
**File:** `src/worker.ts` (add loop)

Add background loop to execute approved trades:
- Every 10 seconds: query `pending_approvals` for status='approved'
- For each: check if > 30 seconds have passed since approval (avoid race)
- Call `executeApprovedTrade()` from Task 5.1
- If success: insert into `executed_trades` table with alpaca_order_id, entry_price, created_at
- Update `pending_approvals` status → 'executed' (or add new status)
- Log execution result
- If failure: log error, retry up to 3 times

**New table field:** `executed_trades.status` to track execution state

---

### Task 5.3: Invalidation Watcher Loop
**File:** `src/worker.ts` (add loop)

Add background loop to monitor open trades for invalidation:
- Every 30 seconds: query `executed_trades` where closed_at IS NULL
- For each: get current price from Binance WS cache
- Call `evaluateInvalidation()` from InvalidationEvaluator
- If triggered: close position via Alpaca (sell for buy, buy for sell)
- Update `executed_trades` set closed_at, close_price, close_reason
- Log invalidation trigger event

**Depends on:** Binance WS price cache (keep in recentEvents or separate Map)

---

## PHASE 6: End-to-End Plumbing (0% → 100%)

### Task 6.1: Wire Full Pipeline
**File:** `src/worker.ts` (audit + wire)

Ensure complete flow from ingestion → execution:
1. ✅ News/price → Event persisted
2. ✅ Filter → passed/failed logged
3. ✅ Credibility sub-agent (if news) → rating logged
4. ✅ Main agent → decision logged to proposed_decisions
5. ✅ Thesis update if delta
6. ✅ Guardrails check → logged to guardrail_decisions
7. ⚪ Create pending approval (if guardrail passes) → insert to pending_approvals with expires_at = now + 15min
8. ⚪ Execution loop monitors approvals
9. ⚪ Invalidation watcher monitors open trades

**New in this task:** 
- Create pending approval record after guardrail passes (connect 5 → 7)
- Link all tables: events → filter_decisions → agent_invocations → proposed_decisions → guardrail_decisions → pending_approvals → executed_trades

---

### Task 6.2: Error Handling & Resilience
**File:** `src/worker.ts` + `src/server.ts`

Add production-ready error handling:
- Wrap all async operations in try-catch
- Log all errors with context (event_id, decision_id, etc.)
- Add `error_logs` table to track issues
- Groq → OpenRouter fallback if main agent fails
- Finnhub failures don't crash worker (log, continue)
- Alpaca execution failures don't block approval UI (mark as failed, retry)
- Postgres connection pool with reconnect logic
- Graceful shutdown handlers

---

### Task 6.3: Thesis Versioning & Git Sync (optional enhancement)
**File:** `src/agent/thesis.ts` (extend)

Add optional sync to Git:
- After each thesis version, commit to local git repo (`thesis/` branch)
- Include diff in commit message
- Keep on-disk thesis file in `docs/thesis.md` for human review
- Add git remote URL to config (optional)

---

## PHASE 7: Testing & Hardening (50% → 100%)

### Task 7.1: Fix Vitest Setup
**File:** `vitest.config.ts` (create)

Create vitest config to bypass rolldown native binding issue:
- Use esbuild instead of rolldown for building
- Or use tsx-based test runner without build step
- Run `npm test` successfully with all 64 tests passing

**Output:** `npm test` runs all unit tests, reports coverage

---

### Task 7.2: Integration Tests
**Files:** `src/__tests__/integration/` (create)

Write integration tests for:
- Finnhub adapter: mock fetch, verify event creation
- Dashboard routes: mock DB, verify approval endpoints work
- Worker pipeline: mock Groq/Gemini, verify end-to-end flow
- Alpaca client: mock Alpaca API, verify trade execution flow

**Target:** 10-15 integration tests covering critical paths

---

### Task 7.3: Rate Limit & Fallback Tests
**File:** `src/__tests__/integration/fallback.test.ts`

Add specific tests for robustness:
- Groq rate limit → OpenRouter fallback succeeds
- Gemini primary key exhausted → secondary key succeeds
- Finnhub unreachable → worker continues without crashing
- Postgres connection lost → reconnect and recover

---

## PHASE 8: Deployment & Go-Live (10% → 100%)

### Task 8.1: Render Deployment Config
**Files:** `render.yaml` + `.env.production`

Create Render deployment manifest:
- Web service: `src/server.ts` (port 3000)
- Background worker: `src/worker.ts` (no port)
- Postgres: already provisioned on Render
- Environment variables: all from .env
- Auto-deploy on git push to main
- Health check: `/health` endpoint

---

### Task 8.2: GitHub → Render Integration
**Files:** `.github/workflows/deploy.yml` (create, optional)

Add GitHub Actions workflow to auto-deploy:
- On push to main: run tests, build, push to Render
- Or use Render's native GitHub integration (simpler)

---

### Task 8.3: Monitoring & Observability
**Files:** `src/utils/health.ts` (create)

Add monitoring endpoints:
- `GET /health` → returns status of all services (Groq, Gemini, Finnhub, Postgres, Binance, Alpaca)
- `GET /metrics` → returns: events processed, decisions made, approvals pending, trades executed
- Send metrics to Render's logging service

---

## Execution Strategy

**Phase 3** (Guardrails) — Tasks 3.1, 3.2, 3.3 (independent, can run in parallel)
**Phase 4** (Dashboard) — Tasks 4.1, 4.2, 4.3 (4.2 depends on 4.1)
**Phase 5** (Execution) — Tasks 5.1, 5.2, 5.3 (5.2 & 5.3 depend on 5.1)
**Phase 6** (Plumbing) — Tasks 6.1, 6.2, 6.3 (depends on 3, 4, 5 complete)
**Phase 7** (Testing) — Tasks 7.1, 7.2, 7.3 (can start anytime, depends on code existing)
**Phase 8** (Deploy) — Tasks 8.1, 8.2, 8.3 (final, after all phases)

**Parallel execution order:**
1. Dispatch 3.1, 3.2, 3.3 in parallel
2. While 3 is running: dispatch 4.1 (which unblocks 4.2)
3. While 4.1 is running: dispatch 5.1 (which unblocks 5.2, 5.3)
4. After 3, 4, 5 complete: dispatch 6.1, 6.2, 6.3
5. Throughout: dispatch 7.1, 7.2, 7.3
6. Final: dispatch 8.1, 8.2, 8.3

**Expected timeline:** ~8-12 parallel subagent tasks (vs 20+ sequential)

---

## Success Criteria

- [ ] All 8 phases marked DONE in PHASES.md
- [ ] `npm run check:connectivity` shows 7/7 services
- [ ] `npm test` runs all unit + integration tests
- [ ] `npm run dev:worker` + `npm run dev:web` runs locally without errors
- [ ] Dashboard shows pending approvals and accepts approve/reject actions
- [ ] Full end-to-end flow: news → filter → agent → guardrails → approval → execution → watcher
- [ ] Deployed to Render with auto-deploy from GitHub
- [ ] 24h monitoring: no errors, metrics tracking

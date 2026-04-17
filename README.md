# NarrativeDesk

Real-time narrative-driven crypto paper-trading agent with human-in-the-loop approval.

**Status:** Phase 3-8 implementation complete. Core pipeline functional. Local testing recommended before next deployment.

---

## Quick Start (Local Development)

### Prerequisites
- Node.js 20+
- PostgreSQL 14+
- Git

### Installation

```bash
# Clone repo
git clone https://github.com/AshokNaik009/NarrativeDesk.git
cd NarrativeDesk

# Install dependencies
npm install

# Create .env file (copy from .env template)
cp .env.example .env
# Edit .env with your API keys

# Start local database (or use existing Render DB)
# If using local Postgres:
createdb narrativedesk

# Apply schema
node run-schema.js

# Build TypeScript
npm run build
```

### Run Locally

**Terminal 1 - Web Server:**
```bash
npm run dev:web
```
Opens at `http://localhost:3000`

**Terminal 2 - Background Worker:**
```bash
npm run dev:worker
```

**Monitor:**
```bash
# Health check
curl http://localhost:3000/health | jq

# Metrics
curl http://localhost:3000/metrics | jq
```

---

## What Works ✅

### Infrastructure
- ✅ Express server with HTMX dashboard
- ✅ PostgreSQL schema (all 9 tables + indexes)
- ✅ Finnhub news polling (60s interval)
- ✅ Binance WebSocket price feeds
- ✅ Alpaca paper trading client with retry logic

### Agent Pipeline
- ✅ Event ingestion & filtering (90% noise rejection)
- ✅ Groq Llama 3.3 70B main agent
- ✅ Gemini Flash credibility sub-agent (with fallback to secondary key)
- ✅ Groq → OpenRouter fallback if rate-limited
- ✅ Guardrail enforcement (max 10% position, 3 concurrent, 5/24h trades, 15m cooldown)
- ✅ Execution loop (every 10s, waits 30s after approval)
- ✅ Invalidation watcher (every 30s, auto-closes positions on trigger)
- ✅ Thesis versioning & git sync (optional)

### Dashboard
- ✅ HTMX-powered approval UI at `/` (dark theme, responsive)
- ✅ Countdown timers (red < 5m, yellow < 10m)
- ✅ Approve/Reject/Edit buttons with tag dropdowns
- ✅ Auto-refresh every 2s via HTMX polling
- ✅ Summary stats (pending, approved, rejected)

### Monitoring
- ✅ `/health` endpoint (service status + latency)
- ✅ `/metrics` endpoint (activity tracking)
- ✅ Error logging to `error_logs` table
- ✅ Comprehensive logging across all tables

---

## What Doesn't Work ❌ (Known Issues)

### Environment Variables
- ❌ Render doesn't auto-load `.env` files (env vars must be set in Render dashboard)
- Dashboard secret authentication fails if `DASHBOARD_SECRET` not explicitly set

### Background Worker
- ❌ **Not deployed yet** on Render (only web service is up)
- Without worker: no news polling, no agent decisions, no approvals created

### GOOGLE_API_KEY
- Need to add to `.env` and Render dashboard (not present currently)

### Vitest
- ✅ Config created but build issue with rolldown native bindings
- Tests exist in `src/**/__tests__/` but won't run on Render

---

## Architecture

```
Events (Finnhub + Binance WS)
    ↓
Filter (EventFilter - 90% noise rejection)
    ↓
Credibility Agent (Gemini Flash - news only)
    ↓
Main Agent (Groq Llama 3.3 70B → OpenRouter fallback)
    ↓
Guardrails (GuardrailEngine - pure logic)
    ↓
Pending Approvals (15min timeout)
    ↓ (Dashboard approval)
Execution Loop (Alpaca paper trading API)
    ↓
Invalidation Watcher (InvalidationEvaluator)
    ↓
Position Closed (logged with outcome)
```

**Database:**
- 9 tables: events, filter_decisions, agent_invocations, proposed_decisions, pending_approvals, executed_trades, guardrail_decisions, error_logs, thesis_versions
- All indexed for query performance
- Schema in `src/db/schema.sql`

**Services:**
- **Web Service** (`src/server.ts`): Express, HTMX dashboard, /approvals REST API
- **Worker** (`src/worker.ts`): Ingestion loops, agent orchestration, execution, invalidation watching
- **Database**: Shared Postgres (Render or external)

---

## Environment Variables

Required for local dev and Render deployment:

```bash
# LLM APIs
GROQ_API_KEY=                    # https://console.groq.com
GOOGLE_API_KEY=                  # https://makersuite.google.com/app/apikey
GOOGLE_API_KEY_SECONDARY=        # (optional, fallback Gemini key)
OPENROUTER_API_KEY=              # https://openrouter.ai/keys

# Database
DATABASE_URL=postgresql://user:pass@host/db

# Market Data
FINHUB_API_KEY=                  # https://finnhub.io/dashboard/api-tokens

# Trading
ALPACA_API_KEY=                  # https://app.alpaca.markets/paper
ALPACA_API_SECRET=

# Dashboard
DASHBOARD_SECRET=my-secret-123   # Any string, for /approvals auth header
```

---

## Testing Locally

### Unit Tests (Pure Modules)
```bash
npm test
```

Tests for:
- EventFilter (dedupe, watchlist, rate-limit)
- DecisionSchemaValidator (LLM output parsing)
- GuardrailEngine (position limits, cooldowns)
- InvalidationEvaluator (trigger evaluation)
- ApprovalStateMachine (state transitions)

### Manual Testing

**1. Check health:**
```bash
curl http://localhost:3000/health | jq
```

Expected:
```json
{
  "timestamp": "2026-04-17T...",
  "services": [
    {"name": "PostgreSQL", "status": "ok"},
    {"name": "Groq", "status": "ok"},
    {"name": "Google Gemini", "status": "ok"}
  ],
  "metrics": {...}
}
```

**2. View dashboard:**
```
http://localhost:3000/
```

Should show:
- Pending/Approved/Rejected counts (0 if worker not running)
- Summary cards
- (No approvals yet until worker creates them)

**3. Test approval API (with auth):**
```bash
curl -X POST http://localhost:3000/approvals/test-id/approve \
  -H 'x-dashboard-secret: my-secret-123' \
  -H 'content-type: application/json' \
  -d '{"tag": "reasonable_take"}'
```

Expected: `200` with approval details (or `404` if approval doesn't exist)

---

## Deployment to Render (Next Time)

### Step 1: Prepare
```bash
git add .
git commit -m "message"
git push origin main
```

### Step 2: Create Web Service
1. Go to https://render.com
2. New → Web Service
3. Connect GitHub repo
4. Name: `narrativedesk-web`
5. Build: `npm install && npm run build`
6. Start: `npm run start:web`
7. Add **all env vars** (see Environment Variables above)
8. **CRITICAL:** Set `DASHBOARD_SECRET` explicitly in Render

### Step 3: Create PostgreSQL
1. New → PostgreSQL
2. Name: `narrativedesk-db`
3. Region: Same as web service
4. Copy connection URL
5. Add to web service env: `DATABASE_URL=<copied_url>`
6. Redeploy web service

### Step 4: Apply Schema
```bash
export DATABASE_URL="<from_step_3>"
node run-schema.js
```

### Step 5: Create Background Worker
1. New → Background Worker
2. Connect same GitHub repo
3. Name: `narrativedesk-worker`
4. Build: `npm install && npm run build`
5. Start: `npm run start:worker`
6. Add **same env vars** as web service (copy from web service)
7. Create

### Step 6: Verify
```bash
curl https://narrativedesk.onrender.com/health | jq
```

Should return healthy status with all services "ok".

---

## Common Issues & Fixes

### 401 on /approvals endpoints
**Cause:** `DASHBOARD_SECRET` not set or wrong value
**Fix:** 
1. Render Dashboard → Web Service → Environment
2. Add/verify `DASHBOARD_SECRET`
3. Redeploy

### Worker not creating approvals
**Cause:** Background worker not deployed yet
**Fix:** Deploy background worker (see Deployment Step 5 above)

### 503 on /health (Postgres error)
**Cause:** DATABASE_URL not set or wrong
**Fix:** 
1. Verify Postgres is running (local) or check Render DB URL
2. Update DATABASE_URL env var
3. Redeploy

### Groq rate-limited
**Cause:** Too many agent calls too fast
**Fix:** Already handled — automatically falls back to OpenRouter
(Check logs for `"Falling back to OpenRouter"`)

### Build fails with "rolldown native binding" error
**Cause:** Vitest config issue
**Fix:** Already fixed in `vitest.config.ts` — rebuild locally to verify

---

## Project Structure

```
src/
├── agent/               # LLM agents & thesis management
│   ├── llm.ts          # Groq + Gemini + OpenRouter client
│   ├── thesis.ts       # Thesis versioning
│   └── GuardrailEngine.ts
├── execution/          # Trade execution
│   ├── alpaca.ts       # Alpaca API client
│   └── __tests__/
├── filter/             # Event filtering
│   ├── EventFilter.ts
│   ├── DecisionSchemaValidator.ts
│   └── __tests__/
├── guardrails/         # Safety checks
│   ├── GuardrailEngine.ts
│   ├── InvalidationEvaluator.ts
│   └── __tests__/
├── hitl/               # Human approval state machine
│   ├── ApprovalStateMachine.ts
│   └── __tests__/
├── ingestion/          # Event sources
│   ├── finnhub.ts
│   └── binance.ts
├── db/
│   ├── client.ts       # Postgres pool & schema init
│   └── schema.sql      # Full database schema
├── dashboard/views/
│   └── approvals.html  # HTMX dashboard UI
├── utils/
│   ├── health.ts       # /health & /metrics endpoints
│   └── connectivity-check.ts
├── config.ts           # Configuration from env vars
├── types.ts            # TypeScript interfaces
├── server.ts           # Express server
├── worker.ts           # Background loops (ingestion, execution, invalidation)
└── __tests__/          # Integration tests

docs/
├── BRD.md              # Original business requirements
└── IMPLEMENTATION_PLAN.md

.env                    # Local env vars (git-ignored)
.env.production         # Production env template
render.yaml             # Render deployment config
vitest.config.ts        # Test runner config
tsconfig.json           # TypeScript config
package.json            # Dependencies
```

---

## Key Metrics (After Running)

Once approvals start flowing, check:

```bash
# Approvals per hour
curl http://localhost:3000/metrics | jq '.oneHourMetrics'

# Database activity
curl http://localhost:3000/health | jq '.metrics'
```

---

## Next Steps

1. **Local Testing**
   - [ ] Run `npm run dev:web` + `npm run dev:worker` together
   - [ ] Wait for first Finnhub poll (60s)
   - [ ] Check dashboard at http://localhost:3000
   - [ ] Verify at least 1 event ingested
   - [ ] Check `/health` endpoint

2. **Debug Issues Locally**
   - Check console logs for errors
   - Query DB: `SELECT COUNT(*) FROM events;`
   - Check guardrail rejections: `SELECT * FROM guardrail_decisions;`

3. **Deploy to Render**
   - Follow "Deployment to Render" section above
   - Do NOT skip Step 2 (set DASHBOARD_SECRET explicitly)
   - Verify worker is running before testing approvals

4. **Monitor Live**
   - Dashboard auto-refreshes every 2s
   - Check `/health` regularly
   - Review `/metrics` hourly

---

## Contributing

See `BRD.md` for original vision and scope. Current implementation focuses on:
- Reliable ingestion (Finnhub + Binance)
- Safe guardrails (no autonomous trading)
- Clear HITL workflow (approval before execution)
- Comprehensive logging (all decisions auditable)

Avoid:
- Adding features beyond Phases 3-8
- Autonomous trading (defeats HITL purpose)
- Real money integration (paper trading only)

---

## License

MIT

---

## Author

Built during agentic-workflows project series #4.

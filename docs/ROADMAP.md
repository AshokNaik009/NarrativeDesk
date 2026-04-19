# NarrativeDesk Roadmap

The current pipeline is a solid engineering artifact — end-to-end async, HITL, guardrailed, observable. As a **trading edge** it has structural limits: news is the weakest signal in crypto, Alpaca is equities-first, and there is no backtest evidence yet. The roadmap below addresses those gaps in order of value-per-effort.

Each phase is self-contained — you can ship after any of them.

---

## Sequencing summary

```
Phase 0  →  Phase 1  →  Phase 2  →  Phase 3  →  Phase 4  →  Phase 5
reframe     plans       signals     backtest    journal     venue
  0.5d      1–2d        ~1wk        3–5d        2–3d        2–3d
  │           │           │           │           │           │
  └── ship after any phase ─────────────────────────────────── ┘
```

Total to a defensible v1: **~2–3 weeks** of focused work through Phase 4. Phase 5 is optional polish.

| Phase | Title | Effort | Status |
|-------|-------|--------|--------|
| 0 | Honest reframing | 0.5 day | ☐ |
| 1 | Structured trade plans | 1–2 days | ☐ |
| 2 | Crypto-native signals | ~1 week | ☐ |
| 3 | Backtest harness | 3–5 days | ☐ |
| 4 | Decision-logger / bias analyzer | 2–3 days | ☐ |
| 5 | Execution venue swap (optional) | 2–3 days | ☐ |

---

## Phase 0 — Honest reframing *(0.5 day)*

**Goal:** Position the project correctly before adding more features.

- Update README + landing copy to frame NarrativeDesk as **(a)** an HITL agentic-systems reference and **(b)** a trading decision-logger — *not* an alpha-generating trading bot.
- Add a "Limitations" section: latency floor (~3–10s LLM), venue mismatch (Alpaca paper ≠ crypto microstructure), no backtest.
- Keep paper-trading but stop describing it as a returns-generating system.

**Deliverable:** `README.md` + `docs/LIMITATIONS.md`.

---

## Phase 1 — Structured trade plans *(1–2 days)*

**Goal:** Replace "thesis vibes" with a plan a human trader can actually execute.

Today the agent outputs prose reasoning and a coarse `action`. The new schema forces the LLM to commit to numbers:

```ts
TradePlan {
  entry_zone:   [number, number]   // price range
  invalidation: number              // if crossed, close
  target:       number              // take-profit
  timeframe:    'scalp' | 'swing' | 'position'
  size_pct:     number              // 0–10
  correlation_notes: string         // BTC beta, sector exposure
  conviction:   1 | 2 | 3 | 4 | 5
}
```

**Touch list:**
- `src/types.ts` — add `TradePlan` Zod schema
- `src/agent/llm.ts` — update prompt + parser
- `src/db/schema.sql` — extend `proposed_decisions` columns
- `src/dashboard/views/approvals.html` — render plan + let humans edit numbers
- `GuardrailEngine` — validate `size_pct` against position cap

**Why this first:** zero new data sources, pure refactor. Makes every downstream metric (win rate, R-multiple, invalidation accuracy) meaningful.

---

## Phase 2 — Crypto-native signals *(~1 week)*

**Goal:** Feed the agent the data that actually moves BTC/ETH/SOL. News stays but gets demoted to *context*, not trigger.

New `src/ingestion` adapters, all using free APIs:

| Source | Free tier | What it gives us | Cadence |
|--------|-----------|------------------|---------|
| Binance `fapi` | unauth, ~1200 req/min | Funding rates + OI per symbol | 5 min |
| Binance WebSocket `!forceOrder@arr` | unauth, live | Liquidation stream | real-time |
| DefiLlama (`api.llama.fi`, `stablecoins.llama.fi`) | unauth, effectively unlimited | DEX volume, stablecoin supply deltas | 15 min |
| Etherscan | free key, 5 rps | Whale wallet balance changes | 5 min |

**Touch list:**
- `src/ingestion/funding.ts`, `liquidations.ts`, `defillama.ts`, `etherscan.ts`
- `src/types.ts` — new event kinds: `FundingEvent`, `LiquidationEvent`, `OnChainEvent`
- `EventFilter` — signal-specific thresholds (e.g. liquidation cascade = >$10M in 5min)
- Agent prompt — inject rolling context (funding, OI delta, stablecoin mint in last 24h) alongside any news trigger

**Expected outcome:** ~5× higher-signal events/day, reasoning grounded in positioning data rather than headlines.

---

## Phase 3 — Backtest harness *(3–5 days)*

**Goal:** Stop guessing; get a real number.

Replay stored events through the live pipeline with mocked time and historical prices.

**Design:**
- `src/backtest/replay.ts` — reads `events` from a date range, pipes through `filter → agent → guardrails → execution` with clock shim
- `src/backtest/pnl.ts` — computes realized P&L, win rate, Sharpe, max drawdown vs. HODL and vs. random
- CLI: `npm run backtest -- --from 2026-01-01 --to 2026-03-31`
- Output: `reports/backtest-YYYY-MM-DD.md`

**Why now (not earlier):** Phase 1 + 2 make the backtest worth running. Backtesting the current news-only pipeline just confirms known weakness.

---

## Phase 4 — Decision-logger / bias analyzer *(2–3 days)*

**Goal:** Make the HITL audit trail the product. The narrower, real use-case.

Extends existing postmortem + approval-tag data into actionable self-review:

- **Bias dashboard** — win-rate by approval tag, by time-of-day, by thesis-type, by conviction. *"You reject 40% of `act` signals between 02:00–06:00 GST; of those, 60% would have been profitable."*
- **Hindsight panel** — for every rejected/edited approval, show what the trade *would have* done.
- **Thesis drift view** — how often the agent's thesis flips, and whether flips precede or lag price.

**Touch list:** `src/metrics/BiasAnalyzer.ts`, new `/bias` dashboard tab, extend `generateReport.ts`.

---

## Phase 5 — Execution venue swap *(2–3 days, optional)*

**Goal:** If paper-trading stays in the product, trade on a venue that reflects crypto reality.

- New adapter `src/execution/hyperliquid.ts` or `bybit-testnet.ts` (perps, funding, liquidations visible in fills)
- Keep `alpaca.ts` behind a `VENUE=` env flag for backwards compatibility
- Update guardrails for leverage + liquidation distance (not just stop-loss %)

**Why last:** only useful once Phase 1 (structured plans) and Phase 2 (real signals) exist. Otherwise it's the same thin pipeline against a different API.

---

## Starting a new session

To resume work on any phase in a fresh Claude Code session:

```
Begin Phase <N> from docs/ROADMAP.md
```

Each phase's touch list names the exact files to modify. No cross-session context should be needed beyond the current git state + this file.

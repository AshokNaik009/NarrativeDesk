# NarrativeDesk Roadmap

## What's already shipped

The original six-phase plan (Phase 0 — 5) took the project from a news-triggered paper-trading prototype to a full HITL decision-logger with crypto-native signals, backtesting, and bias analysis. Completed work:

| Phase | Title | Status |
|-------|-------|--------|
| 0 | Honest reframing (README + `LIMITATIONS.md`) | ✅ Done |
| 1 | Structured `TradePlan` schema (entry/invalidation/target/size/conviction) | ✅ Done |
| 2 | Crypto-native signals (Binance funding/OI/liquidations, DefiLlama, Etherscan) | ✅ Done |
| 3 | Backtest harness (`src/backtest/`) replaying stored events | ✅ Done |
| 4 | Decision-logger / bias analyzer (`src/metrics/BiasAnalyzer.ts`) | ✅ Done |
| 5 | Hyperliquid / Bybit testnet execution adapter | ❌ Dropped — see below |

Phase 5 is intentionally not pursued. Swapping Alpaca for a perps venue doesn't fix the fundamental LLM-latency problem, so it's wasted effort.

---

## Improvements that actually move the needle

These are the next high-leverage improvements — chosen to lean into what NarrativeDesk is *actually good at* (HITL decision auditing and bias coaching) and away from competing with sub-100ms trading systems it can't beat.

### 1. Drop the trading-bot framing entirely
Rename or re-position as *"NarrativeDesk: an LLM-assisted trading journal with bias analytics."* Stop competing with sub-100ms trading systems — you can't win that fight. The project's edge is the audit trail and bias insight, not alpha generation.

### 2. Run the backtest and publish the numbers
The Phase 3 harness exists — use it. Run a 3-month replay and commit `reports/backtest-YYYY-MM-DD.md` with realized P&L vs. HODL vs. random. If it loses to HODL (likely), say so. **Honesty is the product.**

### 3. Double down on Phase 4 (bias analyzer)
The bias dashboard is the only component with no latency floor and no venue mismatch. Extend it with:
- **Thesis-drift charts** — how often the agent's thesis flips, and whether flips precede or lag price
- **Conviction calibration** — Brier score on the agent's 1–5 conviction vs. realized outcomes
- **Regret analysis on rejected trades** — for every rejected/edited approval, show what the trade *would have* done

### 4. Add TradingView chart embed
Embed a TradingView chart widget next to each pending approval so the human sees **price context**, not just a headline. The cheapest, highest-leverage UX change on the dashboard.

### 5. Kill Phase 5 (execution venue swap)
Already dropped above. Hyperliquid/Bybit execution doesn't fix the LLM latency problem. Wasted effort — leave Alpaca paper as-is.

### 6. Personal-mode
Let a user log their **own** manual trades alongside agent proposals. Now the bias analyzer becomes a personal coach, not just an agent-auditor — a much more defensible product surface.

---

## Starting a new session

To resume work on any improvement in a fresh Claude Code session:

```
Begin improvement <N> from docs/ROADMAP.md
```

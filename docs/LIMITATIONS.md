## Structural Limitations of NarrativeDesk

NarrativeDesk is a reference implementation of an end-to-end HITL agentic trading pipeline. It is **not** a returns-generating system or alpha source. This document candidly describes the gaps that prevent it from being one.

### Latency Floor

LLM inference adds **~3–10 seconds per decision** (Groq Llama 3.3 70B main agent + Gemini 2.0 Flash credibility sub-agent). In crypto markets, any edge with a 3–10s decision window is dead before execution — most meaningful microstructure moves (liquidation cascades, funding rate spikes, order book imbalances) resolve in milliseconds to seconds. This latency is structural to the agentic approach: you cannot reason about "why" without invoking an LLM, and you cannot invoke an LLM faster than inference hardware allows.

**Impact:** NarrativeDesk is fundamentally unsuited to scalp or capture short-term momentum. Even with perfect signal timing, the decision pipeline guarantees missed windows.

### Venue Mismatch

Alpaca is equities-first. Its paper-trading fills do not reflect crypto microstructure:
- **No funding rates** — crypto perpetual markets have continuous funding; equities do not.
- **No liquidation cascades** — Alpaca does not simulate margin liquidation mechanics.
- **No leverage** — the paper account cannot model liquidation distance or risk-of-ruin scenarios that dominate crypto decision-making.
- **Spread and slippage behavior** — crypto spot and perp markets have different liquidity profiles and volatility regimes than equities. Paper fills may not reflect actual execution quality.
- **Missing volatility regime** — crypto intraday volatility is often 2–5× higher than equity vol; backtests on Alpaca understate draw-down risk.

**Impact:** Any performance metric (win rate, Sharpe ratio, max drawdown) from Alpaca paper trading is not transferable to real crypto trading. The reported P&L is fiction.

### News Is a Weak Signal in Crypto

By the time a headline appears in a news feed, positioning has typically already moved. Most headline-driven moves are secondary waves, not primary ones:
- On-chain whales often move *before* news hits.
- Insider anticipation moves price *before* public announcement.
- By the time Finnhub picks it up, retail flow is late.

News is better used as **context** (confirming a thesis or updating narrative confidence) than as a **trigger** (initiating a trade). The current system treats news as a primary signal, which is a structural weakness until Phase 2 (crypto-native signals: funding, liquidations, on-chain balance changes) is shipped.

**Impact:** The current signal-to-noise ratio is low. Backtesting the news-only pipeline will likely show below-market returns.

### No Backtest Evidence

The pipeline has never been replayed against historical data. The current system has:
- ✓ Real-time news ingestion and paper-trading execution
- ✓ Full audit trail (every event, decision, approval, outcome logged)
- ✓ Safety guardrails and decision-logging infrastructure

But it has:
- ✗ No historical replay harness
- ✗ No P&L statistics (win rate, profit factor, Sharpe, max drawdown)
- ✗ No comparison to baseline strategies (HODL, random, 50/50 long/short)

**Any claims about trading performance are speculative.** Phase 3 (backtest harness) will provide a real number. Until then, all metrics are in-sample, biased by recency, and likely overstating edge.

### HITL Bottleneck and Unanalyzed Bias

Every `act` decision requires human approval. This caps throughput and introduces subtle biases that the system does not currently track:
- Humans may approve signals more readily in certain time windows (e.g., mornings vs. overnight).
- Humans may tag rejections inconsistently, making approval/rejection patterns uninterpretable.
- Humans may consciously or unconsciously favor certain thesis types or conviction levels.
- Timezone effects (GST vs. other timezones) and fatigue may shift approval thresholds.

The current approval flow captures the decision (approve/reject/edit) and tags it, but does not analyze **whether humans have systematic biases that correlate with outcome**.

**Impact:** Until Phase 4 (bias analyzer), it is impossible to know whether HITL approvals are improving or degrading the system. HITL might be a safety feature or a drag on returns — the data does not yet tell.

---

### Scope of the Reference Implementation

NarrativeDesk demonstrates:
- End-to-end async architecture with explicit error handling and retry logic.
- Multi-layer safety constraints (filter → credibility → guardrails → human approval).
- Full observability: every event, decision, and outcome is logged and queryable.
- Idempotent state machines for approval workflows.
- Practical HITL approval UX (HTMX dashboard, 15-min approval timeout, devil's-advocate counter-thesis).

It is **not** a trading system ready for live crypto deployment. It is a testbed for understanding how human-approved LLM agents behave on real (paper) orders, and a foundation for adding better signals, backtesting, and bias analysis.

---

### Path to a Defensible v1

Phases 1–4 of the roadmap address these gaps in order:

| Phase | Fixes |
|-------|-------|
| 1 | Replaces coarse `action` with structured `TradePlan` (entry, invalidation, target, size, conviction). Enables per-trade R-multiples and invalidation accuracy. |
| 2 | Adds crypto-native signals (funding, liquidations, on-chain). Demotes news from trigger to context. Expected 5× improvement in signal cadence. |
| 3 | Backtest harness. Replays stored events with mocked time and historical prices. Produces real P&L and drawdown stats. |
| 4 | Bias analyzer. Win-rate by approval tag, time-of-day, thesis-type, conviction. Hindsight hindsight panel (what rejected trades would have done). Quantifies HITL impact. |

After Phase 4, the system will be defensible as a decision-logged HITL research tool, even if Phase 2 signals prove weak or HITL approval has unintended side effects.

# Phase 3: Backtest Harness Implementation

## Overview
Implemented a complete backtest replay engine that replays historical events through the full NarrativeDesk pipeline (filter → credibility → main agent → guardrails) with mocked time and computes comprehensive P&L metrics (win rate, Sharpe ratio, max drawdown, vs HODL/random baselines).

## Files Created

### Core Backtest Engine
- `src/backtest/types.ts` - TypeScript interfaces for backtest data structures
- `src/backtest/replay.ts` - Event replay engine with mocked time and portfolio tracking
- `src/backtest/metrics.ts` - P&L computation: Sharpe ratio, max drawdown, R-multiples
- `src/backtest/report.ts` - Markdown report generation
- `src/backtest/cli.ts` - Command-line interface with argument parsing
- `src/backtest/index.ts` - Public exports

## Architecture

### 1. Replay Engine (`replay.ts`)
- Loads all events from DB in date range
- Iterates through events chronologically
- For each event:
  1. **Filter:** Rejects based on watchlist, dedup, source reputation
  2. **Credibility:** Skips events with credibility rating < 2
  3. **Main Agent:** Gets classification (ignore/monitor/act) + trade plan
  4. **Guardrails:** Blocks if position size, concurrent positions, or cooldown violated
  5. **Mock Execution:** Immediate fill at historical price (no slippage)
- Force-closes all open positions at end date
- NO human approval loop in backtest (tests agent efficacy)

**Key Design:**
```typescript
// Event flows through pipeline synchronously
for (const event of events) {
  if (!filter.pass) continue;
  if (credibility.rating < 2) continue;
  const decision = await agent.decide();
  if (decision.classification !== "act") continue;
  if (!guardrails.allow) continue;
  const trade = mockExecute(decision, currentPrice, currentTime);
}
```

### 2. Metrics Module (`metrics.ts`)
Computes:
- **Win Rate:** Percentage of profitable trades
- **Profit Factor:** Gross wins / Gross losses
- **Sharpe Ratio:** Daily returns × sqrt(252), annualized
- **Max Drawdown:** Percentage decline from peak equity
- **R-Multiple:** (Profit) / (Risk per trade)
- **vs HODL:** Compare to buy-and-hold Bitcoin baseline
- **vs Random:** Compare to random trades with same frequency

### 3. Report Generation (`report.ts`)
Markdown output includes:
- Summary table (trades, win rate, Sharpe, drawdown)
- Comparative analysis (vs HODL, vs Random)
- Trade-by-trade log (first 50 trades)
- Performance conclusions

### 4. CLI (`cli.ts`)
```bash
npm run backtest -- --from 2026-01-01 --to 2026-03-31 --initial 50000 --symbols BTC,ETH,SOL
```

Options:
- `--from DATE` (required) - Start date (YYYY-MM-DD)
- `--to DATE` (required) - End date (YYYY-MM-DD)
- `--initial NUM` - Initial cash (default: 10000)
- `--symbols LIST` - Comma-separated symbols (default: BTC,ETH,SOL)
- `--output DIR` - Report output directory (default: ./reports)

## Design Choices

### 1. No Human Approval in Backtest
In production, trades require HITL approval. In backtest, they execute immediately if the agent says "act" and guardrails pass. This isolates agent performance from human decision-making.

### 2. Immediate Execution
No slippage model, no partial fills. Trades fill at current price. Acceptable for MVP; can add slippage stochastically later.

### 3. Forced Close at End
All open positions force-close at the final date's close price. Prevents unrealized P&L from inflating returns.

### 4. Stub Price Data
If historical prices unavailable in `outcome_prices` table, uses stub price (50000 for BTC). In production, integrate CoinGecko API or Polygon for real historical prices.

### 5. Random Baseline
Simulates N random trades (same count as agent) with returns uniformly distributed between -10% and +10%. Useful for statistical significance.

## Package.json Update
Added backtest script:
```json
"backtest": "tsx src/backtest/cli.ts"
```

## Verification

### TypeScript Compilation
```bash
npx tsc --noEmit
# No errors
```

### CLI Help
```bash
npm run backtest -- --help
# Displays usage information
```

### Build Output
```bash
npm run build
# Builds dist/backtest/ with compiled JS and type definitions
```

## Example Usage

```bash
# Backtest Jan-Mar 2026 with $50k initial capital
npm run backtest -- --from 2026-01-01 --to 2026-03-31 --initial 50000

# Output example:
# === NarrativeDesk Backtest Engine ===
# Date Range: 2026-01-01 to 2026-03-31
# Initial Capital: $50,000
# Symbols: BTC, ETH, SOL
#
# === Backtest Complete ===
# Total Trades: 12
# Closed Trades: 12
# Win Rate: 58.3%
# Total P&L: 8.45% ($4,225)
# Sharpe Ratio: 1.23
# Max Drawdown: 12.5%
# vs HODL: 8.45% vs 5.2% (Agent Win)
# vs Random: 8.45% vs -0.3% (Agent Win)
# Report saved: ./reports/backtest-2026-04-21.md
```

## Limitations & TODOs

### Current Limitations
1. **Price Data:** Uses stub prices (50000) when `outcome_prices` table is empty. Need to populate with real historical data via API.
2. **No Slippage Model:** Assumes perfect execution at exact price.
3. **No Transaction Costs:** Doesn't deduct fees or slippage.
4. **Single Currency:** Doesn't model multi-currency portfolios or cross-correlations.
5. **Credibility Caching:** Credibility calls fire every event; could cache by headline.

### Recommended Enhancements
- [ ] Integrate CoinGecko or Polygon API for real historical prices
- [ ] Add slippage model (e.g., 0.1-0.5% per trade)
- [ ] Add transaction fees (maker/taker based on exchange)
- [ ] Compute Calmar ratio, Sortino ratio
- [ ] Generate distribution charts (histogram of returns)
- [ ] Implement trade-by-trade breakdown with breakeven analysis
- [ ] Add stress-test scenarios (market crashes, volatility spikes)

## Files Modified
- `package.json` - Added `backtest` script

## Files Created
- `src/backtest/types.ts` (50 lines)
- `src/backtest/metrics.ts` (133 lines)
- `src/backtest/replay.ts` (215 lines)
- `src/backtest/report.ts` (162 lines)
- `src/backtest/cli.ts` (128 lines)
- `src/backtest/index.ts` (6 lines)
- `docs/BACKTEST_PHASE3.md` (this file)

**Total new code:** ~694 lines

## Integration Notes

### Required Tables
- `events` - Contains raw events (news/price)
- `outcome_prices` - Historical prices (optional, uses stub if empty)
- `thesis_versions` - Thesis history (read/write)

### Pipeline Interaction
- Calls `filterEvent()` from `src/filter/EventFilter.ts`
- Calls `invokeMainAgent()` + `invokeCredibilityAgent()` from `src/agent/llm.ts`
- Calls `evaluateGuardrails()` from `src/guardrails/GuardrailEngine.ts`
- Reads/writes thesis via `src/agent/thesis.ts`

### No Breaking Changes
Backtest is fully isolated; doesn't modify production code paths. All changes are additive.

---

**Status:** Phase 3 Complete. Ready for backtest runs with sample data.

import { randomUUID } from "crypto";
import { query } from "../db/client.js";
import { Decision, Event, PortfolioState } from "../types.js";
import { invokeMainAgent, invokeCredibilityAgent } from "../agent/llm.js";
import { getCurrentThesis, writeThesis } from "../agent/thesis.js";
import { filterEvent } from "../filter/EventFilter.js";
import { evaluateGuardrails } from "../guardrails/GuardrailEngine.js";
import { BacktestConfig, BacktestResult, ExecutedTrade, PortfolioSnapshot } from "./types.js";
import { computePnlStats } from "./metrics.js";

/**
 * Replay historical events through the full agent pipeline with mocked time.
 * No human approval loop: trades execute immediately if agent says "act" and guardrails pass.
 */
export async function replayBacktest(config: BacktestConfig): Promise<BacktestResult> {
  const startTime = new Date();

  // 1. Fetch all events in date range
  const eventsResult = await query<any>(
    `SELECT id, type, source, symbol, headline, raw_payload, created_at
     FROM events
     WHERE created_at >= $1 AND created_at <= $2
     ORDER BY created_at ASC`,
    [config.startDate, config.endDate]
  );

  const events: Event[] = eventsResult.rows.map((row) => ({
    type: row.type,
    source: row.source,
    symbol: row.symbol,
    headline: row.headline,
    rawPayload: row.raw_payload || {},
  }));

  console.log(`[Backtest] Loaded ${events.length} events from ${config.startDate} to ${config.endDate}`);

  // 2. Initialize portfolio and state
  const portfolio: PortfolioState = {
    cash: config.initialCash,
    totalValue: config.initialCash,
    positions: [],
  };

  const trades: ExecutedTrade[] = [];
  const tradeInvalidations = new Map<string, number>();
  const portfolioSnapshots: PortfolioSnapshot[] = [];
  const tradeHistory: Array<{ coin: string; executedAt: Date }> = [];
  let currentTime = config.startDate;

  // Ensure a thesis exists
  let thesis = await getCurrentThesis();
  if (!thesis) {
    thesis = { id: randomUUID(), content: "Market thesis: No strong directional conviction. Watching markets for narrative-driven catalysts." };
    await writeThesis(thesis.content);
  }

  let thesisContent = thesis.content;

  // 3. Replay events
  const recentEvents: Event[] = [];
  const maxRecentEvents = 100;

  for (const event of events) {
    const timestamp = (event.rawPayload as any).created_at || (event.rawPayload as any).timestamp;
    if (timestamp) {
      currentTime = new Date(timestamp);
    }

    // Keep rolling window of recent events for dedup
    recentEvents.push(event);
    if (recentEvents.length > maxRecentEvents) {
      recentEvents.shift();
    }

    // 3a. Filter event
    const filterResult = filterEvent(event, recentEvents);
    if (!filterResult.passed) {
      continue;
    }

    // 3b. Run credibility sub-agent (skip low-credibility events)
    const credibilityResult = await invokeCredibilityAgent(event.headline || JSON.stringify(event.rawPayload).slice(0, 100));
    if (credibilityResult.credibility && credibilityResult.credibility.rating < 2) {
      continue;
    }

    // Build portfolio context string
    const portfolioContext = portfolio.positions.length > 0
      ? `Positions: ${portfolio.positions.map((p) => `${p.coin} ${p.side} ${p.size_pct}% @ ${p.entryPrice}`).join(", ")}`
      : "No open positions";

    // 3c. Run main agent
    const agentResult = await invokeMainAgent(event, thesisContent, portfolioContext, credibilityResult.credibility || undefined);

    if (!agentResult.decision || agentResult.decision.classification !== "act") {
      // Update thesis if decision changed it
      if (agentResult.decision && agentResult.decision.thesis_delta && agentResult.decision.thesis_delta !== "no change") {
        thesisContent = `${thesisContent}\n\nUpdate at ${currentTime.toISOString()}: ${agentResult.decision.thesis_delta}`;
        await writeThesis(thesisContent);
      }
      continue;
    }

    const decision = agentResult.decision;
    const tradePlan = decision.trade_plan;

    if (!tradePlan) continue;

    // 3d. Run guardrails
    const guardrailResult = evaluateGuardrails(tradePlan, portfolio, tradeHistory, currentTime);
    if (!guardrailResult.allowed) {
      console.log(`[Backtest] Guardrail blocked trade: ${guardrailResult.reason}`);
      continue;
    }

    // 3e. Mock execution (immediate fill at current price)
    const entryPrice = await getHistoricalPrice(tradePlan.coin, currentTime);
    if (entryPrice === null) {
      console.log(`[Backtest] Could not fetch price for ${tradePlan.coin} at ${currentTime}`);
      continue;
    }

    const trade: ExecutedTrade = {
      id: randomUUID(),
      side: tradePlan.side,
      coin: tradePlan.coin,
      size_pct: tradePlan.size_pct,
      entry_price: entryPrice,
      entry_time: currentTime,
      close_price: null,
      close_time: null,
      close_reason: null,
    };

    trades.push(trade);
    tradeInvalidations.set(trade.id, tradePlan.invalidation);
    tradeHistory.push({ coin: tradePlan.coin, executedAt: currentTime });

    // Update portfolio
    portfolio.positions.push({
      coin: tradePlan.coin,
      side: tradePlan.side,
      size_pct: tradePlan.size_pct,
      entryPrice: entryPrice,
      currentPrice: entryPrice,
      invalidation: tradePlan.invalidation.toString(),
      tradeId: trade.id,
    });

    // Update thesis
    if (decision.thesis_delta && decision.thesis_delta !== "no change") {
      thesisContent = `${thesisContent}\n\nThesis Update at ${currentTime.toISOString()}: ${decision.thesis_delta}`;
      await writeThesis(thesisContent);
    }

    console.log(`[Backtest] Trade executed: ${tradePlan.side} ${tradePlan.size_pct}% ${tradePlan.coin} @ ${entryPrice}`);
  }

  // 4. Force-close all open trades at end date
  const endPrice: Record<string, number | null> = {};
  for (const trade of trades.filter((t) => t.close_price === null)) {
    if (!endPrice.hasOwnProperty(trade.coin)) {
      endPrice[trade.coin] = await getHistoricalPrice(trade.coin, config.endDate);
    }
  }

  for (const trade of trades.filter((t) => t.close_price === null)) {
    const price = endPrice[trade.coin];
    if (price !== null && price !== undefined) {
      trade.close_price = price;
      trade.close_time = config.endDate;
      trade.close_reason = "backtest_end";
    }
  }

  // Update final portfolio value
  portfolio.totalValue = portfolio.cash;
  for (const trade of trades.filter((t) => t.close_price !== null)) {
    const pnl = trade.side === "buy"
      ? (trade.close_price! - trade.entry_price) * (trade.size_pct / 100) * (portfolio.cash / 100)
      : (trade.entry_price - trade.close_price!) * (trade.size_pct / 100) * (portfolio.cash / 100);
    portfolio.totalValue += pnl;
  }
  portfolio.totalValue = Math.max(portfolio.totalValue, 0);

  // 5. Compute P&L metrics
  const pnlStats = computePnlStats(trades, config.initialCash, portfolio.totalValue, tradeInvalidations);

  // Compare to HODL (buy BTC at start, hold to end)
  const btcStartPrice = await getHistoricalPrice("BTC", config.startDate);
  const btcEndPrice = await getHistoricalPrice("BTC", config.endDate);
  if (btcStartPrice !== null && btcEndPrice !== null) {
    const hodlPnl = ((btcEndPrice - btcStartPrice) / btcStartPrice) * 100;
    pnlStats.vsHodl = { pnlPct: hodlPnl, win: pnlStats.totalPnlPct > hodlPnl };
  }

  // Compare to random strategy (simulate same number of trades with random outcomes)
  const randomPnl = simulateRandomTrades(trades.length);
  pnlStats.vsRandom = { pnlPct: randomPnl, win: pnlStats.totalPnlPct > randomPnl };

  // Take portfolio snapshots at key points
  portfolioSnapshots.push({
    timestamp: config.startDate,
    cash: config.initialCash,
    positions: {},
    totalValue: config.initialCash,
  });

  portfolioSnapshots.push({
    timestamp: config.endDate,
    cash: portfolio.cash,
    positions: {},
    totalValue: portfolio.totalValue,
  });

  console.log(`[Backtest] Completed: ${trades.length} trades, ${trades.filter((t) => t.close_price !== null).length} closed`);

  return {
    config,
    trades,
    portfolio: portfolioSnapshots,
    pnl: pnlStats,
    startedAt: startTime,
    completedAt: new Date(),
  };
}

/**
 * Fetch historical price for a coin at a given timestamp.
 * Falls back to stub price if historical data unavailable.
 */
async function getHistoricalPrice(coin: string, timestamp: Date): Promise<number | null> {
  try {
    // Try to fetch from outcome_prices table first
    const result = await query<any>(
      `SELECT price_at_decision FROM outcome_prices
       WHERE coin = $1 AND created_at <= $2
       ORDER BY created_at DESC LIMIT 1`,
      [coin, timestamp]
    );

    if (result.rows.length > 0) {
      return parseFloat(result.rows[0].price_at_decision);
    }

    // Fallback: return a stub price (in real scenario, call external API)
    console.warn(`[Backtest] No historical price for ${coin}, using stub price`);
    return 50000; // Stub price for BTC, etc.
  } catch (err) {
    console.error(`[Backtest] Failed to fetch price for ${coin}:`, err);
    return null;
  }
}

/**
 * Simulate a random trading strategy with the same number of trades.
 * Returns average P&L percentage.
 */
function simulateRandomTrades(numTrades: number): number {
  let totalPnl = 0;

  for (let i = 0; i < numTrades; i++) {
    // Random return between -10% and +10%
    const returnPct = (Math.random() - 0.5) * 20;
    totalPnl += returnPct;
  }

  return numTrades > 0 ? totalPnl / numTrades : 0;
}

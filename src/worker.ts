import { config } from "./config.js";
import { initDb, query } from "./db/client.js";
import { fetchCryptoNews, persistEvent, persistFilterDecision, fetchQuote } from "./ingestion/finnhub.js";
import { startBinanceWs } from "./ingestion/binance.js";
import { fetchFundingRates } from "./ingestion/funding.js";
import { startLiquidationWatcher } from "./ingestion/liquidations.js";
import { fetchStablecoinSupply, fetchDexVolume } from "./ingestion/defillama.js";
import { fetchWhaleBalanceChanges } from "./ingestion/etherscan.js";
import { filterEvent } from "./filter/EventFilter.js";
import { invokeMainAgent, invokeCredibilityAgent, logAgentInvocation, resetCredibilityCycleCount } from "./agent/llm.js";
import { invokeCounterThesis, invokeTradePostmortem, logCounterThesis, logPostmortem } from "./agent/features.js";
import { getCurrentThesis, writeThesis, ensureThesisExists } from "./agent/thesis.js";
import { evaluateGuardrails } from "./guardrails/GuardrailEngine.js";
import { evaluateInvalidation, MarketState } from "./guardrails/InvalidationEvaluator.js";
import { queryPortfolioState, executeApprovedTrade, closePosition, getOrderStatus } from "./execution/alpaca.js";
import { Event, TradeHistoryEntry, PortfolioState } from "./types.js";

// Recent events buffer for dedup/rate-limiting
const recentEvents: Event[] = [];
const RECENT_BUFFER_SIZE = 100;

// Price cache for invalidation watcher
const priceCache: Record<string, number> = {};

function addToRecent(event: Event) {
  recentEvents.push(event);
  if (recentEvents.length > RECENT_BUFFER_SIZE) {
    recentEvents.shift();
  }

  // Update price cache if this is a price event
  if (event.type === "price" && event.symbol) {
    const payload = event.rawPayload as any;
    if (payload.price) {
      priceCache[event.symbol.toUpperCase()] = payload.price;
    }
  }
}

// Helper: Get trade history from executed_trades table for the last N hours
async function getTradeHistory(hours: number = 24): Promise<TradeHistoryEntry[]> {
  try {
    const result = await query(
      `SELECT coin, created_at as "executedAt"
       FROM executed_trades
       WHERE created_at > NOW() - INTERVAL '${hours} hours'
       ORDER BY created_at DESC`
    );
    return result.rows.map((row) => ({
      coin: row.coin,
      executedAt: new Date(row.executedAt),
    }));
  } catch (err) {
    console.error("[Worker] Error fetching trade history:", err);
    return [];
  }
}


// Helper: Log guardrail decision to DB (gracefully handles missing table)
async function logGuardrailDecision(
  decisionId: string,
  allowed: boolean,
  reason: string
): Promise<void> {
  try {
    await query(
      `INSERT INTO guardrail_decisions (decision_id, allowed, reason, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [decisionId, allowed, reason]
    );
  } catch (err: any) {
    // Gracefully handle missing table (Task 3.3 will create it)
    if (err.code === "42P01" || err.message?.includes("does not exist")) {
      console.warn("[Worker] guardrail_decisions table not yet created, logging to console only");
    } else {
      console.error("[Worker] Error logging guardrail decision:", err);
    }
  }
}

async function processEvent(event: Event) {
  try {
    // Persist raw event
    const eventId = await persistEvent(event);

    // Run filter
    const filterResult = filterEvent(event, recentEvents);
    await persistFilterDecision(eventId, filterResult.passed, filterResult.reason);

    addToRecent(event);

    if (!filterResult.passed) {
      console.log(`[Worker] Filtered out: ${filterResult.reason} | ${event.headline?.slice(0, 60) || event.symbol}`);
      return;
    }

    console.log(`[Worker] Event passed filter: ${event.type} | ${event.headline?.slice(0, 60) || event.symbol}`);

    // Phase 2: invoke credibility sub-agent (news only), then main agent
    let credibilityRating = undefined;
    if (event.type === "news" && event.headline) {
      const credResult = await invokeCredibilityAgent(event.headline);
      credibilityRating = credResult.credibility ?? undefined;
      if (credResult.credibility) {
        console.log(`[Worker] Credibility: ${credResult.credibility.rating}/5 (${credResult.latencyMs}ms)`);
      }
    }

    const thesis = await getCurrentThesis();
    const currentThesis = thesis?.content || "No thesis yet. Observing market.";

    const agentResult = await invokeMainAgent(
      event,
      currentThesis,
      "Portfolio: paper trading, no open positions (Alpaca not connected)",
      credibilityRating
    );

    // Log invocation
    const invocationId = await logAgentInvocation(
      eventId,
      "llama-3.3-70b-versatile",
      agentResult.tokens,
      agentResult.latencyMs,
      agentResult.decision !== null,
      agentResult.decision
    );

    if (!agentResult.decision) {
      console.log(`[Worker] Agent returned no valid decision (${agentResult.latencyMs}ms)`);
      return;
    }

    const d = agentResult.decision;
    console.log(`[Worker] Agent decision: ${d.classification} | ${d.reasoning.slice(0, 80)}`);

    // Persist proposed decision
    await query(
      `INSERT INTO proposed_decisions (agent_invocation_id, classification, reasoning, thesis_delta, side, coin, size_pct, entry_zone_low, entry_zone_high, invalidation_price, target_price, timeframe, correlation_notes, conviction)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [invocationId, d.classification, d.reasoning, d.thesis_delta, d.trade_plan?.side, d.trade_plan?.coin, d.trade_plan?.size_pct, d.trade_plan?.entry_zone[0], d.trade_plan?.entry_zone[1], d.trade_plan?.invalidation, d.trade_plan?.target, d.trade_plan?.timeframe, d.trade_plan?.correlation_notes, d.trade_plan?.conviction]
    );

    // Update thesis if there's a delta
    if (d.thesis_delta && d.thesis_delta !== "no change") {
      const newThesis = `${currentThesis}\n\n[${new Date().toISOString()}] ${d.thesis_delta}`;
      await writeThesis(newThesis);
      console.log(`[Worker] Thesis updated`);
    }

    // Phase 3: Run guardrails if decision is "act"
    if (d.classification === "act" && d.trade_plan) {
      const portfolio = await queryPortfolioState();
      const tradeHistory = await getTradeHistory(24);

      const guardrailResult = evaluateGuardrails(d.trade_plan, portfolio, tradeHistory);

      console.log(
        `[Worker] Guardrail check: ${guardrailResult.allowed ? "ALLOWED" : "BLOCKED"} - ${guardrailResult.reason}`
      );

      // Get the decision_id from proposed_decisions table
      const decisionResult = await query(
        `SELECT id FROM proposed_decisions WHERE agent_invocation_id = $1`,
        [invocationId]
      );

      if (decisionResult.rows.length > 0) {
        const decisionId = decisionResult.rows[0].id;

        // Log guardrail decision to DB
        await logGuardrailDecision(decisionId, guardrailResult.allowed, guardrailResult.reason);

        // Log to console with portfolio summary
        const portfolioSummary = `cash: $${portfolio.cash.toFixed(0)}, positions: ${portfolio.positions.length}`;
        console.log(
          `[Worker] Guardrail decision logged | decision_id: ${decisionId.slice(0, 8)} | portfolio: [${portfolioSummary}]`
        );
      }

      // If guardrails rejected, exit early (don't create pending approval)
      if (!guardrailResult.allowed) {
        console.log(`[Worker] Trade blocked by guardrails, not creating approval`);
        return;
      }

      // Phase 4: Create pending approval if guardrail passes
      // (decisionId from earlier query is already available)
      if (decisionResult.rows.length > 0) {
        const decisionId = decisionResult.rows[0].id;
        const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours from now

        try {
          const approvalResult = await query(
            `INSERT INTO pending_approvals (decision_id, status, expires_at, created_at)
             VALUES ($1, $2, $3, NOW())
             RETURNING id`,
            [decisionId, 'pending', expiresAt]
          );

          if (approvalResult.rows.length > 0) {
            const approvalId = approvalResult.rows[0].id;
            console.log(
              `[Worker] Created pending approval ${approvalId.slice(0, 8)} (expires in 2h) for decision ${decisionId.slice(0, 8)}`
            );

            // Fire-and-forget: generate counter-thesis (devil's advocate) for this approval
            (async () => {
              try {
                const eventRow = await query(
                  `SELECT headline, source FROM events WHERE id = $1`,
                  [eventId]
                );
                const evt = eventRow.rows[0] || {};
                const ct = await invokeCounterThesis(
                  {
                    classification: d.classification,
                    reasoning: d.reasoning,
                    coin: d.trade_plan?.coin ?? null,
                    side: d.trade_plan?.side ?? null,
                    size_pct: d.trade_plan?.size_pct ?? null,
                    invalidation: d.trade_plan?.invalidation ? `$${d.trade_plan.invalidation.toFixed(2)}` : null,
                  },
                  { headline: evt.headline ?? null, source: evt.source ?? null }
                );
                if (ct.counterThesis) {
                  await logCounterThesis(approvalId, ct.counterThesis, ct.tokens, ct.latencyMs);
                  console.log(
                    `[Worker] Counter-thesis logged for approval ${approvalId.slice(0, 8)} (${ct.latencyMs}ms)`
                  );
                }
              } catch (err) {
                console.error("[Worker] Counter-thesis generation failed:", (err as Error).message);
              }
            })().catch((err) => console.error("[Worker] Counter-thesis task error:", err));
          }
        } catch (err: any) {
          if (err.code === "42P01" || err.message?.includes("does not exist")) {
            console.warn("[Worker] pending_approvals table not yet created, logging to console only");
          } else {
            console.error("[Worker] Error creating pending approval:", err);
          }
        }
      }
    }
  } catch (err) {
    console.error("[Worker] Error processing event:", err);
  }
}

// Finnhub news polling loop
async function pollNews() {
  console.log("[Worker] Polling Finnhub for crypto news...");
  const events = await fetchCryptoNews();
  console.log(`[Worker] Got ${events.length} news items`);

  // Reset credibility call budget for this cycle
  resetCredibilityCycleCount();

  for (const event of events) {
    await processEvent(event);
    // Small delay between events to avoid hammering APIs
    await new Promise((r) => setTimeout(r, 500));
  }
}

// Crypto signal polling loop (funding, liquidations, on-chain)
async function pollCryptoSignals() {
  try {
    // Funding rates (every 5 min)
    const fundingEvents = await fetchFundingRates();
    for (const event of fundingEvents) {
      await processEvent(event);
    }

    // Stablecoin supply (every 5 min; called from 15min interval)
    const stablecoinEvents = await fetchStablecoinSupply();
    for (const event of stablecoinEvents) {
      await processEvent(event);
    }

    // DEX volume (every 5 min; called from 15min interval)
    const dexEvents = await fetchDexVolume();
    for (const event of dexEvents) {
      await processEvent(event);
    }

    // Whale balance changes (every 5 min; only if Etherscan key present)
    if ((config as any).etherscanApiKey) {
      const whaleEvents = await fetchWhaleBalanceChanges();
      for (const event of whaleEvents) {
        await processEvent(event);
      }
    }
  } catch (err) {
    console.error("[Worker] Error in crypto signal polling:", err);
  }
}

// Execution loop: monitors approved trades and executes them
async function executionLoop() {
  try {
    // Query for approved trades that haven't been executed yet
    const approvalResult = await query(
      `SELECT pa.id, pa.decision_id,
              pd.side, pd.coin, pd.size_pct,
              pd.entry_zone_low, pd.entry_zone_high,
              pd.invalidation_price, pd.target_price,
              pd.timeframe, pd.correlation_notes, pd.conviction,
              pa.created_at
       FROM pending_approvals pa
       JOIN proposed_decisions pd ON pa.decision_id = pd.id
       WHERE pa.status = 'approved'
       AND pa.created_at < NOW() - INTERVAL '30 seconds'
       ORDER BY pa.created_at ASC
       LIMIT 5`
    );

    for (const approval of approvalResult.rows) {
      try {
        console.log(`[Worker] Executing approved trade ${approval.id.slice(0, 8)}: ${approval.side.toUpperCase()} ${approval.size_pct}% ${approval.coin}`);

        const execResult = await executeApprovedTrade({
          id: approval.id,
          decision_id: approval.decision_id,
          trade_plan: {
            side: approval.side,
            coin: approval.coin,
            size_pct: approval.size_pct,
            entry_zone: [approval.entry_zone_low, approval.entry_zone_high],
            invalidation: approval.invalidation_price,
            target: approval.target_price,
            timeframe: approval.timeframe,
            correlation_notes: approval.correlation_notes,
            conviction: approval.conviction,
          },
        });

        // Insert executed trade record
        await query(
          `INSERT INTO executed_trades (approval_id, side, coin, size_pct, entry_price, invalidation, created_at)
           SELECT $1, pd.side, pd.coin, pd.size_pct, $2, pd.invalidation_price, NOW()
           FROM proposed_decisions pd
           WHERE pd.id = $3`,
          [approval.id, execResult.entry_price, approval.decision_id]
        );

        // Update approval status to 'executed'
        await query(
          `UPDATE pending_approvals SET status = 'executed', resolved_at = NOW() WHERE id = $1`,
          [approval.id]
        );

        console.log(`[Worker] Trade executed: ${approval.id.slice(0, 8)} at ${execResult.entry_price} (order: ${execResult.alpaca_order_id.slice(0, 8)})`);
      } catch (err) {
        console.error(`[Worker] Execution failed for approval ${approval.id.slice(0, 8)}:`, (err as Error).message);
        // Don't update status on failure; will retry next loop
      }
    }
  } catch (err) {
    console.error("[Worker] Execution loop error:", err);
  }
}

// Invalidation watcher: monitors open trades for invalidation triggers
async function invalidationWatcher() {
  try {
    // Query for open trades
    const tradesResult = await query(
      `SELECT et.id, et.approval_id, et.side, et.coin, et.entry_price, et.invalidation, pa.decision_id
       FROM executed_trades et
       JOIN pending_approvals pa ON et.approval_id = pa.id
       WHERE et.closed_at IS NULL
       ORDER BY et.created_at ASC
       LIMIT 10`
    );

    // Build market state from recent prices
    const marketState: MarketState = {
      prices: priceCache,
      timestamp: new Date(),
    };

    for (const trade of tradesResult.rows) {
      if (!marketState.prices[trade.coin.toUpperCase()]) {
        // Try to fetch fresh price
        try {
          const price = await fetchQuote(trade.coin);
          if (price) {
            marketState.prices[trade.coin.toUpperCase()] = price;
          }
        } catch (err) {
          console.warn(`[Worker] Could not fetch price for ${trade.coin}:`, (err as Error).message);
        }
      }

      const invalidationResult = evaluateInvalidation(
        trade.invalidation,
        trade.entry_price,
        trade.coin,
        marketState
      );

      if (invalidationResult.triggered) {
        try {
          console.log(`[Worker] Invalidation triggered for ${trade.coin}: ${invalidationResult.reason}`);

          // Close the position
          await closePosition(`${trade.coin.toUpperCase()}USDT`, trade.side);

          // Update executed_trades record
          const closePrice = marketState.prices[trade.coin.toUpperCase()] || trade.entry_price;
          await query(
            `UPDATE executed_trades
             SET closed_at = NOW(), close_price = $1, close_reason = $2
             WHERE id = $3`,
            [closePrice, invalidationResult.reason, trade.id]
          );

          console.log(`[Worker] Trade closed: ${trade.id.slice(0, 8)} at ${closePrice} | reason: ${invalidationResult.reason}`);

          // Fire-and-forget: generate postmortem for the closed trade
          const closedTradeId = trade.id;
          const closedCoin = trade.coin;
          const closedSide = trade.side;
          const closedEntry = Number(trade.entry_price);
          const closedInvalidation = trade.invalidation;
          const closeReason = invalidationResult.reason;
          (async () => {
            try {
              const detailsResult = await query(
                `SELECT et.created_at AS opened_at, et.closed_at AS closed_at, pd.reasoning AS original_reasoning
                 FROM executed_trades et
                 JOIN pending_approvals pa ON et.approval_id = pa.id
                 JOIN proposed_decisions pd ON pa.decision_id = pd.id
                 WHERE et.id = $1`,
                [closedTradeId]
              );
              if (detailsResult.rows.length === 0) {
                console.warn(`[Worker] Postmortem: trade ${closedTradeId.slice(0, 8)} details not found`);
                return;
              }
              const details = detailsResult.rows[0];
              const pm = await invokeTradePostmortem({
                coin: closedCoin,
                side: closedSide,
                entry_price: closedEntry,
                close_price: Number(closePrice),
                close_reason: closeReason,
                opened_at: new Date(details.opened_at),
                closed_at: new Date(details.closed_at ?? Date.now()),
                original_reasoning: details.original_reasoning ?? "",
                invalidation: closedInvalidation ?? "",
              });
              if (pm.postmortem) {
                await logPostmortem(closedTradeId, pm.postmortem, pm.lesson, pm.tokens, pm.latencyMs);
                console.log(
                  `[Worker] Postmortem logged for trade ${closedTradeId.slice(0, 8)} (${pm.latencyMs}ms)`
                );
              }
            } catch (err) {
              console.error("[Worker] Postmortem generation failed:", (err as Error).message);
            }
          })().catch((err) => console.error("[Worker] Postmortem task error:", err));
        } catch (err) {
          console.error(`[Worker] Failed to close trade ${trade.id.slice(0, 8)}:`, (err as Error).message);
        }
      }
    }
  } catch (err) {
    console.error("[Worker] Invalidation watcher error:", err);
  }
}

// Self-ping to keep web service awake on Render free tier
function startSelfPing() {
  const webUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${config.port}`;
  setInterval(async () => {
    try {
      await fetch(`${webUrl}/health`);
      console.log("[Worker] Self-ping OK");
    } catch {
      console.log("[Worker] Self-ping failed (web service may not be running)");
    }
  }, 10 * 60 * 1000); // every 10 minutes
}

async function main() {
  console.log("[Worker] Starting NarrativeDesk worker...");

  // Init DB
  await initDb();

  // Ensure thesis exists
  await ensureThesisExists();
  console.log("[Worker] Thesis initialized");

  // Start Finnhub polling (every 60 seconds)
  await pollNews();
  setInterval(pollNews, config.finnhubPollIntervalMs);
  console.log("[Worker] Finnhub polling started (every 60s)");

  // Start Binance WebSocket for price ticks
  startBinanceWs(async (event) => {
    // Only process price events every 30 seconds to avoid flooding
    const matching = recentEvents.filter(
      (e: Event) => e.type === "price" && e.symbol === event.symbol
    );
    const lastPrice = matching[matching.length - 1];
    if (lastPrice) {
      const lastTimestamp = (lastPrice.rawPayload as any).timestamp || 0;
      const thisTimestamp = (event.rawPayload as any).timestamp || 0;
      if (thisTimestamp - lastTimestamp < 30_000) return;
    }
    await processEvent(event);
  });
  console.log("[Worker] Binance WebSocket connected");

  // Start Binance liquidation watcher (real-time, emits on cascade threshold)
  startLiquidationWatcher(async (event) => {
    await processEvent(event);
  });
  console.log("[Worker] Binance liquidation watcher started");

  // Crypto signal polling (every 5 minutes: funding, on-chain)
  await pollCryptoSignals();
  setInterval(pollCryptoSignals, 5 * 60 * 1000);
  console.log("[Worker] Crypto signal polling started (every 5min)");

  // Start execution loop (every 10 seconds)
  setInterval(executionLoop, 10 * 1000);
  console.log("[Worker] Execution loop started (every 10s)");

  // Start invalidation watcher loop (every 30 seconds)
  setInterval(invalidationWatcher, 30 * 1000);
  console.log("[Worker] Invalidation watcher started (every 30s)");

  // Self-ping
  startSelfPing();

  console.log("[Worker] All loops running. Ready to process events.");
}

main().catch((err) => {
  console.error("[Worker] Fatal error:", err);
  process.exit(1);
});

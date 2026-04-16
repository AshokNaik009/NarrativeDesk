import { config } from "./config.js";
import { initDb } from "./db/client.js";
import { fetchCryptoNews, persistEvent, persistFilterDecision } from "./ingestion/finnhub.js";
import { startBinanceWs } from "./ingestion/binance.js";
import { filterEvent } from "./filter/EventFilter.js";
import { Event } from "./types.js";

// Recent events buffer for dedup/rate-limiting
const recentEvents: Event[] = [];
const RECENT_BUFFER_SIZE = 100;

function addToRecent(event: Event) {
  recentEvents.push(event);
  if (recentEvents.length > RECENT_BUFFER_SIZE) {
    recentEvents.shift();
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

    // TODO Phase 2: invoke main agent here
    // TODO Phase 3: run guardrails on agent output
    // TODO Phase 4: create pending approval if "act"
  } catch (err) {
    console.error("[Worker] Error processing event:", err);
  }
}

// Finnhub news polling loop
async function pollNews() {
  console.log("[Worker] Polling Finnhub for crypto news...");
  const events = await fetchCryptoNews();
  console.log(`[Worker] Got ${events.length} news items`);

  for (const event of events) {
    await processEvent(event);
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

  // Start Finnhub polling
  await pollNews();
  setInterval(pollNews, config.finnhubPollIntervalMs);

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

  // Self-ping
  startSelfPing();

  console.log("[Worker] Running. Polling Finnhub every 60s, Binance WS connected.");
}

main().catch((err) => {
  console.error("[Worker] Fatal error:", err);
  process.exit(1);
});

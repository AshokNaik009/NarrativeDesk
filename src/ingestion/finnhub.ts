import { config } from "../config.js";
import { Event } from "../types.js";
import { query } from "../db/client.js";

const FINNHUB_BASE = "https://finnhub.io/api/v1";

// Map crypto symbols for Finnhub
const SYMBOL_MAP: Record<string, string> = {
  BTC: "BINANCE:BTCUSDT",
  ETH: "BINANCE:ETHUSDT",
  SOL: "BINANCE:SOLUSDT",
};

export async function fetchCryptoNews(): Promise<Event[]> {
  const events: Event[] = [];

  try {
    const url = `${FINNHUB_BASE}/news?category=crypto&token=${config.finnhubApiKey}`;
    const res = await fetch(url);

    if (!res.ok) {
      console.error(`[Finnhub] News fetch failed: ${res.status}`);
      return events;
    }

    const articles = (await res.json()) as Array<{
      id: number;
      headline: string;
      source: string;
      summary: string;
      url: string;
      datetime: number;
      related: string;
      category: string;
    }>;

    for (const article of articles.slice(0, 20)) {
      // Try to match a watchlist symbol
      const matchedSymbol = config.watchlist.find(
        (s) =>
          article.headline.toUpperCase().includes(s) ||
          article.summary?.toUpperCase().includes(s) ||
          article.related?.toUpperCase().includes(s)
      );

      const event: Event = {
        type: "news",
        source: article.source || "finnhub",
        symbol: matchedSymbol,
        headline: article.headline,
        rawPayload: article as unknown as Record<string, unknown>,
      };

      events.push(event);
    }
  } catch (err) {
    console.error("[Finnhub] Error fetching news:", err);
  }

  return events;
}

export async function fetchQuote(symbol: string): Promise<number | null> {
  try {
    const finnhubSymbol = SYMBOL_MAP[symbol.toUpperCase()];
    if (!finnhubSymbol) return null;

    const url = `${FINNHUB_BASE}/quote?symbol=${finnhubSymbol}&token=${config.finnhubApiKey}`;
    const res = await fetch(url);

    if (!res.ok) return null;

    const data = (await res.json()) as { c: number; h: number; l: number; o: number };
    return data.c; // current price
  } catch {
    return null;
  }
}

export async function persistEvent(event: Event): Promise<string> {
  const result = await query(
    `INSERT INTO events (type, source, symbol, headline, raw_payload)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [event.type, event.source, event.symbol, event.headline, JSON.stringify(event.rawPayload)]
  );
  return result.rows[0].id;
}

export async function persistFilterDecision(
  eventId: string,
  passed: boolean,
  reason: string
): Promise<void> {
  await query(
    `INSERT INTO filter_decisions (event_id, passed, reason) VALUES ($1, $2, $3)`,
    [eventId, passed, reason]
  );
}

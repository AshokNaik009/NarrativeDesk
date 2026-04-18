import { Event, FilterDecision } from "../types.js";
import { config } from "../config.js";

interface FilterConfig {
  watchlist: readonly string[];
  dedupeWindowMs: number;
  minSourceReputation: number;
  maxEventsPerMinute: number;
}

const DEFAULT_CONFIG: FilterConfig = {
  watchlist: config.watchlist,
  dedupeWindowMs: 5 * 60 * 1000, // 5 minutes
  minSourceReputation: 2,
  maxEventsPerMinute: 10,
};

// Source reputation scores (1-5, higher = more trusted)
const SOURCE_REPUTATION: Record<string, number> = {
  finnhub: 4,
  binance: 5,
  reuters: 5,
  bloomberg: 5,
  coindesk: 4,
  cointelegraph: 3,
  unknown: 1,
};

export function filterEvent(
  event: Event,
  recentEvents: Event[],
  cfg: FilterConfig = DEFAULT_CONFIG
): FilterDecision {
  // 1. Watchlist check
  if (event.symbol) {
    const symbol = event.symbol.toUpperCase().replace("USDT", "");
    if (!cfg.watchlist.some((w) => symbol.includes(w))) {
      return { passed: false, reason: `symbol ${event.symbol} not in watchlist` };
    }
  }

  // 2. Dedupe check for news events
  if (event.type === "news" && event.headline) {
    const now = Date.now();
    const isDuplicate = recentEvents.some((re) => {
      if (re.type !== "news" || !re.headline) return false;
      const similarity = computeSimilarity(event.headline!, re.headline!);
      return similarity > 0.8;
    });
    if (isDuplicate) {
      return { passed: false, reason: "duplicate or near-duplicate headline" };
    }
  }

  // 3. Source reputation check
  const reputation = SOURCE_REPUTATION[event.source.toLowerCase()] ?? SOURCE_REPUTATION["unknown"] ?? 1;
  if (reputation! < cfg.minSourceReputation) {
    return { passed: false, reason: `source ${event.source} reputation ${reputation} below threshold ${cfg.minSourceReputation}` };
  }

  // 4. Rate limit check — only count same-type events from the last minute
  const oneMinuteAgo = Date.now() - 60_000;
  const recentSameType = recentEvents.filter((re) => {
    const ts = (re.rawPayload as any).timestamp || (re.rawPayload as any).datetime;
    // If we have a timestamp, use it; otherwise count all recent events of same type
    if (ts && typeof ts === "number") {
      const eventTime = ts > 1e12 ? ts : ts * 1000; // handle s vs ms
      return re.type === event.type && eventTime > oneMinuteAgo;
    }
    return re.type === event.type;
  });
  if (recentSameType.length >= cfg.maxEventsPerMinute) {
    return { passed: false, reason: `rate limit: ${recentSameType.length} ${event.type} events in last minute exceeds ${cfg.maxEventsPerMinute}` };
  }

  // 5. Empty headline check for news
  if (event.type === "news" && (!event.headline || event.headline.trim().length < 5)) {
    return { passed: false, reason: "headline too short or empty" };
  }

  return { passed: true, reason: "passed all filters" };
}

// Simple word-overlap similarity (good enough for headline dedup)
function computeSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

export { computeSimilarity, DEFAULT_CONFIG };
export type { FilterConfig };

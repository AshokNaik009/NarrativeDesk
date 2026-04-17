import { describe, it, expect } from "vitest";
import { filterEvent, computeSimilarity, DEFAULT_CONFIG } from "../EventFilter.js";
import type { Event, FilterDecision } from "../../types.js";

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    type: "news",
    source: "finnhub",
    symbol: "BTC",
    headline: "Bitcoin surges past new resistance level",
    rawPayload: {},
    ...overrides,
  };
}

describe("filterEvent", () => {
  describe("watchlist check", () => {
    it("passes events with watchlist symbols", () => {
      const result = filterEvent(makeEvent({ symbol: "BTC" }), []);
      expect(result.passed).toBe(true);
    });

    it("passes ETH and SOL symbols", () => {
      expect(filterEvent(makeEvent({ symbol: "ETH" }), []).passed).toBe(true);
      expect(filterEvent(makeEvent({ symbol: "SOL" }), []).passed).toBe(true);
    });

    it("filters non-watchlist symbols", () => {
      const result = filterEvent(makeEvent({ symbol: "DOGE" }), []);
      expect(result.passed).toBe(false);
      expect(result.reason).toContain("not in watchlist");
    });

    it("passes events with no symbol (general news)", () => {
      const result = filterEvent(makeEvent({ symbol: undefined }), []);
      expect(result.passed).toBe(true);
    });

    it("handles USDT suffix in symbols", () => {
      const result = filterEvent(makeEvent({ symbol: "BTCUSDT" }), []);
      expect(result.passed).toBe(true);
    });
  });

  describe("dedup check", () => {
    it("filters duplicate headlines", () => {
      const event = makeEvent({ headline: "Bitcoin surges past new resistance level" });
      const recent = [makeEvent({ headline: "Bitcoin surges past new resistance level" })];
      const result = filterEvent(event, recent);
      expect(result.passed).toBe(false);
      expect(result.reason).toContain("duplicate");
    });

    it("filters near-duplicate headlines", () => {
      const event = makeEvent({ headline: "Bitcoin surges past new resistance level today" });
      const recent = [makeEvent({ headline: "Bitcoin surges past new resistance level now" })];
      const result = filterEvent(event, recent);
      expect(result.passed).toBe(false);
    });

    it("passes different headlines", () => {
      const event = makeEvent({ headline: "Ethereum upgrade scheduled for next month" });
      const recent = [makeEvent({ headline: "Bitcoin mining difficulty reaches new high" })];
      const result = filterEvent(event, recent);
      expect(result.passed).toBe(true);
    });

    it("skips dedup for price events", () => {
      const event = makeEvent({ type: "price", symbol: "BTC", headline: undefined });
      const recent = [makeEvent({ type: "price", symbol: "BTC", headline: undefined })];
      const result = filterEvent(event, recent);
      expect(result.passed).toBe(true);
    });
  });

  describe("source reputation check", () => {
    it("passes trusted sources", () => {
      expect(filterEvent(makeEvent({ source: "bloomberg" }), []).passed).toBe(true);
      expect(filterEvent(makeEvent({ source: "reuters" }), []).passed).toBe(true);
      expect(filterEvent(makeEvent({ source: "binance" }), []).passed).toBe(true);
    });

    it("filters low-reputation sources", () => {
      const result = filterEvent(makeEvent({ source: "random_blog" }), []);
      expect(result.passed).toBe(false);
      expect(result.reason).toContain("reputation");
    });
  });

  describe("rate limiting", () => {
    it("filters when too many recent events", () => {
      const recentEvents = Array.from({ length: 10 }, (_, i) =>
        makeEvent({ headline: `Unique headline number ${i}` })
      );
      const result = filterEvent(makeEvent({ headline: "Brand new headline here" }), recentEvents);
      expect(result.passed).toBe(false);
      expect(result.reason).toContain("rate limit");
    });

    it("passes within rate limit", () => {
      const recentEvents = [makeEvent({ headline: "Some other news entirely" })];
      const result = filterEvent(makeEvent({ headline: "Unique breaking news here" }), recentEvents);
      expect(result.passed).toBe(true);
    });
  });

  describe("headline length check", () => {
    it("filters news with empty headline", () => {
      const result = filterEvent(makeEvent({ headline: "" }), []);
      expect(result.passed).toBe(false);
      expect(result.reason).toContain("headline");
    });

    it("filters news with very short headline", () => {
      const result = filterEvent(makeEvent({ headline: "Hi" }), []);
      expect(result.passed).toBe(false);
    });

    it("passes price events without headline check", () => {
      const result = filterEvent(makeEvent({ type: "price", headline: undefined }), []);
      expect(result.passed).toBe(true);
    });
  });

  describe("custom config", () => {
    it("uses custom watchlist", () => {
      const cfg = { ...DEFAULT_CONFIG, watchlist: ["DOGE"] as readonly string[] };
      const result = filterEvent(makeEvent({ symbol: "DOGE" }), [], cfg);
      expect(result.passed).toBe(true);
    });
  });
});

describe("computeSimilarity", () => {
  it("returns 1.0 for identical strings", () => {
    expect(computeSimilarity("hello world", "hello world")).toBe(1);
  });

  it("returns 0 for completely different strings", () => {
    expect(computeSimilarity("alpha beta gamma", "delta epsilon zeta")).toBe(0);
  });

  it("returns partial similarity for overlapping words", () => {
    const sim = computeSimilarity("bitcoin price surges", "bitcoin price drops");
    expect(sim).toBeGreaterThan(0.3);
    expect(sim).toBeLessThan(1);
  });

  it("returns 0 for empty strings", () => {
    expect(computeSimilarity("", "")).toBe(0);
  });
});

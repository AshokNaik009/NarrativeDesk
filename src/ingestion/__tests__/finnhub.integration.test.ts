import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchCryptoNews, fetchQuote, persistEvent, persistFilterDecision } from "../finnhub.js";
import type { Event } from "../../types.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock DB client
vi.mock("../../db/client.js", () => ({
  query: vi.fn().mockResolvedValue({ rows: [{ id: "test-event-id" }] }),
}));

// Mock config
vi.mock("../../config.js", () => ({
  config: {
    finnhubApiKey: "test-finnhub-key",
    watchlist: ["BTC", "ETH", "SOL"],
  },
}));

const SAMPLE_ARTICLES = [
  {
    id: 1001,
    headline: "Bitcoin breaks $100k as institutional adoption surges",
    source: "Bloomberg",
    summary: "BTC reaches all-time high driven by ETF inflows.",
    url: "https://example.com/btc-100k",
    datetime: 1700000000,
    related: "BTC",
    category: "crypto",
  },
  {
    id: 1002,
    headline: "Ethereum upgrades improve transaction throughput",
    source: "CoinDesk",
    summary: "ETH network sees major performance gains after upgrade.",
    url: "https://example.com/eth-upgrade",
    datetime: 1700001000,
    related: "ETH",
    category: "crypto",
  },
  {
    id: 1003,
    headline: "Global markets rally on positive economic data",
    source: "Reuters",
    summary: "Stock markets surge across the board.",
    url: "https://example.com/markets-rally",
    datetime: 1700002000,
    related: "",
    category: "general",
  },
];

describe("Finnhub ingestion adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("fetchCryptoNews", () => {
    it("fetches and normalizes news articles to Event format", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => SAMPLE_ARTICLES,
      });

      const events = await fetchCryptoNews();

      expect(events).toHaveLength(3);
      expect(events[0]).toMatchObject({
        type: "news",
        source: "Bloomberg",
        symbol: "BTC",
        headline: "Bitcoin breaks $100k as institutional adoption surges",
      });
      expect(events[0]!.rawPayload).toBeDefined();
    });

    it("matches watchlist symbols from headline, summary, and related fields", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => SAMPLE_ARTICLES,
      });

      const events = await fetchCryptoNews();

      expect(events[0]!.symbol).toBe("BTC");
      expect(events[1]!.symbol).toBe("ETH");
      // Third article has no crypto symbol match
      expect(events[2]!.symbol).toBeUndefined();
    });

    it("returns empty array on API failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
      });

      const events = await fetchCryptoNews();
      expect(events).toHaveLength(0);
    });

    it("returns empty array on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

      const events = await fetchCryptoNews();
      expect(events).toHaveLength(0);
    });

    it("limits to 20 articles per fetch", async () => {
      const manyArticles = Array.from({ length: 30 }, (_, i) => ({
        ...SAMPLE_ARTICLES[0],
        id: i,
        headline: `Article ${i} about BTC`,
      }));

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => manyArticles,
      });

      const events = await fetchCryptoNews();
      expect(events.length).toBeLessThanOrEqual(20);
    });

    it("calls the correct Finnhub endpoint with API key", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await fetchCryptoNews();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("finnhub.io/api/v1/news?category=crypto&token=test-finnhub-key")
      );
    });
  });

  describe("fetchQuote", () => {
    it("fetches current price for a watchlist symbol", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ c: 98500.5, h: 99000, l: 97000, o: 97500 }),
      });

      const price = await fetchQuote("BTC");

      expect(price).toBe(98500.5);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("BINANCE:BTCUSDT")
      );
    });

    it("returns null for unsupported symbols", async () => {
      const price = await fetchQuote("DOGE");
      expect(price).toBeNull();
    });

    it("returns null on API failure", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const price = await fetchQuote("BTC");
      expect(price).toBeNull();
    });

    it("returns null on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      const price = await fetchQuote("ETH");
      expect(price).toBeNull();
    });
  });

  describe("persistEvent", () => {
    it("inserts event into events table and returns id", async () => {
      const { query } = await import("../../db/client.js");

      const event: Event = {
        type: "news",
        source: "Bloomberg",
        symbol: "BTC",
        headline: "Bitcoin surges",
        rawPayload: { test: true },
      };

      const id = await persistEvent(event);

      expect(id).toBe("test-event-id");
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO events"),
        ["news", "Bloomberg", "BTC", "Bitcoin surges", expect.any(String)]
      );
    });
  });

  describe("persistFilterDecision", () => {
    it("inserts filter decision into filter_decisions table", async () => {
      const { query } = await import("../../db/client.js");

      await persistFilterDecision("event-123", true, "passed all checks");

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO filter_decisions"),
        ["event-123", true, "passed all checks"]
      );
    });
  });
});

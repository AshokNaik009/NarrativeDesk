import { describe, it, expect, beforeEach, vi } from "vitest";
import { queryPortfolioState } from "../alpaca.js";
import type { PortfolioState } from "../../types.js";

// Mock fetch globally
global.fetch = vi.fn();

describe("queryPortfolioState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear cache by making a new module load (simplified approach)
  });

  it("should fetch account and positions from Alpaca API", async () => {
    const mockFetch = global.fetch as any;

    // Mock account endpoint
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        cash: 5000,
        equity: 15000,
      }),
    });

    // Mock positions endpoint
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          symbol: "BTCUSDT",
          qty: 0.5,
          avg_fill_price: 45000,
          side: "long",
        },
      ],
    });

    const result = await queryPortfolioState();

    expect(result.cash).toBe(5000);
    expect(result.totalValue).toBe(15000);
    expect(result.positions).toHaveLength(1);
    const pos = result.positions[0];
    expect(pos?.coin).toBe("BTC");
    expect(pos?.entryPrice).toBe(45000);
    expect(pos?.side).toBe("buy");
  });

  it("should parse multiple positions correctly", async () => {
    const mockFetch = global.fetch as any;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        cash: 5000,
        equity: 20000,
      }),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          symbol: "BTCUSDT",
          qty: 0.5,
          avg_fill_price: 45000,
          side: "long",
        },
        {
          symbol: "ETHUSDT",
          qty: 2,
          avg_fill_price: 2500,
          side: "long",
        },
      ],
    });

    const result = await queryPortfolioState();

    expect(result.positions).toHaveLength(2);
    expect(result.positions[0]?.coin).toBe("BTC");
    expect(result.positions[1]?.coin).toBe("ETH");
  });

  it("should handle short positions (sell side)", async () => {
    const mockFetch = global.fetch as any;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        cash: 5000,
        equity: 20000,
      }),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          symbol: "SOLUSDT",
          qty: -100,
          avg_fill_price: 150,
          side: "short",
        },
      ],
    });

    const result = await queryPortfolioState();

    expect(result.positions[0]?.side).toBe("sell");
  });

  it("should calculate position size percentage correctly", async () => {
    const mockFetch = global.fetch as any;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        cash: 5000,
        equity: 10000,
      }),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          symbol: "BTCUSDT",
          qty: 0.5,
          avg_fill_price: 40000,
          side: "long",
        },
      ],
    });

    const result = await queryPortfolioState();

    // Position value: 0.5 * 40000 = 20000
    // Portfolio value: 10000
    // Size pct: (20000 / 10000) * 100 = 200%
    expect(result.positions[0]?.size_pct).toBe(200);
  });

  it("should cache results for 30 seconds", async () => {
    const mockFetch = global.fetch as any;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        cash: 5000,
        equity: 15000,
      }),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    // First call
    const result1 = await queryPortfolioState();

    // Second call (should be cached)
    const result2 = await queryPortfolioState();

    expect(result1).toEqual(result2);
    // Should only call fetch twice (once for account, once for positions) on first call
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should retry on API failures with exponential backoff", async () => {
    const mockFetch = global.fetch as any;
    const startTime = Date.now();

    // First two attempts fail
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    // Third attempt succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        cash: 5000,
        equity: 15000,
      }),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    const result = await queryPortfolioState();

    const elapsed = Date.now() - startTime;

    expect(result.cash).toBe(5000);
    // Should have retried with backoff: 100ms + 200ms = ~300ms minimum
    expect(elapsed).toBeGreaterThanOrEqual(100);
  });

  it("should throw error after exhausting retries", async () => {
    const mockFetch = global.fetch as any;

    // All attempts fail
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    await expect(queryPortfolioState()).rejects.toThrow();
  });

  it("should set Authorization header with API key", async () => {
    const mockFetch = global.fetch as any;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        cash: 5000,
        equity: 15000,
      }),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    await queryPortfolioState();

    // Check that fetch was called with proper headers
    const firstCall = mockFetch.mock.calls[0];
    expect(firstCall[1].headers["APCA-API-KEY-ID"]).toBeDefined();
  });

  it("should handle empty positions", async () => {
    const mockFetch = global.fetch as any;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        cash: 10000,
        equity: 10000,
      }),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    const result = await queryPortfolioState();

    expect(result.positions).toEqual([]);
    expect(result.cash).toBe(10000);
    expect(result.totalValue).toBe(10000);
  });
});

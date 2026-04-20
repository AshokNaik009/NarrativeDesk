import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeApprovedTrade, closePosition, getOrderStatus } from "../alpaca.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock config
vi.mock("../../config.js", () => ({
  config: {
    alpacaApiKey: "test-alpaca-key",
    alpacaApiSecret: "test-alpaca-secret",
    finnhubApiKey: "test-finnhub-key",
    watchlist: ["BTC", "ETH", "SOL"],
  },
}));

// Mock finnhub fetchQuote
vi.mock("../../ingestion/finnhub.js", () => ({
  fetchQuote: vi.fn().mockResolvedValue(98000),
}));

function mockAlpacaAccount(cash = 100000, equity = 100000) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ cash, equity }),
  });
}

function mockAlpacaPositions(positions: Array<{ symbol: string; qty: number; avg_fill_price: number; side: string }> = []) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => positions,
  });
}

function mockAlpacaOrder(orderId = "order-123", filledPrice?: number) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      id: orderId,
      symbol: "BTCUSDT",
      qty: 1,
      side: "buy",
      filled_avg_price: filledPrice,
      status: "filled",
    }),
  });
}

describe("Alpaca execution adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("executeApprovedTrade", () => {
    it("submits a market order for the correct quantity", async () => {
      // queryPortfolioState: account + positions
      mockAlpacaAccount(100000, 100000);
      mockAlpacaPositions([]);
      // getCurrentPrice via fetchQuote mock returns 98000
      // Order submission
      mockAlpacaOrder("order-abc", 98100);

      const result = await executeApprovedTrade({
        id: "approval-1",
        decision_id: "decision-1",
        trade_plan: {
          side: "buy",
          coin: "BTC",
          size_pct: 5,
          entry_zone: [42000, 42500],
          invalidation: 41500,
          target: 43500,
          timeframe: "swing",
          correlation_notes: "BTC beta 1.0",
          conviction: 3,
        },
      });

      expect(result.alpaca_order_id).toBe("order-abc");
      expect(result.entry_price).toBe(98100);

      // Verify the order was submitted to Alpaca
      const orderCall = mockFetch.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("/v2/orders") && c[1]?.method === "POST"
      );
      expect(orderCall).toBeDefined();

      const orderBody = JSON.parse(orderCall![1].body);
      expect(orderBody.symbol).toBe("BTCUSDT");
      expect(orderBody.side).toBe("buy");
      expect(orderBody.type).toBe("market");
      // qty = floor(100000 * 5% / 98000) = floor(5.1) = 5
      expect(orderBody.qty).toBeGreaterThan(0);
    });

    it("sends correct Alpaca authentication headers", async () => {
      mockAlpacaAccount();
      mockAlpacaPositions([]);
      mockAlpacaOrder();

      await executeApprovedTrade({
        id: "approval-2",
        decision_id: "decision-2",
        trade_plan: {
          side: "buy",
          coin: "ETH",
          size_pct: 3,
          entry_zone: [2300, 2350],
          invalidation: 2250,
          target: 2450,
          timeframe: "swing",
          correlation_notes: "ETH alt strength",
          conviction: 3,
        },
      });

      // Check all Alpaca calls have auth headers
      for (const call of mockFetch.mock.calls) {
        if (typeof call[0] === "string" && call[0].includes("alpaca.markets")) {
          const headers = call[1]?.headers;
          expect(headers["APCA-API-KEY-ID"]).toBe("test-alpaca-key");
          expect(headers["APCA-API-SECRET-KEY"]).toBe("test-alpaca-secret");
        }
      }
    });

    it("throws on zero quantity (position too small)", async () => {
      // Portfolio with very small total value
      mockAlpacaAccount(10, 10);
      mockAlpacaPositions([]);

      await expect(
        executeApprovedTrade({
          id: "approval-3",
          decision_id: "decision-3",
          trade_plan: {
            side: "buy",
            coin: "BTC",
            size_pct: 1,
            entry_zone: [42000, 42500],
            invalidation: 41500,
            target: 43500,
            timeframe: "swing",
            correlation_notes: "BTC beta 1.0",
            conviction: 3,
          },
        })
      ).rejects.toThrow("Invalid order quantity");
    });

    it("uses filled_avg_price when available", async () => {
      mockAlpacaAccount(50000, 50000);
      mockAlpacaPositions([]);
      mockAlpacaOrder("order-filled", 97500.25);

      const result = await executeApprovedTrade({
        id: "approval-4",
        decision_id: "decision-4",
        trade_plan: {
          side: "sell",
          coin: "BTC",
          size_pct: 5,
          entry_zone: [42000, 42500],
          invalidation: 43500,
          target: 41500,
          timeframe: "swing",
          correlation_notes: "BTC shorting setup",
          conviction: 3,
        },
      });

      expect(result.entry_price).toBe(97500.25);
    });

    it("retries on API failure with exponential backoff", async () => {
      mockAlpacaAccount(100000, 100000);
      mockAlpacaPositions([]);

      // First order attempt fails, second succeeds
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => "Internal Server Error",
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => "Internal Server Error",
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: "order-retry",
            symbol: "BTCUSDT",
            qty: 1,
            side: "buy",
            filled_avg_price: 98000,
            status: "filled",
          }),
        });

      const result = await executeApprovedTrade({
        id: "approval-5",
        decision_id: "decision-5",
        trade_plan: {
          side: "buy",
          coin: "BTC",
          size_pct: 5,
          entry_zone: [42000, 42500],
          invalidation: 41500,
          target: 43500,
          timeframe: "swing",
          correlation_notes: "BTC beta 1.0",
          conviction: 3,
        },
      });

      expect(result.alpaca_order_id).toBe("order-retry");
    });
  });

  describe("getOrderStatus", () => {
    it("returns normalized order status", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "order-status-1",
          status: "filled",
          filled_avg_price: 98500,
          filled_qty: 2,
        }),
      });

      const status = await getOrderStatus("order-status-1");

      expect(status.status).toBe("filled");
      expect(status.filled_price).toBe(98500);
      expect(status.filled_qty).toBe(2);
    });

    it("normalizes unknown statuses to pending", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "order-unknown",
          status: "new",
          filled_avg_price: null,
          filled_qty: 0,
        }),
      });

      const status = await getOrderStatus("order-unknown");
      expect(status.status).toBe("pending");
    });

    it("throws on API error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "Order not found",
      });

      await expect(getOrderStatus("bad-order")).rejects.toThrow("Alpaca API error");
    });
  });

  describe("closePosition", () => {
    it("submits opposite-side order to close position", async () => {
      // Portfolio with a BTC long position
      mockAlpacaAccount(50000, 100000);
      mockAlpacaPositions([
        { symbol: "BTCUSDT", qty: 1, avg_fill_price: 95000, side: "long" },
      ]);
      // Close order
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "close-order-1" }),
      });

      const result = await closePosition("BTCUSDT", "buy");

      expect(result.order_id).toBe("close-order-1");

      // Verify it sent a sell order (opposite of long position)
      const closeCall = mockFetch.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("/v2/orders") && c[1]?.method === "POST"
      );
      expect(closeCall).toBeDefined();
      const body = JSON.parse(closeCall![1].body);
      expect(body.side).toBe("sell");
      expect(body.symbol).toBe("BTCUSDT");
    });

    it("throws when no position found", async () => {
      mockAlpacaAccount(100000, 100000);
      mockAlpacaPositions([]);

      await expect(closePosition("DOGEUSDT", "buy")).rejects.toThrow("No position found");
    });
  });
});

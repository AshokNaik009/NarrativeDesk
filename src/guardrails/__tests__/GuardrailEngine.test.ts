import { describe, it, expect } from "vitest";
import { evaluateGuardrails, DEFAULT_GUARDRAIL_CONFIG } from "../GuardrailEngine.js";
import type { PortfolioState, TradeHistoryEntry } from "../../types.js";

const emptyPortfolio: PortfolioState = {
  cash: 10000,
  totalValue: 10000,
  positions: [],
};

const now = new Date("2025-01-15T12:00:00Z");

function makeAction(overrides = {}) {
  return {
    side: "buy" as const,
    coin: "BTC",
    size_pct: 5,
    entry_zone: [42000, 42500] as [number, number],
    invalidation: 41500,
    target: 43500,
    timeframe: "swing" as const,
    correlation_notes: "BTC beta 1.0",
    conviction: 3,
    ...overrides,
  };
}

describe("evaluateGuardrails", () => {
  describe("position size limit", () => {
    it("allows trades within max position size", () => {
      const result = evaluateGuardrails(makeAction({ size_pct: 5 }), emptyPortfolio, [], now);
      expect(result.allowed).toBe(true);
    });

    it("allows trades at exactly max position size", () => {
      const result = evaluateGuardrails(makeAction({ size_pct: 10 }), emptyPortfolio, [], now);
      expect(result.allowed).toBe(true);
    });

    it("blocks trades exceeding max position size", () => {
      const result = evaluateGuardrails(makeAction({ size_pct: 15 }), emptyPortfolio, [], now);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("exceeds max");
    });
  });

  describe("concurrent positions limit", () => {
    it("allows when below max concurrent positions", () => {
      const portfolio: PortfolioState = {
        ...emptyPortfolio,
        positions: [
          { coin: "BTC", side: "buy", size_pct: 5, entryPrice: 60000, invalidation: "test", tradeId: "1" },
        ],
      };
      const result = evaluateGuardrails(makeAction({ coin: "ETH" }), portfolio, [], now);
      expect(result.allowed).toBe(true);
    });

    it("blocks when at max concurrent positions", () => {
      const portfolio: PortfolioState = {
        ...emptyPortfolio,
        positions: [
          { coin: "BTC", side: "buy", size_pct: 3, entryPrice: 60000, invalidation: "test", tradeId: "1" },
          { coin: "ETH", side: "buy", size_pct: 3, entryPrice: 3000, invalidation: "test", tradeId: "2" },
          { coin: "SOL", side: "buy", size_pct: 3, entryPrice: 100, invalidation: "test", tradeId: "3" },
        ],
      };
      const result = evaluateGuardrails(makeAction({ coin: "BTC" }), portfolio, [], now);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("open positions");
    });
  });

  describe("24h trade limit", () => {
    it("allows when under daily limit", () => {
      const history: TradeHistoryEntry[] = [
        { coin: "BTC", executedAt: new Date("2025-01-15T10:00:00Z") },
        { coin: "ETH", executedAt: new Date("2025-01-15T11:00:00Z") },
      ];
      const result = evaluateGuardrails(makeAction(), emptyPortfolio, history, now);
      expect(result.allowed).toBe(true);
    });

    it("blocks when at daily limit", () => {
      const history: TradeHistoryEntry[] = Array.from({ length: 5 }, (_, i) => ({
        coin: ["BTC", "ETH", "SOL", "BTC", "ETH"][i]!,
        executedAt: new Date(`2025-01-15T${8 + i}:00:00Z`),
      }));
      const result = evaluateGuardrails(makeAction(), emptyPortfolio, history, now);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("trades in 24h");
    });

    it("ignores trades older than 24h", () => {
      const history: TradeHistoryEntry[] = Array.from({ length: 5 }, (_, i) => ({
        coin: "BTC",
        executedAt: new Date("2025-01-13T10:00:00Z"), // 2 days ago
      }));
      const result = evaluateGuardrails(makeAction(), emptyPortfolio, history, now);
      expect(result.allowed).toBe(true);
    });
  });

  describe("cooldown per coin", () => {
    it("blocks same coin traded recently", () => {
      const history: TradeHistoryEntry[] = [
        { coin: "BTC", executedAt: new Date("2025-01-15T11:50:00Z") }, // 10 min ago
      ];
      const result = evaluateGuardrails(makeAction({ coin: "BTC" }), emptyPortfolio, history, now);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("cooldown");
    });

    it("allows different coin during cooldown", () => {
      const history: TradeHistoryEntry[] = [
        { coin: "BTC", executedAt: new Date("2025-01-15T11:50:00Z") },
      ];
      const result = evaluateGuardrails(makeAction({ coin: "ETH" }), emptyPortfolio, history, now);
      expect(result.allowed).toBe(true);
    });

    it("allows same coin after cooldown expires", () => {
      const history: TradeHistoryEntry[] = [
        { coin: "BTC", executedAt: new Date("2025-01-15T11:30:00Z") }, // 30 min ago, cooldown is 15m
      ];
      const result = evaluateGuardrails(makeAction({ coin: "BTC" }), emptyPortfolio, history, now);
      expect(result.allowed).toBe(true);
    });
  });

  describe("custom config", () => {
    it("uses custom max position size", () => {
      const cfg = { ...DEFAULT_GUARDRAIL_CONFIG, maxPositionPct: 3 };
      const result = evaluateGuardrails(makeAction({ size_pct: 5 }), emptyPortfolio, [], now, cfg);
      expect(result.allowed).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("passes with empty portfolio and history", () => {
      const result = evaluateGuardrails(makeAction(), emptyPortfolio, [], now);
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain("all guardrails passed");
    });

    it("handles sell side", () => {
      const result = evaluateGuardrails(makeAction({ side: "sell" }), emptyPortfolio, [], now);
      expect(result.allowed).toBe(true);
    });
  });
});

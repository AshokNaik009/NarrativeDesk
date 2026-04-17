import { describe, it, expect } from "vitest";
import { evaluateInvalidation } from "../InvalidationEvaluator.js";
import type { MarketState } from "../InvalidationEvaluator.js";

const marketState: MarketState = {
  prices: { BTC: 58000, ETH: 2800, SOL: 90 },
  timestamp: new Date("2025-01-15T12:00:00Z"),
};

describe("evaluateInvalidation", () => {
  describe("price drops below threshold", () => {
    it("triggers when price is below threshold", () => {
      const result = evaluateInvalidation("price drops below $60000", 65000, "BTC", marketState);
      expect(result.triggered).toBe(true);
      expect(result.reason).toContain("dropped below");
    });

    it("does not trigger when price is above threshold", () => {
      const result = evaluateInvalidation("price drops below $50000", 65000, "BTC", marketState);
      expect(result.triggered).toBe(false);
      expect(result.reason).toContain("still above");
    });

    it("handles 'falls below' phrasing", () => {
      const result = evaluateInvalidation("price falls below 60000", 65000, "BTC", marketState);
      expect(result.triggered).toBe(true);
    });

    it("handles 'goes below' phrasing", () => {
      const result = evaluateInvalidation("price goes below 60000", 65000, "BTC", marketState);
      expect(result.triggered).toBe(true);
    });
  });

  describe("price rises above threshold", () => {
    it("triggers when price is above threshold", () => {
      const result = evaluateInvalidation("price rises above $55000", 50000, "BTC", marketState);
      expect(result.triggered).toBe(true);
      expect(result.reason).toContain("rose above");
    });

    it("does not trigger when price is below threshold", () => {
      const result = evaluateInvalidation("price rises above $65000", 50000, "BTC", marketState);
      expect(result.triggered).toBe(false);
    });
  });

  describe("percentage-based invalidation", () => {
    it("triggers when drop exceeds threshold", () => {
      // Entry 65000, current 58000 → ~10.8% drop
      const result = evaluateInvalidation("drops more than 5%", 65000, "BTC", marketState);
      expect(result.triggered).toBe(true);
    });

    it("does not trigger when drop is below threshold", () => {
      // Entry 59000, current 58000 → ~1.7% drop
      const result = evaluateInvalidation("drops more than 5%", 59000, "BTC", marketState);
      expect(result.triggered).toBe(false);
    });
  });

  describe("compound invalidation (OR)", () => {
    it("triggers if first condition met", () => {
      const result = evaluateInvalidation(
        "price drops below $60000 or price rises above $70000",
        65000,
        "BTC",
        marketState
      );
      expect(result.triggered).toBe(true);
    });

    it("does not trigger if neither condition met", () => {
      const result = evaluateInvalidation(
        "price drops below $50000 or price rises above $70000",
        65000,
        "BTC",
        marketState
      );
      expect(result.triggered).toBe(false);
    });
  });

  describe("hard stop-loss", () => {
    it("triggers 5% hard stop-loss on unrecognized patterns", () => {
      // Entry 65000, current 58000 → ~10.8% loss
      const result = evaluateInvalidation("thesis no longer valid", 65000, "BTC", marketState);
      expect(result.triggered).toBe(true);
      expect(result.reason).toContain("hard stop-loss");
    });

    it("does not trigger hard stop-loss under 5%", () => {
      // Entry 60000, current 58000 → ~3.3% loss
      const result = evaluateInvalidation("thesis no longer valid", 60000, "BTC", marketState);
      expect(result.triggered).toBe(false);
    });
  });

  describe("missing market data", () => {
    it("returns not triggered for unknown coin", () => {
      const result = evaluateInvalidation("price drops below 100", 120, "DOGE", marketState);
      expect(result.triggered).toBe(false);
      expect(result.reason).toContain("no market data");
    });
  });
});

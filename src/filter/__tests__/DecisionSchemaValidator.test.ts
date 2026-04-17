import { describe, it, expect } from "vitest";
import { validateDecision } from "../DecisionSchemaValidator.js";

describe("validateDecision", () => {
  describe("valid inputs", () => {
    it("accepts valid ignore decision", () => {
      const result = validateDecision({
        classification: "ignore",
        reasoning: "This is old news, already priced in",
        thesis_delta: "no change",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.classification).toBe("ignore");
      }
    });

    it("accepts valid monitor decision", () => {
      const result = validateDecision({
        classification: "monitor",
        reasoning: "Interesting development, watching closely",
        thesis_delta: "ETH showing strength",
      });
      expect(result.success).toBe(true);
    });

    it("accepts valid act decision with action", () => {
      const result = validateDecision({
        classification: "act",
        reasoning: "Strong bullish signal on confirmed news",
        thesis_delta: "BTC breakout thesis confirmed",
        action: {
          side: "buy",
          coin: "BTC",
          size_pct: 5,
          invalidation: "price drops below 60000",
          time_horizon: "4h",
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.action?.side).toBe("buy");
        expect(result.data.action?.coin).toBe("BTC");
      }
    });
  });

  describe("string input parsing", () => {
    it("parses JSON string input", () => {
      const json = JSON.stringify({
        classification: "ignore",
        reasoning: "Not relevant to our watchlist",
        thesis_delta: "no change",
      });
      const result = validateDecision(json);
      expect(result.success).toBe(true);
    });

    it("strips markdown code fences", () => {
      const input = '```json\n{"classification":"ignore","reasoning":"Old news already priced in","thesis_delta":"no change"}\n```';
      const result = validateDecision(input);
      expect(result.success).toBe(true);
    });

    it("strips code fences without language tag", () => {
      const input = '```\n{"classification":"monitor","reasoning":"Watching this development closely","thesis_delta":"no change"}\n```';
      const result = validateDecision(input);
      expect(result.success).toBe(true);
    });
  });

  describe("invalid inputs", () => {
    it("rejects invalid JSON string", () => {
      const result = validateDecision("not json at all");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Failed to parse JSON");
      }
    });

    it("rejects missing required fields", () => {
      const result = validateDecision({ classification: "ignore" });
      expect(result.success).toBe(false);
    });

    it("rejects invalid classification value", () => {
      const result = validateDecision({
        classification: "unknown",
        reasoning: "Some reasoning here for validation",
        thesis_delta: "no change",
      });
      expect(result.success).toBe(false);
    });

    it("rejects reasoning shorter than 10 chars", () => {
      const result = validateDecision({
        classification: "ignore",
        reasoning: "Short",
        thesis_delta: "no change",
      });
      expect(result.success).toBe(false);
    });

    it("rejects act without action", () => {
      const result = validateDecision({
        classification: "act",
        reasoning: "Strong signal but no action provided",
        thesis_delta: "thesis changed",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("no action provided");
      }
    });

    it("rejects invalid side in action", () => {
      const result = validateDecision({
        classification: "act",
        reasoning: "Strong signal on this trade idea",
        thesis_delta: "changed",
        action: {
          side: "hold",
          coin: "BTC",
          size_pct: 5,
          invalidation: "price drops below 60k",
          time_horizon: "4h",
        },
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid time_horizon", () => {
      const result = validateDecision({
        classification: "act",
        reasoning: "Strong signal on this trade idea",
        thesis_delta: "changed",
        action: {
          side: "buy",
          coin: "BTC",
          size_pct: 5,
          invalidation: "price drops below 60k",
          time_horizon: "1w",
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("business rules", () => {
    it("strips action from non-act classification", () => {
      const result = validateDecision({
        classification: "ignore",
        reasoning: "Not relevant but LLM added action anyway",
        thesis_delta: "no change",
        action: {
          side: "buy",
          coin: "BTC",
          size_pct: 5,
          invalidation: "price drops below 60k",
          time_horizon: "4h",
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.action).toBeUndefined();
      }
    });
  });
});

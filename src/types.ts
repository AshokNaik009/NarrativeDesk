import { z } from "zod";

// Unified event record
export const EventSchema = z.object({
  type: z.enum(["news", "price"]),
  source: z.string(),
  symbol: z.string().optional(),
  headline: z.string().optional(),
  rawPayload: z.record(z.string(), z.unknown()),
});
export type Event = z.infer<typeof EventSchema>;

// TradePlan schema: structured trade with entry, invalidation, target, risk metrics
export const TradePlanSchema = z.object({
  entry_zone: z.tuple([z.number(), z.number()]).refine(
    ([low, high]) => low <= high,
    "entry_zone low must be <= high"
  ),
  invalidation: z.number().positive("invalidation must be a positive price"),
  target: z.number().positive("target must be a positive price"),
  timeframe: z.enum(["scalp", "swing", "position"]),
  size_pct: z.number().min(0.1).max(10),
  correlation_notes: z.string(),
  conviction: z.number().int().min(1).max(5),
  side: z.enum(["buy", "sell"]),
  coin: z.string(),
});
export type TradePlan = z.infer<typeof TradePlanSchema>;

// Agent decision output
export const DecisionSchema = z.object({
  classification: z.enum(["ignore", "monitor", "act"]),
  reasoning: z.string().min(10),
  thesis_delta: z.string(),
  trade_plan: TradePlanSchema.optional(),
});
export type Decision = z.infer<typeof DecisionSchema>;

// Credibility sub-agent output
export const CredibilitySchema = z.object({
  rating: z.number().int().min(1).max(5),
  reasoning: z.string(),
});
export type Credibility = z.infer<typeof CredibilitySchema>;

// Filter decision
export interface FilterDecision {
  passed: boolean;
  reason: string;
}

// Guardrail result
export interface GuardrailResult {
  allowed: boolean;
  reason: string;
}

// Approval actions
export type ApprovalAction = "approve" | "reject" | "edit" | "expire";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "edited" | "expired";

// Approval tags
export const APPROVE_TAGS = [
  "strong_thesis",
  "reasonable_take",
  "curious_experiment",
  "trusting_the_agent",
] as const;

export const REJECT_TAGS = [
  "weak_thesis",
  "already_priced_in",
  "wrong_coin",
  "wrong_timing",
  "size_too_large",
  "news_not_credible",
  "portfolio_constraint",
  "other",
] as const;

// Portfolio state
export interface PortfolioState {
  cash: number;
  totalValue: number;
  positions: Array<{
    coin: string;
    side: "buy" | "sell";
    size_pct: number;
    entryPrice: number;
    currentPrice?: number;
    invalidation: string;
    tradeId: string;
  }>;
}

// Trade history entry
export interface TradeHistoryEntry {
  coin: string;
  executedAt: Date;
}

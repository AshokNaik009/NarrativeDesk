import { GuardrailResult, PortfolioState, TradeHistoryEntry, TradePlan } from "../types.js";
import { config } from "../config.js";

interface GuardrailConfig {
  maxPositionPct: number;
  maxConcurrentPositions: number;
  maxTradesPer24h: number;
  cooldownMinutes: number;
  stopLossPct: number;
  minLiquidationDistancePct?: number; // Only for perps/leverage (Bybit)
}

const DEFAULT_GUARDRAIL_CONFIG: GuardrailConfig = {
  maxPositionPct: config.maxPositionPct,
  maxConcurrentPositions: config.maxConcurrentPositions,
  maxTradesPer24h: config.maxTradesPer24h,
  cooldownMinutes: config.cooldownMinutes,
  stopLossPct: config.stopLossPct,
  minLiquidationDistancePct: 2, // Min 2% cushion for perps
};

/**
 * Map conviction (1-5) to max leverage (1-4x)
 * conviction 1-2 → max 1x, 3 → max 2x, 4 → max 3x, 5 → max 4x
 */
function getMaxLeverageForConviction(conviction: number): number {
  return Math.ceil(conviction / 1.5);
}

/**
 * Calculate liquidation distance as a percentage
 * Entry → invalidation distance as a % of entry price
 * Liquidation ratio = (1 / leverage) * 100%
 * Distance cushion = (distance to invalidation) / (liquidation ratio) * 100%
 */
function calculateLiquidationDistancePct(
  leverage: number,
  invalidationPrice: number,
  entryPrice: number
): number {
  if (entryPrice === 0 || leverage === 0) return 0;
  const liquidationRatioPct = (1 / leverage) * 100;
  const distanceToInvalidationPct = Math.abs(invalidationPrice - entryPrice) / entryPrice * 100;
  return (distanceToInvalidationPct / liquidationRatioPct) * 100;
}

export function evaluateGuardrails(
  tradePlan: TradePlan,
  portfolio: PortfolioState,
  tradeHistory: TradeHistoryEntry[],
  now: Date = new Date(),
  cfg: GuardrailConfig = DEFAULT_GUARDRAIL_CONFIG
): GuardrailResult {
  // 1. Max position size
  if (tradePlan.size_pct > cfg.maxPositionPct) {
    return { allowed: false, reason: `size ${tradePlan.size_pct}% exceeds max ${cfg.maxPositionPct}%` };
  }

  // 2. Max concurrent positions
  if (portfolio.positions.length >= cfg.maxConcurrentPositions) {
    return {
      allowed: false,
      reason: `${portfolio.positions.length} open positions, max is ${cfg.maxConcurrentPositions}`,
    };
  }

  // 3. Max trades per 24h
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const tradesIn24h = tradeHistory.filter((t) => t.executedAt > oneDayAgo).length;
  if (tradesIn24h >= cfg.maxTradesPer24h) {
    return { allowed: false, reason: `${tradesIn24h} trades in 24h, max is ${cfg.maxTradesPer24h}` };
  }

  // 4. Cooldown per coin
  const cooldownMs = cfg.cooldownMinutes * 60 * 1000;
  const cooldownCutoff = new Date(now.getTime() - cooldownMs);
  const recentSameCoin = tradeHistory.find(
    (t) => t.coin === tradePlan.coin && t.executedAt > cooldownCutoff
  );
  if (recentSameCoin) {
    const minutesAgo = Math.round((now.getTime() - recentSameCoin.executedAt.getTime()) / 60000);
    return {
      allowed: false,
      reason: `${tradePlan.coin} traded ${minutesAgo}m ago, cooldown is ${cfg.cooldownMinutes}m`,
    };
  }

  // 5. Invalidation on wrong side of entry
  const [entryLow, entryHigh] = tradePlan.entry_zone;
  if (tradePlan.side === "buy" && tradePlan.invalidation >= entryLow) {
    return {
      allowed: false,
      reason: `buy invalidation ${tradePlan.invalidation} must be below entry zone low ${entryLow}`,
    };
  }
  if (tradePlan.side === "sell" && tradePlan.invalidation <= entryHigh) {
    return {
      allowed: false,
      reason: `sell invalidation ${tradePlan.invalidation} must be above entry zone high ${entryHigh}`,
    };
  }

  // 6. For perps venues (Bybit): liquidation distance check
  if (config.executionVenue === "bybit") {
    const maxLev = getMaxLeverageForConviction(tradePlan.conviction);
    const entryPrice = (tradePlan.entry_zone[0] + tradePlan.entry_zone[1]) / 2;
    const minLiqDistPct = cfg.minLiquidationDistancePct || 2;
    const actualLiqDistPct = calculateLiquidationDistancePct(maxLev, tradePlan.invalidation, entryPrice);

    if (actualLiqDistPct < minLiqDistPct) {
      return {
        allowed: false,
        reason: `liquidation distance ${actualLiqDistPct.toFixed(1)}% is too tight (min ${minLiqDistPct}% required) at ${maxLev}x leverage`,
      };
    }

    // 7. Max leverage guardrail
    if (maxLev > 4) {
      return {
        allowed: false,
        reason: `conviction ${tradePlan.conviction} maps to leverage ${maxLev}x, exceeds max 4x`,
      };
    }
  }

  return { allowed: true, reason: "all guardrails passed" };
}

export { DEFAULT_GUARDRAIL_CONFIG, calculateLiquidationDistancePct, getMaxLeverageForConviction };
export type { GuardrailConfig };

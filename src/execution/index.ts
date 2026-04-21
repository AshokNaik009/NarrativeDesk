/**
 * Execution venue router: conditionally routes to Alpaca (equities) or Bybit (crypto perps)
 * based on EXECUTION_VENUE env var
 */

import { config } from "../config.js";
import * as alpaca from "./alpaca.js";
import * as bybit from "./bybit.js";
import { PortfolioState, TradePlan } from "../types.js";

export type ExecutionAdapter = typeof alpaca | typeof bybit;

/**
 * Get the active execution adapter based on config
 */
function getExecutionAdapter(): ExecutionAdapter {
  if (config.executionVenue === "bybit") {
    return bybit;
  }
  return alpaca;
}

/**
 * Query portfolio state from active venue
 */
export async function queryPortfolioState(): Promise<PortfolioState> {
  const adapter = getExecutionAdapter();
  return adapter.queryPortfolioState();
}

/**
 * Execute an approved trade on active venue
 */
export async function executeApprovedTrade(approval: {
  id: string;
  decision_id: string;
  trade_plan: TradePlan;
}): Promise<any> {
  const adapter = getExecutionAdapter();
  console.log(`[Execution] Using ${config.executionVenue} venue for trade execution`);
  return adapter.executeApprovedTrade(approval);
}

/**
 * Get order status from active venue
 */
export async function getOrderStatus(
  orderId: string
): Promise<{
  status: "pending" | "partially_filled" | "filled" | "canceled" | "rejected";
  filled_price: number;
  filled_qty: number;
}> {
  const adapter = getExecutionAdapter();
  return adapter.getOrderStatus(orderId);
}

/**
 * Close position on active venue
 */
export async function closePosition(
  symbol: string,
  side: "buy" | "sell"
): Promise<{ order_id: string }> {
  const adapter = getExecutionAdapter();
  return adapter.closePosition(symbol, side);
}

// Export venue constant for telemetry
export function getActiveVenue(): string {
  return config.executionVenue;
}

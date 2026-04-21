
import { config } from "../config.js";
import { PortfolioState, TradePlan } from "../types.js";
import { fetchQuote } from "../ingestion/finnhub.js";
import crypto from "crypto";

const BYBIT_TESTNET_BASE = "https://api-testnet.bybit.com";
const CACHE_TTL = 30_000; // 30 seconds

interface PriceCache {
  [coin: string]: { price: number; timestamp: number };
}

let priceCache: PriceCache = {};

/**
 * Generate Bybit API signature for authentication
 */
function generateBybitSignature(
  secret: string,
  timestamp: string,
  recvWindow: string,
  queryString: string
): string {
  const param = `${timestamp}${config.bybitTestnetKey}${recvWindow}${queryString}`;
  return crypto.createHmac("sha256", secret).update(param).digest("hex");
}

/**
 * Make authenticated request to Bybit API
 */
async function bybitFetch<T>(
  endpoint: string,
  method: "GET" | "POST" = "GET",
  body?: Record<string, unknown>
): Promise<T> {
  if (!config.bybitTestnetKey || !config.bybitTestnetSecret) {
    throw new Error("BYBIT_TESTNET_KEY or BYBIT_TESTNET_SECRET not set");
  }

  const timestamp = Date.now().toString();
  const recvWindow = "5000";
  let queryString = "";

  if (method === "GET" && body) {
    queryString = new URLSearchParams(body as Record<string, string>).toString();
  }

  const signature = generateBybitSignature(
    config.bybitTestnetSecret,
    timestamp,
    recvWindow,
    queryString
  );

  const headers: Record<string, string> = {
    "X-BAPI-KEY": config.bybitTestnetKey,
    "X-BAPI-TIMESTAMP": timestamp,
    "X-BAPI-RECV-WINDOW": recvWindow,
    "X-BAPI-SIGN": signature,
    "Content-Type": "application/json",
  };

  let url = `${BYBIT_TESTNET_BASE}${endpoint}`;
  const options: RequestInit = { method, headers };

  if (method === "GET" && queryString) {
    url += `?${queryString}`;
  } else if (method === "POST") {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Bybit API error: ${response.status} ${errorText}`);
  }

  const result = await response.json() as any;
  if (result.retCode !== 0) {
    throw new Error(`Bybit API error: ${result.retMsg}`);
  }

  return result.result as T;
}

/**
 * Retry helper with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  attempts: number = 3,
  baseDelayMs: number = 100
): Promise<T> {
  let lastError: Error | null = null;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      const backoffMs = Math.pow(2, i) * baseDelayMs;
      console.warn(
        `[Bybit] Attempt ${i + 1}/${attempts} failed, retrying in ${backoffMs}ms:`,
        (err as Error).message
      );
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  throw lastError || new Error("Retry exhausted");
}

/**
 * Fetch current price for a coin from cache, Finnhub, or fallback
 */
async function getCurrentPrice(coin: string): Promise<number> {
  const now = Date.now();

  // Check in-memory cache
  if (priceCache[coin] && now - priceCache[coin].timestamp < CACHE_TTL) {
    console.log(`[Bybit] Using cached price for ${coin}: ${priceCache[coin].price}`);
    return priceCache[coin].price;
  }

  // Try Finnhub quote
  try {
    const price = await fetchQuote(coin);
    if (price !== null) {
      priceCache[coin] = { price, timestamp: now };
      console.log(`[Bybit] Fetched price for ${coin} from Finnhub: ${price}`);
      return price;
    }
  } catch (err) {
    console.warn(`[Bybit] Failed to fetch price from Finnhub for ${coin}:`, (err as Error).message);
  }

  // Fallback: use cached value or default estimate
  if (priceCache[coin]) {
    console.log(`[Bybit] Using stale cached price for ${coin}: ${priceCache[coin].price}`);
    return priceCache[coin].price;
  }

  // Hardcoded fallback estimates
  const fallbackPrices: Record<string, number> = {
    BTC: 45000,
    ETH: 2500,
    SOL: 140,
  };

  const fallback = fallbackPrices[coin.toUpperCase()] || 100;
  console.warn(`[Bybit] Using fallback price estimate for ${coin}: ${fallback}`);
  return fallback;
}

/**
 * Calculate position size in contracts
 */
function calculatePositionSize(sizePct: number, totalValue: number): number {
  const positionValue = (totalValue * sizePct) / 100;
  // For testnet, assume 1 contract = $100 notional at 1x leverage
  return Math.max(1, Math.floor(positionValue / 100));
}

/**
 * Map conviction (1-5) to leverage (1-4x)
 * Higher conviction = more leverage, but capped and guardrailed
 */
function calculateLeverage(conviction: number): number {
  // conviction 1-2 → 1x, 3 → 2x, 4 → 3x, 5 → 4x
  return Math.ceil(conviction / 1.5);
}

/**
 * Calculate liquidation distance as a fraction
 * E.g., 0.05 = 5% cushion between entry and liquidation
 */
function calculateLiquidationDistance(
  leverage: number,
  invalidationPrice: number,
  entryPrice: number
): number {
  if (entryPrice === 0) return 0;
  // Liquidation occurs at (1 / leverage) * 100% loss
  const liquidationLossRatio = 1 / leverage;
  // Distance is the ratio of invalidation to allowed loss
  const distanceToInvalidation = Math.abs(invalidationPrice - entryPrice) / entryPrice;
  return distanceToInvalidation / liquidationLossRatio;
}

/**
 * Query Bybit account balance and positions (testnet)
 */
export async function queryPortfolioState(): Promise<PortfolioState> {
  try {
    const accountInfo = await retryWithBackoff(async () =>
      bybitFetch<{
        list: Array<{
          coin: string;
          walletBalance: string;
          equity: string;
        }>;
      }>("/v5/account/wallet-balance")
    );

    // Get all positions
    const positionsData = await retryWithBackoff(async () =>
      bybitFetch<{
        list: Array<{
          symbol: string;
          size: string;
          side: "Buy" | "Sell";
          entryPrice: string;
          leverage: string;
          positionIdx: number; // 0 = one-way mode
        }>;
      }>("/v5/position/list", "GET", { category: "linear" })
    );

    let totalValue = 0;
    let cash = 0;

    // Sum wallet balance (USDT assumed)
    for (const bal of accountInfo.list) {
      if (bal.coin === "USDT") {
        cash = parseFloat(bal.walletBalance);
        totalValue = parseFloat(bal.equity);
      }
    }

    const positions = positionsData.list
      .filter((pos) => parseFloat(pos.size) > 0)
      .map((pos) => {
        const coin = pos.symbol.replace("USDT", "").toUpperCase();
        const size = parseFloat(pos.size);
        const entryPrice = parseFloat(pos.entryPrice);
        const positionValue = size * entryPrice;
        const sizePct = totalValue > 0 ? (positionValue / totalValue) * 100 : 0;

        return {
          coin,
          side: pos.side === "Buy" ? ("buy" as const) : ("sell" as const),
          size_pct: sizePct,
          entryPrice,
          invalidation: "",
          tradeId: "",
        };
      });

    return { cash, totalValue, positions };
  } catch (err) {
    console.error("[Bybit] Failed to query portfolio state:", err);
    throw err;
  }
}

/**
 * Execute an approved trade on Bybit testnet (with leverage and perp mechanics)
 */
export async function executeApprovedTrade(approval: {
  id: string;
  decision_id: string;
  trade_plan: TradePlan;
}): Promise<{ bybit_order_id: string; entry_price: number; leverage: number }> {
  try {
    const portfolio = await queryPortfolioState();
    const currentPrice = await getCurrentPrice(approval.trade_plan.coin);
    const leverage = calculateLeverage(approval.trade_plan.conviction);

    // Validate liquidation distance
    const liqDist = calculateLiquidationDistance(
      leverage,
      approval.trade_plan.invalidation,
      currentPrice
    );
    if (liqDist < 0.02) {
      throw new Error(
        `Liquidation distance ${(liqDist * 100).toFixed(1)}% is too tight (min 2% required)`
      );
    }

    const size = calculatePositionSize(approval.trade_plan.size_pct, portfolio.totalValue);
    const symbol = `${approval.trade_plan.coin.toUpperCase()}USDT`;

    console.log(
      `[Bybit] Executing perp trade (approval_id: ${approval.id}): ${approval.trade_plan.side.toUpperCase()} ${size} contracts ${symbol} @ ${leverage}x leverage`
    );

    // Place order on Bybit
    const order = await retryWithBackoff(async () =>
      bybitFetch<{
        orderId: string;
        symbol: string;
        side: string;
        price: string;
        orderStatus: string;
      }>("/v5/order/create", "POST", {
        category: "linear",
        symbol,
        side: approval.trade_plan.side === "buy" ? "Buy" : "Sell",
        orderType: "Market",
        qty: size.toString(),
        leverage: leverage.toString(),
      })
    );

    console.log(
      `[Bybit] Trade executed: ${size} ${symbol} @ ${leverage}x (Order ID: ${order.orderId})`
    );

    return {
      bybit_order_id: order.orderId,
      entry_price: currentPrice,
      leverage,
    };
  } catch (err) {
    const errorMsg = (err as Error).message;
    console.error(
      `[Bybit] Trade execution failed for approval ${approval.id}: ${errorMsg}`
    );
    throw err;
  }
}

/**
 * Get order status from Bybit
 */
export async function getOrderStatus(
  orderId: string
): Promise<{
  status: "pending" | "partially_filled" | "filled" | "canceled" | "rejected";
  filled_price: number;
  filled_qty: number;
}> {
  try {
    const order = await bybitFetch<{
      orderId: string;
      orderStatus: string;
      avgPrice: string;
      cumExecQty: string;
    }>("/v5/order/realtime", "GET", { orderId });

    const statusMap: Record<string, "pending" | "partially_filled" | "filled" | "canceled" | "rejected"> = {
      "Created": "pending",
      "New": "pending",
      "PartiallyFilled": "partially_filled",
      "Filled": "filled",
      "Cancelled": "canceled",
      "Rejected": "rejected",
    };

    const status = statusMap[order.orderStatus] || "pending";

    console.log(`[Bybit] Order ${orderId} status: ${status}, filled: ${order.cumExecQty}`);

    return {
      status,
      filled_price: parseFloat(order.avgPrice) || 0,
      filled_qty: parseFloat(order.cumExecQty) || 0,
    };
  } catch (err) {
    console.error(`[Bybit] Failed to get order status for ${orderId}:`, (err as Error).message);
    throw err;
  }
}

/**
 * Close a position on Bybit
 */
export async function closePosition(
  symbol: string,
  side: "buy" | "sell"
): Promise<{ order_id: string }> {
  try {
    const portfolio = await queryPortfolioState();
    const coinSymbol = symbol.replace("USDT", "").toUpperCase();
    const position = portfolio.positions.find((p) => p.coin === coinSymbol);

    if (!position) {
      throw new Error(`No position found for ${symbol}`);
    }

    const symbolUsdt = `${coinSymbol}USDT`;
    const closeSide = position.side === "buy" ? "Sell" : "Buy";
    const size = calculatePositionSize(position.size_pct, portfolio.totalValue);

    console.log(
      `[Bybit] Closing ${position.side} position: ${size} contracts ${symbolUsdt}`
    );

    const order = await retryWithBackoff(async () =>
      bybitFetch<{ orderId: string }>("/v5/order/create", "POST", {
        category: "linear",
        symbol: symbolUsdt,
        side: closeSide,
        orderType: "Market",
        qty: size.toString(),
        reduceOnly: true,
      })
    );

    console.log(`[Bybit] Position closed: ${size} ${symbolUsdt} (Order ID: ${order.orderId})`);
    return { order_id: order.orderId };
  } catch (err) {
    console.error(`[Bybit] Failed to close position ${symbol}:`, (err as Error).message);
    throw err;
  }
}

export { calculateLiquidationDistance, calculateLeverage };

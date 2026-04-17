import { config } from "../config.js";
import { PortfolioState } from "../types.js";
import { fetchQuote } from "../ingestion/finnhub.js";

const ALPACA_BASE = "https://paper-api.alpaca.markets";
const CACHE_TTL = 30_000; // 30 seconds

interface CachedPortfolio {
  data: PortfolioState;
  timestamp: number;
}

interface PriceCache {
  [coin: string]: { price: number; timestamp: number };
}

let cachedPortfolio: CachedPortfolio | null = null;
let priceCache: PriceCache = {};

async function alpacaFetch<T>(
  endpoint: string,
  method: "GET" | "POST" = "GET",
  body?: unknown
): Promise<T> {
  const headers = {
    "APCA-API-KEY-ID": config.alpacaApiKey,
    "APCA-API-SECRET-KEY": config.alpacaApiSecret,
    "Content-Type": "application/json",
  };

  const options: RequestInit = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${ALPACA_BASE}${endpoint}`, options);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Alpaca API error: ${response.status} ${errorText}`);
  }

  return response.json();
}

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
      const backoffMs = Math.pow(2, i) * baseDelayMs; // 100ms, 200ms, 400ms
      console.warn(
        `[Alpaca] Attempt ${i + 1}/${attempts} failed, retrying in ${backoffMs}ms:`,
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
 * Fetch current price for a coin from cache, Finnhub, or return fallback
 */
async function getCurrentPrice(coin: string): Promise<number> {
  const now = Date.now();

  // Check in-memory cache
  if (priceCache[coin] && now - priceCache[coin].timestamp < CACHE_TTL) {
    console.log(`[Alpaca] Using cached price for ${coin}: ${priceCache[coin].price}`);
    return priceCache[coin].price;
  }

  // Try Finnhub quote
  try {
    const price = await fetchQuote(coin);
    if (price !== null) {
      priceCache[coin] = { price, timestamp: now };
      console.log(`[Alpaca] Fetched price for ${coin} from Finnhub: ${price}`);
      return price;
    }
  } catch (err) {
    console.warn(`[Alpaca] Failed to fetch price from Finnhub for ${coin}:`, (err as Error).message);
  }

  // Fallback: use cached value or default estimate
  if (priceCache[coin]) {
    console.log(`[Alpaca] Using stale cached price for ${coin}: ${priceCache[coin].price}`);
    return priceCache[coin].price;
  }

  // Hardcoded fallback estimates
  const fallbackPrices: Record<string, number> = {
    BTC: 45000,
    ETH: 2500,
    SOL: 140,
  };

  const fallback = fallbackPrices[coin.toUpperCase()] || 100;
  console.warn(`[Alpaca] Using fallback price estimate for ${coin}: ${fallback}`);
  return fallback;
}

export async function queryPortfolioState(): Promise<PortfolioState> {
  // Check cache
  if (cachedPortfolio && Date.now() - cachedPortfolio.timestamp < CACHE_TTL) {
    return cachedPortfolio.data;
  }

  const portfolio = await retryWithBackoff(async () => {
    const account = await alpacaFetch<{
      cash: number;
      equity: number;
    }>("/v2/account");

    const positions = await alpacaFetch<
      Array<{
        symbol: string;
        qty: number;
        avg_fill_price: number;
        side: "long" | "short";
      }>
    >("/v2/positions");

    const totalValue = parseFloat(account.equity.toString());

    return {
      cash: parseFloat(account.cash.toString()),
      totalValue,
      positions: positions.map((pos) => {
        const coin = pos.symbol.replace("USDT", "").toUpperCase();
        const positionValue = Math.abs(pos.qty) * pos.avg_fill_price;
        const sizePct = (positionValue / totalValue) * 100;

        return {
          coin,
          side: pos.side === "long" ? ("buy" as const) : ("sell" as const),
          size_pct: sizePct,
          entryPrice: pos.avg_fill_price,
          invalidation: "", // Will be filled from executed_trades
          tradeId: "", // Will be filled from executed_trades
        };
      }),
    };
  });

  cachedPortfolio = { data: portfolio, timestamp: Date.now() };
  return portfolio;
}

export async function executeApprovedTrade(approval: {
  id: string;
  decision_id: string;
  action: { side: "buy" | "sell"; coin: string; size_pct: number };
}): Promise<{ alpaca_order_id: string; entry_price: number }> {
  try {
    const portfolio = await queryPortfolioState();

    // Get current price for the coin
    const currentPrice = await getCurrentPrice(approval.action.coin);

    // Calculate order quantity: (portfolio.totalValue * size_pct / 100) / current_price
    const positionValue = (portfolio.totalValue * approval.action.size_pct) / 100;
    const qty = Math.floor(positionValue / currentPrice);

    if (qty <= 0) {
      throw new Error(
        `Invalid order quantity: ${qty} for position value ${positionValue} at price ${currentPrice}`
      );
    }

    const symbol = `${approval.action.coin.toUpperCase()}USDT`;

    console.log(
      `[Alpaca] Executing trade (approval_id: ${approval.id}): ${approval.action.side.toUpperCase()} ${qty} ${symbol} at estimated ${currentPrice}`
    );

    const order = await retryWithBackoff(async () =>
      alpacaFetch<{
        id: string;
        symbol: string;
        qty: number;
        side: string;
        filled_avg_price?: number;
        status: string;
      }>("/v2/orders", "POST", {
        symbol,
        qty,
        side: approval.action.side,
        type: "market",
        time_in_force: "day",
      })
    );

    const entryPrice = order.filled_avg_price
      ? parseFloat(order.filled_avg_price.toString())
      : currentPrice;

    console.log(
      `[Alpaca] Trade executed successfully: ${qty} ${symbol} at ${entryPrice} (Order ID: ${order.id})`
    );

    // Clear portfolio cache since it changed
    cachedPortfolio = null;

    return {
      alpaca_order_id: order.id,
      entry_price: entryPrice,
    };
  } catch (err) {
    const errorMsg = (err as Error).message;
    console.error(
      `[Alpaca] Trade execution failed for approval ${approval.id}: ${errorMsg}`
    );
    throw err;
  }
}

export async function getOrderStatus(
  orderId: string
): Promise<{
  status: "pending" | "partially_filled" | "filled" | "canceled" | "rejected";
  filled_price: number;
  filled_qty: number;
}> {
  try {
    const order = await alpacaFetch<{
      id: string;
      status: string;
      filled_avg_price?: number;
      filled_qty: number;
    }>(`/v2/orders/${orderId}`);

    const status = order.status.toLowerCase() as any;
    const validStatuses = ["pending", "partially_filled", "filled", "canceled", "rejected"];
    const normalizedStatus = validStatuses.includes(status) ? status : "pending";

    console.log(`[Alpaca] Order ${orderId} status: ${normalizedStatus}, filled: ${order.filled_qty}`);

    return {
      status: normalizedStatus,
      filled_price: order.filled_avg_price ? parseFloat(order.filled_avg_price.toString()) : 0,
      filled_qty: order.filled_qty,
    };
  } catch (err) {
    console.error(`[Alpaca] Failed to get order status for ${orderId}:`, (err as Error).message);
    throw err;
  }
}

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

    // Calculate actual quantity to close: position value / current price
    const currentPrice = await getCurrentPrice(coinSymbol);
    const positionValue = (portfolio.totalValue * position.size_pct) / 100;
    const qty = Math.floor(positionValue / currentPrice);

    if (qty <= 0) {
      throw new Error(
        `Cannot close position: calculated quantity ${qty} is invalid for position value ${positionValue}`
      );
    }

    const symbolUsdt = `${coinSymbol}USDT`;
    // Opposite side: buy position → sell to close, sell position → buy to cover
    const closeSide = position.side === "buy" ? "sell" : "buy";

    console.log(
      `[Alpaca] Closing ${position.side} position: ${qty} ${symbolUsdt} with opposite ${closeSide} order`
    );

    const order = await retryWithBackoff(async () =>
      alpacaFetch<{ id: string }>("/v2/orders", "POST", {
        symbol: symbolUsdt,
        qty,
        side: closeSide,
        type: "market",
        time_in_force: "day",
      })
    );

    console.log(`[Alpaca] Position closed successfully: ${qty} ${symbolUsdt} (Order ID: ${order.id})`);

    // Clear portfolio cache
    cachedPortfolio = null;

    return { order_id: order.id };
  } catch (err) {
    console.error(`[Alpaca] Failed to close position ${symbol}:`, (err as Error).message);
    throw err;
  }
}

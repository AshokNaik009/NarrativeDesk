import WebSocket from "ws";
import { Event } from "../types.js";

const SYMBOL_MAP: Record<string, string> = {
  BTCUSDT: "BTC",
  ETHUSDT: "ETH",
  SOLUSDT: "SOL",
};

interface BinanceLiquidation {
  o: {
    s: string; // symbol
    p: string; // price
    q: string; // quantity
    O: number; // order time
    X: string; // order status
    m: boolean; // maker
  };
  T: number; // transaction time
}

// 5-minute sliding window for liquidation volume tracking
interface LiquidationBuffer {
  symbol: string;
  volumeUsd: number;
  events: BinanceLiquidation[];
}

const buffers: Map<string, LiquidationBuffer> = new Map();
const LIQUIDATION_THRESHOLD_USD = 10_000_000; // $10M cascade threshold
const WINDOW_SIZE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Process a liquidation event and check if cascade threshold is met.
 * Returns a LiquidationCascadeEvent if threshold exceeded in 5-min window.
 */
function processLiquidationEvent(liquidation: BinanceLiquidation): Event | null {
  const symbol = liquidation.o.s;
  const cleanSymbol = SYMBOL_MAP[symbol] || symbol.replace("USDT", "");
  const price = parseFloat(liquidation.o.p);
  const quantity = parseFloat(liquidation.o.q);
  const volumeUsd = price * quantity;
  const timestamp = liquidation.T;

  // Get or create buffer for this symbol
  if (!buffers.has(symbol)) {
    buffers.set(symbol, {
      symbol,
      volumeUsd: 0,
      events: [],
    });
  }

  const buffer = buffers.get(symbol)!;

  // Prune old events outside 5-minute window
  const cutoff = timestamp - WINDOW_SIZE_MS;
  buffer.events = buffer.events.filter((e) => e.T > cutoff);

  // Recalculate volume from remaining events
  buffer.volumeUsd = buffer.events.reduce((sum, e) => {
    return sum + parseFloat(e.o.p) * parseFloat(e.o.q);
  }, 0);

  // Add new event
  buffer.events.push(liquidation);
  buffer.volumeUsd += volumeUsd;

  // Check cascade threshold
  if (buffer.volumeUsd >= LIQUIDATION_THRESHOLD_USD) {
    // Calculate price range from buffered events
    const prices = buffer.events.map((e) => parseFloat(e.o.p));
    const priceHigh = Math.max(...prices);
    const priceLow = Math.min(...prices);

    const event: Event = {
      type: "LiquidationCascade",
      source: "Binance",
      symbol: cleanSymbol,
      headline: undefined,
      rawPayload: {
        symbol,
        liquidationPriceLow: priceLow,
        liquidationPriceHigh: priceHigh,
        liquidationVolumeUsd: buffer.volumeUsd,
        cascade: true,
        eventCount: buffer.events.length,
        timestamp: new Date(),
      },
    };

    console.log(
      `[Liquidations] CASCADE SIGNAL: ${cleanSymbol} $${(buffer.volumeUsd / 1e6).toFixed(2)}M in 5min`
    );

    // Reset buffer after emitting cascade signal
    buffer.volumeUsd = 0;
    buffer.events = [];

    return event;
  }

  return null;
}

type LiquidationCallback = (event: Event) => void;

/**
 * Start WebSocket listener for Binance liquidation stream.
 * Emits LiquidationCascadeEvent when $10M threshold is exceeded in a 5-minute window.
 */
export function startLiquidationWatcher(onCascade: LiquidationCallback): WebSocket {
  const wsUrl = `wss://stream.binance.com:9443/ws/!forceOrder@arr`;

  const ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    console.log("[Liquidations WS] Connected to Binance liquidation stream");
  });

  ws.on("message", (data) => {
    try {
      const liquidations = JSON.parse(data.toString()) as BinanceLiquidation[];

      if (!Array.isArray(liquidations)) {
        return;
      }

      for (const liquidation of liquidations) {
        const cascadeEvent = processLiquidationEvent(liquidation);
        if (cascadeEvent) {
          onCascade(cascadeEvent);
        }
      }
    } catch (err) {
      console.error("[Liquidations WS] Parse error:", err);
    }
  });

  ws.on("error", (err) => {
    console.error("[Liquidations WS] Error:", err.message);
  });

  ws.on("close", () => {
    console.log("[Liquidations WS] Disconnected, reconnecting in 5s...");
    setTimeout(() => startLiquidationWatcher(onCascade), 5000);
  });

  return ws;
}

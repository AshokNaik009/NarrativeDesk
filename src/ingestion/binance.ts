import WebSocket from "ws";
import { config } from "../config.js";
import { Event } from "../types.js";

type PriceCallback = (event: Event) => void;

const SYMBOL_MAP: Record<string, string> = {
  btcusdt: "BTC",
  ethusdt: "ETH",
  solusdt: "SOL",
};

export function startBinanceWs(onPrice: PriceCallback): WebSocket {
  const streams = config.binanceSymbols.map((s) => `${s}@ticker`).join("/");
  const wsUrl = `wss://stream.binance.com:9443/ws/${streams}`;

  const ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    console.log("[Binance WS] Connected");
  });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      const symbol = SYMBOL_MAP[msg.s?.toLowerCase()] || msg.s;

      const event: Event = {
        type: "price",
        source: "binance",
        symbol,
        headline: undefined,
        rawPayload: {
          symbol: msg.s,
          price: parseFloat(msg.c), // current price
          volume: parseFloat(msg.v),
          priceChange: parseFloat(msg.p),
          priceChangePct: parseFloat(msg.P),
          high: parseFloat(msg.h),
          low: parseFloat(msg.l),
          timestamp: msg.E,
        },
      };

      onPrice(event);
    } catch (err) {
      console.error("[Binance WS] Parse error:", err);
    }
  });

  ws.on("error", (err) => {
    console.error("[Binance WS] Error:", err.message);
  });

  ws.on("close", () => {
    console.log("[Binance WS] Disconnected, reconnecting in 5s...");
    setTimeout(() => startBinanceWs(onPrice), 5000);
  });

  return ws;
}

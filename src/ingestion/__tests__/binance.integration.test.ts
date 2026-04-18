import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock ws module
const mockWsOn = vi.fn();
const mockWsConstructor = vi.fn().mockImplementation(() => ({
  on: mockWsOn,
}));

vi.mock("ws", () => ({
  default: mockWsConstructor,
}));

vi.mock("../../config.js", () => ({
  config: {
    binanceSymbols: ["btcusdt", "ethusdt", "solusdt"],
  },
}));

import { startBinanceWs } from "../binance.js";

describe("Binance WebSocket adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("connects to the correct Binance stream URL", () => {
    const callback = vi.fn();
    startBinanceWs(callback);

    expect(mockWsConstructor).toHaveBeenCalledWith(
      expect.stringContaining("wss://stream.binance.com:9443/ws/")
    );

    const url = mockWsConstructor.mock.calls[0]![0] as string;
    expect(url).toContain("btcusdt@ticker");
    expect(url).toContain("ethusdt@ticker");
    expect(url).toContain("solusdt@ticker");
  });

  it("registers open, message, error, and close handlers", () => {
    const callback = vi.fn();
    startBinanceWs(callback);

    const registeredEvents = mockWsOn.mock.calls.map((c: unknown[]) => c[0]);
    expect(registeredEvents).toContain("open");
    expect(registeredEvents).toContain("message");
    expect(registeredEvents).toContain("error");
    expect(registeredEvents).toContain("close");
  });

  it("normalizes Binance ticker data into Event format on message", () => {
    const callback = vi.fn();
    startBinanceWs(callback);

    // Find the message handler
    const messageCall = mockWsOn.mock.calls.find((c: unknown[]) => c[0] === "message");
    const messageHandler = messageCall![1] as (data: Buffer) => void;

    const tickerData = JSON.stringify({
      s: "BTCUSDT",
      c: "98500.00",
      v: "12345.67",
      p: "1500.00",
      P: "1.55",
      h: "99000.00",
      l: "97000.00",
      E: 1700000000000,
    });

    messageHandler(Buffer.from(tickerData));

    expect(callback).toHaveBeenCalledTimes(1);
    const event = callback.mock.calls[0]![0];
    expect(event.type).toBe("price");
    expect(event.source).toBe("binance");
    expect(event.symbol).toBe("BTC");
    expect(event.rawPayload.price).toBe(98500.0);
    expect(event.rawPayload.volume).toBe(12345.67);
    expect(event.rawPayload.priceChangePct).toBe(1.55);
  });

  it("maps BTCUSDT to BTC, ETHUSDT to ETH, SOLUSDT to SOL", () => {
    const callback = vi.fn();
    startBinanceWs(callback);

    const messageCall = mockWsOn.mock.calls.find((c: unknown[]) => c[0] === "message");
    const messageHandler = messageCall![1] as (data: Buffer) => void;

    const symbols = [
      { input: "BTCUSDT", expected: "BTC" },
      { input: "ETHUSDT", expected: "ETH" },
      { input: "SOLUSDT", expected: "SOL" },
    ];

    for (const { input, expected } of symbols) {
      callback.mockClear();
      messageHandler(Buffer.from(JSON.stringify({ s: input, c: "100", v: "1", p: "0", P: "0", h: "100", l: "100", E: Date.now() })));
      expect(callback.mock.calls[0]![0].symbol).toBe(expected);
    }
  });

  it("does not crash on malformed messages", () => {
    const callback = vi.fn();
    startBinanceWs(callback);

    const messageCall = mockWsOn.mock.calls.find((c: unknown[]) => c[0] === "message");
    const messageHandler = messageCall![1] as (data: Buffer) => void;

    // Should not throw
    expect(() => messageHandler(Buffer.from("not json"))).not.toThrow();
    expect(callback).not.toHaveBeenCalled();
  });

  it("attempts reconnect on close after 5 seconds", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    startBinanceWs(callback);

    const closeCall = mockWsOn.mock.calls.find((c: unknown[]) => c[0] === "close");
    const closeHandler = closeCall![1] as () => void;

    mockWsConstructor.mockClear();
    closeHandler();

    // Before timer fires, no reconnect
    expect(mockWsConstructor).not.toHaveBeenCalled();

    // After 5 seconds, reconnect
    vi.advanceTimersByTime(5000);
    expect(mockWsConstructor).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});

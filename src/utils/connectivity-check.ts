import { config } from "../config.js";
import Groq from "groq-sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import pg from "pg";
import WebSocket from "ws";

interface CheckResult {
  service: string;
  status: "OK" | "FAIL";
  latencyMs: number;
  error?: string;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

async function checkGroq(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const groq = new Groq({ apiKey: config.groqApiKey });
    await withTimeout(
      groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: "Say OK" }],
        max_tokens: 3,
      }),
      10000
    );
    return { service: "Groq (llama-3.3-70b)", status: "OK", latencyMs: Date.now() - start };
  } catch (err: any) {
    return { service: "Groq (llama-3.3-70b)", status: "FAIL", latencyMs: Date.now() - start, error: err.message?.slice(0, 100) };
  }
}

async function checkGemini(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const genai = new GoogleGenerativeAI(config.googleApiKey);
    const model = genai.getGenerativeModel({ model: "gemini-flash-latest" });
    await withTimeout(
      model.generateContent({ contents: [{ role: "user", parts: [{ text: "Say OK" }] }] }),
      10000
    );
    return { service: "Gemini (flash-latest)", status: "OK", latencyMs: Date.now() - start };
  } catch (err: any) {
    return { service: "Gemini (flash-latest)", status: "FAIL", latencyMs: Date.now() - start, error: err.message?.slice(0, 100) };
  }
}

async function checkOpenRouter(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const res = await withTimeout(
      fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.openRouterApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "meta-llama/llama-3.3-70b-instruct",
          messages: [{ role: "user", content: "Say OK" }],
          max_tokens: 3,
        }),
      }),
      10000
    );
    if (!res.ok) {
      const body = await res.text();
      return { service: "OpenRouter", status: "FAIL", latencyMs: Date.now() - start, error: `HTTP ${res.status}: ${body.slice(0, 80)}` };
    }
    await res.json();
    return { service: "OpenRouter", status: "OK", latencyMs: Date.now() - start };
  } catch (err: any) {
    return { service: "OpenRouter", status: "FAIL", latencyMs: Date.now() - start, error: err.message?.slice(0, 100) };
  }
}

async function checkFinnhub(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const url = `https://finnhub.io/api/v1/news?category=crypto&token=${config.finnhubApiKey}`;
    const res = await withTimeout(fetch(url), 5000);
    if (!res.ok) {
      return { service: "Finnhub", status: "FAIL", latencyMs: Date.now() - start, error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as any[];
    return { service: "Finnhub", status: "OK", latencyMs: Date.now() - start, error: `${data.length} articles` };
  } catch (err: any) {
    return { service: "Finnhub", status: "FAIL", latencyMs: Date.now() - start, error: err.message?.slice(0, 100) };
  }
}

async function checkPostgres(): Promise<CheckResult> {
  const start = Date.now();
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });
  try {
    const res = await withTimeout(pool.query("SELECT 1 AS ok"), 5000);
    return { service: "Postgres (Render)", status: res.rows[0]?.ok === 1 ? "OK" : "FAIL", latencyMs: Date.now() - start };
  } catch (err: any) {
    return { service: "Postgres (Render)", status: "FAIL", latencyMs: Date.now() - start, error: err.message?.slice(0, 100) };
  } finally {
    await pool.end();
  }
}

async function checkBinanceWs(): Promise<CheckResult> {
  const start = Date.now();
  return withTimeout(
    new Promise<CheckResult>((resolve) => {
      const ws = new WebSocket("wss://stream.binance.com:9443/ws/btcusdt@ticker");
      ws.on("message", () => {
        ws.close();
        resolve({ service: "Binance WebSocket", status: "OK", latencyMs: Date.now() - start });
      });
      ws.on("error", (err) => {
        ws.close();
        resolve({ service: "Binance WebSocket", status: "FAIL", latencyMs: Date.now() - start, error: err.message?.slice(0, 100) });
      });
    }),
    5000
  ).catch(() => ({
    service: "Binance WebSocket",
    status: "FAIL" as const,
    latencyMs: Date.now() - start,
    error: "Timeout",
  }));
}

async function checkAlpaca(): Promise<CheckResult> {
  const start = Date.now();
  if (!config.alpacaApiKey || config.alpacaApiKey === "your_alpaca_key_here") {
    return { service: "Alpaca Paper Trading", status: "FAIL", latencyMs: 0, error: "API key not configured" };
  }
  // Note: Alpaca API requires authentication; this checks endpoint availability and credentials validity
  try {
    const res = await withTimeout(
      fetch("https://paper-api.alpaca.markets/v2/account", {
        headers: {
          "APCA-API-KEY-ID": config.alpacaApiKey,
          "APCA-API-SECRET-KEY": config.alpacaApiSecret,
        },
      }),
      5000
    );
    if (!res.ok) {
      return { service: "Alpaca Paper Trading", status: "FAIL", latencyMs: Date.now() - start, error: `HTTP ${res.status}` };
    }
    return { service: "Alpaca Paper Trading", status: "OK", latencyMs: Date.now() - start };
  } catch (err: any) {
    return { service: "Alpaca Paper Trading", status: "FAIL", latencyMs: Date.now() - start, error: err.message?.slice(0, 100) };
  }
}

async function main() {
  console.log("\n🔍 NarrativeDesk Connectivity Check\n");
  console.log("Running all checks in parallel...\n");

  const results = await Promise.all([
    checkGroq(),
    checkGemini(),
    checkOpenRouter(),
    checkFinnhub(),
    checkPostgres(),
    checkBinanceWs(),
    checkAlpaca(),
  ]);

  // Print table
  const maxServiceLen = Math.max(...results.map((r) => r.service.length));
  const header = `${"Service".padEnd(maxServiceLen)}  Status  Latency   Notes`;
  const separator = "-".repeat(header.length + 20);

  console.log(header);
  console.log(separator);

  for (const r of results) {
    const statusIcon = r.status === "OK" ? "✅ OK  " : "❌ FAIL";
    const latency = `${r.latencyMs}ms`.padStart(7);
    const notes = r.error || "";
    console.log(`${r.service.padEnd(maxServiceLen)}  ${statusIcon}  ${latency}   ${notes}`);
  }

  console.log(separator);

  const passed = results.filter((r) => r.status === "OK").length;
  console.log(`\n${passed}/${results.length} services connected successfully.\n`);

  process.exit(passed === results.length ? 0 : 1);
}

main();

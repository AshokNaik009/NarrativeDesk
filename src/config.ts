import dotenv from "dotenv";
dotenv.config();

export const config = {
  // LLM
  groqApiKey: process.env.GROQ_API_KEY!,
  googleApiKey: process.env.GOOGLE_API_KEY!,
  googleApiKeySecondary: process.env.GOOGLE_API_KEY_SECONDARY,
  openRouterApiKey: process.env.OPENROUTER_API_KEY!,

  // Database
  databaseUrl: process.env.DATABASE_URL!,

  // Finnhub
  finnhubApiKey: process.env.FINHUB_API_KEY!,

  // Etherscan (optional)
  etherscanApiKey: process.env.ETHERSCAN_API_KEY || "",

  // Alpaca (equities paper trading)
  alpacaApiKey: process.env.ALPACA_API_KEY || "",
  alpacaApiSecret: process.env.ALPACA_API_SECRET || "",

  // Bybit Testnet (crypto perps with leverage, funding, liquidations)
  bybitTestnetKey: process.env.BYBIT_TESTNET_KEY || "",
  bybitTestnetSecret: process.env.BYBIT_TESTNET_SECRET || "",

  // Execution venue: "alpaca" (equities) or "bybit" (crypto perps)
  executionVenue: (process.env.EXECUTION_VENUE || "alpaca") as "alpaca" | "bybit",

  // Server
  port: parseInt(process.env.PORT || "3000"),
  nodeEnv: process.env.NODE_ENV || "development",
  dashboardSecret: process.env.DASHBOARD_SECRET || "dev-secret",

  // Watchlist
  watchlist: ["BTC", "ETH", "SOL"] as const,

  // Guardrails
  maxPositionPct: 10,
  maxConcurrentPositions: 3,
  maxTradesPer24h: 5,
  cooldownMinutes: 15,
  stopLossPct: 5,

  // HITL
  approvalTimeoutMinutes: 15,
  dashboardPollSeconds: 3,

  // Finnhub polling
  finnhubPollIntervalMs: 60_000,

  // Binance WS
  binanceSymbols: ["btcusdt", "ethusdt", "solusdt"],
};

import { parseArgs } from "util";
import { replayBacktest } from "./replay.js";
import { writeBacktestReport } from "./report.js";
import { BacktestConfig } from "./types.js";
import { initDb } from "../db/client.js";

const options = {
  from: {
    type: "string" as const,
    short: "f",
    description: "Start date (YYYY-MM-DD)",
  },
  to: {
    type: "string" as const,
    short: "t",
    description: "End date (YYYY-MM-DD)",
  },
  initial: {
    type: "string" as const,
    short: "i",
    description: "Initial cash amount (default: 10000)",
  },
  symbols: {
    type: "string" as const,
    short: "s",
    description: "Comma-separated symbols (default: BTC,ETH,SOL)",
  },
  output: {
    type: "string" as const,
    short: "o",
    description: "Output directory for report (default: ./reports)",
  },
  help: {
    type: "boolean" as const,
    short: "h",
    description: "Show help message",
  },
};

async function main() {
  const { values, positionals } = parseArgs({ options, allowPositionals: true });

  if (values.help) {
    console.log(`
Usage: npm run backtest -- [options]

Options:
  --from, -f DATE      Start date (YYYY-MM-DD) [required]
  --to, -t DATE        End date (YYYY-MM-DD) [required]
  --initial, -i NUM    Initial cash (default: 10000)
  --symbols, -s LIST   Comma-separated symbols (default: BTC,ETH,SOL)
  --output, -o DIR     Output directory (default: ./reports)
  --help, -h           Show this help message

Example:
  npm run backtest -- --from 2026-01-01 --to 2026-03-31 --initial 50000 --symbols BTC,ETH
`);
    process.exit(0);
  }

  // Validate required arguments
  if (!values.from || !values.to) {
    console.error("Error: --from and --to dates are required");
    console.error("Use --help for usage information");
    process.exit(1);
  }

  // Parse arguments
  const startDate = new Date(values.from);
  const endDate = new Date(values.to);
  const initialCash = parseFloat(values.initial || "10000");
  const symbols = values.symbols ? values.symbols.split(",") : ["BTC", "ETH", "SOL"];
  const outputDir = values.output || "./reports";

  // Validate dates
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    console.error("Error: Invalid date format. Use YYYY-MM-DD");
    process.exit(1);
  }

  if (startDate >= endDate) {
    console.error("Error: Start date must be before end date");
    process.exit(1);
  }

  // Create config
  const config: BacktestConfig = {
    startDate,
    endDate,
    initialCash,
    symbols,
  };

  console.log("\n=== NarrativeDesk Backtest Engine ===\n");
  console.log(`Date Range:     ${config.startDate.toISOString().split("T")[0]} to ${config.endDate.toISOString().split("T")[0]}`);
  console.log(`Initial Capital: $${config.initialCash.toLocaleString()}`);
  console.log(`Symbols:        ${config.symbols.join(", ")}`);
  console.log("\nInitializing database...");

  try {
    await initDb();

    console.log("Running backtest...\n");
    const startTime = Date.now();

    const result = await replayBacktest(config);

    const durationMs = Date.now() - startTime;

    console.log("\n=== Backtest Complete ===\n");
    console.log(`Total Trades:   ${result.pnl.totalTrades}`);
    console.log(`Closed Trades:  ${result.pnl.closedTrades}`);
    console.log(`Win Rate:       ${result.pnl.winRate.toFixed(1)}%`);
    console.log(`Total P&L:      ${result.pnl.totalPnlPct.toFixed(2)}% ($${result.pnl.totalPnlUsd.toFixed(2)})`);
    console.log(`Sharpe Ratio:   ${result.pnl.sharpeRatio.toFixed(2)}`);
    console.log(`Max Drawdown:   ${result.pnl.maxDrawdown.toFixed(2)}%`);
    console.log(`vs HODL:        ${result.pnl.vsHodl.pnlPct.toFixed(2)}% (${result.pnl.vsHodl.win ? "Agent Win" : "HODL Better"})`);
    console.log(`vs Random:      ${result.pnl.vsRandom.pnlPct.toFixed(2)}% (${result.pnl.vsRandom.win ? "Agent Win" : "Random Better"})`);
    console.log(`Runtime:        ${(durationMs / 1000).toFixed(1)}s`);

    // Write report
    console.log("\nWriting report...");
    const reportPath = writeBacktestReport(result, outputDir);
    console.log(`Report saved: ${reportPath}\n`);

    process.exit(0);
  } catch (err) {
    console.error("Backtest failed:", err);
    process.exit(1);
  }
}

main();

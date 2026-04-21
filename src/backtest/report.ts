import { BacktestResult } from "./types.js";
import { writeFileSync } from "fs";
import { join } from "path";

/**
 * Generate a markdown report from backtest results.
 */
export function generateBacktestReport(result: BacktestResult): string {
  const {
    config,
    trades,
    pnl,
    startedAt,
    completedAt,
  } = result;

  const closedTrades = trades.filter((t) => t.close_price !== null);
  const durationMs = completedAt.getTime() - startedAt.getTime();

  let report = `# Backtest Report

**Date Range:** ${config.startDate.toISOString().split("T")[0]} to ${config.endDate.toISOString().split("T")[0]}
**Initial Capital:** $${config.initialCash.toLocaleString()}
**Symbols Traded:** ${config.symbols.join(", ")}
**Generated:** ${completedAt.toISOString()}

## Performance Summary

| Metric | Value |
|--------|-------|
| **Total Trades** | ${pnl.totalTrades} |
| **Closed Trades** | ${pnl.closedTrades} |
| **Open Trades** | ${pnl.openTrades} |
| **Win Count** | ${pnl.winCount} |
| **Loss Count** | ${pnl.lossCount} |
| **Win Rate** | ${pnl.winRate.toFixed(1)}% |
| **Avg Win** | ${pnl.avgWin.toFixed(2)}% |
| **Avg Loss** | ${pnl.avgLoss.toFixed(2)}% |
| **Profit Factor** | ${isFinite(pnl.profitFactor) ? pnl.profitFactor.toFixed(2) : "N/A"} |
| **Total P&L** | $${pnl.totalPnlUsd.toFixed(2)} (${pnl.totalPnlPct.toFixed(2)}%) |
| **Sharpe Ratio** | ${pnl.sharpeRatio.toFixed(2)} |
| **Max Drawdown** | ${pnl.maxDrawdown.toFixed(2)}% |

## Comparative Analysis

| Strategy | Return | vs Agent |
|----------|--------|----------|
| **NarrativeDesk Agent** | ${pnl.totalPnlPct.toFixed(2)}% | — |
| **HODL (BTC)** | ${pnl.vsHodl.pnlPct.toFixed(2)}% | ${pnl.vsHodl.win ? "✓ Agent Win" : "✗ HODL Better"} |
| **Random Trades** | ${pnl.vsRandom.pnlPct.toFixed(2)}% | ${pnl.vsRandom.win ? "✓ Agent Win" : "✗ Random Better"} |

## Trade Log

${tradeLogsToMarkdown(closedTrades)}

## Analysis Notes

- **Runtime:** ${(durationMs / 1000).toFixed(1)}s
- **Trades Per Day:** ${(pnl.totalTrades / Math.ceil((config.endDate.getTime() - config.startDate.getTime()) / (24 * 60 * 60 * 1000))).toFixed(1)}
- **Risk/Reward Ratio:** ${pnl.avgWin > 0 && pnl.avgLoss > 0 ? (pnl.avgWin / pnl.avgLoss).toFixed(2) : "N/A"}

## Conclusions

${generateConclusions(pnl)}
`;

  return report;
}

function tradeLogsToMarkdown(trades: any[]): string {
  if (trades.length === 0) {
    return "No closed trades to display.";
  }

  let table = "| Coin | Side | Size | Entry | Exit | P&L | P&L % |\n";
  table += "|------|------|------|-------|------|-----|-------|\n";

  for (const trade of trades.slice(0, 50)) { // Limit to first 50 for readability
    const entry = trade.entry_price.toFixed(2);
    const exit = trade.close_price?.toFixed(2) || "N/A";
    const pnl = trade.close_price
      ? (trade.close_price - trade.entry_price).toFixed(2)
      : "N/A";
    const pnlPct = trade.close_price
      ? (((trade.close_price - trade.entry_price) / trade.entry_price) * 100).toFixed(2)
      : "N/A";

    table += `| ${trade.coin} | ${trade.side} | ${trade.size_pct}% | $${entry} | $${exit} | $${pnl} | ${pnlPct}% |\n`;
  }

  if (trades.length > 50) {
    table += `\n*... and ${trades.length - 50} more trades (see full log for details)*\n`;
  }

  return table;
}

function generateConclusions(pnl: any): string {
  const conclusions: string[] = [];

  if (pnl.winRate > 55) {
    conclusions.push("- **Strong Win Rate:** Agent achieved above-55% win rate, indicating consistent decision quality.");
  } else if (pnl.winRate < 45) {
    conclusions.push("- **Low Win Rate:** Agent win rate below 45%, suggesting strategy requires optimization.");
  }

  if (pnl.sharpeRatio > 1) {
    conclusions.push("- **Good Risk-Adjusted Returns:** Sharpe ratio > 1 indicates solid risk-adjusted performance.");
  } else if (pnl.sharpeRatio < 0) {
    conclusions.push("- **Negative Sharpe:** Returns did not compensate for volatility.");
  }

  if (pnl.maxDrawdown < 15) {
    conclusions.push("- **Controlled Drawdown:** Maximum drawdown < 15% shows good downside risk management.");
  } else {
    conclusions.push(`- **Large Drawdown:** Maximum drawdown of ${pnl.maxDrawdown.toFixed(1)}% exceeded typical risk tolerance.`);
  }

  if (pnl.vsHodl.win) {
    conclusions.push("- **Outperformed HODL:** Agent strategy beat buy-and-hold Bitcoin baseline.");
  } else {
    conclusions.push("- **Underperformed HODL:** Buy-and-hold Bitcoin would have been better in this period.");
  }

  if (conclusions.length === 0) {
    conclusions.push("- Insufficient data to draw meaningful conclusions.");
  }

  return conclusions.join("\n");
}

/**
 * Write backtest report to file.
 */
export function writeBacktestReport(result: BacktestResult, outputDir: string = "./reports"): string {
  const reportContent = generateBacktestReport(result);
  const timestamp = result.completedAt.toISOString().split("T")[0];
  const filename = `backtest-${timestamp}.md`;
  const filepath = join(outputDir, filename);

  writeFileSync(filepath, reportContent, "utf-8");
  console.log(`[Report] Written to ${filepath}`);

  return filepath;
}

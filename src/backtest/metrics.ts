import { ExecutedTrade, PnlStats, PortfolioSnapshot } from "./types.js";

/**
 * Compute annualized Sharpe ratio from daily returns.
 * Assumes 252 trading days per year.
 */
export function computeSharpeRatio(dailyReturns: number[]): number {
  if (dailyReturns.length === 0) return 0;

  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((a, r) => a + Math.pow(r - mean, 2), 0) / dailyReturns.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;

  // Annualize: daily Sharpe * sqrt(252), assuming risk-free rate ≈ 0
  const dailySharpe = mean / stdDev;
  return dailySharpe * Math.sqrt(252);
}

/**
 * Compute maximum drawdown as percentage of peak equity.
 * Assumes dailyEquities are in chronological order.
 */
export function computeMaxDrawdown(dailyEquities: number[]): number {
  if (dailyEquities.length === 0) return 0;

  let peak = dailyEquities[0] || 0;
  let maxDD = 0;

  for (const equity of dailyEquities) {
    if (equity > peak) {
      peak = equity;
    }
    const dd = peak > 0 ? (peak - equity) / peak : 0;
    if (dd > maxDD) {
      maxDD = dd;
    }
  }

  return maxDD * 100; // as percentage
}

/**
 * Compute R-multiple for a trade: (profit / risk per contract).
 * Risk = (entry - invalidation) for buy, (invalidation - entry) for sell.
 */
export function computeRMultiple(trade: ExecutedTrade, invalidationPrice: number): number {
  if (trade.close_price === null) return 0;

  const entry = trade.entry_price;
  const close = trade.close_price;

  const profit = trade.side === "buy" ? close - entry : entry - close;
  const risk = Math.abs(entry - invalidationPrice);

  if (risk === 0) return 0;
  return profit / risk;
}

/**
 * Compute comprehensive P&L stats from a list of closed trades.
 */
export function computePnlStats(
  trades: ExecutedTrade[],
  initialCash: number,
  finalCash: number,
  tradeInvalidations: Map<string, number> // trade ID -> invalidation price
): PnlStats {
  const closedTrades = trades.filter((t) => t.close_price !== null);
  const openTrades = trades.filter((t) => t.close_price === null);

  let winCount = 0;
  let lossCount = 0;
  let totalWin = 0;
  let totalLoss = 0;
  const rMultiples: number[] = [];
  const tradeReturns: number[] = [];

  for (const trade of closedTrades) {
    const entry = trade.entry_price;
    const close = trade.close_price!;

    // Compute return percentage
    const returnPct = trade.side === "buy" ? ((close - entry) / entry) * 100 : ((entry - close) / entry) * 100;

    tradeReturns.push(returnPct);

    if (returnPct >= 0) {
      winCount++;
      totalWin += returnPct;
    } else {
      lossCount++;
      totalLoss += Math.abs(returnPct);
    }

    // Compute R-multiple
    const invalidation = tradeInvalidations.get(trade.id) || 0;
    const rMult = computeRMultiple(trade, invalidation);
    rMultiples.push(rMult);
  }

  const winRate = closedTrades.length > 0 ? (winCount / closedTrades.length) * 100 : 0;
  const avgWin = winCount > 0 ? totalWin / winCount : 0;
  const avgLoss = lossCount > 0 ? totalLoss / lossCount : 0;
  const profitFactor = totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? Infinity : 0;

  const sharpe = computeSharpeRatio(tradeReturns.map((r) => r / 100)); // convert to decimal
  const maxDD = computeMaxDrawdown(tradeReturns);

  const totalPnlUsd = finalCash - initialCash;
  const totalPnlPct = (totalPnlUsd / initialCash) * 100;

  return {
    totalTrades: trades.length,
    closedTrades: closedTrades.length,
    openTrades: openTrades.length,
    winCount,
    lossCount,
    winRate,
    avgWin,
    avgLoss,
    profitFactor,
    totalPnlUsd,
    totalPnlPct,
    sharpeRatio: sharpe,
    maxDrawdown: maxDD,
    vsHodl: { pnlPct: 0, win: false }, // Computed separately
    vsRandom: { pnlPct: 0, win: false }, // Computed separately
  };
}

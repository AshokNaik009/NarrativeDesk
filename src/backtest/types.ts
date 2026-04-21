export interface BacktestConfig {
  startDate: Date;
  endDate: Date;
  initialCash: number;
  symbols: string[];
}

export interface ExecutedTrade {
  id: string;
  side: "buy" | "sell";
  coin: string;
  size_pct: number;
  entry_price: number;
  entry_time: Date;
  close_price: number | null;
  close_time: Date | null;
  close_reason: string | null;
}

export interface PortfolioSnapshot {
  timestamp: Date;
  cash: number;
  positions: Record<string, { side: "buy" | "sell"; size_pct: number; entry_price: number }>;
  totalValue: number;
}

export interface PnlStats {
  totalTrades: number;
  closedTrades: number;
  openTrades: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  totalPnlUsd: number;
  totalPnlPct: number;
  sharpeRatio: number;
  maxDrawdown: number;
  vsHodl: { pnlPct: number; win: boolean };
  vsRandom: { pnlPct: number; win: boolean };
}

export interface BacktestResult {
  config: BacktestConfig;
  trades: ExecutedTrade[];
  portfolio: PortfolioSnapshot[];
  pnl: PnlStats;
  startedAt: Date;
  completedAt: Date;
}

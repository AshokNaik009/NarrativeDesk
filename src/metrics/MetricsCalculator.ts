import { query } from "../db/client.js";

// ── Layer 2: Decision Metrics ──────────────────────────────────────────────────

export interface ClassificationBreakdown {
  ignore: number;
  monitor: number;
  act: number;
  total: number;
}

export interface ThesisDeltaSummary {
  totalUpdates: number;
  noChangeCount: number;
  updateRate: number; // percentage of decisions that changed the thesis
}

export interface SubAgentCorrelation {
  avgRatingForAct: number | null;
  avgRatingForIgnore: number | null;
  avgRatingForMonitor: number | null;
  highCredibilityActRate: number | null; // % of rating>=4 that led to "act"
}

export interface Layer2Metrics {
  classificationBreakdown: ClassificationBreakdown;
  thesisDeltaSummary: ThesisDeltaSummary;
  subAgentCorrelation: SubAgentCorrelation;
  periodStart: string;
  periodEnd: string;
}

export async function computeLayer2(since?: Date): Promise<Layer2Metrics> {
  const sinceClause = since ? `AND pd.created_at >= $1` : "";
  const params = since ? [since.toISOString()] : [];

  // Classification breakdown
  const classResult = await query(
    `SELECT classification, COUNT(*)::int as count
     FROM proposed_decisions pd
     WHERE 1=1 ${sinceClause}
     GROUP BY classification`,
    params
  );

  const breakdown: ClassificationBreakdown = { ignore: 0, monitor: 0, act: 0, total: 0 };
  for (const row of classResult.rows) {
    const key = row.classification as keyof typeof breakdown;
    if (key in breakdown) breakdown[key] = row.count;
    breakdown.total += row.count;
  }

  // Thesis delta summary
  const thesisResult = await query(
    `SELECT
       COUNT(*)::int as total_decisions,
       COUNT(*) FILTER (WHERE thesis_delta IS NULL OR thesis_delta = 'no change')::int as no_change
     FROM proposed_decisions pd
     WHERE 1=1 ${sinceClause}`,
    params
  );

  const totalDecisions = thesisResult.rows[0]?.total_decisions ?? 0;
  const noChangeCount = thesisResult.rows[0]?.no_change ?? 0;
  const thesisDelta: ThesisDeltaSummary = {
    totalUpdates: totalDecisions - noChangeCount,
    noChangeCount,
    updateRate: totalDecisions > 0 ? ((totalDecisions - noChangeCount) / totalDecisions) * 100 : 0,
  };

  // Sub-agent correlation: avg credibility rating per classification
  const correlationResult = await query(
    `SELECT
       pd.classification,
       AVG(si.rating)::float as avg_rating,
       COUNT(*)::int as count
     FROM proposed_decisions pd
     JOIN agent_invocations ai ON pd.agent_invocation_id = ai.id
     JOIN subagent_invocations si ON si.agent_invocation_id = ai.id
     WHERE si.rating IS NOT NULL ${sinceClause.replace("pd.", "pd.")}
     GROUP BY pd.classification`,
    params
  );

  const corrMap: Record<string, number> = {};
  for (const row of correlationResult.rows) {
    corrMap[row.classification] = row.avg_rating;
  }

  // High-credibility act rate
  const highCredResult = await query(
    `SELECT
       COUNT(*) FILTER (WHERE pd.classification = 'act')::int as act_count,
       COUNT(*)::int as total_high
     FROM proposed_decisions pd
     JOIN agent_invocations ai ON pd.agent_invocation_id = ai.id
     JOIN subagent_invocations si ON si.agent_invocation_id = ai.id
     WHERE si.rating >= 4 ${sinceClause.replace("pd.", "pd.")}`,
    params
  );

  const totalHigh = highCredResult.rows[0]?.total_high ?? 0;
  const actHigh = highCredResult.rows[0]?.act_count ?? 0;

  // Period bounds
  const periodResult = await query(
    `SELECT MIN(pd.created_at) as period_start, MAX(pd.created_at) as period_end
     FROM proposed_decisions pd
     WHERE 1=1 ${sinceClause}`,
    params
  );

  return {
    classificationBreakdown: breakdown,
    thesisDeltaSummary: thesisDelta,
    subAgentCorrelation: {
      avgRatingForAct: corrMap["act"] ?? null,
      avgRatingForIgnore: corrMap["ignore"] ?? null,
      avgRatingForMonitor: corrMap["monitor"] ?? null,
      highCredibilityActRate: totalHigh > 0 ? (actHigh / totalHigh) * 100 : null,
    },
    periodStart: periodResult.rows[0]?.period_start?.toISOString() ?? "",
    periodEnd: periodResult.rows[0]?.period_end?.toISOString() ?? "",
  };
}

// ── Layer 3: Trade Outcome Metrics ─────────────────────────────────────────────

export interface Layer3Metrics {
  totalTrades: number;
  closedTrades: number;
  openTrades: number;
  winCount: number;
  lossCount: number;
  winRate: number | null; // percentage, null if no closed trades
  avgWinPct: number | null;
  avgLossPct: number | null;
  profitFactor: number | null; // gross wins / gross losses
  invalidationAccuracy: number | null; // % of stop-loss exits where invalidation actually fired
  avgHoldDurationMinutes: number | null;
}

export async function computeLayer3(since?: Date): Promise<Layer3Metrics> {
  const sinceClause = since ? `AND et.created_at >= $1` : "";
  const params = since ? [since.toISOString()] : [];

  const tradesResult = await query(
    `SELECT
       et.id,
       et.side,
       et.coin,
       et.entry_price,
       et.close_price,
       et.close_reason,
       et.closed_at,
       et.created_at,
       pd.invalidation
     FROM executed_trades et
     JOIN pending_approvals pa ON et.approval_id = pa.id
     JOIN proposed_decisions pd ON pa.decision_id = pd.id
     WHERE 1=1 ${sinceClause}
     ORDER BY et.created_at`,
    params
  );

  const trades = tradesResult.rows;
  const closedTrades = trades.filter((t) => t.closed_at !== null);
  const openTrades = trades.filter((t) => t.closed_at === null);

  let wins = 0;
  let losses = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let invalidationFired = 0;
  let stopLossExits = 0;
  let totalHoldMinutes = 0;

  for (const t of closedTrades) {
    const entry = parseFloat(t.entry_price);
    const close = parseFloat(t.close_price);
    if (!entry || !close) continue;

    const pnlPct = t.side === "buy"
      ? ((close - entry) / entry) * 100
      : ((entry - close) / entry) * 100;

    if (pnlPct >= 0) {
      wins++;
      grossWin += pnlPct;
    } else {
      losses++;
      grossLoss += Math.abs(pnlPct);
    }

    // Check invalidation accuracy: did the close_reason match the invalidation?
    if (t.close_reason) {
      stopLossExits++;
      if (
        t.close_reason.toLowerCase().includes("invalidat") ||
        t.close_reason.toLowerCase().includes("stop")
      ) {
        invalidationFired++;
      }
    }

    // Hold duration
    if (t.closed_at && t.created_at) {
      const holdMs = new Date(t.closed_at).getTime() - new Date(t.created_at).getTime();
      totalHoldMinutes += holdMs / 60000;
    }
  }

  const closedCount = closedTrades.length;

  return {
    totalTrades: trades.length,
    closedTrades: closedCount,
    openTrades: openTrades.length,
    winCount: wins,
    lossCount: losses,
    winRate: closedCount > 0 ? (wins / closedCount) * 100 : null,
    avgWinPct: wins > 0 ? grossWin / wins : null,
    avgLossPct: losses > 0 ? grossLoss / losses : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    invalidationAccuracy: stopLossExits > 0 ? (invalidationFired / stopLossExits) * 100 : null,
    avgHoldDurationMinutes: closedCount > 0 ? totalHoldMinutes / closedCount : null,
  };
}

// ── Layer 4: HITL Metrics ──────────────────────────────────────────────────────

export interface Layer4Metrics {
  totalApprovals: number;
  approvedCount: number;
  rejectedCount: number;
  editedCount: number;
  expiredCount: number;
  approvalRate: number | null;
  rejectionRate: number | null;
  editRate: number | null;
  expirationRate: number | null;
  avgTimeToDecisionSeconds: number | null;
  tagBreakdown: Record<string, number>;
  rejectionVsOutcome: Array<{
    tag: string;
    avgPriceChange15m: number | null;
    count: number;
  }>;
}

export async function computeLayer4(since?: Date): Promise<Layer4Metrics> {
  const sinceClause = since ? `AND pa.created_at >= $1` : "";
  const params = since ? [since.toISOString()] : [];

  // Status breakdown
  const statusResult = await query(
    `SELECT status, COUNT(*)::int as count
     FROM pending_approvals pa
     WHERE status != 'pending' ${sinceClause}
     GROUP BY status`,
    params
  );

  let approved = 0, rejected = 0, edited = 0, expired = 0;
  for (const row of statusResult.rows) {
    switch (row.status) {
      case "approved": approved = row.count; break;
      case "rejected": rejected = row.count; break;
      case "edited": edited = row.count; break;
      case "expired": expired = row.count; break;
    }
  }
  const total = approved + rejected + edited + expired;

  // Average time-to-decision (resolved - created)
  const ttdResult = await query(
    `SELECT AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)))::float as avg_seconds
     FROM pending_approvals pa
     WHERE resolved_at IS NOT NULL AND status != 'expired' ${sinceClause}`,
    params
  );

  const avgTtd = ttdResult.rows[0]?.avg_seconds ?? null;

  // Tag breakdown
  const tagResult = await query(
    `SELECT tag, COUNT(*)::int as count
     FROM pending_approvals pa
     WHERE tag IS NOT NULL ${sinceClause}
     GROUP BY tag
     ORDER BY count DESC`,
    params
  );

  const tagBreakdown: Record<string, number> = {};
  for (const row of tagResult.rows) {
    tagBreakdown[row.tag] = row.count;
  }

  // Rejection vs outcome: for rejected proposals, what happened to the price?
  const rejOutcomeResult = await query(
    `SELECT
       pa.tag,
       op.price_at_decision,
       op.price_15m,
       COUNT(*)::int as count
     FROM pending_approvals pa
     JOIN proposed_decisions pd ON pa.decision_id = pd.id
     LEFT JOIN outcome_prices op ON op.decision_id = pd.id
     WHERE pa.status = 'rejected' AND pa.tag IS NOT NULL ${sinceClause}
     GROUP BY pa.tag, op.price_at_decision, op.price_15m`,
    params
  );

  // Aggregate rejection-vs-outcome by tag
  const rejMap: Record<string, { totalChange: number; count: number; withPrice: number }> = {};
  for (const row of rejOutcomeResult.rows) {
    if (!rejMap[row.tag]) {
      rejMap[row.tag] = { totalChange: 0, count: 0, withPrice: 0 };
    }
    const entry = rejMap[row.tag]!;
    entry.count += row.count;
    if (row.price_at_decision && row.price_15m) {
      const change = ((row.price_15m - row.price_at_decision) / row.price_at_decision) * 100;
      entry.totalChange += change * row.count;
      entry.withPrice += row.count;
    }
  }

  const rejectionVsOutcome = Object.entries(rejMap).map(([tag, data]) => ({
    tag,
    avgPriceChange15m: data.withPrice > 0 ? data.totalChange / data.withPrice : null,
    count: data.count,
  }));

  return {
    totalApprovals: total,
    approvedCount: approved,
    rejectedCount: rejected,
    editedCount: edited,
    expiredCount: expired,
    approvalRate: total > 0 ? (approved / total) * 100 : null,
    rejectionRate: total > 0 ? (rejected / total) * 100 : null,
    editRate: total > 0 ? (edited / total) * 100 : null,
    expirationRate: total > 0 ? (expired / total) * 100 : null,
    avgTimeToDecisionSeconds: avgTtd,
    tagBreakdown,
    rejectionVsOutcome,
  };
}

// ── Combined report ────────────────────────────────────────────────────────────

export interface FullMetricsReport {
  generatedAt: string;
  layer2: Layer2Metrics;
  layer3: Layer3Metrics;
  layer4: Layer4Metrics;
}

export async function computeFullReport(since?: Date): Promise<FullMetricsReport> {
  const [layer2, layer3, layer4] = await Promise.all([
    computeLayer2(since),
    computeLayer3(since),
    computeLayer4(since),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    layer2,
    layer3,
    layer4,
  };
}

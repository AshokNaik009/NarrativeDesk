import { query } from "../db/client.js";

export interface ApprovalByTag {
  tag: string;
  approvedCount: number;
  rejectedCount: number;
  winRate: number | null;
  avgConviction: number | null;
}

export interface ApprovalByTimeOfDay {
  hour: number;
  approvedCount: number;
  rejectedCount: number;
  approvalRate: number | null;
  winRate: number | null;
}

export interface ApprovalByConviction {
  conviction: number;
  approvedCount: number;
  rejectedCount: number;
  approvalRate: number | null;
  winRate: number | null;
}

export interface HindsightTrade {
  approvalId: string;
  decision: string;
  thesis: string;
  tag: string | null;
  conviction: number | null;
  wouldHaveEntry: number;
  wouldHaveTarget: number;
  wouldHaveSide: string;
  priceAt15m: number | null;
  theoreticalPnl: number | null;
  wouldHaveWon: boolean;
}

export interface BiasMetrics {
  approvalsByTag: ApprovalByTag[];
  approvalsByTimeOfDay: ApprovalByTimeOfDay[];
  approvalsByConviction: ApprovalByConviction[];
  hindsightAnalysis: HindsightTrade[];
  thesisDriftMetrics: {
    avgFlipsPerDay: number;
    totalFlips: number;
    leadsPriceMovement: boolean;
  };
}

export async function computeBiasMetrics(since?: Date): Promise<BiasMetrics> {
  const sinceClause = since ? "AND pa.created_at >= $1" : "";
  const params = since ? [since.toISOString()] : [];

  // 1. Approval patterns by tag
  const tagResult = await query(
    `SELECT
       pa.tag,
       COUNT(*) FILTER (WHERE pa.status = 'approved')::int as approved_count,
       COUNT(*) FILTER (WHERE pa.status = 'rejected')::int as rejected_count,
       AVG(pd.conviction)::float as avg_conviction,
       AVG(CASE WHEN et.close_price IS NOT NULL AND et.entry_price IS NOT NULL
         THEN CASE WHEN pd.side = 'buy' THEN ((et.close_price - et.entry_price) / et.entry_price) * 100
                   WHEN pd.side = 'sell' THEN ((et.entry_price - et.close_price) / et.entry_price) * 100
                   ELSE NULL END
         ELSE NULL END)::float as win_rate
     FROM pending_approvals pa
     JOIN proposed_decisions pd ON pa.decision_id = pd.id
     LEFT JOIN executed_trades et ON pa.id = et.approval_id
     WHERE pa.resolved_at IS NOT NULL ${sinceClause}
     GROUP BY pa.tag
     HAVING pa.tag IS NOT NULL
     ORDER BY approved_count + rejected_count DESC`,
    params
  );

  const approvalsByTag: ApprovalByTag[] = tagResult.rows.map((row) => ({
    tag: row.tag,
    approvedCount: row.approved_count,
    rejectedCount: row.rejected_count,
    winRate: row.win_rate,
    avgConviction: row.avg_conviction,
  }));

  // 2. Time-of-day bias (hour 0-23)
  const timeResult = await query(
    `SELECT
       EXTRACT(HOUR FROM pa.created_at)::int as hour,
       COUNT(*) FILTER (WHERE pa.status = 'approved')::int as approved_count,
       COUNT(*) FILTER (WHERE pa.status = 'rejected')::int as rejected_count,
       AVG(CASE WHEN et.close_price IS NOT NULL AND et.entry_price IS NOT NULL
         THEN CASE WHEN pd.side = 'buy' THEN ((et.close_price - et.entry_price) / et.entry_price) * 100
                   WHEN pd.side = 'sell' THEN ((et.entry_price - et.close_price) / et.entry_price) * 100
                   ELSE NULL END
         ELSE NULL END)::float as win_rate
     FROM pending_approvals pa
     JOIN proposed_decisions pd ON pa.decision_id = pd.id
     LEFT JOIN executed_trades et ON pa.id = et.approval_id
     WHERE pa.resolved_at IS NOT NULL ${sinceClause}
     GROUP BY hour
     ORDER BY hour`,
    params
  );

  const approvalsByTimeOfDay: ApprovalByTimeOfDay[] = timeResult.rows.map((row) => {
    const total = row.approved_count + row.rejected_count;
    return {
      hour: row.hour,
      approvedCount: row.approved_count,
      rejectedCount: row.rejected_count,
      approvalRate: total > 0 ? (row.approved_count / total) * 100 : null,
      winRate: row.win_rate,
    };
  });

  // 3. Conviction bias
  const convictionResult = await query(
    `SELECT
       pd.conviction,
       COUNT(*) FILTER (WHERE pa.status = 'approved')::int as approved_count,
       COUNT(*) FILTER (WHERE pa.status = 'rejected')::int as rejected_count,
       AVG(CASE WHEN et.close_price IS NOT NULL AND et.entry_price IS NOT NULL
         THEN CASE WHEN pd.side = 'buy' THEN ((et.close_price - et.entry_price) / et.entry_price) * 100
                   WHEN pd.side = 'sell' THEN ((et.entry_price - et.close_price) / et.entry_price) * 100
                   ELSE NULL END
         ELSE NULL END)::float as win_rate
     FROM pending_approvals pa
     JOIN proposed_decisions pd ON pa.decision_id = pd.id
     LEFT JOIN executed_trades et ON pa.id = et.approval_id
     WHERE pa.resolved_at IS NOT NULL AND pd.conviction IS NOT NULL ${sinceClause}
     GROUP BY pd.conviction
     ORDER BY pd.conviction`,
    params
  );

  const approvalsByConviction: ApprovalByConviction[] = convictionResult.rows.map((row) => {
    const total = row.approved_count + row.rejected_count;
    return {
      conviction: row.conviction,
      approvedCount: row.approved_count,
      rejectedCount: row.rejected_count,
      approvalRate: total > 0 ? (row.approved_count / total) * 100 : null,
      winRate: row.win_rate,
    };
  });

  // 4. Hindsight analysis
  const hindsightResult = await query(
    `SELECT
       pa.id as approval_id,
       pd.reasoning as decision,
       pd.thesis_delta as thesis,
       pa.tag,
       pd.conviction,
       pd.side,
       pd.entry_zone_low,
       pd.target_price,
       COALESCE(op.price_at_decision, 0)::numeric as price_at_decision,
       COALESCE(op.price_15m, 0)::numeric as price_15m
     FROM pending_approvals pa
     JOIN proposed_decisions pd ON pa.decision_id = pd.id
     LEFT JOIN outcome_prices op ON pd.id = op.decision_id
     WHERE pa.status = 'rejected' AND op.price_at_decision IS NOT NULL
     LIMIT 50`,
    params
  );

  const hindsightAnalysis: HindsightTrade[] = hindsightResult.rows.map((row) => {
    const entry = parseFloat(row.entry_zone_low || "0");
    const target = parseFloat(row.target_price || "0");
    const priceNow = parseFloat(row.price_15m || row.price_at_decision || "0");

    let theoreticalPnl: number | null = null;
    let wouldHaveWon = false;

    if (entry && priceNow && row.side) {
      if (row.side === "buy") {
        theoreticalPnl = ((priceNow - entry) / entry) * 100;
        wouldHaveWon = priceNow > entry;
      } else {
        theoreticalPnl = ((entry - priceNow) / entry) * 100;
        wouldHaveWon = priceNow < entry;
      }
    }

    return {
      approvalId: row.approval_id,
      decision: row.decision || "unknown",
      thesis: row.thesis || "unknown",
      tag: row.tag,
      conviction: row.conviction,
      wouldHaveEntry: entry,
      wouldHaveTarget: target,
      wouldHaveSide: row.side,
      priceAt15m: priceNow,
      theoreticalPnl,
      wouldHaveWon,
    };
  });

  // 5. Thesis drift
  const thesisResult = await query(
    `SELECT
       COUNT(DISTINCT tv.id)::int as total_versions,
       COUNT(DISTINCT CASE WHEN tv.diff IS NOT NULL THEN tv.id END)::int as flip_count,
       MIN(tv.created_at) as period_start,
       MAX(tv.created_at) as period_end
     FROM thesis_versions tv`
  );

  const thesisRow = thesisResult.rows[0];
  const totalVersions = thesisRow?.total_versions ?? 0;
  const flipCount = thesisRow?.flip_count ?? 0;
  const periodStart = thesisRow?.period_start;
  const periodEnd = thesisRow?.period_end;

  let avgFlipsPerDay = 0;
  if (periodStart && periodEnd) {
    const days = (new Date(periodEnd).getTime() - new Date(periodStart).getTime()) / (1000 * 60 * 60 * 24);
    avgFlipsPerDay = days > 0 ? flipCount / days : 0;
  }

  return {
    approvalsByTag,
    approvalsByTimeOfDay,
    approvalsByConviction,
    hindsightAnalysis,
    thesisDriftMetrics: {
      avgFlipsPerDay: Math.round(avgFlipsPerDay * 100) / 100,
      totalFlips: flipCount,
      leadsPriceMovement: flipCount > 0,
    },
  };
}

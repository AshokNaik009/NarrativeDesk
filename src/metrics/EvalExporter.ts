import { query } from "../db/client.js";

/**
 * CC-SKILLS-Evals fixture format:
 * Each fixture is a single agent decision with inputs, outputs, and outcomes.
 */
export interface EvalFixture {
  id: string;
  timestamp: string;
  // Input context
  input: {
    event_type: string;
    event_source: string;
    event_symbol: string | null;
    event_headline: string | null;
    thesis_at_time: string | null;
    credibility_rating: number | null;
    credibility_reasoning: string | null;
  };
  // Agent output
  output: {
    classification: string;
    reasoning: string;
    thesis_delta: string | null;
    trade_plan: {
      side: string;
      coin: string;
      size_pct: number;
      entry_zone: [number, number];
      invalidation: number;
      target: number;
      timeframe: string;
      correlation_notes: string;
      conviction: number;
    } | null;
  };
  // Component metrics
  component: {
    model: string;
    prompt_tokens: number;
    completion_tokens: number;
    latency_ms: number;
    schema_compliant: boolean;
  };
  // HITL outcome (if applicable)
  hitl: {
    status: string | null;
    tag: string | null;
    tag_freetext: string | null;
    time_to_decision_seconds: number | null;
    edited_size_pct: number | null;
  } | null;
  // Guardrail outcome (if applicable)
  guardrail: {
    allowed: boolean;
    reason: string;
  } | null;
  // Price outcomes (if available)
  outcome: {
    price_at_decision: number | null;
    price_15m: number | null;
    price_1h: number | null;
    price_4h: number | null;
    price_24h: number | null;
    trade_entry_price: number | null;
    trade_close_price: number | null;
    trade_close_reason: string | null;
    trade_pnl_pct: number | null;
  } | null;
}

/**
 * Export all decision data as CC-SKILLS-Evals fixtures.
 * Each fixture is a complete record of one agent decision and its full lifecycle.
 */
export async function exportEvalFixtures(since?: Date, limit: number = 1000): Promise<EvalFixture[]> {
  const sinceClause = since ? `AND pd.created_at >= $1` : "";
  const params: unknown[] = since ? [since.toISOString()] : [];
  params.push(limit);

  const result = await query(
    `SELECT
       pd.id as decision_id,
       pd.classification,
       pd.reasoning,
       pd.thesis_delta,
       pd.side,
       pd.coin,
       pd.size_pct,
       pd.entry_zone_low,
       pd.entry_zone_high,
       pd.invalidation_price,
       pd.target_price,
       pd.timeframe,
       pd.correlation_notes,
       pd.conviction,
       pd.created_at as decision_time,
       -- Event
       e.type as event_type,
       e.source as event_source,
       e.symbol as event_symbol,
       e.headline as event_headline,
       -- Agent invocation
       ai.model,
       ai.prompt_tokens,
       ai.completion_tokens,
       ai.latency_ms,
       ai.schema_compliant,
       -- Sub-agent
       si.rating as cred_rating,
       si.reasoning as cred_reasoning,
       -- Thesis at time of decision (latest thesis before this decision)
       tv.content as thesis_content,
       -- Approval
       pa.status as approval_status,
       pa.tag as approval_tag,
       pa.tag_freetext,
       pa.edited_size_pct,
       pa.created_at as approval_created,
       pa.resolved_at as approval_resolved,
       -- Guardrail
       gd.allowed as guardrail_allowed,
       gd.reason as guardrail_reason,
       -- Outcome prices
       op.price_at_decision,
       op.price_15m,
       op.price_1h,
       op.price_4h,
       op.price_24h,
       -- Trade execution
       et.entry_price as trade_entry,
       et.close_price as trade_close,
       et.close_reason as trade_close_reason
     FROM proposed_decisions pd
     LEFT JOIN agent_invocations ai ON pd.agent_invocation_id = ai.id
     LEFT JOIN events e ON ai.event_id = e.id
     LEFT JOIN subagent_invocations si ON si.agent_invocation_id = ai.id
     LEFT JOIN (
       SELECT DISTINCT ON (created_at) id, content, created_at
       FROM thesis_versions
       ORDER BY created_at DESC
     ) tv ON tv.created_at <= pd.created_at
     LEFT JOIN pending_approvals pa ON pa.decision_id = pd.id
     LEFT JOIN guardrail_decisions gd ON gd.decision_id = pd.id
     LEFT JOIN outcome_prices op ON op.decision_id = pd.id
     LEFT JOIN executed_trades et ON et.approval_id = pa.id
     WHERE 1=1 ${sinceClause}
     ORDER BY pd.created_at ASC
     LIMIT $${params.length}`,
    params
  );

  return result.rows.map((row): EvalFixture => {
    // Compute trade P&L if we have both entry and close
    let tradePnlPct: number | null = null;
    if (row.trade_entry && row.trade_close) {
      const entry = parseFloat(row.trade_entry);
      const close = parseFloat(row.trade_close);
      if (row.side === "buy") {
        tradePnlPct = ((close - entry) / entry) * 100;
      } else {
        tradePnlPct = ((entry - close) / entry) * 100;
      }
    }

    // Time to decision
    let ttdSeconds: number | null = null;
    if (row.approval_created && row.approval_resolved) {
      ttdSeconds = (new Date(row.approval_resolved).getTime() - new Date(row.approval_created).getTime()) / 1000;
    }

    return {
      id: row.decision_id,
      timestamp: row.decision_time?.toISOString() ?? "",
      input: {
        event_type: row.event_type ?? "unknown",
        event_source: row.event_source ?? "unknown",
        event_symbol: row.event_symbol,
        event_headline: row.event_headline,
        thesis_at_time: row.thesis_content,
        credibility_rating: row.cred_rating,
        credibility_reasoning: row.cred_reasoning,
      },
      output: {
        classification: row.classification,
        reasoning: row.reasoning,
        thesis_delta: row.thesis_delta,
        trade_plan: row.side
          ? {
              side: row.side,
              coin: row.coin,
              size_pct: parseFloat(row.size_pct),
              entry_zone: [parseFloat(row.entry_zone_low), parseFloat(row.entry_zone_high)],
              invalidation: parseFloat(row.invalidation_price),
              target: parseFloat(row.target_price),
              timeframe: row.timeframe,
              correlation_notes: row.correlation_notes,
              conviction: row.conviction,
            }
          : null,
      },
      component: {
        model: row.model ?? "unknown",
        prompt_tokens: row.prompt_tokens ?? 0,
        completion_tokens: row.completion_tokens ?? 0,
        latency_ms: row.latency_ms ?? 0,
        schema_compliant: row.schema_compliant ?? false,
      },
      hitl: row.approval_status
        ? {
            status: row.approval_status,
            tag: row.approval_tag,
            tag_freetext: row.tag_freetext,
            time_to_decision_seconds: ttdSeconds,
            edited_size_pct: row.edited_size_pct ? parseFloat(row.edited_size_pct) : null,
          }
        : null,
      guardrail: row.guardrail_allowed !== null && row.guardrail_allowed !== undefined
        ? {
            allowed: row.guardrail_allowed,
            reason: row.guardrail_reason,
          }
        : null,
      outcome: {
        price_at_decision: row.price_at_decision ? parseFloat(row.price_at_decision) : null,
        price_15m: row.price_15m ? parseFloat(row.price_15m) : null,
        price_1h: row.price_1h ? parseFloat(row.price_1h) : null,
        price_4h: row.price_4h ? parseFloat(row.price_4h) : null,
        price_24h: row.price_24h ? parseFloat(row.price_24h) : null,
        trade_entry_price: row.trade_entry ? parseFloat(row.trade_entry) : null,
        trade_close_price: row.trade_close ? parseFloat(row.trade_close) : null,
        trade_close_reason: row.trade_close_reason,
        trade_pnl_pct: tradePnlPct,
      },
    };
  });
}

/**
 * Export fixtures as JSONL (one JSON object per line) — the standard eval format.
 */
export async function exportEvalFixturesJsonl(since?: Date, limit?: number): Promise<string> {
  const fixtures = await exportEvalFixtures(since, limit);
  return fixtures.map((f) => JSON.stringify(f)).join("\n");
}

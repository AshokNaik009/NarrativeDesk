import { Router } from "express";
import { query } from "../db/client.js";
import { esc, renderFilterChecks } from "./shared.js";
import { formatGst, formatGstTime } from "../utils/time.js";

export const activityRouter = Router();

function renderFilterRow(row: any): { time: Date; html: string } {
  const time = new Date(row.created_at);
  const timeStr = formatGstTime(time);
  const icon = row.passed ? "&#9679;" : "&#9675;";
  const color = row.passed ? "#3fb950" : "#484f58";
  const payload = typeof row.raw_payload === "string" ? JSON.parse(row.raw_payload) : row.raw_payload;
  const sourceUrl = payload?.url || null;
  const sourceName = esc(row.source || "unknown");
  const headlineText = esc(row.headline?.slice(0, 80)) || "Unknown event";
  const label =
    row.event_type === "price"
      ? `Price tick ${esc(row.symbol)}`
      : sourceUrl
      ? `<a href="${esc(sourceUrl)}" target="_blank" rel="noopener" style="color:#58a6ff;text-decoration:none;">${headlineText}</a>`
      : headlineText;
  const reason = row.passed ? "passed all filters" : esc(row.reason);
  const kind = row.passed ? "passed" : "filtered";
  return {
    time,
    html: `<div class="activity-row" data-kind="${kind}" style="padding:8px 0;border-bottom:1px solid #21262d;">
      <div style="display:flex;gap:12px;align-items:flex-start;cursor:pointer;" onclick="openDetail('/activity/event/${esc(row.event_id)}')">
        <span style="color:${color};font-size:16px;line-height:1;min-width:16px;">${icon}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;color:#8b949e;">${timeStr} &middot; ${sourceName}</div>
          <div style="font-size:13px;color:#c9d1d9;word-break:break-word;">${label}</div>
          <div style="font-size:11px;color:${row.passed ? "#3fb950" : "#484f58"};">${reason} &middot; <span style="text-decoration:underline;">view checks</span></div>
        </div>
      </div>
    </div>`,
  };
}

function renderDecisionRow(row: any): { time: Date; html: string } {
  const time = new Date(row.created_at);
  const timeStr = formatGstTime(time);
  const classColors: Record<string, string> = { act: "#d29922", monitor: "#58a6ff", ignore: "#484f58" };
  const color = classColors[row.classification] || "#8b949e";
  const actionText = row.side ? ` | ${row.side.toUpperCase()} ${row.size_pct}% ${row.coin}` : "";
  const eventId = row.event_id;
  const clickAttr = eventId ? `onclick="openDetail('/activity/event/${esc(eventId)}')"` : "";
  return {
    time,
    html: `<div class="activity-row" data-kind="decision" style="padding:8px 0;border-bottom:1px solid #21262d;">
      <div style="display:flex;gap:12px;align-items:flex-start;${eventId ? "cursor:pointer;" : ""}" ${clickAttr}>
        <span style="color:${color};font-size:16px;line-height:1;min-width:16px;">&#9733;</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;color:#8b949e;">${timeStr} | ${esc(row.model) || "agent"} | ${row.latency_ms || "?"}ms | ${(row.prompt_tokens || 0) + (row.completion_tokens || 0)} tokens</div>
          <div style="font-size:13px;">
            <span style="display:inline-block;padding:2px 6px;border-radius:3px;background:${color};color:#0d1117;font-size:11px;font-weight:600;">${esc(row.classification)}</span>
            <span style="color:#c9d1d9;margin-left:8px;">${esc(row.reasoning?.slice(0, 120))}${actionText}</span>
          </div>
          ${row.thesis_delta && row.thesis_delta !== "no change" ? `<div style="font-size:11px;color:#8b949e;margin-top:4px;">Thesis: ${esc(row.thesis_delta.slice(0, 100))}</div>` : ""}
        </div>
      </div>
    </div>`,
  };
}

activityRouter.get("/activity", async (_req, res) => {
  try {
    const filterResult = await query(
      `SELECT fd.passed, fd.reason, fd.created_at,
              e.id as event_id, e.headline, e.symbol, e.type as event_type, e.source, e.raw_payload
       FROM filter_decisions fd
       JOIN events e ON fd.event_id = e.id
       WHERE fd.created_at > NOW() - INTERVAL '30 minutes'
       ORDER BY fd.created_at DESC LIMIT 30`
    );

    const decisionsResult = await query(
      `SELECT pd.classification, pd.reasoning, pd.coin, pd.side, pd.size_pct,
              pd.thesis_delta, pd.created_at,
              ai.event_id, ai.model, ai.latency_ms, ai.prompt_tokens, ai.completion_tokens
       FROM proposed_decisions pd
       LEFT JOIN agent_invocations ai ON pd.agent_invocation_id = ai.id
       ORDER BY pd.created_at DESC LIMIT 20`
    );

    const statsResult = await query(
      `SELECT
        (SELECT COUNT(*)::int FROM events WHERE created_at > NOW() - INTERVAL '1 hour') as events_1h,
        (SELECT COUNT(*)::int FROM filter_decisions WHERE passed = true AND created_at > NOW() - INTERVAL '1 hour') as passed_1h,
        (SELECT COUNT(*)::int FROM filter_decisions WHERE passed = false AND created_at > NOW() - INTERVAL '1 hour') as filtered_1h,
        (SELECT COUNT(*)::int FROM proposed_decisions WHERE created_at > NOW() - INTERVAL '1 hour') as decisions_1h,
        (SELECT COUNT(*)::int FROM proposed_decisions WHERE classification = 'act' AND created_at > NOW() - INTERVAL '24 hours') as acts_24h,
        (SELECT COUNT(*)::int FROM agent_invocations WHERE created_at > NOW() - INTERVAL '1 hour') as agent_calls_1h`
    );

    const stats = statsResult.rows[0] || {};

    let html = `<div id="activity-section" hx-get="/activity" hx-trigger="every 15s" hx-swap="outerHTML" style="margin-top:12px;margin-bottom:32px;">`;

    html += `<div class="summary-bar" style="grid-template-columns:repeat(6,1fr);">
      <div class="summary-card"><div class="summary-card-label">Events (1h)</div><div class="summary-card-value" style="font-size:24px;">${stats.events_1h || 0}</div></div>
      <div class="summary-card"><div class="summary-card-label">Filtered Out</div><div class="summary-card-value" style="font-size:24px;color:#8b949e;">${stats.filtered_1h || 0}</div></div>
      <div class="summary-card"><div class="summary-card-label">Passed Filter</div><div class="summary-card-value" style="font-size:24px;color:#3fb950;">${stats.passed_1h || 0}</div></div>
      <div class="summary-card"><div class="summary-card-label">Agent Calls</div><div class="summary-card-value" style="font-size:24px;color:#58a6ff;">${stats.agent_calls_1h || 0}</div></div>
      <div class="summary-card"><div class="summary-card-label">Decisions (1h)</div><div class="summary-card-value" style="font-size:24px;">${stats.decisions_1h || 0}</div></div>
      <div class="summary-card pending"><div class="summary-card-label">Acts (24h)</div><div class="summary-card-value" style="font-size:24px;">${stats.acts_24h || 0}</div></div>
    </div>`;

    html += `<div style="background:#161b22;border:1px solid #30363d;border-radius:6px;padding:16px;max-height:600px;overflow-y:auto;">`;

    const timeline: Array<{ time: Date; html: string }> = [];
    for (const row of filterResult.rows) timeline.push(renderFilterRow(row));
    for (const row of decisionsResult.rows) timeline.push(renderDecisionRow(row));
    timeline.sort((a, b) => b.time.getTime() - a.time.getTime());

    if (timeline.length === 0) {
      html += `<div style="text-align:center;padding:30px;color:#8b949e;">
        No activity yet. The worker may still be starting up.<br>
        <span style="font-size:12px;">Events are polled every 60s from Finnhub. Binance prices stream continuously.</span>
      </div>`;
    } else {
      html += `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px;">
        <span style="font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:0.5px;margin-right:4px;">Filter</span>
        <span class="filter-chip active" data-filter="passed" onclick="toggleActivityFilter('passed')"><span class="dot" style="background:#3fb950;"></span> passed</span>
        <span class="filter-chip active" data-filter="filtered" onclick="toggleActivityFilter('filtered')"><span class="dot" style="background:#484f58;border:1px solid #8b949e;"></span> filtered out</span>
        <span class="filter-chip active" data-filter="decision" onclick="toggleActivityFilter('decision')"><span class="dot" style="background:#d29922;"></span> agent decision</span>
        <span style="margin-left:auto;font-size:11px;color:#8b949e;">click row for details</span>
      </div>`;

      const shown = timeline.slice(0, 40);
      for (const entry of shown) html += entry.html;

      if (shown.length >= 40) {
        const oldest = shown[shown.length - 1]!.time.toISOString();
        html += `<div id="activity-sentinel" hx-get="/activity/older?before=${encodeURIComponent(oldest)}&limit=40" hx-trigger="revealed" hx-swap="outerHTML" style="padding:16px;text-align:center;color:#8b949e;font-size:12px;">Loading older events...</div>`;
      }
    }

    html += `</div></div>`;
    res.send(html);
  } catch (err) {
    res.send(`<div style="color:#f85149;padding:20px;">Activity feed error: ${(err as Error).message}</div>`);
  }
});

activityRouter.get("/activity/older", async (req, res) => {
  try {
    const beforeRaw = (req.query.before as string) || new Date().toISOString();
    const limit = Math.min(parseInt((req.query.limit as string) || "40"), 100);
    const before = new Date(beforeRaw);
    if (isNaN(before.getTime())) {
      return res.send(`<div style="padding:12px;color:#f85149;font-size:12px;">Invalid cursor.</div>`);
    }

    const filterResult = await query(
      `SELECT fd.passed, fd.reason, fd.created_at,
              e.id as event_id, e.headline, e.symbol, e.type as event_type, e.source, e.raw_payload
       FROM filter_decisions fd
       JOIN events e ON fd.event_id = e.id
       WHERE fd.created_at < $1
       ORDER BY fd.created_at DESC LIMIT $2`,
      [before, limit]
    );
    const decisionsResult = await query(
      `SELECT pd.classification, pd.reasoning, pd.coin, pd.side, pd.size_pct,
              pd.thesis_delta, pd.created_at,
              ai.event_id, ai.model, ai.latency_ms, ai.prompt_tokens, ai.completion_tokens
       FROM proposed_decisions pd
       LEFT JOIN agent_invocations ai ON pd.agent_invocation_id = ai.id
       WHERE pd.created_at < $1
       ORDER BY pd.created_at DESC LIMIT $2`,
      [before, limit]
    );

    const timeline: Array<{ time: Date; html: string }> = [];
    for (const row of filterResult.rows) timeline.push(renderFilterRow(row));
    for (const row of decisionsResult.rows) timeline.push(renderDecisionRow(row));
    timeline.sort((a, b) => b.time.getTime() - a.time.getTime());
    const page = timeline.slice(0, limit);

    if (page.length === 0) {
      return res.send(`<div style="padding:16px;text-align:center;color:#8b949e;font-size:12px;">No more events.</div>`);
    }

    let html = "";
    for (const entry of page) html += entry.html;
    if (page.length >= limit) {
      const oldest = page[page.length - 1]!.time.toISOString();
      html += `<div id="activity-sentinel-${Date.now()}" hx-get="/activity/older?before=${encodeURIComponent(oldest)}&limit=${limit}" hx-trigger="revealed" hx-swap="outerHTML" style="padding:16px;text-align:center;color:#8b949e;font-size:12px;">Loading older events...</div>`;
    }
    res.send(html);
  } catch (err) {
    res.send(`<div style="padding:12px;color:#f85149;font-size:12px;">Older feed error: ${(err as Error).message}</div>`);
  }
});

activityRouter.get("/activity/event/:eventId", async (req, res) => {
  try {
    const eventId = req.params.eventId;
    const eventResult = await query(
      `SELECT id, type, source, headline, symbol, raw_payload, created_at FROM events WHERE id = $1`,
      [eventId]
    );
    if (eventResult.rows.length === 0) {
      return res.send(`<div style="padding:20px;color:#f85149;">Event not found.</div>`);
    }
    const ev = eventResult.rows[0];
    const filterRes = await query(
      `SELECT passed, reason, created_at FROM filter_decisions WHERE event_id = $1 ORDER BY created_at DESC`,
      [eventId]
    );
    const invRes = await query(
      `SELECT id, model, latency_ms, prompt_tokens, completion_tokens, created_at
       FROM agent_invocations WHERE event_id = $1 ORDER BY created_at DESC`,
      [eventId]
    );
    const decRes = await query(
      `SELECT id, classification, reasoning, coin, side, size_pct,
              entry_zone_low, entry_zone_high, invalidation_price, target_price,
              timeframe, correlation_notes, conviction,
              thesis_delta, created_at
       FROM proposed_decisions WHERE agent_invocation_id = ANY($1::uuid[]) ORDER BY created_at DESC`,
      [invRes.rows.map((r) => r.id)]
    );

    const payload = typeof ev.raw_payload === "string" ? JSON.parse(ev.raw_payload) : ev.raw_payload;
    const url = payload?.url ? `<a href="${esc(payload.url)}" target="_blank" rel="noopener" style="color:#58a6ff;">${esc(payload.url)}</a>` : "";

    let html = `<div style="font-size:13px;color:#c9d1d9;">
      <div style="font-size:11px;color:#8b949e;text-transform:uppercase;margin-bottom:6px;">Event</div>
      <div style="margin-bottom:4px;"><strong>${esc(ev.type)}</strong> &middot; ${esc(ev.source || "")} &middot; ${formatGst(new Date(ev.created_at))}</div>
      ${ev.headline ? `<div style="margin-bottom:4px;">${esc(ev.headline)}</div>` : ""}
      ${url ? `<div style="margin-bottom:4px;font-size:12px;">${url}</div>` : ""}
    </div>`;

    if (filterRes.rows.length > 0) {
      const f = filterRes.rows[0];
      const summaryColor = f.passed ? "#3fb950" : "#f85149";
      html += `<div style="margin-top:16px;">
        <div style="font-size:11px;color:#8b949e;text-transform:uppercase;margin-bottom:8px;">Filter checks</div>
        <div style="font-size:12px;color:${summaryColor};margin-bottom:10px;font-weight:600;">${f.passed ? "PASSED" : "FILTERED OUT"} &mdash; ${esc(f.reason || "")}</div>
        ${renderFilterChecks(f.passed, f.reason || "")}
      </div>`;
    }

    if (invRes.rows.length > 0) {
      html += `<div style="margin-top:16px;"><div style="font-size:11px;color:#8b949e;text-transform:uppercase;margin-bottom:6px;">Agent invocations</div>`;
      for (const inv of invRes.rows) {
        html += `<div style="font-size:12px;color:#8b949e;margin-bottom:4px;">${esc(inv.model)} &middot; ${inv.latency_ms}ms &middot; ${(inv.prompt_tokens || 0) + (inv.completion_tokens || 0)} tokens &middot; ${formatGstTime(new Date(inv.created_at))}</div>`;
      }
      html += `</div>`;
    }

    if (decRes.rows.length > 0) {
      html += `<div style="margin-top:16px;"><div style="font-size:11px;color:#8b949e;text-transform:uppercase;margin-bottom:6px;">Decisions</div>`;
      for (const d of decRes.rows) {
        const actionText = d.side ? ` &middot; ${d.side.toUpperCase()} ${d.size_pct}% ${d.coin}` : "";
        const entryZone = d.entry_zone_low !== null && d.entry_zone_high !== null
          ? `$${parseFloat(d.entry_zone_low).toFixed(2)} – $${parseFloat(d.entry_zone_high).toFixed(2)}`
          : null;
        const invPrice = d.invalidation_price !== null ? `$${parseFloat(d.invalidation_price).toFixed(2)}` : null;
        const tgtPrice = d.target_price !== null ? `$${parseFloat(d.target_price).toFixed(2)}` : null;
        const planBits = [
          entryZone ? `Entry: ${entryZone}` : null,
          invPrice ? `Invalidation: ${invPrice}` : null,
          tgtPrice ? `Target: ${tgtPrice}` : null,
          d.timeframe ? `Timeframe: ${esc(d.timeframe)}` : null,
          d.conviction !== null ? `Conviction: ${d.conviction}/5` : null,
        ].filter(Boolean).join(" &middot; ");
        html += `<div style="padding:8px 0;border-bottom:1px solid #21262d;">
          <div style="font-size:12px;"><strong style="color:#d29922;">${esc(d.classification)}</strong>${actionText}</div>
          <div style="font-size:12px;color:#c9d1d9;margin-top:4px;">${esc(d.reasoning)}</div>
          ${planBits ? `<div style="font-size:11px;color:#8b949e;margin-top:4px;">${planBits}</div>` : ""}
          ${d.correlation_notes ? `<div style="font-size:11px;color:#8b949e;margin-top:4px;">Correlation: ${esc(d.correlation_notes)}</div>` : ""}
          ${d.thesis_delta && d.thesis_delta !== "no change" ? `<div style="font-size:11px;color:#8b949e;margin-top:4px;">Thesis: ${esc(d.thesis_delta)}</div>` : ""}
        </div>`;
      }
      html += `</div>`;
    }

    res.send(html);
  } catch (err) {
    res.send(`<div style="padding:20px;color:#f85149;">Event detail error: ${(err as Error).message}</div>`);
  }
});

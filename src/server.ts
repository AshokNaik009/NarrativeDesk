import express from "express";
import { config } from "./config.js";
import { initDb, query } from "./db/client.js";
import { transition } from "./hitl/ApprovalStateMachine.js";
import { ApprovalStatus } from "./types.js";
import { getHealth, getMetrics } from "./utils/health.js";
import { computeFullReport } from "./metrics/MetricsCalculator.js";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware: Dashboard secret authentication for /approvals routes
// HTMX requests from the dashboard itself (same-origin with HX-Request header) are trusted.
// External API calls must provide X-Dashboard-Secret.
app.use((req, res, next) => {
  if (req.path.startsWith("/approvals")) {
    const isHtmx = req.headers["hx-request"] === "true";
    const secret = req.headers["x-dashboard-secret"];
    if (!isHtmx && secret !== config.dashboardSecret) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }
  next();
});

// Health check — detailed service status
app.get("/health", async (_req, res) => {
  try {
    const health = await getHealth();
    const statusCode = health.services.every((s) => s.status === "ok") ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (err) {
    res.status(503).json({
      status: "error",
      error: (err as Error).message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Metrics endpoint — activity metrics
app.get("/metrics", async (_req, res) => {
  try {
    const metrics = await getMetrics();
    res.json(metrics);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Full metrics report (Layers 2-4)
app.get("/metrics/full", async (req, res) => {
  try {
    const days = parseInt((req.query.days as string) || "7");
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const report = await computeFullReport(since);
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Dashboard home — HTMX approvals dashboard
app.get("/", (_req, res) => {
  try {
    // Serve the HTMX dashboard HTML
    const dashboardPath = join(__dirname, "dashboard", "views", "approvals.html");
    const html = readFileSync(dashboardPath, "utf-8");
    res.send(html);
  } catch (err) {
    // Fallback: serve stats if dashboard file not found
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>NarrativeDesk</title>
        <style>
          body { font-family: system-ui; max-width: 800px; margin: 2rem auto; padding: 0 1rem; background: #0d1117; color: #c9d1d9; }
          h1 { color: #58a6ff; }
          .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1rem; margin: 1rem 0; }
        </style>
      </head>
      <body>
        <h1>NarrativeDesk</h1>
        <div class="card">
          <p>Dashboard loading... Check /health for status</p>
        </div>
      </body>
      </html>
    `);
  }
});

// Render helpers — shared between /activity (initial) and /activity/older (pagination)
function renderFilterRow(row: any): { time: Date; html: string } {
  const time = new Date(row.created_at);
  const timeStr = time.toLocaleTimeString();
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
  const reason = row.passed ? "passed filter" : esc(row.reason);
  const kind = row.passed ? "passed" : "filtered";
  return {
    time,
    html: `<div class="activity-row" data-kind="${kind}" style="padding:8px 0;border-bottom:1px solid #21262d;">
      <div style="display:flex;gap:12px;align-items:flex-start;cursor:pointer;" onclick="openDetail('/activity/event/${esc(row.event_id)}')">
        <span style="color:${color};font-size:16px;line-height:1;min-width:16px;">${icon}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;color:#8b949e;">${timeStr} &middot; ${sourceName}</div>
          <div style="font-size:13px;color:#c9d1d9;word-break:break-word;">${label}</div>
          <div style="font-size:11px;color:${row.passed ? "#3fb950" : "#484f58"};">${reason}</div>
        </div>
      </div>
    </div>`,
  };
}

function renderDecisionRow(row: any): { time: Date; html: string } {
  const time = new Date(row.created_at);
  const timeStr = time.toLocaleTimeString();
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

// GET /activity - Live activity feed showing everything the system is doing
app.get("/activity", async (_req, res) => {
  try {
    // 1. Recent filter decisions + event data for modal detail (last 30 min)
    const filterResult = await query(
      `SELECT fd.passed, fd.reason, fd.created_at,
              e.id as event_id, e.headline, e.symbol, e.type as event_type, e.source, e.raw_payload
       FROM filter_decisions fd
       JOIN events e ON fd.event_id = e.id
       WHERE fd.created_at > NOW() - INTERVAL '30 minutes'
       ORDER BY fd.created_at DESC LIMIT 30`
    );

    // 3. Recent agent decisions (ALL, not just "act" — last 2 hours) + event link
    const decisionsResult = await query(
      `SELECT pd.classification, pd.reasoning, pd.coin, pd.side, pd.size_pct,
              pd.thesis_delta, pd.created_at,
              ai.event_id, ai.model, ai.latency_ms, ai.prompt_tokens, ai.completion_tokens
       FROM proposed_decisions pd
       LEFT JOIN agent_invocations ai ON pd.agent_invocation_id = ai.id
       ORDER BY pd.created_at DESC LIMIT 20`
    );

    // 4. Summary counts
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

    // Build HTML
    // Stats bar
    let html = `<div id="activity-section" hx-get="/activity" hx-trigger="every 15s" hx-swap="outerHTML" style="margin-top:12px;margin-bottom:32px;">`;

    html += `<div class="summary-bar" style="grid-template-columns:repeat(6,1fr);">
      <div class="summary-card"><div class="summary-card-label">Events (1h)</div><div class="summary-card-value" style="font-size:24px;">${stats.events_1h || 0}</div></div>
      <div class="summary-card"><div class="summary-card-label">Filtered Out</div><div class="summary-card-value" style="font-size:24px;color:#8b949e;">${stats.filtered_1h || 0}</div></div>
      <div class="summary-card"><div class="summary-card-label">Passed Filter</div><div class="summary-card-value" style="font-size:24px;color:#3fb950;">${stats.passed_1h || 0}</div></div>
      <div class="summary-card"><div class="summary-card-label">Agent Calls</div><div class="summary-card-value" style="font-size:24px;color:#58a6ff;">${stats.agent_calls_1h || 0}</div></div>
      <div class="summary-card"><div class="summary-card-label">Decisions (1h)</div><div class="summary-card-value" style="font-size:24px;">${stats.decisions_1h || 0}</div></div>
      <div class="summary-card pending"><div class="summary-card-label">Acts (24h)</div><div class="summary-card-value" style="font-size:24px;">${stats.acts_24h || 0}</div></div>
    </div>`;

    // Activity timeline
    html += `<div style="background:#161b22;border:1px solid #30363d;border-radius:6px;padding:16px;max-height:600px;overflow-y:auto;">`;

    // Merge filter decisions and agent decisions into a single timeline
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

// GET /activity/older?before=<iso>&limit=40 - Infinite scroll pagination
app.get("/activity/older", async (req, res) => {
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

// GET /activity/event/:eventId - Full lifecycle detail for detail modal
app.get("/activity/event/:eventId", async (req, res) => {
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
      `SELECT id, classification, reasoning, coin, side, size_pct, invalidation, thesis_delta, created_at
       FROM proposed_decisions WHERE agent_invocation_id = ANY($1::uuid[]) ORDER BY created_at DESC`,
      [invRes.rows.map((r) => r.id)]
    );

    const payload = typeof ev.raw_payload === "string" ? JSON.parse(ev.raw_payload) : ev.raw_payload;
    const url = payload?.url ? `<a href="${esc(payload.url)}" target="_blank" rel="noopener" style="color:#58a6ff;">${esc(payload.url)}</a>` : "";

    let html = `<div style="font-size:13px;color:#c9d1d9;">
      <div style="font-size:11px;color:#8b949e;text-transform:uppercase;margin-bottom:6px;">Event</div>
      <div style="margin-bottom:4px;"><strong>${esc(ev.type)}</strong> &middot; ${esc(ev.source || "")} &middot; ${new Date(ev.created_at).toLocaleString()}</div>
      ${ev.headline ? `<div style="margin-bottom:4px;">${esc(ev.headline)}</div>` : ""}
      ${url ? `<div style="margin-bottom:4px;font-size:12px;">${url}</div>` : ""}
    </div>`;

    if (filterRes.rows.length > 0) {
      html += `<div style="margin-top:16px;"><div style="font-size:11px;color:#8b949e;text-transform:uppercase;margin-bottom:6px;">Filter</div>`;
      for (const f of filterRes.rows) {
        html += `<div style="font-size:12px;color:${f.passed ? "#3fb950" : "#8b949e"};">${f.passed ? "PASSED" : "FILTERED OUT"} &mdash; ${esc(f.reason || "")}</div>`;
      }
      html += `</div>`;
    }

    if (invRes.rows.length > 0) {
      html += `<div style="margin-top:16px;"><div style="font-size:11px;color:#8b949e;text-transform:uppercase;margin-bottom:6px;">Agent invocations</div>`;
      for (const inv of invRes.rows) {
        html += `<div style="font-size:12px;color:#8b949e;margin-bottom:4px;">${esc(inv.model)} &middot; ${inv.latency_ms}ms &middot; ${(inv.prompt_tokens || 0) + (inv.completion_tokens || 0)} tokens &middot; ${new Date(inv.created_at).toLocaleTimeString()}</div>`;
      }
      html += `</div>`;
    }

    if (decRes.rows.length > 0) {
      html += `<div style="margin-top:16px;"><div style="font-size:11px;color:#8b949e;text-transform:uppercase;margin-bottom:6px;">Decisions</div>`;
      for (const d of decRes.rows) {
        const actionText = d.side ? ` &middot; ${d.side.toUpperCase()} ${d.size_pct}% ${d.coin}` : "";
        html += `<div style="padding:8px 0;border-bottom:1px solid #21262d;">
          <div style="font-size:12px;"><strong style="color:#d29922;">${esc(d.classification)}</strong>${actionText}</div>
          <div style="font-size:12px;color:#c9d1d9;margin-top:4px;">${esc(d.reasoning)}</div>
          ${d.invalidation ? `<div style="font-size:11px;color:#8b949e;margin-top:4px;">Invalidation: ${esc(d.invalidation)}</div>` : ""}
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

// Helper: render countdown string from expires_at
function renderCountdown(expiresAt: Date): { text: string; css: string } {
  const remaining = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  const text = `${m}m ${s.toString().padStart(2, "0")}s`;
  const css = remaining < 300 ? "danger" : remaining < 600 ? "warning" : "safe";
  return { text, css };
}

// Helper: escape HTML
function esc(str: string | null | undefined): string {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// GET /approvals - Returns HTML for HTMX, JSON for API calls
app.get("/approvals", async (req, res) => {
  try {
    const isHtmx = req.headers["hx-request"] === "true";

    // Pending approvals
    const pendingResult = await query(
      `SELECT
        pa.id, pa.status, pa.expires_at, pa.created_at,
        pd.classification, pd.reasoning, pd.thesis_delta,
        pd.side, pd.coin, pd.size_pct, pd.invalidation, pd.time_horizon,
        ai.model
      FROM pending_approvals pa
      JOIN proposed_decisions pd ON pa.decision_id = pd.id
      LEFT JOIN agent_invocations ai ON pd.agent_invocation_id = ai.id
      WHERE pa.status = 'pending'
      ORDER BY pa.expires_at ASC`
    );

    // Counts for summary bar
    const countsResult = await query(
      `SELECT status, COUNT(*)::int as count FROM pending_approvals GROUP BY status`
    );
    const counts = { pending: 0, approved: 0, rejected: 0, edited: 0, expired: 0 };
    for (const row of countsResult.rows) {
      if (row.status in counts) counts[row.status as keyof typeof counts] = row.count;
    }

    if (!isHtmx) {
      // JSON response for API consumers
      const approvals = pendingResult.rows.map((row) => ({
        id: row.id, status: row.status,
        headline: `${row.classification.toUpperCase()}: ${row.coin || "N/A"}`,
        decision: row.classification, reasoning: row.reasoning, thesis_delta: row.thesis_delta,
        action: { side: row.side, coin: row.coin, size_pct: row.size_pct, invalidation: row.invalidation },
        expires_at: row.expires_at, created_at: row.created_at, model: row.model,
      }));
      return res.json(approvals);
    }

    // HTML response for HTMX
    let cardsHtml = "";
    if (pendingResult.rows.length === 0) {
      cardsHtml = `<div style="text-align:center;padding:40px;color:#8b949e;">No pending approvals. The agent is watching the market.</div>`;
    } else {
      for (const row of pendingResult.rows) {
        const cd = renderCountdown(new Date(row.expires_at));
        const sideCss = row.side === "buy" ? "buy" : "sell";
        cardsHtml += `
        <div class="approval-item">
          <div class="approval-item-header">
            <div class="countdown-timer ${cd.css}">${cd.text}</div>
            <div>
              <div class="approval-headline">${esc(row.classification.toUpperCase())}: ${esc(row.coin) || "N/A"}</div>
              <span class="approval-status-badge pending">pending</span>
            </div>
          </div>
          <div class="approval-content">
            <div class="approval-section">
              <div class="approval-section-label">Decision</div>
              <div class="approval-section-value">
                <span class="classification">${esc(row.classification)}</span>
                <div style="margin-top:8px;">${esc(row.reasoning)}</div>
                ${row.thesis_delta && row.thesis_delta !== "no change" ? `<div style="margin-top:6px;font-size:11px;color:#8b949e;">Thesis delta: ${esc(row.thesis_delta)}</div>` : ""}
              </div>
            </div>
            <div class="approval-section">
              <div class="approval-section-label">Action</div>
              <div class="approval-section-value">
                ${row.side ? `
                <div class="action-badge ${sideCss}">
                  <span>${esc(row.side?.toUpperCase())}</span>
                  <span>${row.size_pct}%</span>
                  <span>${esc(row.coin)}</span>
                </div>
                <div style="margin-top:8px;font-size:11px;color:#8b949e;">Invalidation: ${esc(row.invalidation)}</div>
                <div style="margin-top:4px;font-size:11px;color:#8b949e;">Horizon: ${esc(row.time_horizon)}</div>
                ` : `<span style="color:#8b949e;">No action</span>`}
              </div>
            </div>
          </div>
          <div class="approval-actions">
            <button class="btn btn-approve" onclick="openModal('approve','${row.id}')">Approve</button>
            <button class="btn btn-reject" onclick="openModal('reject','${row.id}')">Reject</button>
            <button class="btn btn-edit" onclick="openModal('edit','${row.id}')">Edit</button>
          </div>
        </div>`;
      }
    }

    const html = `
    <div id="approvals-section" hx-get="/approvals" hx-trigger="every 3s" hx-swap="outerHTML">
      <div class="summary-bar">
        <div class="summary-card pending"><div class="summary-card-label">Pending</div><div class="summary-card-value">${counts.pending}</div></div>
        <div class="summary-card approved"><div class="summary-card-label">Approved</div><div class="summary-card-value">${counts.approved}</div></div>
        <div class="summary-card rejected"><div class="summary-card-label">Rejected</div><div class="summary-card-value">${counts.rejected + counts.expired}</div></div>
      </div>
      <div class="approvals-list">${cardsHtml}</div>
    </div>`;

    res.send(html);
  } catch (err) {
    res.status(500).send(`<div style="color:#f85149;">Error loading approvals: ${(err as Error).message}</div>`);
  }
});

// GET /portfolio - HTMX partial for portfolio state
app.get("/portfolio", async (_req, res) => {
  try {
    const result = await query(
      `SELECT cash, total_value, positions, created_at
       FROM portfolio_snapshots ORDER BY created_at DESC LIMIT 1`
    );

    if (result.rows.length === 0) {
      return res.send(`<div style="text-align:center;padding:20px;color:#8b949e;">No portfolio data yet.</div>`);
    }

    const snap = result.rows[0];
    const positions = snap.positions || [];
    const positionsHtml = positions.length === 0
      ? `<div style="color:#8b949e;font-size:13px;">No open positions</div>`
      : positions.map((p: any) => `
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #21262d;">
          <span><span class="action-badge ${p.side === "buy" ? "buy" : "sell"}" style="padding:2px 6px;font-size:11px;">${p.side?.toUpperCase()}</span> ${esc(p.coin)}</span>
          <span>${p.size_pct?.toFixed(1)}% @ $${p.entryPrice?.toLocaleString()}</span>
        </div>`).join("");

    res.send(`
    <div id="portfolio-section" hx-get="/portfolio" hx-trigger="every 10s" hx-swap="outerHTML">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
        <div class="summary-card"><div class="summary-card-label">Cash</div><div class="summary-card-value" style="font-size:24px;">$${parseFloat(snap.cash || 0).toLocaleString()}</div></div>
        <div class="summary-card"><div class="summary-card-label">Total Value</div><div class="summary-card-value" style="font-size:24px;">$${parseFloat(snap.total_value || 0).toLocaleString()}</div></div>
      </div>
      <div style="background:#161b22;border:1px solid #30363d;border-radius:6px;padding:16px;">
        <div style="font-size:12px;color:#8b949e;text-transform:uppercase;margin-bottom:12px;">Positions</div>
        ${positionsHtml}
      </div>
    </div>`);
  } catch (err) {
    res.send(`<div style="color:#f85149;">Error: ${(err as Error).message}</div>`);
  }
});

// GET /thesis - HTMX partial for current thesis + version history
app.get("/thesis", async (_req, res) => {
  try {
    const result = await query(
      `SELECT content, created_at FROM thesis_versions ORDER BY created_at DESC LIMIT 1`
    );

    const thesis = result.rows[0];
    const content = thesis?.content || "No thesis yet. Agent is observing.";
    const updated = thesis?.created_at ? new Date(thesis.created_at).toLocaleString() : "never";

    // Get thesis version history
    const historyResult = await query(
      `SELECT id, content, created_at FROM thesis_versions ORDER BY created_at DESC LIMIT 20`
    );

    const versionRows = historyResult.rows
      .map((v) => {
        const preview = v.content?.slice(0, 150)?.split('\n')[0] || "(empty)";
        return `
        <div style="border-bottom:1px solid #21262d;display:flex;gap:12px;padding:10px 12px;cursor:pointer;" onclick="openDetail('/thesis/version/${esc(v.id)}')">
          <div style="font-size:11px;color:#8b949e;min-width:140px;">${new Date(v.created_at).toLocaleString()}</div>
          <div style="flex:1;font-size:12px;color:#c9d1d9;">${esc(preview)}</div>
        </div>`;
      })
      .join("");

    res.send(`
    <div id="thesis-section" hx-get="/thesis" hx-trigger="every 15s" hx-swap="outerHTML">
      <div style="background:#161b22;border:1px solid #30363d;border-radius:6px;padding:16px;margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:12px;">
          <span style="font-size:12px;color:#8b949e;text-transform:uppercase;">Current Thesis</span>
          <span style="font-size:11px;color:#8b949e;">Updated: ${esc(updated)}</span>
        </div>
        <div style="font-size:13px;line-height:1.6;white-space:pre-wrap;">${esc(content)}</div>
      </div>
      <div style="background:#161b22;border:1px solid #30363d;border-radius:6px;overflow-y:auto;max-height:400px;">
        <div style="padding:12px;border-bottom:1px solid #30363d;font-size:12px;color:#8b949e;text-transform:uppercase;font-weight:600;">Click a row for details</div>
        ${versionRows || '<div style="padding:12px;color:#8b949e;">No thesis versions yet.</div>'}
      </div>
    </div>`);
  } catch (err) {
    res.send(`<div style="color:#f85149;">Error: ${(err as Error).message}</div>`);
  }
});

// GET /thesis/version/:id - Thesis version detail (opens in modal)
app.get("/thesis/version/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT id, content, created_at FROM thesis_versions WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).send(`<div style="color:#f85149;">Version not found</div>`);
    }

    const v = result.rows[0];
    res.send(`
      <div style="background:#161b22;border:1px solid #30363d;border-radius:6px;padding:16px;">
        <div style="margin-bottom:12px;">
          <span style="font-size:12px;color:#8b949e;text-transform:uppercase;">Thesis Version</span>
          <div style="font-size:11px;color:#8b949e;margin-top:4px;">${new Date(v.created_at).toLocaleString()}</div>
        </div>
        <div style="font-size:13px;line-height:1.6;white-space:pre-wrap;color:#c9d1d9;">${esc(v.content)}</div>
      </div>`);
  } catch (err) {
    res.status(500).send(`<div style="color:#f85149;">Error: ${(err as Error).message}</div>`);
  }
});

// GET /decisions - HTMX partial for recent decisions
app.get("/decisions", async (_req, res) => {
  try {
    const result = await query(
      `SELECT
        pd.classification, pd.reasoning, pd.coin, pd.side, pd.size_pct, pd.created_at,
        pa.status as approval_status, pa.tag,
        et.entry_price, et.close_price, et.close_reason, et.closed_at
      FROM proposed_decisions pd
      LEFT JOIN pending_approvals pa ON pa.decision_id = pd.id
      LEFT JOIN executed_trades et ON et.approval_id = pa.id
      ORDER BY pd.created_at DESC
      LIMIT 20`
    );

    if (result.rows.length === 0) {
      return res.send(`<div id="decisions-section" hx-get="/decisions" hx-trigger="every 10s" hx-swap="outerHTML"><div style="text-align:center;padding:20px;color:#8b949e;">No decisions yet.</div></div>`);
    }

    const rowsHtml = result.rows.map((r) => {
      const statusColor: Record<string, string> = { approved: "#3fb950", rejected: "#f85149", edited: "#58a6ff", expired: "#8b949e", pending: "#d29922" };
      const color = statusColor[r.approval_status] || "#8b949e";
      const pnl = r.entry_price && r.close_price
        ? (r.side === "buy"
          ? ((r.close_price - r.entry_price) / r.entry_price * 100)
          : ((r.entry_price - r.close_price) / r.entry_price * 100)).toFixed(2)
        : null;
      const pnlColor = pnl !== null ? (parseFloat(pnl) >= 0 ? "#3fb950" : "#f85149") : "#8b949e";

      return `
      <tr style="border-bottom:1px solid #21262d;">
        <td style="padding:8px;font-size:12px;color:#8b949e;">${new Date(r.created_at).toLocaleString()}</td>
        <td style="padding:8px;"><span class="classification">${esc(r.classification)}</span></td>
        <td style="padding:8px;">${esc(r.coin) || "-"}</td>
        <td style="padding:8px;">${r.side ? `${r.side.toUpperCase()} ${r.size_pct}%` : "-"}</td>
        <td style="padding:8px;"><span style="color:${color};">${esc(r.approval_status) || "-"}</span></td>
        <td style="padding:8px;">${esc(r.tag) || "-"}</td>
        <td style="padding:8px;color:${pnlColor};">${pnl !== null ? `${pnl}%` : "-"}</td>
      </tr>`;
    }).join("");

    res.send(`
    <div id="decisions-section" hx-get="/decisions" hx-trigger="every 10s" hx-swap="outerHTML">
      <div style="background:#161b22;border:1px solid #30363d;border-radius:6px;overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid #30363d;">
              <th style="padding:10px 8px;text-align:left;font-size:11px;color:#8b949e;text-transform:uppercase;">Time</th>
              <th style="padding:10px 8px;text-align:left;font-size:11px;color:#8b949e;text-transform:uppercase;">Class</th>
              <th style="padding:10px 8px;text-align:left;font-size:11px;color:#8b949e;text-transform:uppercase;">Coin</th>
              <th style="padding:10px 8px;text-align:left;font-size:11px;color:#8b949e;text-transform:uppercase;">Action</th>
              <th style="padding:10px 8px;text-align:left;font-size:11px;color:#8b949e;text-transform:uppercase;">Status</th>
              <th style="padding:10px 8px;text-align:left;font-size:11px;color:#8b949e;text-transform:uppercase;">Tag</th>
              <th style="padding:10px 8px;text-align:left;font-size:11px;color:#8b949e;text-transform:uppercase;">P&L</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </div>`);
  } catch (err) {
    res.send(`<div style="color:#f85149;">Error: ${(err as Error).message}</div>`);
  }
});

// GET /approvals/:id - Get single approval by ID
app.get("/approvals/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT
        pa.id,
        pa.status,
        pa.tag,
        pa.tag_freetext,
        pa.edited_size_pct,
        pa.expires_at,
        pa.created_at,
        pa.resolved_at,
        pd.id as decision_id,
        pd.classification,
        pd.reasoning,
        pd.thesis_delta,
        pd.side,
        pd.coin,
        pd.size_pct,
        pd.invalidation,
        pd.time_horizon,
        ai.model
      FROM pending_approvals pa
      JOIN proposed_decisions pd ON pa.decision_id = pd.id
      LEFT JOIN agent_invocations ai ON pd.agent_invocation_id = ai.id
      WHERE pa.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Approval not found" });
    }

    const row = result.rows[0];
    const approval = {
      id: row.id,
      status: row.status,
      headline: `${row.classification.toUpperCase()}: ${row.coin || "N/A"}`,
      decision: row.classification,
      reasoning: row.reasoning,
      thesis_delta: row.thesis_delta,
      action: {
        side: row.side,
        coin: row.coin,
        size_pct: row.size_pct,
        invalidation: row.invalidation,
      },
      expires_at: row.expires_at,
      created_at: row.created_at,
      resolved_at: row.resolved_at,
      tag: row.tag,
      tag_freetext: row.tag_freetext,
      edited_size_pct: row.edited_size_pct,
      model: row.model,
    };

    res.json(approval);
  } catch (err) {
    res.status(500).json({ error: `Database error: ${err}` });
  }
});

// POST /approvals/:id/approve - Approve a pending approval
app.post("/approvals/:id/approve", async (req, res) => {
  try {
    const { id } = req.params;
    const { tag, freetext } = req.body;

    if (!tag) {
      return res.status(400).json({ error: "tag is required" });
    }

    // Fetch current approval state
    const stateResult = await query(
      `SELECT id, status, expires_at
       FROM pending_approvals
       WHERE id = $1`,
      [id]
    );

    if (stateResult.rows.length === 0) {
      return res.status(404).json({ error: "Approval not found" });
    }

    const approval = stateResult.rows[0];
    const now = new Date();

    // Use state machine to validate transition
    const transitionResult = transition(
      {
        id: approval.id,
        status: approval.status as ApprovalStatus,
        expiresAt: new Date(approval.expires_at),
      },
      "approve",
      now,
      tag
    );

    if (!transitionResult.success) {
      return res.status(400).json({ error: transitionResult.error });
    }

    // Update approval
    const updateResult = await query(
      `UPDATE pending_approvals
       SET status = 'approved', tag = $2, tag_freetext = $3, resolved_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, tag, freetext || null]
    );

    const updated = updateResult.rows[0];
    res.json({
      id: updated.id,
      status: updated.status,
      tag: updated.tag,
      tag_freetext: updated.tag_freetext,
      resolved_at: updated.resolved_at,
    });
  } catch (err) {
    res.status(500).json({ error: `Database error: ${err}` });
  }
});

// POST /approvals/:id/reject - Reject a pending approval
app.post("/approvals/:id/reject", async (req, res) => {
  try {
    const { id } = req.params;
    const { tag, freetext } = req.body;

    if (!tag) {
      return res.status(400).json({ error: "tag is required" });
    }

    // Fetch current approval state
    const stateResult = await query(
      `SELECT id, status, expires_at
       FROM pending_approvals
       WHERE id = $1`,
      [id]
    );

    if (stateResult.rows.length === 0) {
      return res.status(404).json({ error: "Approval not found" });
    }

    const approval = stateResult.rows[0];
    const now = new Date();

    // Use state machine to validate transition
    const transitionResult = transition(
      {
        id: approval.id,
        status: approval.status as ApprovalStatus,
        expiresAt: new Date(approval.expires_at),
      },
      "reject",
      now,
      tag
    );

    if (!transitionResult.success) {
      return res.status(400).json({ error: transitionResult.error });
    }

    // Update approval
    const updateResult = await query(
      `UPDATE pending_approvals
       SET status = 'rejected', tag = $2, tag_freetext = $3, resolved_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, tag, freetext || null]
    );

    const updated = updateResult.rows[0];
    res.json({
      id: updated.id,
      status: updated.status,
      tag: updated.tag,
      tag_freetext: updated.tag_freetext,
      resolved_at: updated.resolved_at,
    });
  } catch (err) {
    res.status(500).json({ error: `Database error: ${err}` });
  }
});

// POST /approvals/:id/edit - Edit and approve a pending approval
app.post("/approvals/:id/edit", async (req, res) => {
  try {
    const { id } = req.params;
    const { tag, freetext, edited_size_pct } = req.body;

    if (!tag) {
      return res.status(400).json({ error: "tag is required" });
    }

    if (edited_size_pct === undefined) {
      return res.status(400).json({ error: "edited_size_pct is required" });
    }

    if (typeof edited_size_pct !== "number" || edited_size_pct <= 0) {
      return res.status(400).json({ error: "edited_size_pct must be a positive number" });
    }

    // Fetch current approval state
    const stateResult = await query(
      `SELECT id, status, expires_at
       FROM pending_approvals
       WHERE id = $1`,
      [id]
    );

    if (stateResult.rows.length === 0) {
      return res.status(404).json({ error: "Approval not found" });
    }

    const approval = stateResult.rows[0];
    const now = new Date();

    // Use state machine to validate transition
    const transitionResult = transition(
      {
        id: approval.id,
        status: approval.status as ApprovalStatus,
        expiresAt: new Date(approval.expires_at),
      },
      "edit",
      now,
      tag,
      edited_size_pct
    );

    if (!transitionResult.success) {
      return res.status(400).json({ error: transitionResult.error });
    }

    // Update approval
    const updateResult = await query(
      `UPDATE pending_approvals
       SET status = 'edited', tag = $2, tag_freetext = $3, edited_size_pct = $4, resolved_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, tag, freetext || null, edited_size_pct]
    );

    const updated = updateResult.rows[0];
    res.json({
      id: updated.id,
      status: updated.status,
      tag: updated.tag,
      tag_freetext: updated.tag_freetext,
      edited_size_pct: updated.edited_size_pct,
      resolved_at: updated.resolved_at,
    });
  } catch (err) {
    res.status(500).json({ error: `Database error: ${err}` });
  }
});

// GET /pulse - System status header (pending count + worker heartbeat)
app.get("/pulse", async (_req, res) => {
  try {
    const pending = await query(`SELECT COUNT(*)::int as n FROM pending_approvals WHERE status = 'pending'`);
    const lastEvent = await query(`SELECT MAX(created_at) as ts FROM events`);
    const n = pending.rows[0]?.n || 0;
    const lastTs = lastEvent.rows[0]?.ts ? new Date(lastEvent.rows[0].ts) : null;
    const ageSec = lastTs ? Math.floor((Date.now() - lastTs.getTime()) / 1000) : null;
    const workerOk = ageSec !== null && ageSec < 300;
    const dot = workerOk ? "#3fb950" : "#f85149";
    const workerLabel = workerOk ? `worker live (${ageSec}s ago)` : ageSec === null ? "no events yet" : `stale (${ageSec}s)`;
    const badge = n > 0 ? `<span style="background:#d29922;color:#0d1117;padding:2px 8px;border-radius:10px;font-weight:600;margin-left:8px;">${n} pending</span>` : "";
    res.send(`<span style="display:inline-flex;align-items:center;gap:8px;"><span style="width:8px;height:8px;border-radius:50%;background:${dot};display:inline-block;"></span><span style="color:#8b949e;font-size:12px;">${workerLabel}</span>${badge}</span>`);
  } catch (err) {
    res.send(`<span style="color:#f85149;font-size:12px;">pulse error</span>`);
  }
});

// GET /chat - Render message history for current session
app.get("/chat", async (_req, res) => {
  try {
    const sessionId = "default";
    const rows = await query(
      `SELECT role, content, created_at FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT 50`,
      [sessionId]
    );
    if (rows.rows.length === 0) {
      return res.send(`<div style="color:#8b949e;text-align:center;padding:20px;font-size:13px;">Ask about the thesis, a coin, or a past decision. The agent sees current thesis, portfolio, and last 10 decisions.</div>`);
    }
    let html = "";
    for (const m of rows.rows) {
      const mine = m.role === "user";
      const bg = mine ? "#1f6feb" : "#21262d";
      const color = mine ? "#ffffff" : "#c9d1d9";
      const align = mine ? "flex-end" : "flex-start";
      html += `<div style="display:flex;justify-content:${align};margin-bottom:10px;"><div style="max-width:75%;background:${bg};color:${color};padding:8px 12px;border-radius:12px;font-size:13px;white-space:pre-wrap;">${esc(m.content)}</div></div>`;
    }
    res.send(html);
  } catch (err) {
    res.send(`<div style="color:#f85149;padding:12px;font-size:12px;">Chat load error: ${(err as Error).message}</div>`);
  }
});

// POST /chat - Submit a user message, run invokeChatAgent, persist both sides
app.post("/chat", async (req, res) => {
  try {
    const sessionId = "default";
    const userMessage = String(req.body.message || "").trim().slice(0, 2000);
    if (!userMessage) {
      return res.send("");
    }

    await query(
      `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'user', $2)`,
      [sessionId, userMessage]
    );

    const thesisRow = await query(`SELECT content FROM thesis_versions ORDER BY created_at DESC LIMIT 1`);
    const portfolioRow = await query(`SELECT state FROM portfolio_snapshots ORDER BY created_at DESC LIMIT 1`);
    const decisionsRows = await query(
      `SELECT classification, coin, reasoning, created_at FROM proposed_decisions ORDER BY created_at DESC LIMIT 10`
    );
    const historyRows = await query(
      `SELECT role, content FROM chat_messages WHERE session_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [sessionId]
    );

    const { invokeChatAgent } = await import("./agent/features.js");
    const result = await invokeChatAgent(
      userMessage,
      {
        thesis: thesisRow.rows[0]?.content || "No thesis yet.",
        portfolio: portfolioRow.rows[0]?.state ? JSON.stringify(portfolioRow.rows[0].state) : "No portfolio snapshot.",
        recentDecisions: decisionsRows.rows.map((d) => ({
          classification: d.classification,
          coin: d.coin,
          reasoning: d.reasoning || "",
          created_at: new Date(d.created_at).toISOString(),
        })),
      },
      historyRows.rows.reverse().slice(0, -1).map((h) => ({ role: h.role as "user" | "assistant", content: h.content }))
    );

    const reply = result.reply || "(no response — check API key or rate limits)";
    await query(
      `INSERT INTO chat_messages (session_id, role, content, prompt_tokens, completion_tokens)
       VALUES ($1, 'assistant', $2, $3, $4)`,
      [sessionId, reply, result.tokens.prompt, result.tokens.completion]
    );

    // Append both bubbles (HTMX beforeend)
    const userHtml = `<div style="display:flex;justify-content:flex-end;margin-bottom:10px;"><div style="max-width:75%;background:#1f6feb;color:#ffffff;padding:8px 12px;border-radius:12px;font-size:13px;white-space:pre-wrap;">${esc(userMessage)}</div></div>`;
    const botHtml = `<div style="display:flex;justify-content:flex-start;margin-bottom:10px;"><div style="max-width:75%;background:#21262d;color:#c9d1d9;padding:8px 12px;border-radius:12px;font-size:13px;white-space:pre-wrap;">${esc(reply)}</div></div>`;
    res.send(userHtml + botHtml);
  } catch (err) {
    res.send(`<div style="color:#f85149;padding:12px;font-size:12px;">Chat error: ${(err as Error).message}</div>`);
  }
});

async function main() {
  await initDb();

  app.listen(config.port, () => {
    console.log(`[Server] NarrativeDesk dashboard running on port ${config.port}`);
  });
}

main().catch((err) => {
  console.error("[Server] Fatal error:", err);
  process.exit(1);
});

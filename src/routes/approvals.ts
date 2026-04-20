import { Router } from "express";
import { config } from "../config.js";
import { query } from "../db/client.js";
import { transition } from "../hitl/ApprovalStateMachine.js";
import { ApprovalStatus } from "../types.js";
import { esc, renderCountdown } from "./shared.js";

export const approvalsRouter = Router();

// Auth: HTMX same-origin trusted, external calls need secret header
approvalsRouter.use((req, res, next) => {
  const isHtmx = req.headers["hx-request"] === "true";
  const secret = req.headers["x-dashboard-secret"];
  if (!isHtmx && secret !== config.dashboardSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

approvalsRouter.get("/approvals", async (req, res) => {
  try {
    const isHtmx = req.headers["hx-request"] === "true";

    const pendingResult = await query(
      `SELECT
        pa.id, pa.status, pa.expires_at, pa.created_at,
        pd.classification, pd.reasoning, pd.thesis_delta,
        pd.side, pd.coin, pd.size_pct, pd.entry_zone_low, pd.entry_zone_high, pd.invalidation_price, pd.target_price, pd.timeframe, pd.correlation_notes, pd.conviction,
        ai.model
      FROM pending_approvals pa
      JOIN proposed_decisions pd ON pa.decision_id = pd.id
      LEFT JOIN agent_invocations ai ON pd.agent_invocation_id = ai.id
      WHERE pa.status = 'pending'
      ORDER BY pa.expires_at ASC`
    );

    const countsResult = await query(
      `SELECT status, COUNT(*)::int as count FROM pending_approvals GROUP BY status`
    );
    const counts = { pending: 0, approved: 0, rejected: 0, edited: 0, expired: 0 };
    for (const row of countsResult.rows) {
      if (row.status in counts) counts[row.status as keyof typeof counts] = row.count;
    }

    if (!isHtmx) {
      const approvals = pendingResult.rows.map((row) => ({
        id: row.id, status: row.status,
        headline: `${row.classification.toUpperCase()}: ${row.coin || "N/A"}`,
        decision: row.classification, reasoning: row.reasoning, thesis_delta: row.thesis_delta,
        trade_plan: row.side ? { side: row.side, coin: row.coin, size_pct: row.size_pct, entry_zone: [row.entry_zone_low, row.entry_zone_high], invalidation: row.invalidation_price, target: row.target_price, timeframe: row.timeframe, correlation_notes: row.correlation_notes, conviction: row.conviction } : null,
        expires_at: row.expires_at, created_at: row.created_at, model: row.model,
      }));
      return res.json(approvals);
    }

    let cardsHtml = "";
    if (pendingResult.rows.length === 0) {
      cardsHtml = `<div style="text-align:center;padding:40px;color:#8b949e;">No pending approvals. The agent is watching the market.</div>`;
    } else {
      for (const row of pendingResult.rows) {
        const cd = renderCountdown(new Date(row.expires_at));
        const sideCss = row.side === "buy" ? "buy" : "sell";
        const entryZoneStr = row.entry_zone_low !== null && row.entry_zone_high !== null
          ? `$${parseFloat(row.entry_zone_low).toFixed(2)} – $${parseFloat(row.entry_zone_high).toFixed(2)}`
          : "N/A";
        const invalidationStr = row.invalidation_price !== null ? `$${parseFloat(row.invalidation_price).toFixed(2)}` : "N/A";
        const targetStr = row.target_price !== null ? `$${parseFloat(row.target_price).toFixed(2)}` : "N/A";
        const convictionStr = row.conviction !== null ? `${row.conviction}/5` : "N/A";

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
              <div class="approval-section-label">Trade Plan</div>
              <div class="approval-section-value">
                ${row.side ? `
                <div class="action-badge ${sideCss}">
                  <span>${esc(row.side?.toUpperCase())}</span>
                  <span>${row.size_pct}%</span>
                  <span>${esc(row.coin)}</span>
                </div>
                <div style="margin-top:8px;font-size:11px;color:#8b949e;">
                  <div>Entry Zone: ${entryZoneStr}</div>
                  <div>Invalidation: ${invalidationStr}</div>
                  <div>Target: ${targetStr}</div>
                  <div>Timeframe: ${esc(row.timeframe || "N/A")}</div>
                  <div>Conviction: ${convictionStr}</div>
                </div>
                ${row.correlation_notes ? `<div style="margin-top:6px;font-size:11px;color:#8b949e;">Notes: ${esc(row.correlation_notes)}</div>` : ""}
                ` : `<span style="color:#8b949e;">No trade plan</span>`}
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

approvalsRouter.get("/approvals/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT
        pa.id, pa.status, pa.tag, pa.tag_freetext,
        pa.edited_size_pct, pa.edited_entry_zone_low, pa.edited_entry_zone_high,
        pa.edited_invalidation_price, pa.edited_target_price, pa.edited_conviction,
        pa.expires_at, pa.created_at, pa.resolved_at,
        pd.id as decision_id, pd.classification, pd.reasoning, pd.thesis_delta,
        pd.side, pd.coin, pd.size_pct, pd.entry_zone_low, pd.entry_zone_high, pd.invalidation_price, pd.target_price, pd.timeframe, pd.correlation_notes, pd.conviction,
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
    res.json({
      id: row.id,
      status: row.status,
      headline: `${row.classification.toUpperCase()}: ${row.coin || "N/A"}`,
      decision: row.classification,
      reasoning: row.reasoning,
      thesis_delta: row.thesis_delta,
      trade_plan: {
        side: row.side,
        coin: row.coin,
        size_pct: row.size_pct,
        entry_zone: [row.entry_zone_low, row.entry_zone_high],
        invalidation: row.invalidation_price,
        target: row.target_price,
        timeframe: row.timeframe,
        correlation_notes: row.correlation_notes,
        conviction: row.conviction,
      },
      expires_at: row.expires_at,
      created_at: row.created_at,
      resolved_at: row.resolved_at,
      tag: row.tag,
      tag_freetext: row.tag_freetext,
      // Return both original and edited values for the form
      size_pct: row.size_pct,
      entry_zone_low: row.entry_zone_low,
      entry_zone_high: row.entry_zone_high,
      invalidation_price: row.invalidation_price,
      target_price: row.target_price,
      conviction: row.conviction,
      model: row.model,
    });
  } catch (err) {
    res.status(500).json({ error: `Database error: ${err}` });
  }
});

async function handleApprovalAction(
  action: "approve" | "reject" | "edit",
  req: any,
  res: any
) {
  try {
    const { id } = req.params;
    const {
      tag,
      freetext,
      edited_size_pct,
      edited_entry_zone_low,
      edited_entry_zone_high,
      edited_invalidation_price,
      edited_target_price,
      edited_conviction,
    } = req.body;

    if (!tag) return res.status(400).json({ error: "tag is required" });

    if (action === "edit") {
      // Validate all required fields for edit
      const requiredFields = {
        edited_size_pct,
        edited_entry_zone_low,
        edited_entry_zone_high,
        edited_invalidation_price,
        edited_target_price,
        edited_conviction,
      };

      for (const [field, value] of Object.entries(requiredFields)) {
        if (value === undefined || value === null) {
          return res.status(400).json({ error: `${field} is required` });
        }
      }

      // Validate types and ranges
      if (typeof edited_size_pct !== "number" || edited_size_pct <= 0 || edited_size_pct > 10) {
        return res.status(400).json({ error: "edited_size_pct must be between 0 and 10" });
      }
      if (typeof edited_entry_zone_low !== "number" || edited_entry_zone_low <= 0) {
        return res.status(400).json({ error: "edited_entry_zone_low must be positive" });
      }
      if (typeof edited_entry_zone_high !== "number" || edited_entry_zone_high <= 0) {
        return res.status(400).json({ error: "edited_entry_zone_high must be positive" });
      }
      if (edited_entry_zone_low > edited_entry_zone_high) {
        return res.status(400).json({ error: "edited_entry_zone_low must be <= edited_entry_zone_high" });
      }
      if (typeof edited_invalidation_price !== "number" || edited_invalidation_price <= 0) {
        return res.status(400).json({ error: "edited_invalidation_price must be positive" });
      }
      if (typeof edited_target_price !== "number" || edited_target_price <= 0) {
        return res.status(400).json({ error: "edited_target_price must be positive" });
      }
      if (typeof edited_conviction !== "number" || !Number.isInteger(edited_conviction) || edited_conviction < 1 || edited_conviction > 5) {
        return res.status(400).json({ error: "edited_conviction must be an integer between 1 and 5" });
      }
    }

    const stateResult = await query(
      `SELECT id, status, expires_at FROM pending_approvals WHERE id = $1`,
      [id]
    );
    if (stateResult.rows.length === 0) {
      return res.status(404).json({ error: "Approval not found" });
    }
    const approval = stateResult.rows[0];
    const now = new Date();

    const transitionResult = transition(
      {
        id: approval.id,
        status: approval.status as ApprovalStatus,
        expiresAt: new Date(approval.expires_at),
      },
      action,
      now,
      tag,
      action === "edit" ? edited_size_pct : undefined
    );

    if (!transitionResult.success) {
      return res.status(400).json({ error: transitionResult.error });
    }

    const targetStatus =
      action === "approve" ? "approved" : action === "reject" ? "rejected" : "edited";
    const updateSql =
      action === "edit"
        ? `UPDATE pending_approvals
             SET status = 'edited', tag = $2, tag_freetext = $3,
                 edited_size_pct = $4, edited_entry_zone_low = $5, edited_entry_zone_high = $6,
                 edited_invalidation_price = $7, edited_target_price = $8, edited_conviction = $9,
                 resolved_at = NOW()
             WHERE id = $1 RETURNING *`
        : `UPDATE pending_approvals
             SET status = $4, tag = $2, tag_freetext = $3, resolved_at = NOW()
             WHERE id = $1 RETURNING *`;

    const updateParams =
      action === "edit"
        ? [
            id,
            tag,
            freetext || null,
            edited_size_pct,
            edited_entry_zone_low,
            edited_entry_zone_high,
            edited_invalidation_price,
            edited_target_price,
            edited_conviction,
          ]
        : [id, tag, freetext || null, targetStatus];

    const updateResult = await query(updateSql, updateParams);
    const updated = updateResult.rows[0];
    res.json({
      id: updated.id,
      status: updated.status,
      tag: updated.tag,
      tag_freetext: updated.tag_freetext,
      edited_size_pct: updated.edited_size_pct,
      edited_entry_zone_low: updated.edited_entry_zone_low,
      edited_entry_zone_high: updated.edited_entry_zone_high,
      edited_invalidation_price: updated.edited_invalidation_price,
      edited_target_price: updated.edited_target_price,
      edited_conviction: updated.edited_conviction,
      resolved_at: updated.resolved_at,
    });
  } catch (err) {
    res.status(500).json({ error: `Database error: ${err}` });
  }
}

approvalsRouter.post("/approvals/:id/approve", (req, res) => handleApprovalAction("approve", req, res));
approvalsRouter.post("/approvals/:id/reject", (req, res) => handleApprovalAction("reject", req, res));
approvalsRouter.post("/approvals/:id/edit", (req, res) => handleApprovalAction("edit", req, res));

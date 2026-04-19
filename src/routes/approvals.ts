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
        pd.side, pd.coin, pd.size_pct, pd.invalidation, pd.time_horizon,
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
        action: { side: row.side, coin: row.coin, size_pct: row.size_pct, invalidation: row.invalidation },
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

approvalsRouter.get("/approvals/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT
        pa.id, pa.status, pa.tag, pa.tag_freetext, pa.edited_size_pct,
        pa.expires_at, pa.created_at, pa.resolved_at,
        pd.id as decision_id, pd.classification, pd.reasoning, pd.thesis_delta,
        pd.side, pd.coin, pd.size_pct, pd.invalidation, pd.time_horizon,
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
    const { tag, freetext, edited_size_pct } = req.body;

    if (!tag) return res.status(400).json({ error: "tag is required" });

    if (action === "edit") {
      if (edited_size_pct === undefined) {
        return res.status(400).json({ error: "edited_size_pct is required" });
      }
      if (typeof edited_size_pct !== "number" || edited_size_pct <= 0) {
        return res.status(400).json({ error: "edited_size_pct must be a positive number" });
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
             SET status = 'edited', tag = $2, tag_freetext = $3, edited_size_pct = $4, resolved_at = NOW()
             WHERE id = $1 RETURNING *`
        : `UPDATE pending_approvals
             SET status = $4, tag = $2, tag_freetext = $3, resolved_at = NOW()
             WHERE id = $1 RETURNING *`;

    const updateParams =
      action === "edit"
        ? [id, tag, freetext || null, edited_size_pct]
        : [id, tag, freetext || null, targetStatus];

    const updateResult = await query(updateSql, updateParams);
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
}

approvalsRouter.post("/approvals/:id/approve", (req, res) => handleApprovalAction("approve", req, res));
approvalsRouter.post("/approvals/:id/reject", (req, res) => handleApprovalAction("reject", req, res));
approvalsRouter.post("/approvals/:id/edit", (req, res) => handleApprovalAction("edit", req, res));

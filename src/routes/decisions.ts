import { Router } from "express";
import { query } from "../db/client.js";
import { esc } from "./shared.js";
import { formatGst } from "../utils/time.js";

export const decisionsRouter = Router();

decisionsRouter.get("/decisions", async (_req, res) => {
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
        <td style="padding:8px;font-size:12px;color:#8b949e;">${esc(formatGst(new Date(r.created_at)))}</td>
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

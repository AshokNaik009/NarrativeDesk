import { Router } from "express";
import { query } from "../db/client.js";
import { esc } from "./shared.js";

export const portfolioRouter = Router();

portfolioRouter.get("/portfolio", async (_req, res) => {
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

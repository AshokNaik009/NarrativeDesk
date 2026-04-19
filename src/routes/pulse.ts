import { Router } from "express";
import { query } from "../db/client.js";

export const pulseRouter = Router();

pulseRouter.get("/pulse", async (_req, res) => {
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

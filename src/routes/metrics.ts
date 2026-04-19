import { Router } from "express";
import { getHealth, getMetrics } from "../utils/health.js";
import { computeFullReport } from "../metrics/MetricsCalculator.js";

export const metricsRouter = Router();

metricsRouter.get("/health", async (_req, res) => {
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

metricsRouter.get("/metrics", async (_req, res) => {
  try {
    const metrics = await getMetrics();
    res.json(metrics);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

metricsRouter.get("/metrics/full", async (req, res) => {
  try {
    const days = parseInt((req.query.days as string) || "7");
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const report = await computeFullReport(since);
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

import express from "express";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import { initDb } from "./db/client.js";
import { activityRouter } from "./routes/activity.js";
import { approvalsRouter } from "./routes/approvals.js";
import { chatRouter } from "./routes/chat.js";
import { decisionsRouter } from "./routes/decisions.js";
import { metricsRouter } from "./routes/metrics.js";
import { portfolioRouter } from "./routes/portfolio.js";
import { pulseRouter } from "./routes/pulse.js";
import { thesisRouter } from "./routes/thesis.js";
import { biasRouter } from "./routes/bias.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Dashboard home — serve the HTMX dashboard HTML
app.get("/", (_req, res) => {
  try {
    const dashboardPath = join(__dirname, "dashboard", "views", "approvals.html");
    const html = readFileSync(dashboardPath, "utf-8");
    res.send(html);
  } catch {
    res.status(500).send(`<!DOCTYPE html><html><body style="font-family:system-ui;background:#0d1117;color:#c9d1d9;padding:2rem;"><h1 style="color:#58a6ff;">NarrativeDesk</h1><p>Dashboard loading... Check /health for status</p></body></html>`);
  }
});

// Mount route modules
app.use(metricsRouter);     // /health, /metrics, /metrics/full
app.use(activityRouter);    // /activity, /activity/older, /activity/event/:id
app.use(approvalsRouter);   // /approvals (+ auth middleware lives inside)
app.use(portfolioRouter);   // /portfolio
app.use(thesisRouter);      // /thesis, /thesis/version/:id
app.use(decisionsRouter);   // /decisions
app.use(pulseRouter);       // /pulse
app.use(chatRouter);        // GET/POST /chat
app.use(biasRouter);        // /bias, /bias/json, /bias/report

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

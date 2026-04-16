import express from "express";
import { config } from "./config.js";
import { initDb, query } from "./db/client.js";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Dashboard home — placeholder until Phase 4
app.get("/", async (_req, res) => {
  try {
    const pendingResult = await query(
      `SELECT COUNT(*) as count FROM pending_approvals WHERE status = 'pending'`
    );
    const eventCount = await query(`SELECT COUNT(*) as count FROM events`);
    const decisionCount = await query(`SELECT COUNT(*) as count FROM proposed_decisions`);

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>NarrativeDesk</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: system-ui; max-width: 800px; margin: 2rem auto; padding: 0 1rem; background: #0d1117; color: #c9d1d9; }
          h1 { color: #58a6ff; }
          .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1rem; margin: 1rem 0; }
          .stat { font-size: 2rem; font-weight: bold; color: #58a6ff; }
          .label { color: #8b949e; font-size: 0.9rem; }
          .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; }
        </style>
      </head>
      <body>
        <h1>NarrativeDesk</h1>
        <p>Real-time narrative-driven crypto paper-trading agent</p>
        <div class="grid">
          <div class="card">
            <div class="stat">${pendingResult.rows[0].count}</div>
            <div class="label">Pending Approvals</div>
          </div>
          <div class="card">
            <div class="stat">${eventCount.rows[0].count}</div>
            <div class="label">Events Ingested</div>
          </div>
          <div class="card">
            <div class="stat">${decisionCount.rows[0].count}</div>
            <div class="label">Decisions Made</div>
          </div>
        </div>
        <div class="card">
          <p class="label">Dashboard with HTMX approval UI coming in Phase 4</p>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send(`DB error: ${err}`);
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

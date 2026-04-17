import express from "express";
import { config } from "./config.js";
import { initDb, query } from "./db/client.js";
import { transition } from "./hitl/ApprovalStateMachine.js";
import { ApprovalStatus } from "./types.js";
import { getHealth, getMetrics } from "./utils/health.js";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware: Dashboard secret authentication for /approvals routes
app.use((req, res, next) => {
  if (req.path.startsWith("/approvals")) {
    const secret = req.headers["x-dashboard-secret"];
    if (secret !== config.dashboardSecret) {
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

// GET /approvals - List all pending approvals with decision details
app.get("/approvals", async (_req, res) => {
  try {
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
      WHERE pa.status = 'pending'
      ORDER BY pa.expires_at ASC`
    );

    const approvals = result.rows.map((row) => ({
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
    }));

    res.json(approvals);
  } catch (err) {
    res.status(500).json({ error: `Database error: ${err}` });
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
      `SELECT pa.id, pa.status, pa.expires_at
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
      `SELECT pa.id, pa.status, pa.expires_at
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
      `SELECT pa.id, pa.status, pa.expires_at
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

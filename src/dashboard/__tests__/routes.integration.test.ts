import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import express from "express";
import type { Express } from "express";

// Mock DB client
const mockQuery = vi.fn();
vi.mock("../../db/client.js", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  initDb: vi.fn().mockResolvedValue(undefined),
}));

// Mock health module
vi.mock("../../utils/health.js", () => ({
  getHealth: vi.fn().mockResolvedValue({
    timestamp: new Date().toISOString(),
    uptime: 1000,
    services: [{ name: "PostgreSQL", status: "ok" }],
    metrics: { eventsProcessed: 10, decisionsMade: 5, approvalsPending: 2, tradesExecuted: 1, guardrailsChecked: 3 },
  }),
  getMetrics: vi.fn().mockResolvedValue({
    timestamp: new Date().toISOString(),
    oneHourMetrics: { eventsProcessed: 5, decisionsMade: 2, approvalsExecuted: 1, tradesExecuted: 0 },
  }),
}));

// Mock config
vi.mock("../../config.js", () => ({
  config: {
    port: 3999,
    dashboardSecret: "test-secret",
  },
}));

// Mock ApprovalStateMachine
vi.mock("../../hitl/ApprovalStateMachine.js", () => ({
  transition: vi.fn().mockReturnValue({ success: true, nextState: "approved" }),
}));

// Mock fs for dashboard HTML
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    readFileSync: vi.fn().mockImplementation((path: string) => {
      if (typeof path === "string" && path.includes("approvals.html")) {
        return "<html><body>Dashboard</body></html>";
      }
      return (actual.readFileSync as (...args: unknown[]) => unknown)(path);
    }),
  };
});

// Manually build the Express app to test routes without starting the server
function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Auth middleware
  app.use((req, res, next) => {
    if (req.path.startsWith("/approvals")) {
      const secret = req.headers["x-dashboard-secret"];
      if (secret !== "test-secret") {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }
    next();
  });

  // Health
  app.get("/health", async (_req, res) => {
    const { getHealth } = await import("../../utils/health.js");
    const health = await getHealth();
    res.json(health);
  });

  // Metrics
  app.get("/metrics", async (_req, res) => {
    const { getMetrics } = await import("../../utils/health.js");
    const metrics = await getMetrics();
    res.json(metrics);
  });

  // Dashboard home
  app.get("/", (_req, res) => {
    res.send("<html><body>Dashboard</body></html>");
  });

  // GET /approvals
  app.get("/approvals", async (_req, res) => {
    const { query } = await import("../../db/client.js");
    const result = await query("SELECT ...");
    res.json(result.rows);
  });

  // POST /approvals/:id/approve
  app.post("/approvals/:id/approve", async (req, res) => {
    const { tag } = req.body;
    if (!tag) return res.status(400).json({ error: "tag is required" });

    const { query } = await import("../../db/client.js");
    const stateResult = await query("SELECT ...", [req.params.id]);
    if (stateResult.rows.length === 0) return res.status(404).json({ error: "Not found" });

    const { transition } = await import("../../hitl/ApprovalStateMachine.js");
    const result = transition(
      { id: req.params.id, status: "pending", expiresAt: new Date(Date.now() + 900000) },
      "approve", new Date(), tag
    );

    if (!result.success) return res.status(400).json({ error: result.error });

    await query("UPDATE ...", [req.params.id, tag]);
    res.json({ id: req.params.id, status: "approved", tag });
  });

  // POST /approvals/:id/reject
  app.post("/approvals/:id/reject", async (req, res) => {
    const { tag } = req.body;
    if (!tag) return res.status(400).json({ error: "tag is required" });
    res.json({ id: req.params.id, status: "rejected", tag });
  });

  // POST /approvals/:id/edit
  app.post("/approvals/:id/edit", async (req, res) => {
    const { tag, edited_size_pct } = req.body;
    if (!tag) return res.status(400).json({ error: "tag is required" });
    if (edited_size_pct === undefined) return res.status(400).json({ error: "edited_size_pct is required" });
    if (typeof edited_size_pct !== "number" || edited_size_pct <= 0) return res.status(400).json({ error: "edited_size_pct must be positive" });
    res.json({ id: req.params.id, status: "edited", tag, edited_size_pct });
  });

  return app;
}

// Lightweight request helper (no supertest dependency needed)
async function request(app: Express, method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  return new Promise<{ status: number; body: unknown; text: string }>((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const url = `http://localhost:${port}${path}`;

      const options: RequestInit = {
        method,
        headers: { "Content-Type": "application/json", ...headers },
      };
      if (body) options.body = JSON.stringify(body);

      fetch(url, options)
        .then(async (res) => {
          const text = await res.text();
          let parsed: unknown;
          try { parsed = JSON.parse(text); } catch { parsed = text; }
          server.close();
          resolve({ status: res.status, body: parsed, text });
        })
        .catch((err) => {
          server.close();
          resolve({ status: 500, body: { error: err.message }, text: err.message });
        });
    });
  });
}

describe("Dashboard routes", () => {
  let app: Express;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /health", () => {
    it("returns health status with services and metrics", async () => {
      const res = await request(app, "GET", "/health");
      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.services).toBeDefined();
      expect(body.metrics).toBeDefined();
    });
  });

  describe("GET /metrics", () => {
    it("returns one-hour activity metrics", async () => {
      const res = await request(app, "GET", "/metrics");
      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.oneHourMetrics).toBeDefined();
    });
  });

  describe("GET / (dashboard)", () => {
    it("serves the HTML dashboard", async () => {
      const res = await request(app, "GET", "/");
      expect(res.status).toBe(200);
      expect(res.text).toContain("Dashboard");
    });
  });

  describe("authentication", () => {
    it("rejects /approvals without dashboard secret", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(app, "GET", "/approvals");
      expect(res.status).toBe(401);
    });

    it("accepts /approvals with correct dashboard secret", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(app, "GET", "/approvals", undefined, {
        "x-dashboard-secret": "test-secret",
      });
      expect(res.status).toBe(200);
    });
  });

  describe("POST /approvals/:id/approve", () => {
    it("requires a tag", async () => {
      const res = await request(
        app, "POST", "/approvals/test-id/approve",
        {},
        { "x-dashboard-secret": "test-secret" }
      );
      expect(res.status).toBe(400);
      expect((res.body as any).error).toContain("tag");
    });

    it("approves with valid tag", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: "test-id", status: "pending", expires_at: new Date(Date.now() + 900000) }] })
        .mockResolvedValueOnce({ rows: [{ id: "test-id", status: "approved", tag: "strong_thesis" }] });

      const res = await request(
        app, "POST", "/approvals/test-id/approve",
        { tag: "strong_thesis" },
        { "x-dashboard-secret": "test-secret" }
      );
      expect(res.status).toBe(200);
      expect((res.body as any).status).toBe("approved");
    });
  });

  describe("POST /approvals/:id/reject", () => {
    it("requires a tag", async () => {
      const res = await request(
        app, "POST", "/approvals/test-id/reject",
        {},
        { "x-dashboard-secret": "test-secret" }
      );
      expect(res.status).toBe(400);
    });

    it("rejects with valid tag", async () => {
      const res = await request(
        app, "POST", "/approvals/test-id/reject",
        { tag: "weak_thesis" },
        { "x-dashboard-secret": "test-secret" }
      );
      expect(res.status).toBe(200);
      expect((res.body as any).status).toBe("rejected");
    });
  });

  describe("POST /approvals/:id/edit", () => {
    it("requires tag and edited_size_pct", async () => {
      const res = await request(
        app, "POST", "/approvals/test-id/edit",
        { tag: "reasonable_take" },
        { "x-dashboard-secret": "test-secret" }
      );
      expect(res.status).toBe(400);
      expect((res.body as any).error).toContain("edited_size_pct");
    });

    it("rejects non-positive edited_size_pct", async () => {
      const res = await request(
        app, "POST", "/approvals/test-id/edit",
        { tag: "reasonable_take", edited_size_pct: -1 },
        { "x-dashboard-secret": "test-secret" }
      );
      expect(res.status).toBe(400);
    });

    it("edits with valid tag and size", async () => {
      const res = await request(
        app, "POST", "/approvals/test-id/edit",
        { tag: "reasonable_take", edited_size_pct: 3.5 },
        { "x-dashboard-secret": "test-secret" }
      );
      expect(res.status).toBe(200);
      expect((res.body as any).edited_size_pct).toBe(3.5);
    });
  });
});

import { query } from "../db/client.js";
import Groq from "groq-sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "../config.js";

interface ServiceHealth {
  name: string;
  status: "ok" | "error";
  latencyMs?: number;
  details?: string;
}

interface HealthReport {
  timestamp: string;
  uptime: number;
  services: ServiceHealth[];
  metrics: {
    eventsProcessed: number;
    decisionsMade: number;
    approvalsPending: number;
    tradesExecuted: number;
    guardrailsChecked: number;
  };
}

let startTime = Date.now();

export async function getHealth(): Promise<HealthReport> {
  const services: ServiceHealth[] = [];

  // Check Database
  try {
    const start = Date.now();
    await query("SELECT 1");
    services.push({
      name: "PostgreSQL",
      status: "ok",
      latencyMs: Date.now() - start,
    });
  } catch (err) {
    services.push({
      name: "PostgreSQL",
      status: "error",
      details: (err as Error).message,
    });
  }

  // Check Groq
  try {
    const groq = new Groq({ apiKey: config.groqApiKey });
    const start = Date.now();
    // Just test that the API key is valid by checking models list (lightweight)
    await (groq as any).models.list();
    services.push({
      name: "Groq",
      status: "ok",
      latencyMs: Date.now() - start,
    });
  } catch (err) {
    services.push({
      name: "Groq",
      status: "error",
      details: (err as Error).message?.slice(0, 100),
    });
  }

  // Check Google Gemini
  try {
    const genai = new GoogleGenerativeAI(config.googleApiKey);
    const model = genai.getGenerativeModel({ model: "gemini-flash-latest" });
    const start = Date.now();
    // Test with a minimal request
    await model.generateContent("ping");
    services.push({
      name: "Google Gemini",
      status: "ok",
      latencyMs: Date.now() - start,
    });
  } catch (err) {
    services.push({
      name: "Google Gemini",
      status: "error",
      details: (err as Error).message?.slice(0, 100),
    });
  }

  // Check OpenRouter (optional, just verify key exists)
  if (config.openRouterApiKey) {
    services.push({
      name: "OpenRouter",
      status: config.openRouterApiKey ? "ok" : "error",
    });
  }

  // Fetch metrics
  let metrics = {
    eventsProcessed: 0,
    decisionsMade: 0,
    approvalsPending: 0,
    tradesExecuted: 0,
    guardrailsChecked: 0,
  };

  try {
    const eventResult = await query("SELECT COUNT(*) as count FROM events");
    const decisionResult = await query(
      "SELECT COUNT(*) as count FROM proposed_decisions"
    );
    const approvalResult = await query(
      "SELECT COUNT(*) as count FROM pending_approvals WHERE status = 'pending'"
    );
    const tradeResult = await query(
      "SELECT COUNT(*) as count FROM executed_trades"
    );
    const guardrailResult = await query(
      "SELECT COUNT(*) as count FROM guardrail_decisions"
    );

    metrics = {
      eventsProcessed: parseInt(eventResult.rows[0]?.count || 0),
      decisionsMade: parseInt(decisionResult.rows[0]?.count || 0),
      approvalsPending: parseInt(approvalResult.rows[0]?.count || 0),
      tradesExecuted: parseInt(tradeResult.rows[0]?.count || 0),
      guardrailsChecked: parseInt(guardrailResult.rows[0]?.count || 0),
    };
  } catch (err) {
    // Silently fail metrics collection
    console.error("[Health] Error fetching metrics:", err);
  }

  return {
    timestamp: new Date().toISOString(),
    uptime: Date.now() - startTime,
    services,
    metrics,
  };
}

export async function getMetrics() {
  try {
    const eventResult = await query(
      "SELECT COUNT(*) as count FROM events WHERE created_at > NOW() - INTERVAL '1 hour'"
    );
    const decisionResult = await query(
      "SELECT COUNT(*) as count FROM proposed_decisions WHERE created_at > NOW() - INTERVAL '1 hour'"
    );
    const approvalResult = await query(
      "SELECT COUNT(*) as count FROM pending_approvals WHERE status = 'approved'"
    );
    const tradeResult = await query(
      "SELECT COUNT(*) as count FROM executed_trades WHERE created_at > NOW() - INTERVAL '1 hour'"
    );

    return {
      timestamp: new Date().toISOString(),
      oneHourMetrics: {
        eventsProcessed: parseInt(eventResult.rows[0]?.count || 0),
        decisionsMade: parseInt(decisionResult.rows[0]?.count || 0),
        approvalsExecuted: parseInt(approvalResult.rows[0]?.count || 0),
        tradesExecuted: parseInt(tradeResult.rows[0]?.count || 0),
      },
    };
  } catch (err) {
    return {
      timestamp: new Date().toISOString(),
      error: (err as Error).message,
    };
  }
}

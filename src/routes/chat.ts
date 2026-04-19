import { Router } from "express";
import { query } from "../db/client.js";
import { esc } from "./shared.js";

export const chatRouter = Router();

chatRouter.get("/chat", async (_req, res) => {
  try {
    const sessionId = "default";
    const rows = await query(
      `SELECT role, content, created_at FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT 50`,
      [sessionId]
    );
    if (rows.rows.length === 0) {
      return res.send(`<div style="color:#8b949e;text-align:center;padding:20px;font-size:13px;">Ask about the thesis, a coin, or a past decision. The agent sees current thesis, portfolio, and last 10 decisions.</div>`);
    }
    let html = "";
    for (const m of rows.rows) {
      const mine = m.role === "user";
      const bg = mine ? "#1f6feb" : "#21262d";
      const color = mine ? "#ffffff" : "#c9d1d9";
      const align = mine ? "flex-end" : "flex-start";
      html += `<div style="display:flex;justify-content:${align};margin-bottom:10px;"><div style="max-width:75%;background:${bg};color:${color};padding:8px 12px;border-radius:12px;font-size:13px;white-space:pre-wrap;">${esc(m.content)}</div></div>`;
    }
    res.send(html);
  } catch (err) {
    res.send(`<div style="color:#f85149;padding:12px;font-size:12px;">Chat load error: ${(err as Error).message}</div>`);
  }
});

chatRouter.post("/chat", async (req, res) => {
  try {
    const sessionId = "default";
    const userMessage = String(req.body.message || "").trim().slice(0, 2000);
    if (!userMessage) return res.send("");

    await query(
      `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'user', $2)`,
      [sessionId, userMessage]
    );

    const thesisRow = await query(`SELECT content FROM thesis_versions ORDER BY created_at DESC LIMIT 1`);
    const portfolioRow = await query(`SELECT cash, total_value, positions FROM portfolio_snapshots ORDER BY created_at DESC LIMIT 1`);
    const decisionsRows = await query(
      `SELECT classification, coin, reasoning, created_at FROM proposed_decisions ORDER BY created_at DESC LIMIT 10`
    );
    const historyRows = await query(
      `SELECT role, content FROM chat_messages WHERE session_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [sessionId]
    );

    const { invokeChatAgent } = await import("../agent/features.js");
    const portfolioSummary = portfolioRow.rows[0]
      ? `cash=${portfolioRow.rows[0].cash} total=${portfolioRow.rows[0].total_value} positions=${JSON.stringify(portfolioRow.rows[0].positions || [])}`
      : "No portfolio snapshot.";
    const result = await invokeChatAgent(
      userMessage,
      {
        thesis: thesisRow.rows[0]?.content || "No thesis yet.",
        portfolio: portfolioSummary,
        recentDecisions: decisionsRows.rows.map((d) => ({
          classification: d.classification,
          coin: d.coin,
          reasoning: d.reasoning || "",
          created_at: new Date(d.created_at).toISOString(),
        })),
      },
      historyRows.rows.reverse().slice(0, -1).map((h) => ({ role: h.role as "user" | "assistant", content: h.content }))
    );

    const reply = result.reply || "(no response — check API key or rate limits)";
    await query(
      `INSERT INTO chat_messages (session_id, role, content, prompt_tokens, completion_tokens)
       VALUES ($1, 'assistant', $2, $3, $4)`,
      [sessionId, reply, result.tokens.prompt, result.tokens.completion]
    );

    const userHtml = `<div style="display:flex;justify-content:flex-end;margin-bottom:10px;"><div style="max-width:75%;background:#1f6feb;color:#ffffff;padding:8px 12px;border-radius:12px;font-size:13px;white-space:pre-wrap;">${esc(userMessage)}</div></div>`;
    const botHtml = `<div style="display:flex;justify-content:flex-start;margin-bottom:10px;"><div style="max-width:75%;background:#21262d;color:#c9d1d9;padding:8px 12px;border-radius:12px;font-size:13px;white-space:pre-wrap;">${esc(reply)}</div></div>`;
    res.send(userHtml + botHtml);
  } catch (err) {
    res.send(`<div style="color:#f85149;padding:12px;font-size:12px;">Chat error: ${(err as Error).message}</div>`);
  }
});

import Groq from "groq-sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "../config.js";
import { query } from "../db/client.js";

const groq = new Groq({ apiKey: config.groqApiKey });
const genai = new GoogleGenerativeAI(config.googleApiKey);

const GROQ_MODEL = "llama-3.3-70b-versatile";
const GEMINI_MODEL = "gemini-flash-latest";

const CHAT_SYSTEM_PROMPT = `You are NarrativeDesk's analyst assistant. Answer the trader's question using current thesis, portfolio, and recent decisions. Be concise (3-5 sentences max). Cite specific decisions by coin/time when relevant.`;

const COUNTER_THESIS_SYSTEM_PROMPT = `You are a devil's advocate. Given a proposed trade, argue why it is WRONG in 2-3 sentences. Focus on: could this news be priced in? Is the thesis weak? Is sizing/timing off? Be specific and skeptical.`;

const POSTMORTEM_SYSTEM_PROMPT = `A trade just closed. Write a 2-sentence postmortem (what happened) and a 1-sentence lesson. Respond with ONLY JSON: {"postmortem": "...", "lesson": "..."}`;

export interface ChatContext {
  thesis: string;
  portfolio: string;
  recentDecisions: Array<{ classification: string; coin: string | null; reasoning: string; created_at: string }>;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function invokeChatAgent(
  userMessage: string,
  context: ChatContext,
  conversationHistory?: ChatMessage[]
): Promise<{ reply: string; tokens: { prompt: number; completion: number }; latencyMs: number }> {
  const start = Date.now();

  try {
    const recentDecisionsSummary = context.recentDecisions
      .slice(0, 10)
      .map(
        (d) =>
          `- [${d.created_at}] ${d.classification}${d.coin ? ` ${d.coin}` : ""}: ${d.reasoning.slice(0, 160)}`
      )
      .join("\n");

    const contextBlock = `Current thesis:\n${context.thesis}\n\nPortfolio:\n${context.portfolio}\n\nRecent decisions:\n${recentDecisionsSummary || "(none)"}`;

    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: CHAT_SYSTEM_PROMPT },
      { role: "system", content: contextBlock },
    ];

    if (conversationHistory && conversationHistory.length > 0) {
      for (const m of conversationHistory.slice(-10)) {
        messages.push({ role: m.role, content: m.content });
      }
    }

    messages.push({ role: "user", content: userMessage });

    const response = await groq.chat.completions.create({
      model: GROQ_MODEL,
      temperature: 0.3,
      messages,
    });

    const reply = response.choices[0]?.message?.content?.trim() || "";
    const tokens = {
      prompt: response.usage?.prompt_tokens || 0,
      completion: response.usage?.completion_tokens || 0,
    };

    return { reply, tokens, latencyMs: Date.now() - start };
  } catch (err) {
    console.error("[Features] invokeChatAgent failed:", (err as Error).message?.slice(0, 200));
    return { reply: "", tokens: { prompt: 0, completion: 0 }, latencyMs: Date.now() - start };
  }
}

export async function invokeCounterThesis(
  decision: {
    classification: string;
    reasoning: string;
    coin?: string | null;
    side?: string | null;
    size_pct?: number | null;
    invalidation?: string | null;
  },
  event: { headline?: string | null; source?: string | null }
): Promise<{ counterThesis: string; tokens: { prompt: number; completion: number }; latencyMs: number }> {
  const start = Date.now();

  try {
    const userPrompt = `Proposed trade:
- Classification: ${decision.classification}
- Coin: ${decision.coin ?? "N/A"}
- Side: ${decision.side ?? "N/A"}
- Size: ${decision.size_pct ?? "N/A"}%
- Reasoning: ${decision.reasoning}
- Invalidation: ${decision.invalidation ?? "N/A"}

Triggering event:
- Headline: ${event.headline ?? "N/A"}
- Source: ${event.source ?? "N/A"}

Argue why this trade is WRONG in 2-3 sentences.`;

    const response = await groq.chat.completions.create({
      model: GROQ_MODEL,
      temperature: 0.4,
      messages: [
        { role: "system", content: COUNTER_THESIS_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    });

    const counterThesis = response.choices[0]?.message?.content?.trim() || "";
    const tokens = {
      prompt: response.usage?.prompt_tokens || 0,
      completion: response.usage?.completion_tokens || 0,
    };

    return { counterThesis, tokens, latencyMs: Date.now() - start };
  } catch (err) {
    console.error("[Features] invokeCounterThesis failed:", (err as Error).message?.slice(0, 200));
    return { counterThesis: "", tokens: { prompt: 0, completion: 0 }, latencyMs: Date.now() - start };
  }
}

export async function invokeTradePostmortem(
  trade: {
    coin: string;
    side: string;
    entry_price: number;
    close_price: number;
    close_reason: string;
    opened_at: Date;
    closed_at: Date;
    original_reasoning: string;
    invalidation: string;
  }
): Promise<{ postmortem: string; lesson: string; tokens: { prompt: number; completion: number }; latencyMs: number }> {
  const start = Date.now();

  try {
    const pnlPct =
      trade.entry_price > 0
        ? (((trade.close_price - trade.entry_price) / trade.entry_price) * 100) *
          (trade.side.toLowerCase() === "sell" ? -1 : 1)
        : 0;

    const durationMs = trade.closed_at.getTime() - trade.opened_at.getTime();
    const durationMin = Math.round(durationMs / 60000);

    const userPrompt = `Closed trade:
- Coin: ${trade.coin}
- Side: ${trade.side}
- Entry: ${trade.entry_price}
- Close: ${trade.close_price}
- P&L: ${pnlPct.toFixed(2)}%
- Duration: ${durationMin} minutes
- Close reason: ${trade.close_reason}
- Original reasoning: ${trade.original_reasoning}
- Invalidation condition: ${trade.invalidation}

Write 2-sentence postmortem and 1-sentence lesson as JSON.`;

    const model = genai.getGenerativeModel({ model: GEMINI_MODEL });
    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [{ text: `${POSTMORTEM_SYSTEM_PROMPT}\n\n${userPrompt}` }],
        },
      ],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
    });

    const text = result.response.text();
    const tokens = {
      prompt: result.response.usageMetadata?.promptTokenCount || 0,
      completion: result.response.usageMetadata?.candidatesTokenCount || 0,
    };

    try {
      const parsed = JSON.parse(text) as { postmortem?: unknown; lesson?: unknown };
      const postmortem = typeof parsed.postmortem === "string" ? parsed.postmortem : "";
      const lesson = typeof parsed.lesson === "string" ? parsed.lesson : "";
      return { postmortem, lesson, tokens, latencyMs: Date.now() - start };
    } catch {
      console.error("[Features] Postmortem JSON parse failed:", text.slice(0, 200));
      return { postmortem: "", lesson: "", tokens, latencyMs: Date.now() - start };
    }
  } catch (err) {
    console.error("[Features] invokeTradePostmortem failed:", (err as Error).message?.slice(0, 200));
    return { postmortem: "", lesson: "", tokens: { prompt: 0, completion: 0 }, latencyMs: Date.now() - start };
  }
}

export async function logCounterThesis(
  approvalId: string,
  content: string,
  tokens?: { prompt: number; completion: number },
  latencyMs?: number
): Promise<void> {
  try {
    await query(
      `INSERT INTO counter_theses (approval_id, content, prompt_tokens, completion_tokens, latency_ms)
       VALUES ($1, $2, $3, $4, $5)`,
      [approvalId, content, tokens?.prompt ?? null, tokens?.completion ?? null, latencyMs ?? null]
    );
  } catch (err: any) {
    if (err.code === "42P01" || err.message?.includes("does not exist")) {
      console.warn("[Features] counter_theses table not yet created, skipping persistence");
    } else {
      console.error("[Features] Error logging counter-thesis:", err);
    }
  }
}

export async function logPostmortem(
  tradeId: string,
  postmortem: string,
  lesson: string,
  tokens?: { prompt: number; completion: number },
  latencyMs?: number
): Promise<void> {
  try {
    await query(
      `INSERT INTO trade_postmortems (trade_id, postmortem, lesson, prompt_tokens, completion_tokens, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tradeId, postmortem, lesson, tokens?.prompt ?? null, tokens?.completion ?? null, latencyMs ?? null]
    );
  } catch (err: any) {
    if (err.code === "42P01" || err.message?.includes("does not exist")) {
      console.warn("[Features] trade_postmortems table not yet created, skipping persistence");
    } else {
      console.error("[Features] Error logging postmortem:", err);
    }
  }
}

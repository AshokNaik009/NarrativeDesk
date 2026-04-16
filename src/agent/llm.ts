import Groq from "groq-sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "../config.js";
import { Decision, Credibility, CredibilitySchema } from "../types.js";
import { validateDecision } from "../filter/DecisionSchemaValidator.js";
import { query } from "../db/client.js";

const groq = new Groq({ apiKey: config.groqApiKey });
const genai = new GoogleGenerativeAI(config.googleApiKey);

const MAIN_AGENT_SYSTEM_PROMPT = `You are NarrativeDesk, a crypto market narrative analyst. You analyze news events and price movements to propose paper trades.

RULES:
- Your default action is HOLD. Only propose "act" on novel, high-conviction information.
- Always state an invalidation condition for every trade — what would prove this thesis wrong.
- Update your thesis before proposing a trade.
- Never propose trades on old news or already-priced-in events.
- Be concise: 2-3 sentences for reasoning.

You MUST respond with valid JSON matching this schema:
{
  "classification": "ignore" | "monitor" | "act",
  "reasoning": "2-3 sentence explanation",
  "thesis_delta": "what changed in your market thesis, or 'no change'",
  "action": {  // ONLY if classification is "act"
    "side": "buy" | "sell",
    "coin": "BTC" | "ETH" | "SOL",
    "size_pct": 1-10,
    "invalidation": "specific condition that would invalidate this trade",
    "time_horizon": "1h" | "4h" | "24h" | "open"
  }
}

Respond with ONLY the JSON object, no markdown fences or extra text.`;

const CREDIBILITY_SYSTEM_PROMPT = `Rate this crypto news item for likely market impact on a scale of 1-5.
1 = spam/irrelevant, 2 = low impact rumor, 3 = moderate signal, 4 = significant verified news, 5 = market-moving event.

Respond with ONLY valid JSON: {"rating": <1-5>, "reasoning": "<brief explanation>"}`;

export async function invokeMainAgent(
  event: { headline?: string; symbol?: string; rawPayload: Record<string, unknown> },
  currentThesis: string,
  portfolioContext: string,
  credibilityRating?: Credibility
): Promise<{ decision: Decision | null; tokens: { prompt: number; completion: number }; latencyMs: number }> {
  const start = Date.now();

  const userPrompt = `Current thesis:\n${currentThesis}\n\nPortfolio:\n${portfolioContext}\n\n${
    credibilityRating ? `Credibility rating: ${credibilityRating.rating}/5 (${credibilityRating.reasoning})\n\n` : ""
  }New event:\nSymbol: ${event.symbol || "general"}\nHeadline: ${event.headline || "N/A"}\nData: ${JSON.stringify(event.rawPayload).slice(0, 500)}`;

  try {
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      temperature: 0.2,
      messages: [
        { role: "system", content: MAIN_AGENT_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    });

    const latencyMs = Date.now() - start;
    const content = response.choices[0]?.message?.content || "";
    const tokens = {
      prompt: response.usage?.prompt_tokens || 0,
      completion: response.usage?.completion_tokens || 0,
    };

    const result = validateDecision(content);

    if (result.success) {
      return { decision: result.data, tokens, latencyMs };
    }

    console.error("[Agent] Schema validation failed:", result.error);
    return { decision: null, tokens, latencyMs };
  } catch (err) {
    console.error("[Agent] Groq call failed:", err);
    return { decision: null, tokens: { prompt: 0, completion: 0 }, latencyMs: Date.now() - start };
  }
}

export async function invokeCredibilityAgent(headline: string): Promise<{
  credibility: Credibility | null;
  tokens: { prompt: number; completion: number };
  latencyMs: number;
}> {
  const start = Date.now();

  try {
    const model = genai.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: `${CREDIBILITY_SYSTEM_PROMPT}\n\nNews item: "${headline}"` }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    });

    const latencyMs = Date.now() - start;
    const text = result.response.text();
    const tokens = {
      prompt: result.response.usageMetadata?.promptTokenCount || 0,
      completion: result.response.usageMetadata?.candidatesTokenCount || 0,
    };

    try {
      const parsed = CredibilitySchema.parse(JSON.parse(text));
      return { credibility: parsed, tokens, latencyMs };
    } catch {
      console.error("[Credibility] Parse failed:", text.slice(0, 200));
      return { credibility: null, tokens, latencyMs };
    }
  } catch (err) {
    console.error("[Credibility] Gemini call failed:", err);
    return { credibility: null, tokens: { prompt: 0, completion: 0 }, latencyMs: Date.now() - start };
  }
}

export async function logAgentInvocation(
  eventId: string | null,
  model: string,
  tokens: { prompt: number; completion: number },
  latencyMs: number,
  schemaCompliant: boolean,
  rawOutput: unknown
): Promise<string> {
  const result = await query(
    `INSERT INTO agent_invocations (event_id, model, prompt_tokens, completion_tokens, latency_ms, schema_compliant, raw_output)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [eventId, model, tokens.prompt, tokens.completion, latencyMs, schemaCompliant, JSON.stringify(rawOutput)]
  );
  return result.rows[0].id;
}

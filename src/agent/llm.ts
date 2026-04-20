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

TRADE PLAN DISCIPLINE:
- Commit to numbers. No hedging language.
- Entry zone should be a tight range (≤1% wide typically): [low, high]
- Invalidation and target are exact prices, not sentences.
- Conviction is 1-5 where 5 = highest confidence.
- Correlation_notes: cite BTC beta, sector exposure, or cross-asset risks.

You MUST respond with valid JSON matching this schema:
{
  "classification": "ignore" | "monitor" | "act",
  "reasoning": "2-3 sentence explanation",
  "thesis_delta": "what changed in your market thesis, or 'no change'",
  "trade_plan": {  // ONLY if classification is "act"
    "entry_zone": [low_price, high_price],
    "invalidation": price_that_invalidates_thesis,
    "target": take_profit_price,
    "timeframe": "scalp" | "swing" | "position",
    "size_pct": 1-10,
    "correlation_notes": "BTC beta, sector exposure, cross-asset risks, etc",
    "conviction": 1-5,
    "side": "buy" | "sell",
    "coin": "BTC" | "ETH" | "SOL" | other
  }
}

Respond with ONLY the JSON object, no markdown fences or extra text.`;

const CREDIBILITY_SYSTEM_PROMPT = `Rate this crypto news item for likely market impact on a scale of 1-5.
1 = spam/irrelevant, 2 = low impact rumor, 3 = moderate signal, 4 = significant verified news, 5 = market-moving event.

Respond with ONLY valid JSON: {"rating": <1-5>, "reasoning": "<brief explanation>"}`;

const GEMINI_MODEL = "gemini-flash-latest"; // Use flash-latest for best compatibility

const OPENROUTER_FREE_MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "nvidia/llama-3.1-nemotron-70b-instruct:free",
  "qwen/qwen-2.5-72b-instruct:free",
  "google/gemini-2.0-flash-exp:free",
  "meta-llama/llama-3.1-70b-instruct:free",
];

async function callMainAgentGroq(
  userPrompt: string
): Promise<{ content: string; tokens: { prompt: number; completion: number } } | null> {
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

    const content = response.choices[0]?.message?.content || "";
    const tokens = {
      prompt: response.usage?.prompt_tokens || 0,
      completion: response.usage?.completion_tokens || 0,
    };

    return { content, tokens };
  } catch (err: any) {
    if (err.message?.includes("429") || err.message?.includes("rate_limit")) {
      console.warn("[Agent] Groq rate limited, will fallback to OpenRouter");
      return null;
    }
    throw err;
  }
}

async function callMainAgentOpenRouter(
  userPrompt: string
): Promise<{ content: string; tokens: { prompt: number; completion: number } }> {
  const attempts: Array<{ model: string; error: string }> = [];

  for (const model of OPENROUTER_FREE_MODELS) {
    try {
      console.log(`[Agent] Trying OpenRouter model: ${model}`);
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.openRouterApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 1024,
          messages: [
            { role: "system", content: MAIN_AGENT_SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const status = response.status;

        // Don't retry on auth errors
        if (status === 401 || status === 403) {
          throw new Error(`OpenRouter auth error: ${status} ${errorText}`);
        }

        // Log and try next model
        attempts.push({ model, error: `${status} ${errorText}` });
        console.warn(`[Agent] Model ${model} failed (${status}), trying next...`);
        continue;
      }

      const data = (await response.json()) as any;
      const content = data.choices?.[0]?.message?.content || "";
      const tokens = {
        prompt: data.usage?.prompt_tokens || 0,
        completion: data.usage?.completion_tokens || 0,
      };

      console.log(`[Agent] OpenRouter model ${model} succeeded`);
      return { content, tokens };
    } catch (err: any) {
      const errorMsg = err.message || String(err);

      // Auth errors are fatal
      if (errorMsg.includes("auth error")) {
        throw err;
      }

      // Log other errors and try next model
      attempts.push({ model, error: errorMsg });
      console.warn(`[Agent] Model ${model} error: ${errorMsg.slice(0, 100)}`);
    }
  }

  // All models exhausted
  const attemptDetails = attempts.map((a) => `${a.model}: ${a.error}`).join("; ");
  throw new Error(`All OpenRouter free models failed: ${attemptDetails}`);
}

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
    // Try Groq first
    let result = await callMainAgentGroq(userPrompt);

    // Fallback to OpenRouter if Groq is rate-limited
    if (result === null) {
      console.log("[Agent] Falling back to OpenRouter");
      result = await callMainAgentOpenRouter(userPrompt);
    }

    const latencyMs = Date.now() - start;
    const content = result.content;
    const tokens = result.tokens;

    const validationResult = validateDecision(content);

    if (validationResult.success) {
      return { decision: validationResult.data, tokens, latencyMs };
    }

    console.error("[Agent] Schema validation failed:", validationResult.error);
    return { decision: null, tokens, latencyMs };
  } catch (err) {
    console.error("[Agent] Both Groq and OpenRouter failed:", err);
    return { decision: null, tokens: { prompt: 0, completion: 0 }, latencyMs: Date.now() - start };
  }
}

// Credibility agent rate-limit tracking
let credibilityRateLimitedUntil = 0;
let credibilityCallCount = 0;
const CREDIBILITY_MAX_PER_CYCLE = 5; // Max credibility calls per poll cycle (preserve free tier quota)
const CREDIBILITY_COOLDOWN_MS = 60_000; // Cooldown after hitting rate limit

export function resetCredibilityCycleCount(): void {
  credibilityCallCount = 0;
}

export async function invokeCredibilityAgent(headline: string): Promise<{
  credibility: Credibility | null;
  tokens: { prompt: number; completion: number };
  latencyMs: number;
}> {
  const start = Date.now();

  // Skip if rate-limited or over per-cycle budget
  if (Date.now() < credibilityRateLimitedUntil) {
    console.log(`[Credibility] Skipped — rate-limited for ${Math.ceil((credibilityRateLimitedUntil - Date.now()) / 1000)}s more`);
    return { credibility: null, tokens: { prompt: 0, completion: 0 }, latencyMs: 0 };
  }
  if (credibilityCallCount >= CREDIBILITY_MAX_PER_CYCLE) {
    console.log(`[Credibility] Skipped — ${CREDIBILITY_MAX_PER_CYCLE} calls this cycle (quota preservation)`);
    return { credibility: null, tokens: { prompt: 0, completion: 0 }, latencyMs: 0 };
  }

  credibilityCallCount++;

  try {
    let model = genai.getGenerativeModel({ model: GEMINI_MODEL });
    let result;
    try {
      result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: `${CREDIBILITY_SYSTEM_PROMPT}\n\nNews item: "${headline}"` }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      });
    } catch (err: any) {
      const isRateLimit = err.message?.includes("429") || err.message?.includes("quota");

      // Try secondary key
      if (isRateLimit && config.googleApiKeySecondary) {
        console.warn("[Credibility] Primary key rate-limited, trying secondary");
        const genaiSecondary = new GoogleGenerativeAI(config.googleApiKeySecondary);
        model = genaiSecondary.getGenerativeModel({ model: GEMINI_MODEL });
        try {
          result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: `${CREDIBILITY_SYSTEM_PROMPT}\n\nNews item: "${headline}"` }] }],
            generationConfig: { temperature: 0, responseMimeType: "application/json" },
          });
        } catch (err2: any) {
          // Both keys exhausted — set cooldown
          const retryMatch = err2.message?.match(/retry in (\d+)/i);
          const retrySec = retryMatch ? parseInt(retryMatch[1]) : 60;
          credibilityRateLimitedUntil = Date.now() + Math.max(retrySec * 1000, CREDIBILITY_COOLDOWN_MS);
          console.warn(`[Credibility] Both keys exhausted, pausing for ${retrySec}s`);
          return { credibility: null, tokens: { prompt: 0, completion: 0 }, latencyMs: Date.now() - start };
        }
      } else if (isRateLimit) {
        // Single key exhausted — set cooldown
        const retryMatch = err.message?.match(/retry in (\d+)/i);
        const retrySec = retryMatch ? parseInt(retryMatch[1]) : 60;
        credibilityRateLimitedUntil = Date.now() + Math.max(retrySec * 1000, CREDIBILITY_COOLDOWN_MS);
        console.warn(`[Credibility] Rate-limited, pausing for ${retrySec}s`);
        return { credibility: null, tokens: { prompt: 0, completion: 0 }, latencyMs: Date.now() - start };
      } else {
        throw err;
      }
    }

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
    console.error("[Credibility] Gemini call failed:", (err as Error).message?.slice(0, 150));
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

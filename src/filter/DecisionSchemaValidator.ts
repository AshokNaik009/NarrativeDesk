import { Decision, DecisionSchema } from "../types.js";

export type ValidationResult =
  | { success: true; data: Decision }
  | { success: false; error: string };

export function validateDecision(rawOutput: unknown): ValidationResult {
  // Handle string input (common LLM output)
  let parsed = rawOutput;

  if (typeof rawOutput === "string") {
    // Strip markdown code fences
    let cleaned = rawOutput.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "");
    cleaned = cleaned.replace(/\n?```\s*$/i, "");
    cleaned = cleaned.trim();

    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return { success: false, error: `Failed to parse JSON: ${cleaned.slice(0, 100)}...` };
    }
  }

  // Strip extra keys by parsing through Zod
  const result = DecisionSchema.safeParse(parsed);

  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return { success: false, error: `Schema validation failed: ${issues}` };
  }

  // Business rule: trade_plan must be present only when classification is "act"
  if (result.data.classification === "act" && !result.data.trade_plan) {
    return { success: false, error: "classification is 'act' but no trade_plan provided" };
  }

  if (result.data.classification !== "act" && result.data.trade_plan) {
    // Silently strip trade_plan if classification isn't "act"
    return { success: true, data: { ...result.data, trade_plan: undefined } };
  }

  return { success: true, data: result.data };
}

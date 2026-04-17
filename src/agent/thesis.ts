import { query } from "../db/client.js";

const DEFAULT_THESIS = `Market thesis: No strong directional conviction. Watching BTC, ETH, SOL for narrative-driven catalysts. Default stance is hold.`;

export async function getCurrentThesis(): Promise<{ id: string; content: string } | null> {
  const result = await query(
    `SELECT id, content FROM thesis_versions ORDER BY created_at DESC LIMIT 1`
  );
  return result.rows[0] || null;
}

export async function writeThesis(newContent: string): Promise<string> {
  const current = await getCurrentThesis();
  const diff = current ? computeDiff(current.content, newContent) : "initial thesis";

  const result = await query(
    `INSERT INTO thesis_versions (content, diff) VALUES ($1, $2) RETURNING id`,
    [newContent, diff]
  );
  return result.rows[0].id;
}

export async function getThesisHistory(limit = 10): Promise<Array<{ id: string; content: string; diff: string | null; created_at: Date }>> {
  const result = await query(
    `SELECT id, content, diff, created_at FROM thesis_versions ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return result.rows;
}

export async function ensureThesisExists(): Promise<string> {
  const current = await getCurrentThesis();
  if (current) return current.id;
  return writeThesis(DEFAULT_THESIS);
}

export function computeDiff(oldText: string, newText: string): string {
  if (oldText === newText) return "no change";

  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const changes: string[] = [];

  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    if (oldLine !== newLine) {
      if (oldLine !== undefined && newLine !== undefined) {
        changes.push(`~ L${i + 1}: "${oldLine.slice(0, 60)}" → "${newLine.slice(0, 60)}"`);
      } else if (oldLine !== undefined) {
        changes.push(`- L${i + 1}: "${oldLine.slice(0, 60)}"`);
      } else {
        changes.push(`+ L${i + 1}: "${newLine!.slice(0, 60)}"`);
      }
    }
  }

  return changes.length > 0 ? changes.join("\n") : "no change";
}

export { DEFAULT_THESIS };

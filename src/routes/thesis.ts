import { Router } from "express";
import { query } from "../db/client.js";
import { esc } from "./shared.js";
import { formatGst } from "../utils/time.js";

export const thesisRouter = Router();

// Parse thesis content into a header (lines without a leading timestamp) and
// individual entries (lines that start with "[ISO-timestamp]").
interface ThesisEntry {
  time: Date | null;
  text: string;
}
function parseThesisContent(content: string): { header: string; entries: ThesisEntry[] } {
  const lines = content.split(/\r?\n/);
  const entries: ThesisEntry[] = [];
  const headerLines: string[] = [];
  const tsRe = /^\s*\[([^\]]+)\]\s*(.*)$/;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(tsRe);
    if (m) {
      const iso = m[1]!;
      const text = m[2]!;
      const d = new Date(iso);
      entries.push({ time: isNaN(d.getTime()) ? null : d, text });
    } else {
      headerLines.push(line);
    }
  }
  return { header: headerLines.join("\n"), entries };
}

thesisRouter.get("/thesis", async (_req, res) => {
  try {
    const result = await query(
      `SELECT content, created_at FROM thesis_versions ORDER BY created_at DESC LIMIT 1`
    );

    const thesis = result.rows[0];
    const content = thesis?.content || "No thesis yet. Agent is observing.";
    const updatedDate = thesis?.created_at ? new Date(thesis.created_at) : null;
    const updated = updatedDate ? formatGst(updatedDate) : "never";

    const { header, entries } = parseThesisContent(content);

    // Current thesis block — header + most recent entries as cards
    let currentHtml = `<div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:20px;margin-bottom:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <span style="font-size:12px;color:#8b949e;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Current Thesis</span>
        <span style="font-size:11px;color:#8b949e;">Updated ${esc(updated)}</span>
      </div>`;

    if (header) {
      currentHtml += `<div style="font-size:14px;line-height:1.6;color:#c9d1d9;padding:12px 14px;background:#0d1117;border-left:3px solid #58a6ff;border-radius:4px;margin-bottom:16px;white-space:pre-wrap;">${esc(header)}</div>`;
    }

    if (entries.length > 0) {
      currentHtml += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;">`;
      const shown = entries.slice(-12).reverse();
      for (const e of shown) {
        const timeLabel = e.time ? formatGst(e.time) : "unknown time";
        currentHtml += `<div style="background:#0d1117;border:1px solid #21262d;border-radius:6px;padding:12px;">
          <div style="font-size:10px;color:#8b949e;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">${esc(timeLabel)}</div>
          <div style="font-size:13px;color:#c9d1d9;line-height:1.5;">${esc(e.text)}</div>
        </div>`;
      }
      currentHtml += `</div>`;
      if (entries.length > 12) {
        currentHtml += `<div style="font-size:11px;color:#8b949e;margin-top:10px;">Showing 12 of ${entries.length} thesis updates &mdash; see version history for full log.</div>`;
      }
    } else if (!header) {
      currentHtml += `<div style="font-size:13px;color:#8b949e;padding:12px 0;">${esc(content)}</div>`;
    }

    currentHtml += `</div>`;

    // Version history list (unchanged styling but with GST times)
    const historyResult = await query(
      `SELECT id, content, created_at FROM thesis_versions ORDER BY created_at DESC LIMIT 20`
    );

    const versionRows = historyResult.rows
      .map((v) => {
        const firstLine = v.content?.split("\n").map((s: string) => s.trim()).find((s: string) => s && !/^\s*\[/.test(s));
        const preview = firstLine || v.content?.slice(0, 120) || "(empty)";
        const when = formatGst(new Date(v.created_at));
        return `
        <div style="border-bottom:1px solid #21262d;display:flex;gap:12px;padding:12px 14px;cursor:pointer;transition:background 0.15s;" onclick="openDetail('/thesis/version/${esc(v.id)}')" onmouseover="this.style.background='#1c2128';" onmouseout="this.style.background='transparent';">
          <div style="font-size:11px;color:#8b949e;min-width:170px;">${esc(when)}</div>
          <div style="flex:1;font-size:12px;color:#c9d1d9;">${esc(preview.slice(0, 160))}</div>
        </div>`;
      })
      .join("");

    res.send(`
    <div id="thesis-section" hx-get="/thesis" hx-trigger="every 30s" hx-swap="outerHTML">
      ${currentHtml}
      <div style="background:#161b22;border:1px solid #30363d;border-radius:8px;overflow:hidden;">
        <div style="padding:12px 14px;border-bottom:1px solid #30363d;font-size:12px;color:#8b949e;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Version History &middot; click a row for details</div>
        <div style="max-height:420px;overflow-y:auto;">
          ${versionRows || '<div style="padding:16px;color:#8b949e;font-size:13px;">No thesis versions yet.</div>'}
        </div>
      </div>
    </div>`);
  } catch (err) {
    res.send(`<div style="color:#f85149;">Error: ${(err as Error).message}</div>`);
  }
});

thesisRouter.get("/thesis/version/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT id, content, created_at FROM thesis_versions WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).send(`<div style="color:#f85149;">Version not found</div>`);
    }

    const v = result.rows[0];
    const { header, entries } = parseThesisContent(v.content || "");

    let body = "";
    if (header) {
      body += `<div style="font-size:13px;color:#c9d1d9;padding:12px 14px;background:#0d1117;border-left:3px solid #58a6ff;border-radius:4px;margin-bottom:14px;white-space:pre-wrap;">${esc(header)}</div>`;
    }
    if (entries.length > 0) {
      body += `<div style="display:flex;flex-direction:column;gap:8px;">`;
      for (const e of entries.slice().reverse()) {
        const timeLabel = e.time ? formatGst(e.time) : "unknown time";
        body += `<div style="background:#0d1117;border:1px solid #21262d;border-radius:6px;padding:10px 12px;">
          <div style="font-size:10px;color:#8b949e;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">${esc(timeLabel)}</div>
          <div style="font-size:13px;color:#c9d1d9;line-height:1.5;">${esc(e.text)}</div>
        </div>`;
      }
      body += `</div>`;
    }
    if (!body) {
      body = `<div style="font-size:13px;color:#8b949e;padding:8px 0;white-space:pre-wrap;">${esc(v.content || "")}</div>`;
    }

    res.send(`
      <div>
        <div style="margin-bottom:14px;">
          <span style="font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:0.5px;">Thesis Version</span>
          <div style="font-size:11px;color:#8b949e;margin-top:2px;">${esc(formatGst(new Date(v.created_at)))}</div>
        </div>
        ${body}
      </div>`);
  } catch (err) {
    res.status(500).send(`<div style="color:#f85149;">Error: ${(err as Error).message}</div>`);
  }
});

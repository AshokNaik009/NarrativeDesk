export function esc(str: string | null | undefined): string {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderCountdown(expiresAt: Date): { text: string; css: string } {
  const remaining = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  const text = h > 0 ? `${h}h ${m}m` : `${m}m ${s.toString().padStart(2, "0")}s`;
  const css = remaining < 300 ? "danger" : remaining < 1800 ? "warning" : "safe";
  return { text, css };
}

export interface FilterCheckResult {
  name: string;
  status: "pass" | "fail" | "skip";
  note?: string;
}

// Given a filter_decisions row (passed + reason), infer the per-check breakdown.
// EventFilter.ts runs checks sequentially and fails fast, so the reason string
// tells us which check failed — the earlier ones passed, later ones were not run.
export function inferFilterChecks(passed: boolean, reason: string): FilterCheckResult[] {
  const checks: FilterCheckResult[] = [
    { name: "Watchlist", status: "skip" },
    { name: "Dedupe", status: "skip" },
    { name: "Source reputation", status: "skip" },
    { name: "Rate limit", status: "skip" },
    { name: "Headline length", status: "skip" },
  ];

  if (passed) {
    for (const c of checks) c.status = "pass";
    return checks;
  }

  // Map reason text to failing check index
  const r = (reason || "").toLowerCase();
  let failedAt = -1;
  if (r.includes("not in watchlist")) failedAt = 0;
  else if (r.includes("duplicate")) failedAt = 1;
  else if (r.includes("reputation")) failedAt = 2;
  else if (r.includes("rate limit")) failedAt = 3;
  else if (r.includes("headline") && r.includes("short")) failedAt = 4;

  if (failedAt === -1) {
    // Unknown reason — mark first check as fail so user sees something
    checks[0]!.status = "fail";
    checks[0]!.note = reason;
    return checks;
  }

  for (let i = 0; i < failedAt; i++) checks[i]!.status = "pass";
  checks[failedAt]!.status = "fail";
  checks[failedAt]!.note = reason;
  return checks;
}

export function renderFilterChecks(passed: boolean, reason: string): string {
  const checks = inferFilterChecks(passed, reason);
  const pill = (c: FilterCheckResult) => {
    const color =
      c.status === "pass" ? "#3fb950" : c.status === "fail" ? "#f85149" : "#484f58";
    const icon = c.status === "pass" ? "&#10003;" : c.status === "fail" ? "&#10007;" : "&middot;";
    const label =
      c.status === "pass" ? "passed" : c.status === "fail" ? "failed" : "not evaluated";
    return `<div style="display:flex;align-items:center;gap:10px;padding:6px 10px;background:#0d1117;border:1px solid #30363d;border-radius:4px;">
      <span style="color:${color};font-weight:700;font-size:14px;min-width:14px;">${icon}</span>
      <span style="flex:1;font-size:12px;color:#c9d1d9;">${esc(c.name)}</span>
      <span style="font-size:11px;color:${color};text-transform:uppercase;letter-spacing:0.5px;">${label}</span>
      ${c.note ? `<span style="font-size:11px;color:#8b949e;margin-left:8px;">&mdash; ${esc(c.note)}</span>` : ""}
    </div>`;
  };
  return `<div style="display:flex;flex-direction:column;gap:6px;">${checks.map(pill).join("")}</div>`;
}

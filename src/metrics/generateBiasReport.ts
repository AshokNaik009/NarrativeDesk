import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { computeBiasMetrics } from "./BiasAnalyzer.js";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function generateBiasReport(since?: Date): Promise<string> {
  const metrics = await computeBiasMetrics(since);

  const timestamp = new Date().toISOString().split("T")[0];
  const reportDir = join(__dirname, "../../reports");
  mkdirSync(reportDir, { recursive: true });
  const reportPath = join(reportDir, `bias-analysis-${timestamp}.md`);

  const totalApprovals = metrics.approvalsByTag.reduce((sum, t) => sum + t.approvedCount + t.rejectedCount, 0);
  const totalApproved = metrics.approvalsByTag.reduce((sum, t) => sum + t.approvedCount, 0);
  const totalRejected = metrics.approvalsByTag.reduce((sum, t) => sum + t.rejectedCount, 0);
  const approvalRate = totalApprovals > 0 ? (totalApproved / totalApprovals) * 100 : 0;

  const hindsightWins = metrics.hindsightAnalysis.filter((h) => h.wouldHaveWon).length;
  const hindsightMissed = metrics.hindsightAnalysis.length;

  let summary = `# HITL Bias Analysis Report\n\n`;
  summary += `**Generated:** ${new Date().toISOString()}\n\n`;
  summary += `## Executive Summary\n\n`;
  summary += `- **Total Approvals:** ${totalApprovals}\n`;
  summary += `- **Approval Rate:** ${approvalRate.toFixed(1)}% (${totalApproved} approved, ${totalRejected} rejected)\n`;
  summary += `- **Hindsight Analysis:** ${hindsightWins} of ${hindsightMissed} rejected trades would have been profitable\n`;
  summary += `- **Thesis Flips:** ${metrics.thesisDriftMetrics.totalFlips} flips (${metrics.thesisDriftMetrics.avgFlipsPerDay.toFixed(2)} per day)\n\n`;

  summary += `## Approval Bias by Tag\n\n`;
  summary += `| Tag | Approved | Rejected | Approval % | Avg Conviction | Win Rate |\n`;
  summary += `|-----|----------|----------|------------|----------------|----------|\n`;
  metrics.approvalsByTag.forEach((tag) => {
    const total = tag.approvedCount + tag.rejectedCount;
    const approvalPct = total > 0 ? ((tag.approvedCount / total) * 100).toFixed(1) : "N/A";
    const conviction = tag.avgConviction?.toFixed(2) ?? "N/A";
    const winRate = tag.winRate?.toFixed(2) ?? "N/A";
    summary += `| ${tag.tag} | ${tag.approvedCount} | ${tag.rejectedCount} | ${approvalPct}% | ${conviction} | ${winRate}% |\n`;
  });
  summary += `\n`;

  summary += `## Time-of-Day Bias (0-23 hours)\n\n`;
  summary += `| Hour | Approved | Rejected | Approval % | Win Rate |\n`;
  summary += `|------|----------|----------|------------|----------|\n`;
  metrics.approvalsByTimeOfDay.forEach((hour) => {
    const approvalPct = hour.approvalRate?.toFixed(1) ?? "N/A";
    const winRate = hour.winRate?.toFixed(2) ?? "N/A";
    summary += `| ${hour.hour.toString().padStart(2, "0")}:00 | ${hour.approvedCount} | ${hour.rejectedCount} | ${approvalPct}% | ${winRate}% |\n`;
  });
  summary += `\n`;

  summary += `## Conviction Impact on Approval\n\n`;
  summary += `| Conviction | Approved | Rejected | Approval % | Win Rate |\n`;
  summary += `|------------|----------|----------|------------|----------|\n`;
  metrics.approvalsByConviction.forEach((conv) => {
    const approvalPct = conv.approvalRate?.toFixed(1) ?? "N/A";
    const winRate = conv.winRate?.toFixed(2) ?? "N/A";
    summary += `| ${conv.conviction}/5 | ${conv.approvedCount} | ${conv.rejectedCount} | ${approvalPct}% | ${winRate}% |\n`;
  });
  summary += `\n`;

  summary += `## Hindsight: Top Rejected Trades That Would Have Won\n\n`;
  const topHindsight = metrics.hindsightAnalysis
    .filter((h) => h.wouldHaveWon && h.theoreticalPnl)
    .sort((a, b) => (b.theoreticalPnl ?? 0) - (a.theoreticalPnl ?? 0))
    .slice(0, 10);

  if (topHindsight.length > 0) {
    summary += `| Tag | Side | Entry | Target | 15m Price | Theo PnL | Conviction |\n`;
    summary += `|-----|------|-------|--------|-----------|----------|-------------|\n`;
    topHindsight.forEach((h) => {
      const pnl = h.theoreticalPnl?.toFixed(2) ?? "N/A";
      const conv = h.conviction ?? "N/A";
      summary += `| ${h.tag ?? "N/A"} | ${h.wouldHaveSide} | ${h.wouldHaveEntry.toFixed(2)} | ${h.wouldHaveTarget.toFixed(2)} | ${h.priceAt15m?.toFixed(2) ?? "N/A"} | ${pnl}% | ${conv} |\n`;
    });
  } else {
    summary += `*No rejected trades would have been profitable.*\n`;
  }
  summary += `\n`;

  summary += `## Actionable Insights\n\n`;

  const lowHours = metrics.approvalsByTimeOfDay.filter((h) => (h.approvalRate ?? 100) < 50);
  if (lowHours.length > 0) {
    const hours = lowHours.map((h) => `${h.hour.toString().padStart(2, "0")}:00`).join(", ");
    summary += `- **Fatigue detected:** Approval rate drops below 50% at hours: ${hours}\n`;
  }

  const convictions = metrics.approvalsByConviction.sort((a, b) => a.conviction - b.conviction);
  if (convictions.length > 0) {
    const lowConv = convictions[0];
    const highConv = convictions[convictions.length - 1];
    if (lowConv && highConv) {
      const lowRate = lowConv.approvalRate ?? 0;
      const highRate = highConv.approvalRate ?? 0;
      summary += `- **Conviction correlation:** Low conviction (${lowConv.conviction}/5) approved ${lowRate.toFixed(1)}%, high conviction (${highConv.conviction}/5) approved ${highRate.toFixed(1)}%\n`;
    }
  }

  summary += `- **Thesis drift:** ${metrics.thesisDriftMetrics.totalFlips} flips over period (${metrics.thesisDriftMetrics.avgFlipsPerDay.toFixed(2)} per day)\n`;

  const missedRate = hindsightMissed > 0 ? ((hindsightWins / hindsightMissed) * 100).toFixed(1) : 0;
  summary += `- **Rejected trades hindsight:** ${hindsightWins}/${hindsightMissed} (${missedRate}%) of rejected proposals would have won\n`;
  summary += `  - *Note: This is speculative, based on 15m price moves. Actual slippage could differ.*\n`;

  summary += `\n---\n\n`;
  summary += `*Report generated by NarrativeDesk Bias Analyzer*\n`;

  writeFileSync(reportPath, summary, "utf-8");
  return reportPath;
}

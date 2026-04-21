import { Router } from "express";
import { computeBiasMetrics } from "../metrics/BiasAnalyzer.js";
import { generateBiasReport } from "../metrics/generateBiasReport.js";

export const biasRouter = Router();

/**
 * GET /bias/json
 * Returns bias metrics as JSON
 */
biasRouter.get("/bias/json", async (req, res) => {
  try {
    const days = parseInt((req.query.days as string) || "30");
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const metrics = await computeBiasMetrics(since);
    res.json(metrics);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /bias/report
 * Generates and returns markdown report
 */
biasRouter.get("/bias/report", async (req, res) => {
  try {
    const days = parseInt((req.query.days as string) || "30");
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const reportPath = await generateBiasReport(since);
    res.json({ reportPath, message: "Bias report generated successfully" });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /bias
 * Serves the bias dashboard HTML
 */
biasRouter.get("/bias", async (_req, res) => {
  try {
    const metrics = await computeBiasMetrics(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

    // Render simple HTML dashboard with metrics
    const html = renderBiasDashboard(metrics);
    res.send(html);
  } catch (err) {
    res.status(500).send(`<h1>Error loading bias dashboard</h1><p>${(err as Error).message}</p>`);
  }
});

/**
 * Render bias dashboard as HTML
 */
function renderBiasDashboard(metrics: any): string {
  const tagRows = metrics.approvalsByTag
    .map(
      (t: any) =>
        `<tr>
      <td style="padding:8px;border-bottom:1px solid #21262d;">${t.tag || "N/A"}</td>
      <td style="padding:8px;border-bottom:1px solid #21262d;text-align:right;">${t.approvedCount}</td>
      <td style="padding:8px;border-bottom:1px solid #21262d;text-align:right;">${t.rejectedCount}</td>
      <td style="padding:8px;border-bottom:1px solid #21262d;text-align:right;">${
        t.avgConviction ? t.avgConviction.toFixed(2) : "N/A"
      }</td>
      <td style="padding:8px;border-bottom:1px solid #21262d;text-align:right;color:${
        t.winRate && t.winRate > 0 ? "#3fb950" : "#f85149"
      };">${t.winRate ? t.winRate.toFixed(2) : "N/A"}%</td>
    </tr>`
    )
    .join("");

  const timeRows = metrics.approvalsByTimeOfDay
    .map(
      (h: any) =>
        `<tr>
      <td style="padding:8px;border-bottom:1px solid #21262d;">${h.hour.toString().padStart(2, "0")}:00</td>
      <td style="padding:8px;border-bottom:1px solid #21262d;text-align:right;">${h.approvedCount}</td>
      <td style="padding:8px;border-bottom:1px solid #21262d;text-align:right;">${h.rejectedCount}</td>
      <td style="padding:8px;border-bottom:1px solid #21262d;text-align:right;">${
        h.approvalRate ? h.approvalRate.toFixed(1) : "N/A"
      }%</td>
      <td style="padding:8px;border-bottom:1px solid #21262d;text-align:right;color:${
        h.winRate && h.winRate > 0 ? "#3fb950" : "#f85149"
      };">${h.winRate ? h.winRate.toFixed(2) : "N/A"}%</td>
    </tr>`
    )
    .join("");

  const convRows = metrics.approvalsByConviction
    .map(
      (c: any) =>
        `<tr>
      <td style="padding:8px;border-bottom:1px solid #21262d;">${c.conviction}/5</td>
      <td style="padding:8px;border-bottom:1px solid #21262d;text-align:right;">${c.approvedCount}</td>
      <td style="padding:8px;border-bottom:1px solid #21262d;text-align:right;">${c.rejectedCount}</td>
      <td style="padding:8px;border-bottom:1px solid #21262d;text-align:right;">${
        c.approvalRate ? c.approvalRate.toFixed(1) : "N/A"
      }%</td>
      <td style="padding:8px;border-bottom:1px solid #21262d;text-align:right;color:${
        c.winRate && c.winRate > 0 ? "#3fb950" : "#f85149"
      };">${c.winRate ? c.winRate.toFixed(2) : "N/A"}%</td>
    </tr>`
    )
    .join("");

  const hindsightRows = metrics.hindsightAnalysis
    .filter((h: any) => h.wouldHaveWon && h.theoreticalPnl)
    .sort((a: any, b: any) => (b.theoreticalPnl ?? 0) - (a.theoreticalPnl ?? 0))
    .slice(0, 10)
    .map(
      (h: any) =>
        `<tr>
      <td style="padding:8px;border-bottom:1px solid #21262d;">${h.tag || "N/A"}</td>
      <td style="padding:8px;border-bottom:1px solid #21262d;">${h.wouldHaveSide}</td>
      <td style="padding:8px;border-bottom:1px solid #21262d;text-align:right;">${h.wouldHaveEntry.toFixed(2)}</td>
      <td style="padding:8px;border-bottom:1px solid #21262d;text-align:right;">${h.wouldHaveTarget.toFixed(2)}</td>
      <td style="padding:8px;border-bottom:1px solid #21262d;text-align:right;">${
        h.priceAt15m ? h.priceAt15m.toFixed(2) : "N/A"
      }</td>
      <td style="padding:8px;border-bottom:1px solid #21262d;text-align:right;color:#3fb950;">${
        h.theoreticalPnl ? h.theoreticalPnl.toFixed(2) : "N/A"
      }%</td>
      <td style="padding:8px;border-bottom:1px solid #21262d;text-align:right;">${h.conviction ?? "N/A"}</td>
    </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bias Analysis - NarrativeDesk</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0d1117;
      color: #c9d1d9;
      padding: 20px;
      max-width: 1400px;
      margin: 0 auto;
    }
    h1 { color: #58a6ff; margin-bottom: 30px; font-size: 28px; }
    h2 { color: #58a6ff; margin-top: 30px; margin-bottom: 15px; font-size: 20px; }
    .section { margin-bottom: 40px; padding: 20px; background: #0a0d13; border-radius: 6px; border: 1px solid #21262d; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
    }
    th {
      background: #161b22;
      padding: 10px;
      text-align: left;
      border-bottom: 2px solid #21262d;
      font-weight: 600;
      color: #58a6ff;
    }
    td { padding: 8px; }
    .positive { color: #3fb950; }
    .negative { color: #f85149; }
    .meta { font-size: 12px; color: #8b949e; margin-top: 10px; }
  </style>
</head>
<body>
  <h1>HITL Bias Analysis Dashboard</h1>

  <div class="section">
    <h2>Approval Metrics by Tag</h2>
    <table>
      <thead>
        <tr>
          <th>Tag</th>
          <th>Approved</th>
          <th>Rejected</th>
          <th>Avg Conviction</th>
          <th>Win Rate</th>
        </tr>
      </thead>
      <tbody>
        ${tagRows || "<tr><td colspan='5'>No data</td></tr>"}
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>Time-of-Day Approval Bias</h2>
    <table>
      <thead>
        <tr>
          <th>Hour</th>
          <th>Approved</th>
          <th>Rejected</th>
          <th>Approval %</th>
          <th>Win Rate</th>
        </tr>
      </thead>
      <tbody>
        ${timeRows || "<tr><td colspan='5'>No data</td></tr>"}
      </tbody>
    </table>
    <p class="meta">Lower approval rates during fatigue hours (late night/early morning) may indicate decision quality issues.</p>
  </div>

  <div class="section">
    <h2>Conviction Impact on Approval</h2>
    <table>
      <thead>
        <tr>
          <th>Conviction</th>
          <th>Approved</th>
          <th>Rejected</th>
          <th>Approval %</th>
          <th>Win Rate</th>
        </tr>
      </thead>
      <tbody>
        ${convRows || "<tr><td colspan='5'>No data</td></tr>"}
      </tbody>
    </table>
    <p class="meta">Analyze whether overconfidence (high conviction) correlates with worse outcomes.</p>
  </div>

  <div class="section">
    <h2>Hindsight: Top Rejected Trades That Would Have Won</h2>
    <table>
      <thead>
        <tr>
          <th>Tag</th>
          <th>Side</th>
          <th>Entry</th>
          <th>Target</th>
          <th>15m Price</th>
          <th>Theo PnL</th>
          <th>Conviction</th>
        </tr>
      </thead>
      <tbody>
        ${hindsightRows || "<tr><td colspan='7'>No rejected trades would have won</td></tr>"}
      </tbody>
    </table>
    <p class="meta">Speculative: based on 15m price movement. Actual slippage would differ. Shows missed opportunities.</p>
  </div>

  <div class="section">
    <h2>Thesis Drift Metrics</h2>
    <div style="padding:12px;background:#161b22;border-radius:4px;">
      <div style="margin:8px 0;"><strong>Total Flips:</strong> ${metrics.thesisDriftMetrics.totalFlips}</div>
      <div style="margin:8px 0;"><strong>Flips/Day:</strong> ${metrics.thesisDriftMetrics.avgFlipsPerDay.toFixed(2)}</div>
      <div style="margin:8px 0;"><strong>Leads Price Moves:</strong> ${metrics.thesisDriftMetrics.leadsPriceMovement ? "Yes" : "No"}</div>
    </div>
    <p class="meta">Track thesis consistency and whether narrative flips precede or lag price reversals.</p>
  </div>

</body>
</html>`;
}

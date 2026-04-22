import { theme } from "../lib/theme";
import { formatDollarsFull, formatDollars } from "../lib/format";
import { byExpiry, byType, sortedPositions, bucketLabel } from "../lib/pipelineDetail";
import { vixRegimeMultiplier } from "../lib/pipelineForecast";

// Normal-distribution z-scores for CI ranges. Used only for display on the
// Pipeline Detail page — main dashboard sticks to 80% CI (see ReviewSurface /
// CalendarTab pipeline summary).
const CI_LEVELS = [
  { label: "60%", z: 0.84 },
  { label: "80%", z: 1.28 },
  { label: "90%", z: 1.64 },
];

function fmtPct(p) {
  return p == null ? "—" : `${(p * 100).toFixed(0)}%`;
}
function fmtDate(s) {
  if (!s) return "—";
  const d = new Date(`${s}T00:00:00Z`);
  // Render in UTC so a date-only value (e.g. "2026-05-01") doesn't shift back
  // a day when the browser is west of UTC.
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function PipelineDetailPanel({ account }) {
  const fc = account?.forecast;
  if (!fc || !Array.isArray(fc.per_position)) {
    return (
      <div style={{ fontSize: theme.size.sm, color: theme.text.subtle, padding: theme.space[3] }}>
        No per-position forecast available yet — run today's snapshot to populate.
      </div>
    );
  }

  const positions = sortedPositions(fc.per_position);
  const expiries  = byExpiry(fc.per_position);
  const types     = byType(fc.per_position);

  return (
    <div style={{ marginTop: theme.space[4], padding: theme.space[4], background: theme.bg.base, borderRadius: theme.radius.md, border: `1px solid ${theme.border.default}` }}>
      {/* Three summary blocks — matches spec layout */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: theme.space[4], marginBottom: theme.space[4] }}>
        <SummaryBlock label="Current Month" rows={[
          ["Realized",           formatDollarsFull(fc.realized_to_date ?? 0)],
          ["Expected remaining", `~${formatDollarsFull(fc.this_month_remaining ?? 0)}`],
          ["Forecast total",     `~${formatDollarsFull(fc.month_total ?? 0)}`],
          ["vs target",          gapText(fc.target_gap)],
        ]} />
        <SummaryBlock label="Forward Pipeline" rows={[
          ["Forward premium", `~${formatDollarsFull(fc.forward_pipeline_premium ?? 0)}`],
          ["CSP share",       `~${formatDollarsFull(fc.csp_pipeline_premium ?? 0)}`],
          ["CC share",        `~${formatDollarsFull(fc.cc_pipeline_premium ?? 0)}`],
          ["Phase",           phaseLabel(fc.pipeline_phase)],
        ]} />
        <SummaryBlock label="By Position Type" rows={[
          ["CSP count · premium",  types.csp ? `${types.csp.count} · ${formatDollars(types.csp.premium)}` : "—"],
          ["CSP avg capture",      types.csp ? fmtPct(types.csp.avg_capture) : "—"],
          ["CC count · premium",   types.cc  ? `${types.cc.count} · ${formatDollars(types.cc.premium)}`   : "—"],
          ["Below-cost CC",        fc.below_cost_cc_premium > 0 ? formatDollars(fc.below_cost_cc_premium) : "none"],
        ]} />
      </div>

      {/* Forecast Confidence — 60/80/90% CIs around this-month estimate */}
      <ForecastConfidenceBlock fc={fc} account={account} />

      {/* By-expiry breakdown */}
      <div style={{ marginBottom: theme.space[4] }}>
        <div style={{ fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: theme.space[2] }}>
          By Expiry
        </div>
        <table style={{ width: "100%", fontSize: theme.size.sm, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: theme.text.subtle, textAlign: "left", borderBottom: `1px solid ${theme.border.default}` }}>
              <th style={thStyle}>Expiry</th>
              <th style={thStyle}>Count</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Premium</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Expected rem.</th>
              <th style={{ ...thStyle, textAlign: "right" }}>This month</th>
            </tr>
          </thead>
          <tbody>
            {expiries.map(e => (
              <tr key={e.expiry} style={{ borderBottom: `1px solid ${theme.border.default}` }}>
                <td style={tdStyle}>{fmtDate(e.expiry)}</td>
                <td style={tdStyle}>{e.count}</td>
                <td style={{ ...tdStyle, textAlign: "right", fontFamily: "monospace" }}>{formatDollars(e.premium)}</td>
                <td style={{ ...tdStyle, textAlign: "right", fontFamily: "monospace", color: theme.green }}>{formatDollars(e.remaining)}</td>
                <td style={{ ...tdStyle, textAlign: "right", fontFamily: "monospace" }}>{formatDollars(e.this_month)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Per-position table */}
      <div>
        <div style={{ fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: theme.space[2] }}>
          Per Position · {positions.length} open
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", fontSize: theme.size.sm, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: theme.text.subtle, textAlign: "left", borderBottom: `1px solid ${theme.border.default}` }}>
                <th style={thStyle}>Ticker</th>
                <th style={thStyle}>Type</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Strike</th>
                <th style={thStyle}>Expiry</th>
                <th style={{ ...thStyle, textAlign: "right" }}>DTE</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Profit %</th>
                <th style={thStyle}>Bucket</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Capture</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Premium</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Expected rem.</th>
                <th style={{ ...thStyle, textAlign: "right" }}>This month</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p, i) => (
                <tr key={`${p.ticker}-${p.type}-${p.strike}-${p.expiry}-${i}`} style={{ borderBottom: `1px solid ${theme.border.default}` }}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{p.ticker}</td>
                  <td style={tdStyle}>
                    <span style={{ color: p.type?.toLowerCase() === "csp" ? theme.blue : theme.green }}>
                      {p.type?.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: "monospace" }}>${p.strike}</td>
                  <td style={tdStyle}>{fmtDate(p.expiry)}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: "monospace" }}>{p.dte ?? "—"}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: "monospace" }}>{fmtPct(p.current_profit_pct)}</td>
                  <td style={{ ...tdStyle, color: theme.text.subtle }}>{bucketLabel(p.bucket)}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: "monospace" }}>{fmtPct(p.capture_pct)}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: "monospace" }}>{formatDollars(p.premium_at_open ?? 0)}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: "monospace", color: (p.remaining ?? 0) < 0 ? theme.red : theme.green }}>
                    {formatDollars(p.remaining ?? 0)}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: "monospace" }}>{formatDollars(p.this_month ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ForecastConfidenceBlock({ fc, account }) {
  const std    = fc?.this_month_std ?? null;
  const mean   = fc?.month_total ?? null;
  const vix    = account?.vix_current ?? null;
  const vixMul = vixRegimeMultiplier(vix);

  if (std == null || !isFinite(std) || std <= 0 || mean == null) return null;

  return (
    <div style={{ marginBottom: theme.space[4], padding: theme.space[3], background: theme.bg.surface, borderRadius: theme.radius.md, border: `1px solid ${theme.border.default}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: theme.space[2] }}>
        <div style={{ fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.5px" }}>
          Forecast Confidence · Implied month total
        </div>
        <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, fontFamily: "monospace" }}>
          VIX {vix != null ? vix.toFixed(1) : "—"} · regime ×{vixMul.toFixed(2)} · σ {formatDollars(Math.round(std))}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${CI_LEVELS.length}, 1fr)`, gap: theme.space[3] }}>
        {CI_LEVELS.map(({ label, z }) => {
          const halfWidth = z * std;
          const lo = mean - halfWidth;
          const hi = mean + halfWidth;
          return (
            <div key={label} style={{ padding: theme.space[2], background: theme.bg.base, borderRadius: theme.radius.sm, border: `1px solid ${theme.border.default}` }}>
              <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginBottom: 4 }}>{label} CI</div>
              <div style={{ fontSize: theme.size.md, color: theme.text.primary, fontFamily: "monospace" }}>
                {formatDollars(Math.round(lo))} – {formatDollars(Math.round(hi))}
              </div>
              <div style={{ fontSize: theme.size.xs, color: theme.text.muted, fontFamily: "monospace", marginTop: 2 }}>
                ±{formatDollars(Math.round(halfWidth))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SummaryBlock({ label, rows }) {
  return (
    <div style={{ padding: theme.space[3], background: theme.bg.surface, borderRadius: theme.radius.md, border: `1px solid ${theme.border.default}` }}>
      <div style={{ fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: theme.space[2] }}>
        {label}
      </div>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: theme.size.sm, marginBottom: 4 }}>
          <span style={{ color: theme.text.subtle }}>{k}</span>
          <span style={{ color: theme.text.primary, fontFamily: "monospace" }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

function gapText(gap) {
  if (gap == null) return "—";
  if (gap === 0) return "met ✓";
  return gap < 0 ? `↓ ${formatDollarsFull(-gap)}` : `↑ ${formatDollarsFull(gap)}`;
}

function phaseLabel(phase) {
  if (!phase) return "—";
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

const thStyle = {
  padding: `${theme.space[1]}px ${theme.space[2]}px`,
  fontWeight: 500,
  fontSize: theme.size.xs,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};
const tdStyle = {
  padding: `${theme.space[2]}px ${theme.space[2]}px`,
  color: theme.text.primary,
};

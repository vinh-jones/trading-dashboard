import { T } from "../../theme.js";
import { byExpiry, byType, sortedPositions, bucketLabel } from "../../../lib/pipelineDetail.js";
import { vixRegimeMultiplier } from "../../../lib/pipelineForecast.js";

const CI_LEVELS = [
  { label: "60%", z: 0.84 },
  { label: "80%", z: 1.28 },
  { label: "90%", z: 1.64 },
];

function fmt$(n) {
  if (n == null || !isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1000) return `${sign}$${Math.round(abs).toLocaleString()}`;
  return `${sign}$${Math.round(abs)}`;
}
function fmtPct(p) {
  return p == null ? "—" : `${(p * 100).toFixed(0)}%`;
}
function fmtDate(s) {
  if (!s) return "—";
  const d = new Date(`${s}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function PipelineDetailPanel({ account }) {
  const fc = account?.forecast;
  if (!fc || !Array.isArray(fc.per_position)) {
    return (
      <div style={{ fontSize: T.sm, color: T.ts, padding: 12, fontFamily: T.mono }}>
        No per-position forecast available yet — run today's snapshot to populate.
      </div>
    );
  }

  const positions = sortedPositions(fc.per_position);
  const expiries  = byExpiry(fc.per_position);
  const types     = byType(fc.per_position);

  return (
    <div style={{ marginTop: 14, padding: 14, background: T.bg, border: `1px solid ${T.bd}`, borderRadius: T.rMd }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 14 }}>
        <SummaryBlock label="Current Month" rows={[
          ["Realized",           fmt$(fc.realized_to_date ?? 0)],
          ["Expected remaining", `~${fmt$(fc.this_month_remaining ?? 0)}`],
          ["Forecast total",     `~${fmt$(fc.month_total ?? 0)}`],
          ["vs target",          gapText(fc.target_gap)],
        ]} />
        <SummaryBlock label="Forward Pipeline" rows={[
          ["Forward premium", `~${fmt$(fc.forward_pipeline_premium ?? 0)}`],
          ["CSP share",       `~${fmt$(fc.csp_pipeline_premium ?? 0)}`],
          ["CC share",        `~${fmt$(fc.cc_pipeline_premium ?? 0)}`],
          ["Phase",           phaseLabel(fc.pipeline_phase)],
        ]} />
        <SummaryBlock label="By Position Type" rows={[
          ["CSP count · premium",  types.csp ? `${types.csp.count} · ${fmt$(types.csp.premium)}` : "—"],
          ["CSP avg capture",      types.csp ? fmtPct(types.csp.avg_capture) : "—"],
          ["CC count · premium",   types.cc  ? `${types.cc.count} · ${fmt$(types.cc.premium)}`   : "—"],
          ["Below-cost CC",        fc.below_cost_cc_premium > 0 ? fmt$(fc.below_cost_cc_premium) : "none"],
        ]} />
      </div>

      {/* Forecast Confidence — 60/80/90% CIs */}
      <ForecastConfidenceBlock fc={fc} account={account} />

      {/* By-expiry */}
      <SectionHeader>By Expiry</SectionHeader>
      <table style={tableStyle}>
        <thead>
          <tr style={trHeaderStyle}>
            <th style={thStyle}>Expiry</th>
            <th style={thStyle}>#</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Premium</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Expected rem.</th>
            <th style={{ ...thStyle, textAlign: "right" }}>This month</th>
          </tr>
        </thead>
        <tbody>
          {expiries.map(e => (
            <tr key={e.expiry} style={trStyle}>
              <td style={tdStyle}>{fmtDate(e.expiry)}</td>
              <td style={tdStyle}>{e.count}</td>
              <td style={{ ...tdStyle, textAlign: "right" }}>{fmt$(e.premium)}</td>
              <td style={{ ...tdStyle, textAlign: "right", color: T.green }}>{fmt$(e.remaining)}</td>
              <td style={{ ...tdStyle, textAlign: "right" }}>{fmt$(e.this_month)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Per position */}
      <div style={{ marginTop: 16 }}>
        <SectionHeader>Per Position · {positions.length} open</SectionHeader>
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr style={trHeaderStyle}>
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
                <tr key={`${p.ticker}-${p.type}-${p.strike}-${p.expiry}-${i}`} style={trStyle}>
                  <td style={{ ...tdStyle, color: T.t1, fontWeight: 600 }}>{p.ticker}</td>
                  <td style={tdStyle}>
                    <span style={{ color: p.type?.toLowerCase() === "csp" ? T.blue : T.green }}>
                      {p.type?.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>${p.strike}</td>
                  <td style={tdStyle}>{fmtDate(p.expiry)}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{p.dte ?? "—"}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{fmtPct(p.current_profit_pct)}</td>
                  <td style={{ ...tdStyle, color: T.ts }}>{bucketLabel(p.bucket)}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{fmtPct(p.capture_pct)}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{fmt$(p.premium_at_open ?? 0)}</td>
                  <td style={{ ...tdStyle, textAlign: "right", color: (p.remaining ?? 0) < 0 ? T.red : T.green }}>
                    {fmt$(p.remaining ?? 0)}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{fmt$(p.this_month ?? 0)}</td>
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
    <div style={{ marginBottom: 14, padding: 10, background: T.surf, border: `1px solid ${T.bd}`, borderRadius: T.rSm, fontFamily: T.mono }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <div style={{ fontSize: T.xs, color: T.tm, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          Forecast Confidence · Implied month total
        </div>
        <div style={{ fontSize: T.xs, color: T.ts }}>
          VIX {vix != null ? vix.toFixed(1) : "—"} · regime ×{vixMul.toFixed(2)} · σ ${Math.round(std).toLocaleString()}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${CI_LEVELS.length}, 1fr)`, gap: 10 }}>
        {CI_LEVELS.map(({ label, z }) => {
          const halfWidth = z * std;
          const lo = mean - halfWidth;
          const hi = mean + halfWidth;
          return (
            <div key={label} style={{ padding: 8, background: T.bg, border: `1px solid ${T.bd}`, borderRadius: T.rSm }}>
              <div style={{ fontSize: T.xs, color: T.ts, marginBottom: 3 }}>{label} CI</div>
              <div style={{ fontSize: T.md, color: T.t1 }}>
                ${Math.round(lo).toLocaleString()} – ${Math.round(hi).toLocaleString()}
              </div>
              <div style={{ fontSize: T.xs, color: T.tm, marginTop: 2 }}>
                ±${Math.round(halfWidth).toLocaleString()}
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
    <div style={{ padding: 10, background: T.surf, border: `1px solid ${T.bd}`, borderRadius: T.rSm, fontFamily: T.mono }}>
      <div style={{ fontSize: T.xs, color: T.tm, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>
        {label}
      </div>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: T.sm, marginBottom: 3 }}>
          <span style={{ color: T.ts }}>{k}</span>
          <span style={{ color: T.t1 }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

function SectionHeader({ children }) {
  return (
    <div style={{ fontSize: T.xs, color: T.tm, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8, fontFamily: T.mono }}>
      {children}
    </div>
  );
}

function gapText(gap) {
  if (gap == null) return "—";
  if (gap === 0) return "met ✓";
  return gap < 0 ? `↓ ${fmt$(-gap)}` : `↑ ${fmt$(gap)}`;
}

function phaseLabel(phase) {
  if (!phase) return "—";
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

const tableStyle = {
  width: "100%", fontSize: T.sm, fontFamily: T.mono, borderCollapse: "collapse",
};
const trHeaderStyle = {
  color: T.ts, textAlign: "left", borderBottom: `1px solid ${T.bd}`,
};
const trStyle = {
  borderBottom: `1px solid ${T.bd}`,
};
const thStyle = {
  padding: "6px 8px", fontWeight: 500, fontSize: T.xs,
  textTransform: "uppercase", letterSpacing: "0.08em",
};
const tdStyle = {
  padding: "6px 8px", color: T.t2,
};

// Risk-Unit tab (v2, Phase 1) — the "second denominator" readout.
//
// DESCRIPTIVE-ONLY. These numbers measure risk; they carry NO decision
// authority. A risk readout is a brake, never a green light — same discipline
// as the cash floor not being a deployment platform.

import { useState } from "react";
import { theme } from "../lib/theme";
import { TYPE_COLORS } from "../lib/constants";
import { useRiskUnits } from "../hooks/useRiskUnits";
import {
  deltaNarrative, vegaNarrative, thetaNarrative, bookSummary, familyDivergence,
} from "../lib/riskNarrative";

// engine kind → TYPE_COLORS key
const FAMILY_LABEL = { CSP: "CSP", CC: "CC", LEAP: "LEAPS", SHARES: "Shares", SPREAD: "Spread" };
const FAMILY_ORDER = ["LEAP", "SHARES", "CSP", "CC", "SPREAD"];

// ── formatters ───────────────────────────────────────────────────────────────
const usd = (n) => {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  const body = a >= 1000 ? `$${(a / 1000).toFixed(1)}k` : `$${a.toFixed(0)}`;
  return n < 0 ? `−${body}` : body;
};
const signedUsd = (n) => (n == null ? "—" : (n >= 0 ? "+" : "") + usd(n));
const pct = (n) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);

// rgba tint derived from a theme hex token (keeps hue sourced from theme.js)
function tint(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const card = {
  background: theme.bg.surface, border: `1px solid ${theme.border.default}`,
  borderRadius: theme.radius.md, padding: theme.space[4],
};
const sectionTitle = {
  fontSize: theme.size.sm, color: theme.text.muted, textTransform: "uppercase",
  letterSpacing: "0.5px", marginBottom: theme.space[3],
};

function Badge({ kind }) {
  const key = FAMILY_LABEL[kind] || kind;
  const c = TYPE_COLORS[key] || TYPE_COLORS.Shares;
  return (
    <span style={{
      display: "inline-block", padding: "1px 6px", borderRadius: theme.radius.sm,
      fontSize: theme.size.xs, fontWeight: 600, background: c.bg, color: c.text,
      border: `1px solid ${c.border}`,
    }}>{key}</span>
  );
}

// ── denominator headline card ────────────────────────────────────────────────
function Denominator({ label, sublabel, value, unit, read, about, accent }) {
  return (
    <div style={{ ...card, flex: 1, minWidth: 200 }}>
      <div style={{ display: "flex", alignItems: "center", gap: theme.space[1] }}>
        <span style={{ fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</span>
        {about && <span title={about} style={{ cursor: "help", color: theme.text.subtle, fontSize: theme.size.xs }}>ⓘ</span>}
      </div>
      <div style={{ fontSize: theme.size.xxl, fontFamily: theme.font.mono, color: accent, margin: `${theme.space[1]}px 0` }}>
        {signedUsd(value)}
      </div>
      <div style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>{unit}</div>
      {sublabel && <div style={{ fontSize: theme.size.xs, color: accent, marginTop: theme.space[1], fontWeight: 600 }}>{sublabel}</div>}
      <div style={{ fontSize: theme.size.sm, color: theme.text.secondary, marginTop: theme.space[2] }}>{read}</div>
    </div>
  );
}

export function RiskTab({ positions = null, account = null }) {
  const { risk, refreshedAt, loading, error } = useRiskUnits(positions);
  const [howToRead, setHowToRead] = useState(false);

  if (loading) return <div style={{ padding: theme.space[5], color: theme.text.muted, fontSize: theme.size.sm, textAlign: "center" }}>Computing risk…</div>;
  if (error)   return <div style={{ ...card, color: theme.red }}>Failed to load risk inputs: {error}</div>;
  if (!risk)   return <div style={{ padding: theme.space[5], color: theme.text.muted }}>No risk data.</div>;

  const { aggregate: agg, grid } = risk;
  const acctValue = account?.account_value ?? null;

  const dN = deltaNarrative(agg.netBetaWeightedDelta, acctValue);
  const vN = vegaNarrative(agg.netVega, account?.vix_current);
  const tN = thetaNarrative(agg.netTheta);

  const deltaSign = agg.netBetaWeightedDelta >= 0;
  const vegaShort = agg.netVega < 0;

  // family rollup: risk share (|beta-weighted delta|) vs capital share
  const famRows = FAMILY_ORDER
    .filter((k) => agg.byFamily[k])
    .map((k) => ({ kind: k, ...agg.byFamily[k] }));
  const totalRisk = famRows.reduce((s, f) => s + Math.abs(f.betaWeightedDelta), 0) || 1;
  const totalCap  = agg.totalCapital || 1;

  // grid tint scale
  const maxAbs = Math.max(1, ...grid.flatMap((row) => row.cells.map((c) => Math.abs(c.pnl))));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.space[4] }}>

      {/* observe-only banner */}
      <div style={{
        background: theme.bg.surface, border: `1px solid ${theme.border.strong}`,
        borderRadius: theme.radius.md, padding: `${theme.space[2]}px ${theme.space[3]}px`,
        fontSize: theme.size.xs, color: theme.text.muted,
      }}>
        Descriptive-only · observe-first. These measure risk — they carry no decision authority. A risk readout is a brake, not a green light.
      </div>

      {/* book in one line + how-to-read */}
      <div style={{ ...card, padding: `${theme.space[2]}px ${theme.space[3]}px` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: theme.space[2], flexWrap: "wrap" }}>
          <div style={{ fontSize: theme.size.md, color: theme.text.primary }}>
            <span style={{ color: theme.text.muted }}>Your book, in one line: </span>{bookSummary(agg)}
          </div>
          <button onClick={() => setHowToRead((v) => !v)} style={{
            background: "none", border: `1px solid ${theme.border.default}`, color: theme.text.muted,
            borderRadius: theme.radius.sm, padding: "2px 8px", fontSize: theme.size.xs, cursor: "pointer", fontFamily: "inherit",
          }}>
            {howToRead ? "Hide" : "ⓘ How to read this"}
          </button>
        </div>
        {howToRead && (
          <div style={{ marginTop: theme.space[3], display: "flex", flexDirection: "column", gap: theme.space[2], fontSize: theme.size.sm, color: theme.text.secondary }}>
            <div><b style={{ color: theme.text.primary }}>Beta-weighted delta</b> — {dN.about}</div>
            <div><b style={{ color: theme.text.primary }}>Net vega</b> — {vN.about}</div>
            <div><b style={{ color: theme.text.primary }}>Net theta</b> — {tN.about}</div>
            <div><b style={{ color: theme.text.primary }}>Scenario grid</b> — total P&L if the S&P moves (rows) and implied vol moves (columns). The center cell is "nothing moved" = $0. Read down a column for pure price risk; read across a row for vol's effect.</div>
            <div><b style={{ color: theme.text.primary }}>Risk vs capital</b> — amber is each family's share of directional risk, blue its share of capital. Where they diverge is the point: a long amber bar over a short blue one means that family punches above its capital weight in risk.</div>
            <div style={{ color: theme.text.subtle }}>These describe what your current exposure means — not what to do with it.</div>
          </div>
        )}
      </div>

      {/* two denominators + theta */}
      <div style={{ display: "flex", gap: theme.space[3], flexWrap: "wrap" }}>
        <Denominator
          label="Beta-weighted delta" sublabel={dN.label} about={dN.about}
          value={agg.netBetaWeightedDelta} unit="$ P&L per +1% SPX move"
          accent={deltaSign ? theme.green : theme.red} read={dN.plain}
        />
        <Denominator
          label="Net vega" sublabel={vN.label} about={vN.about}
          value={agg.netVega} unit="$ P&L per +1 IV point"
          accent={vegaShort ? theme.red : theme.green} read={vN.plain}
        />
        <Denominator
          label="Net theta" sublabel={tN.label} about={tN.about}
          value={agg.netTheta} unit="$ P&L per calendar day"
          accent={agg.netTheta >= 0 ? theme.green : theme.red} read={tN.plain}
        />
      </div>

      {/* scenario grid */}
      <div style={card}>
        <div style={sectionTitle}>Scenario grid — P&L under price × vol shocks</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontFamily: theme.font.mono, fontSize: theme.size.sm }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: theme.space[2], color: theme.text.muted, fontSize: theme.size.xs }}>SPX ↓ / IV →</th>
                {grid[0].cells.map((c) => (
                  <th key={c.ivShock} style={{ textAlign: "right", padding: theme.space[2], color: theme.text.muted, fontSize: theme.size.xs }}>
                    {c.ivShock >= 0 ? "+" : ""}{c.ivShock} IV
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map((row) => (
                <tr key={row.spxShock}>
                  <td style={{ padding: theme.space[2], color: theme.text.secondary, whiteSpace: "nowrap" }}>
                    {row.spxShock >= 0 ? "+" : ""}{row.spxShock}% SPX
                  </td>
                  {row.cells.map((c) => {
                    const alpha = Math.min(0.8, (Math.abs(c.pnl) / maxAbs) * 0.8);
                    return (
                      <td key={c.ivShock} title={acctValue ? `${pct(c.pnl / acctValue)} of account` : undefined}
                        style={{
                          padding: theme.space[2], textAlign: "right",
                          background: tint(c.pnl < 0 ? theme.red : theme.green, alpha),
                          color: theme.text.primary, borderRadius: theme.radius.sm,
                        }}>
                        {signedUsd(c.pnl)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginTop: theme.space[2] }}>
          Full revaluation; each name's price shock is beta-scaled off the common SPX move (a co-movement proxy, not a covariance model).
        </div>
      </div>

      {/* risk vs capital by family */}
      <div style={card}>
        <div style={sectionTitle}>Risk vs capital, by family</div>
        <div style={{ display: "flex", flexDirection: "column", gap: theme.space[3] }}>
          {famRows.map((f) => {
            const riskShare = Math.abs(f.betaWeightedDelta) / totalRisk;
            const capShare  = f.capital / totalCap;
            return (
              <div key={f.kind}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: theme.space[1] }}>
                  <Badge kind={f.kind} />
                  <span style={{ fontSize: theme.size.xs, color: theme.text.muted, fontFamily: theme.font.mono }}>
                    risk {pct(riskShare)} · capital {pct(capShare)}
                  </span>
                </div>
                <div style={{ display: "flex", gap: theme.space[1], height: 6 }}>
                  <div style={{ width: `${riskShare * 100}%`, background: theme.amber, borderRadius: theme.radius.sm }} title="risk share" />
                </div>
                <div style={{ display: "flex", gap: theme.space[1], height: 6, marginTop: 2 }}>
                  <div style={{ width: `${capShare * 100}%`, background: theme.blueBold, borderRadius: theme.radius.sm }} title="capital share" />
                </div>
                <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginTop: 2 }}>{familyDivergence(riskShare, capShare)}</div>
              </div>
            );
          })}
          <div style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>
            <span style={{ color: theme.amber }}>▬</span> risk (|beta-weighted delta|) &nbsp; <span style={{ color: theme.blueBold }}>▬</span> capital — divergence is the point.
          </div>
        </div>
      </div>

      {/* per-position breakdown */}
      <div style={card}>
        <div style={sectionTitle}>Positions by directional risk</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: theme.size.sm }}>
            <thead>
              <tr style={{ color: theme.text.muted, fontSize: theme.size.xs, textAlign: "right" }}>
                <th style={{ textAlign: "left", padding: theme.space[2] }}>Position</th>
                <th style={{ padding: theme.space[2], cursor: "help" }} title="Beta-weighted delta — $ P&L for a 1% SPX move, beta-scaled. Positive = long the market.">βΔ ($/1% SPX)</th>
                <th style={{ padding: theme.space[2], cursor: "help" }} title="Vega — $ P&L per +1 IV point. Long options (LEAPs) are +, short premium (CSP/CC) is −.">Vega ($/IV pt)</th>
                <th style={{ padding: theme.space[2], cursor: "help" }} title="Theta — $ P&L per day from time decay. Short premium collects (+), long options pay (−).">Theta ($/day)</th>
                <th style={{ padding: theme.space[2] }}>Capital</th>
              </tr>
            </thead>
            <tbody style={{ fontFamily: theme.font.mono }}>
              {agg.perPosition.map((p, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${theme.border.default}` }}>
                  <td style={{ padding: theme.space[2], fontFamily: theme.font.mono }}>
                    <Badge kind={p.kind} />{" "}
                    <span style={{ color: theme.text.primary }}>{p.ticker}</span>
                    {p.strike ? <span style={{ color: theme.text.subtle }}> {p.strike}</span> : null}
                    {p.betaAssumed ? <span title="no beta — assumed 1.0" style={{ color: theme.amber, fontSize: theme.size.xs }}> β?</span> : null}
                  </td>
                  <td style={{ padding: theme.space[2], textAlign: "right", color: p.betaWeightedDelta >= 0 ? theme.green : theme.red }}>{signedUsd(p.betaWeightedDelta)}</td>
                  <td style={{ padding: theme.space[2], textAlign: "right", color: p.vegaDollars >= 0 ? theme.green : theme.red }}>{signedUsd(p.vegaDollars)}</td>
                  <td style={{ padding: theme.space[2], textAlign: "right", color: p.thetaDollars >= 0 ? theme.green : theme.red }}>{signedUsd(p.thetaDollars)}</td>
                  <td style={{ padding: theme.space[2], textAlign: "right", color: theme.text.muted }}>{usd(p.capital)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* coverage footer */}
      <div style={{ fontSize: theme.size.xs, color: theme.text.muted }}>
        Coverage: {agg.coverage.covered} of {agg.coverage.total} legs have live greeks
        {agg.coverage.uncovered.length > 0 && (
          <span style={{ color: theme.amber }}>
            {" "}· uncovered: {agg.coverage.uncovered.map((u) => `${u.ticker} (${u.reason})`).join(", ")}
          </span>
        )}
        {refreshedAt && <span style={{ color: theme.text.subtle }}> · quotes {new Date(refreshedAt).toLocaleTimeString()}</span>}
      </div>
    </div>
  );
}

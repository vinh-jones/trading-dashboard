import { useState, useMemo } from "react";
import { theme } from "../lib/theme";
import { useUwSignals } from "../hooks/useUwSignals";
import { summarizeWhaleFlowByTicker, WHALE_FLOW_DEFAULTS } from "../lib/whaleCspFlow";

function fmtPremium(n) {
  if (n == null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}k`;
  return `$${n}`;
}

const SCORE_COLOR = {
  Strong:   theme.green,
  Moderate: theme.blue,
  Neutral:  theme.text.muted,
  Weak:     theme.text.subtle,
};

function flowChip(s) {
  if (s == null)  return { label: "—",       color: theme.text.subtle };
  if (s >= 0.2)   return { label: "bullish",  color: theme.green };
  if (s <= -0.2)  return { label: "bearish",  color: theme.red };
  return { label: "neutral", color: theme.text.muted };
}

// Whale CSP flow (Consumer 5) — a per-ticker shortlist of where institutions
// are selling puts, fused with the Radar entry score. Filtered to your CSP
// window (7-65 DTE, OTM) by default; toggle to see everything. Each row expands
// to its individual trades.
export function WhaleFlowPanel({ heldTickers, scoreByTicker }) {
  const { uwSignals } = useUwSignals();
  const [open, setOpen]         = useState(false);
  const [filtered, setFiltered] = useState(true);
  const [expanded, setExpanded] = useState(null);

  const rows = useMemo(() => {
    const list = [...uwSignals.values()];
    const opts = { heldTickers, scoreByTicker, minPremium: WHALE_FLOW_DEFAULTS.minPremium };
    if (filtered) Object.assign(opts, {
      minDte: WHALE_FLOW_DEFAULTS.minDte, maxDte: WHALE_FLOW_DEFAULTS.maxDte, otmOnly: WHALE_FLOW_DEFAULTS.otmOnly,
    });
    return summarizeWhaleFlowByTicker(list, opts);
  }, [uwSignals, heldTickers, scoreByTicker, filtered]);

  if (uwSignals.size === 0) return null;

  const th = (label, align = "left") => (
    <th style={{
      textAlign: align, padding: `${theme.space[2]}px ${theme.space[3]}px`,
      color: theme.text.muted, fontWeight: 500, fontSize: theme.size.xs,
      textTransform: "uppercase", letterSpacing: "0.5px", whiteSpace: "nowrap",
    }}>{label}</th>
  );
  const td = (content, style = {}) => (
    <td style={{ padding: `${theme.space[2]}px ${theme.space[3]}px`, ...style }}>{content}</td>
  );

  return (
    <div style={{
      background: theme.bg.surface, border: `1px solid ${theme.border.default}`,
      borderRadius: theme.radius.md, marginBottom: theme.space[4], overflow: "hidden",
    }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "transparent", border: "none", cursor: "pointer",
          padding: `${theme.space[3]}px ${theme.space[4]}px`, fontFamily: "inherit",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: theme.space[2] }}>
          <span style={{ fontSize: theme.size.md, color: theme.text.primary, fontWeight: 600 }}>
            🐋 Whale put-selling flow
          </span>
          <span style={{
            fontSize: theme.size.xs, color: theme.blue, background: `${theme.blue}22`,
            border: `1px solid ${theme.blue}66`, borderRadius: theme.radius.pill, padding: "1px 7px", fontWeight: 600,
          }}>{rows.length}</span>
        </span>
        <span style={{ color: theme.text.subtle, fontSize: theme.size.sm }}>{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div style={{ borderTop: `1px solid ${theme.border.default}` }}>
          <div style={{ display: "flex", gap: theme.space[1], padding: `${theme.space[2]}px ${theme.space[3]}px` }}>
            <FilterBtn active={filtered}  onClick={() => setFiltered(true)}>CSP window (7–65d · OTM)</FilterBtn>
            <FilterBtn active={!filtered} onClick={() => setFiltered(false)}>All put-sells</FilterBtn>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: theme.size.sm }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${theme.border.strong}` }}>
                  {th("Ticker")}{th("Score")}{th("Put-sell $", "right")}{th("#", "right")}
                  {th("Top strike", "right")}{th("Flow", "right")}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isOpen   = expanded === r.ticker;
                  const fc       = flowChip(r.flow_sentiment);
                  const scColor  = SCORE_COLOR[r.score_label] ?? theme.text.subtle;
                  // Shortlist accent: good setup AND bullish institutional flow.
                  const isCandidate = (r.score_label === "Strong" || r.score_label === "Moderate") && r.flow_sentiment > 0.2;
                  return (
                    <FragmentRow key={r.ticker}>
                      <tr
                        onClick={() => setExpanded(isOpen ? null : r.ticker)}
                        style={{
                          borderBottom: `1px solid ${theme.border.default}`, cursor: "pointer",
                          borderLeft: isCandidate ? `3px solid ${theme.green}` : "3px solid transparent",
                        }}
                      >
                        {td(
                          <span style={{ fontWeight: 700, color: theme.text.primary }}>
                            {r.ticker}
                            {r.held && (
                              <span style={{
                                marginLeft: theme.space[1], fontSize: theme.size.xs, color: theme.amber,
                                background: `${theme.amber}22`, border: `1px solid ${theme.amber}66`,
                                borderRadius: theme.radius.pill, padding: "0 6px",
                              }}>held</span>
                            )}
                          </span>
                        )}
                        {td(
                          <span>
                            <span style={{ color: scColor, fontWeight: 600 }}>{r.score_label ?? "—"}</span>
                            {r.iv_rank != null && (
                              <span style={{ color: theme.text.subtle, fontSize: theme.size.xs }}> · IVR {Math.round(r.iv_rank)}</span>
                            )}
                          </span>
                        )}
                        {td(fmtPremium(r.total_premium), { textAlign: "right", color: theme.green, fontWeight: 600, fontFamily: theme.font.mono })}
                        {td(r.trade_count, { textAlign: "right", color: theme.text.muted })}
                        {td(
                          <span style={{ color: theme.text.primary }}>
                            ${r.top_strike}
                            {r.top_strike_otm != null && (
                              <span style={{ color: r.top_strike_otm >= 0 ? theme.green : theme.red, fontSize: theme.size.xs }}>
                                {" "}{r.top_strike_otm >= 0 ? "+" : ""}{r.top_strike_otm.toFixed(1)}%
                              </span>
                            )}
                          </span>,
                          { textAlign: "right" }
                        )}
                        {td(<span style={{ color: fc.color, fontWeight: 600 }}>{fc.label}</span>, { textAlign: "right" })}
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={6} style={{ padding: 0, background: theme.bg.base }}>
                            <div style={{ padding: `${theme.space[2]}px ${theme.space[4]}px` }}>
                              {r.trades.map((t, i) => (
                                <div key={i} style={{
                                  display: "flex", gap: theme.space[3], fontSize: theme.size.xs,
                                  color: theme.text.muted, padding: "2px 0",
                                }}>
                                  <span style={{ color: theme.text.secondary }}>${t.strike} put</span>
                                  <span>{t.dte != null ? `${t.dte}d` : "—"}</span>
                                  <span style={{ color: t.otm_pct >= 0 ? theme.green : theme.red }}>
                                    {t.otm_pct != null ? `${t.otm_pct >= 0 ? "+" : ""}${t.otm_pct.toFixed(1)}% OTM` : ""}
                                  </span>
                                  <span style={{ color: theme.green, fontFamily: theme.font.mono }}>{fmtPremium(t.premium)}</span>
                                  {t.has_sweep && <span style={{ color: theme.amber }}>sweep</span>}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </FragmentRow>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ padding: `${theme.space[2]}px ${theme.space[4]}px`, fontSize: theme.size.xs, color: theme.text.subtle }}>
            Tickers ranked by total institutional put-sell premium. <span style={{ color: theme.green }}>Green bar</span> = strong/moderate setup AND bullish flow. Click a row for the individual trades.
          </div>
        </div>
      )}
    </div>
  );
}

function FilterBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      fontSize: theme.size.xs, fontFamily: "inherit", cursor: "pointer",
      padding: "3px 10px", borderRadius: theme.radius.pill,
      border: `1px solid ${active ? theme.blue : theme.border.default}`,
      background: active ? `${theme.blue}22` : "transparent",
      color: active ? theme.blue : theme.text.muted, fontWeight: active ? 600 : 400,
    }}>{children}</button>
  );
}

// React.Fragment with a key, kept terse for the row+detail pair.
function FragmentRow({ children }) {
  return <>{children}</>;
}

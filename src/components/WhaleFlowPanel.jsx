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

// Column explanations — used for both the header hover tooltip (desktop) and
// the tap-to-open column guide (mobile). Written for someone still learning.
const COLUMN_HELP = {
  "Ticker":     "The stock. ★ + green row = a prime CSP candidate: good setup AND bullish flow. 'held' = you already have a position in it.",
  "Score":      "Your entry quality — IV richness + Bollinger position + trend + gamma/flow. Strong or Moderate = a better setup to sell a put. IVR = IV rank; higher = richer premium (good = ~50+).",
  "Put-sell $": "Total premium institutions collected selling puts here (within the filter). Bigger = more institutional conviction by size. Good = large.",
  "#":          "Number of separate whale put-sell trades. More = repeated conviction, not a one-off. Good = several.",
  "Top strike": "The strike with the most put-sell premium — a price level whales are validating. +% = out-of-the-money (below spot, the safe sell zone, good); −% = in-the-money (more aggressive).",
  "Flow":       "Net options flow direction. Bullish (good for selling puts) = put-selling + call-buying dominate. Bearish = the opposite. Neutral = mixed.",
  "Gamma":      "Dealer-gamma regime. Stable (good) = market makers calm the stock — CSP-friendly. Choppy (caution) = they amplify moves — faster, riskier. Flat = neutral.",
};

function flowChip(s) {
  if (s == null)  return { label: "—",       color: theme.text.subtle };
  if (s >= 0.2)   return { label: "bullish",  color: theme.green };
  if (s <= -0.2)  return { label: "bearish",  color: theme.red };
  return { label: "neutral", color: theme.text.muted };
}

// Gamma environment — positive = dealers stabilize (chop, CSP-friendly),
// negative = they amplify (fast moves). Ryan sells puts best in stable regimes.
function gammaChip(g) {
  if (g == null)   return { label: "—",      color: theme.text.subtle };
  if (g >= 0.10)   return { label: "stable", color: theme.green };
  if (g <= -0.10)  return { label: "choppy", color: theme.red };
  return { label: "flat", color: theme.text.muted };
}

// Whale CSP flow (Consumer 5) — a per-ticker shortlist of where institutions
// are selling puts, fused with the Radar entry score. Filtered to your CSP
// window (7-65 DTE, OTM) by default; toggle to see everything. Each row expands
// to its individual trades.
export function WhaleFlowPanel({ heldTickers, scoreByTicker }) {
  const { uwSignals } = useUwSignals();
  const [open, setOpen]           = useState(false);
  const [filtered, setFiltered]   = useState(true);
  const [expanded, setExpanded]   = useState(null);
  const [guideOpen, setGuideOpen] = useState(false);

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
    <th title={COLUMN_HELP[label]} style={{
      textAlign: align, padding: `${theme.space[2]}px ${theme.space[3]}px`,
      color: theme.text.muted, fontWeight: 500, fontSize: theme.size.xs,
      textTransform: "uppercase", letterSpacing: "0.5px", whiteSpace: "nowrap",
      cursor: "help", textDecoration: "underline dotted", textUnderlineOffset: 3,
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
          <div style={{ display: "flex", gap: theme.space[1], alignItems: "center", flexWrap: "wrap", padding: `${theme.space[2]}px ${theme.space[3]}px` }}>
            <FilterBtn active={filtered}  onClick={() => setFiltered(true)}>CSP window (7–65d · OTM)</FilterBtn>
            <FilterBtn active={!filtered} onClick={() => setFiltered(false)}>All put-sells</FilterBtn>
            <button
              onClick={() => setGuideOpen((g) => !g)}
              style={{
                marginLeft: "auto", fontSize: theme.size.xs, fontFamily: "inherit", cursor: "pointer",
                background: "transparent", border: "none", color: theme.text.muted, textDecoration: "underline",
              }}
            >{guideOpen ? "hide guide" : "ⓘ what do these mean?"}</button>
          </div>

          {guideOpen && (
            <div style={{
              padding: `${theme.space[2]}px ${theme.space[4]}px ${theme.space[3]}px`,
              borderBottom: `1px solid ${theme.border.default}`, background: theme.bg.base,
            }}>
              {Object.entries(COLUMN_HELP).map(([col, text]) => (
                <div key={col} style={{ fontSize: theme.size.xs, color: theme.text.muted, padding: "3px 0", lineHeight: 1.5 }}>
                  <span style={{ color: theme.text.secondary, fontWeight: 600 }}>{col}</span> — {text}
                </div>
              ))}
            </div>
          )}

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: theme.size.sm }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${theme.border.strong}` }}>
                  {th("Ticker")}{th("Score")}{th("Put-sell $", "right")}{th("#", "right")}
                  {th("Top strike", "right")}{th("Flow", "right")}{th("Gamma", "right")}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isOpen   = expanded === r.ticker;
                  const fc       = flowChip(r.flow_sentiment);
                  const gc       = gammaChip(r.gamma_env);
                  const scColor  = SCORE_COLOR[r.score_label] ?? theme.text.subtle;
                  const isCandidate = r.is_candidate;
                  return (
                    <FragmentRow key={r.ticker}>
                      <tr
                        onClick={() => setExpanded(isOpen ? null : r.ticker)}
                        style={{
                          borderBottom: `1px solid ${theme.border.default}`, cursor: "pointer",
                          borderLeft: isCandidate ? `3px solid ${theme.green}` : "3px solid transparent",
                          background: isCandidate ? `${theme.green}14` : "transparent",
                        }}
                      >
                        {td(
                          <span style={{ fontWeight: 700, color: theme.text.primary }}>
                            {isCandidate && <span style={{ color: theme.green, marginRight: 4 }}>★</span>}
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
                        {td(<span style={{ color: gc.color, fontWeight: 600 }}>{gc.label}</span>, { textAlign: "right" })}
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={7} style={{ padding: 0, background: theme.bg.base }}>
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
            Tickers ranked by total institutional put-sell premium. <span style={{ color: theme.green }}>★ green row</span> = strong/moderate setup AND bullish flow — your prime CSP candidates. Gamma: <span style={{ color: theme.green }}>stable</span> = CSP-friendly, <span style={{ color: theme.red }}>choppy</span> = caution. Click a row for the individual trades.
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

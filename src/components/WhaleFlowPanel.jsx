import { useState, useMemo } from "react";
import { theme } from "../lib/theme";
import { useUwSignals } from "../hooks/useUwSignals";
import { aggregateWhalePutSells } from "../lib/whaleCspFlow";

function fmtPremium(n) {
  if (n == null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}k`;
  return `$${n}`;
}

function dte(expiryIso) {
  if (!expiryIso) return null;
  const ms = Date.parse(`${expiryIso}T00:00:00Z`) - Date.now();
  return Math.max(0, Math.round(ms / 86400000));
}

// Whale CSP flow (Consumer 5) — a ranked feed of institutions selling puts
// across the watchlist. Ryan's CSP idea-generation screen. Collapsed by default
// so it stays out of the way until you want it.
export function WhaleFlowPanel({ heldTickers }) {
  const { uwSignals } = useUwSignals();
  const [open, setOpen] = useState(false);

  const rows = useMemo(
    () => aggregateWhalePutSells([...uwSignals.values()], { heldTickers }),
    [uwSignals, heldTickers]
  );

  if (rows.length === 0) return null;

  return (
    <div style={{
      background: theme.bg.surface,
      border: `1px solid ${theme.border.default}`,
      borderRadius: theme.radius.md,
      marginBottom: theme.space[4],
      overflow: "hidden",
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
        <div style={{ borderTop: `1px solid ${theme.border.default}`, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: theme.size.sm }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${theme.border.strong}` }}>
                {["TICKER", "STRIKE", "DTE", "OTM%", "PREMIUM", ""].map((h, i) => (
                  <th key={h || i} style={{
                    textAlign: i >= 1 && i <= 4 ? "right" : "left",
                    padding: `${theme.space[2]}px ${theme.space[3]}px`,
                    color: theme.text.muted, fontWeight: 500, fontSize: theme.size.xs,
                    textTransform: "uppercase", letterSpacing: "0.5px", whiteSpace: "nowrap",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const d = dte(r.expiry);
                const otmColor = r.otm_pct == null ? theme.text.muted : r.otm_pct >= 0 ? theme.green : theme.red;
                return (
                  <tr key={`${r.ticker}-${r.strike}-${r.expiry}-${i}`} style={{ borderBottom: `1px solid ${theme.border.default}` }}>
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[3]}px`, fontWeight: 700, color: theme.text.primary }}>
                      {r.ticker}
                      {r.held && (
                        <span style={{
                          marginLeft: theme.space[1], fontSize: theme.size.xs, color: theme.amber,
                          background: `${theme.amber}22`, border: `1px solid ${theme.amber}66`,
                          borderRadius: theme.radius.pill, padding: "0 6px",
                        }}>held</span>
                      )}
                    </td>
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[3]}px`, textAlign: "right", color: theme.text.primary }}>
                      ${r.strike}
                    </td>
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[3]}px`, textAlign: "right", color: theme.text.muted }}>
                      {d != null ? `${d}d` : "—"}
                    </td>
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[3]}px`, textAlign: "right", color: otmColor, fontWeight: 600 }}>
                      {r.otm_pct != null ? `${r.otm_pct >= 0 ? "+" : ""}${r.otm_pct.toFixed(1)}%` : "—"}
                    </td>
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[3]}px`, textAlign: "right", color: theme.green, fontWeight: 600, fontFamily: theme.font.mono }}>
                      {fmtPremium(r.premium)}
                    </td>
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[3]}px`, color: theme.text.subtle }}>
                      {r.has_sweep ? "sweep" : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ padding: `${theme.space[2]}px ${theme.space[4]}px`, fontSize: theme.size.xs, color: theme.text.subtle }}>
            Institutions selling puts (bid-side, ≥$50k) on your watchlist — entry ideas + strike confirmation. Positive OTM% = strike below spot.
          </div>
        </div>
      )}
    </div>
  );
}

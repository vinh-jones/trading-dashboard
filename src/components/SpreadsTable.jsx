// src/components/SpreadsTable.jsx
import React from "react";
import { theme } from "../lib/theme";
import { calcDTE } from "../lib/trading";
import { formatExpiry, formatDollars } from "../lib/format";
import { cushionToBreakeven } from "../lib/spreads";

const labelSt = {
  padding: `${theme.space[2]}px ${theme.space[3]}px`, textAlign: "left",
  color: theme.text.muted, fontWeight: 500, fontSize: theme.size.sm,
  textTransform: "uppercase", letterSpacing: "0.5px", whiteSpace: "nowrap",
};
const cellSt = { padding: `${theme.space[2]}px ${theme.space[3]}px`, fontSize: theme.size.md, color: theme.text.primary };

function cushionColor(state) {
  return state === "breached" ? theme.red : state === "warn" ? theme.amber : theme.green;
}

export function SpreadsTable({ rows, quoteMap, isMobile }) {
  if (!rows.length) {
    return <div style={{ fontSize: theme.size.sm, color: theme.text.subtle, padding: "12px 0" }}>No open spreads.</div>;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: theme.size.md }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${theme.border.strong}` }}>
            <th style={labelSt}>Ticker</th>
            <th style={labelSt}>Legs</th>
            {!isMobile && <th style={labelSt}>Expiry</th>}
            <th style={{ ...labelSt, textAlign: "right" }}>DTE</th>
            <th style={{ ...labelSt, textAlign: "right" }}>Credit</th>
            <th style={{ ...labelSt, textAlign: "right" }}>Max Gain</th>
            <th style={{ ...labelSt, textAlign: "right" }}>Max Loss</th>
            <th style={{ ...labelSt, textAlign: "right" }}>Breakeven</th>
            <th style={{ ...labelSt, textAlign: "right" }}>Cushion</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => {
            const dte = calcDTE(s.expiry_date);
            const spot = quoteMap.get(s.ticker)?.mid ?? quoteMap.get(s.ticker)?.last ?? null;
            const cush = cushionToBreakeven({ spot, breakeven: s.breakeven, subtype: s.subtype });
            const rightTag = s.right === "put" ? "p" : "c";
            return (
              <tr key={i} style={{ borderBottom: `1px solid ${theme.border.default}` }}>
                <td style={{ ...cellSt, fontWeight: 700 }}>{s.ticker}</td>
                <td style={cellSt}>
                  {s.short_strike}/{s.long_strike}{rightTag}
                  <span style={{ marginLeft: 6, color: theme.text.subtle, fontSize: theme.size.xs }}>
                    {s.contracts}x · {s.subtype}{s.settlement === "cash" ? " · cash-settled" : ""}
                  </span>
                </td>
                {!isMobile && <td style={cellSt}>{formatExpiry(s.expiry_date)}</td>}
                <td style={{ ...cellSt, textAlign: "right" }}>{dte != null ? `${dte}d` : "—"}</td>
                <td style={{ ...cellSt, textAlign: "right" }}>${s.credit?.toFixed(2)}</td>
                <td style={{ ...cellSt, textAlign: "right", color: theme.green }}>{formatDollars(s.max_gain)}</td>
                <td style={{ ...cellSt, textAlign: "right", color: theme.red }}>{formatDollars(s.max_loss)}</td>
                <td style={{ ...cellSt, textAlign: "right" }}>{s.breakeven}</td>
                <td style={{ ...cellSt, textAlign: "right", color: cush ? cushionColor(cush.state) : theme.text.muted }}>
                  {cush ? `${cush.distance_pct >= 0 ? "+" : ""}${(cush.distance_pct * 100).toFixed(1)}%` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

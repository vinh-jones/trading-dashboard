// src/components/SpreadsTable.jsx
import React from "react";
import { theme } from "../lib/theme";
import { calcDTE, buildOccSymbol } from "../lib/trading";
import { formatExpiry, formatDollars } from "../lib/format";
import { cushionToBreakeven, spreadUnrealized } from "../lib/spreads";
import { computeAssignmentRisk } from "../lib/assignmentRisk";

const labelSt = {
  padding: `${theme.space[2]}px ${theme.space[3]}px`, textAlign: "left",
  color: theme.text.muted, fontWeight: 500, fontSize: theme.size.sm,
  textTransform: "uppercase", letterSpacing: "0.5px", whiteSpace: "nowrap",
};
const cellSt = { padding: `${theme.space[2]}px ${theme.space[3]}px`, fontSize: theme.size.md, color: theme.text.primary };

function cushionColor(state) {
  return state === "breached" ? theme.red : state === "warn" ? theme.amber : theme.green;
}

export function SpreadsTable({ rows, quoteMap, uwSignals, isMobile }) {
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
            <th style={{ ...labelSt, textAlign: "right" }}>G/L</th>
            <th style={{ ...labelSt, textAlign: "right" }}>Captured</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => {
            const dte = calcDTE(s.expiry_date);
            const spot = quoteMap.get(s.ticker)?.mid ?? quoteMap.get(s.ticker)?.last ?? null;
            const cush = cushionToBreakeven({ spot, breakeven: s.breakeven, subtype: s.subtype });
            const rightTag = s.right === "put" ? "p" : "c";
            const isCall = s.right === "call";
            const shortSym = s.expiry_date && s.short_strike != null ? buildOccSymbol(s.ticker, s.expiry_date, isCall, s.short_strike) : null;
            const longSym  = s.expiry_date && s.long_strike  != null ? buildOccSymbol(s.ticker, s.expiry_date, isCall, s.long_strike)  : null;
            const shortMid = shortSym ? (quoteMap.get(shortSym)?.mid ?? null) : null;
            const longMid  = longSym  ? (quoteMap.get(longSym)?.mid  ?? null) : null;
            const ur = spreadUnrealized({ credit: s.credit, shortMid, longMid, contracts: s.contracts, is_credit: s.is_credit, max_gain: s.max_gain });
            const uwSig = uwSignals?.get?.(s.ticker);
            const flowSmoothed = uwSig?.flow_ema ?? uwSig?.flow_sentiment ?? null;
            const assignmentRisk = s.assignable
              ? computeAssignmentRisk({
                  earningsDate: quoteMap.get(s.ticker)?.earnings_date ?? null,
                  expiry: s.expiry_date,
                  today: new Date().toISOString().slice(0, 10),
                  flowSentiment: flowSmoothed,
                  gammaEnv: uwSig?.gamma_env ?? null,
                  cushionState: cush?.state === "breached" ? "assignment_risk" : "safe",
                  shortInterestPct: uwSig?.short_interest_pct ?? null,
                  expectedMovePct: uwSig?.earnings_expected_move_pct ?? null,
                  spot, strike: s.short_strike,
                })
              : null;
            return (
              <tr key={i} style={{ borderBottom: `1px solid ${theme.border.default}` }}>
                <td style={{ ...cellSt, fontWeight: 700 }}>{s.ticker}</td>
                <td style={cellSt}>
                  {s.short_strike}/{s.long_strike}{rightTag}
                  <span style={{ marginLeft: 6, color: theme.text.subtle, fontSize: theme.size.xs }}>
                    {s.contracts}x · {s.subtype}{s.settlement === "cash" ? " · cash-settled" : ""}
                  </span>
                  {s.assignable
                    ? (assignmentRisk && assignmentRisk.level !== "none" && (
                        <span
                          title={assignmentRisk.factors?.map(f => f.label).join(" · ") || undefined}
                          style={{ marginLeft: 6, color: assignmentRisk.level === "high" ? theme.red : theme.amber, fontSize: theme.size.xs, cursor: assignmentRisk.factors?.length ? "help" : undefined }}
                        >
                          ⚠ assignment risk · {assignmentRisk.level}
                        </span>
                      ))
                    : <span style={{ marginLeft: 6, color: theme.text.subtle, fontSize: theme.size.xs }}>no early assignment</span>}
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
                <td style={{ ...cellSt, textAlign: "right", color: ur.gl_dollars == null ? theme.text.muted : ur.gl_dollars >= 0 ? theme.green : theme.red }}>
                  {ur.gl_dollars == null ? "—" : formatDollars(ur.gl_dollars)}
                </td>
                <td style={{ ...cellSt, textAlign: "right" }}>
                  {ur.pct_captured == null ? "—" : `${Math.round(ur.pct_captured * 100)}%`}
                  {ur.close_50 && <span style={{ marginLeft: 4, color: theme.green, fontWeight: 600 }}>🎯</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

import { useState, useEffect } from "react";
import { useData } from "../hooks/useData";
import { useQuotes } from "../hooks/useQuotes";
import { useWindowWidth } from "../hooks/useWindowWidth";
import { useRollAnalysis } from "../hooks/useRollAnalysis";
import { formatDollars, formatDollarsFull, formatExpiry } from "../lib/format";
import { calcDTE, allocColor } from "../lib/trading";
import { TYPE_COLORS, SUBTYPE_LABELS } from "../lib/constants";
import { SixtyCheck } from "./SixtyCheck";
import { theme } from "../lib/theme";

function buildOccSymbol(ticker, expiryIso, isCall, strike) {
  const [y, m, d] = expiryIso.split("-");
  const expiry = y.slice(2) + m + d;
  const side   = isCall ? "C" : "P";
  const strikePadded = String(Math.round(parseFloat(strike) * 1000)).padStart(8, "0");
  return `${ticker}${expiry}${side}${strikePadded}`;
}

function getCostBasisPerShare(lots) {
  const totalFronted = lots.reduce((sum, lot) => sum + (lot.fronted || 0), 0);
  const totalShares  = lots.reduce((sum, lot) => {
    // Handles both "(100, $530)" and "($121, 300)" formats:
    // strip dollar amounts, then take the first remaining integer.
    const withoutPrices = (lot.description || "").replace(/\$[\d,]+\.?\d*/g, "");
    const m = withoutPrices.match(/\b(\d[\d,]*)\b/);
    return sum + (m ? parseInt(m[1].replace(/,/g, ""), 10) : 0);
  }, 0);
  if (!totalShares) return null;
  return totalFronted / totalShares;
}

// ── Roll Analysis card section ────────────────────────────────────────────────

function RollAnalysisSection({ ticker, rollData, rollLoading, lastCheckedAt, costBasisPerShare, ccStrike, stockPrice, threshold }) {
  // Only show for below-cost CCs
  if (ccStrike == null || costBasisPerShare == null || ccStrike >= costBasisPerShare) return null;

  const labelStyle = {
    fontSize:      theme.size.xs,
    color:         theme.text.muted,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    fontWeight:    500,
    marginBottom:  theme.space[1],
  };

  const wrapStyle = {
    borderTop:  `1px solid ${theme.border.default}`,
    paddingTop: theme.space[2],
    marginTop:  theme.space[2],
  };

  // State 1: never checked
  if (!lastCheckedAt && !rollLoading) {
    return (
      <div style={wrapStyle}>
        <div style={labelStyle}>Roll Analysis</div>
        <div style={{ fontSize: theme.size.sm, color: theme.text.subtle }}>
          Click "Check Rolls" above to analyze roll opportunities.
        </div>
      </div>
    );
  }

  // State 2: in-flight
  if (rollLoading) {
    return (
      <div style={wrapStyle}>
        <div style={labelStyle}>Roll Analysis</div>
        <div style={{ fontSize: theme.size.sm, color: theme.text.subtle }}>Fetching roll data…</div>
      </div>
    );
  }

  // State 3: checked but this ticker was outside the proximity threshold
  if (lastCheckedAt && !rollData) {
    const pctBelow = stockPrice != null
      ? Math.round(((costBasisPerShare - stockPrice) / costBasisPerShare) * 100)
      : null;
    return (
      <div style={wrapStyle}>
        <div style={labelStyle}>Roll Analysis</div>
        <div style={{ fontSize: theme.size.sm, color: theme.text.subtle }}>
          {pctBelow != null
            ? `${ticker} is ${pctBelow}% below cost basis (threshold: ${threshold}%).`
            : `${ticker} was outside the proximity threshold (${threshold}%).`}
          {" "}Lower the threshold above to include this position.
        </div>
      </div>
    );
  }

  // State 4-6: have data — render roll windows
  const { current_cc_mid, assignment_strike,
          roll_14dte_expiry, roll_14dte_dte, roll_14dte_strike, roll_14dte_mid, roll_14dte_net, roll_14dte_viable,
          roll_21dte_expiry, roll_21dte_dte, roll_21dte_strike, roll_21dte_mid, roll_21dte_net, roll_21dte_viable,
          roll_28dte_expiry, roll_28dte_dte, roll_28dte_strike, roll_28dte_mid, roll_28dte_net, roll_28dte_viable,
          any_viable, data_sufficient, notes } = rollData;

  const sectionBorderColor = any_viable ? theme.green : theme.border.default;

  function RollRow({ expiry, dte, strike, mid, net, viable, label }) {
    if (!expiry) {
      return (
        <div style={{ display: "flex", gap: theme.space[2], alignItems: "center", marginBottom: 3 }}>
          <span style={{ fontSize: theme.size.sm, color: theme.text.subtle, width: 80 }}>{label}</span>
          <span style={{ fontSize: theme.size.sm, color: theme.text.subtle }}>—</span>
          {notes && <span style={{ fontSize: theme.size.xs, color: theme.text.faint }}>({notes})</span>}
        </div>
      );
    }

    if (mid == null) {
      return (
        <div style={{ display: "flex", gap: theme.space[2], alignItems: "center", marginBottom: 3 }}>
          <span style={{ fontSize: theme.size.sm, color: theme.text.subtle, width: 80 }}>{label} ({formatExpiry(expiry)})</span>
          <span style={{ fontSize: theme.size.sm, color: theme.text.subtle }}>—</span>
          {notes?.includes("weekly") && (
            <span style={{ fontSize: theme.size.xs, color: theme.text.faint }}>weekly options unavailable</span>
          )}
        </div>
      );
    }

    const netColor   = viable ? theme.green : theme.red;
    const netPrefix  = net >= 0 ? "+" : "";
    const viableMark = viable ? "✓" : "✗";

    return (
      <div style={{ display: "flex", gap: theme.space[2], alignItems: "center", marginBottom: 3 }}>
        <span style={{ fontSize: theme.size.sm, color: theme.text.secondary, flexShrink: 0 }}>
          {dte}d ({formatExpiry(expiry)}){strike != null ? ` $${strike}` : ""}
        </span>
        <span style={{ fontSize: theme.size.sm, color: theme.text.primary }}>
          ${mid.toFixed(2)} avail
        </span>
        <span style={{ fontSize: theme.size.sm, color: netColor, fontWeight: viable ? 600 : 400 }}>
          → {netPrefix}${Math.abs(net).toFixed(2)} {net >= 0 ? "credit" : "debit"}
        </span>
        <span style={{ fontSize: theme.size.sm, color: netColor }}>{viableMark}</span>
      </div>
    );
  }

  return (
    <div style={{ ...wrapStyle, borderTop: `1px solid ${sectionBorderColor}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: theme.space[2], marginBottom: theme.space[1] }}>
        <span style={labelStyle}>Roll Analysis</span>
        {any_viable && (
          <span style={{
            fontSize:     theme.size.xs,
            color:        theme.green,
            fontWeight:   600,
            background:   "rgba(63,185,80,0.10)",
            border:       `1px solid ${theme.green}`,
            borderRadius: theme.radius.sm,
            padding:      "1px 6px",
          }}>
            ● Roll opportunity
          </span>
        )}
      </div>

      <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginBottom: theme.space[1] }}>
        Assign price: <span style={{ color: theme.text.secondary }}>${assignment_strike}</span>
        {" · "}CC: <span style={{ color: theme.text.secondary }}>${rollData.current_cc_strike}</span>
        {current_cc_mid != null && (
          <> · mid <span style={{ color: theme.text.secondary }}>${current_cc_mid.toFixed(2)}</span></>
        )}
      </div>

      <RollRow
        label="14 DTE"
        expiry={roll_14dte_expiry} dte={roll_14dte_dte} strike={roll_14dte_strike}
        mid={roll_14dte_mid} net={roll_14dte_net} viable={roll_14dte_viable}
      />
      <RollRow
        label="21 DTE"
        expiry={roll_21dte_expiry} dte={roll_21dte_dte} strike={roll_21dte_strike}
        mid={roll_21dte_mid} net={roll_21dte_net} viable={roll_21dte_viable}
      />
      <RollRow
        label="28 DTE"
        expiry={roll_28dte_expiry} dte={roll_28dte_dte} strike={roll_28dte_strike}
        mid={roll_28dte_mid} net={roll_28dte_net} viable={roll_28dte_viable}
      />

      {any_viable && (
        <div style={{ marginTop: theme.space[1], fontSize: theme.size.sm, color: theme.green, fontWeight: 600 }}>
          {[
            roll_14dte_viable && `$${roll_14dte_strike ?? assignment_strike}C +$${roll_14dte_net?.toFixed(2)} credit (14 DTE)`,
            roll_21dte_viable && `$${roll_21dte_strike ?? assignment_strike}C +$${roll_21dte_net?.toFixed(2)} credit (21 DTE)`,
            roll_28dte_viable && `$${roll_28dte_strike ?? assignment_strike}C +$${roll_28dte_net?.toFixed(2)} credit (28 DTE)`,
          ].filter(Boolean).join(" · ")}
        </div>
      )}

      {!any_viable && data_sufficient && (
        <div style={{ marginTop: theme.space[1], fontSize: theme.size.sm, color: theme.text.subtle }}>
          No net-neutral or better roll currently available.
        </div>
      )}

      {!data_sufficient && (
        <div style={{ marginTop: theme.space[1], fontSize: theme.size.xs, color: theme.text.faint }}>
          Incomplete data — some windows unavailable.
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function OpenPositionsTab() {
  const { positions, account } = useData();
  const { quoteMap } = useQuotes();
  const isMobile = useWindowWidth() < 600;
  const { assigned_shares, open_csps, open_leaps } = positions;

  const { rollMap, rollLoading, lastCheckedAt, isStale, checkRolls, relativeTime } = useRollAnalysis();

  const [threshold, setThreshold]     = useState(25);
  const [thresholdInput, setThresholdInput] = useState("25");
  const [thresholdError, setThresholdError] = useState(null);

  // Re-render every minute so relative time label stays current
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  function handleThresholdChange(e) {
    const val = e.target.value;
    setThresholdInput(val);
    const n = parseInt(val, 10);
    if (isNaN(n) || n < 10 || n > 50 || n % 5 !== 0) {
      setThresholdError("10–50, multiples of 5");
    } else {
      setThresholdError(null);
      setThreshold(n);
    }
  }

  function handleCheckRolls() {
    if (thresholdError) return;
    checkRolls(threshold);
  }

  const checkedLabel   = relativeTime();
  const buttonLabel    = rollLoading
    ? "Checking…"
    : isStale && lastCheckedAt
    ? "Check Rolls (stale)"
    : "Check Rolls";

  // ── Allocation chart data ─────────────────────────────────────────────────
  const accountValue = account?.account_value || 1;
  const allocMap = {};
  open_csps.forEach(p => {
    if (!allocMap[p.ticker]) allocMap[p.ticker] = { csp: 0, shares: 0, leaps: 0 };
    allocMap[p.ticker].csp += (p.capital_fronted || 0);
  });
  assigned_shares.forEach(s => {
    const sharesTotal = s.positions.reduce((sum, lot) => sum + (lot.fronted || 0), 0);
    const leapsTotal  = (s.open_leaps ?? []).reduce((sum, l) => sum + (l.capital_fronted || 0), 0);
    if (!allocMap[s.ticker]) allocMap[s.ticker] = { csp: 0, shares: 0, leaps: 0 };
    allocMap[s.ticker].shares += sharesTotal;
    allocMap[s.ticker].leaps  += leapsTotal;
  });
  open_leaps.forEach(l => {
    if (!allocMap[l.ticker]) allocMap[l.ticker] = { csp: 0, shares: 0, leaps: 0 };
    allocMap[l.ticker].leaps += (l.capital_fronted || 0);
  });
  const allocRows = Object.entries(allocMap)
    .map(([ticker, { csp, shares, leaps }]) => ({
      ticker,
      cspPct:    csp    / accountValue,
      sharesPct: shares / accountValue,
      leapsPct:  leaps  / accountValue,
      totalPct:  (csp + shares + leaps) / accountValue,
    }))
    .sort((a, b) => b.totalPct - a.totalPct);
  const SCALE = Math.max(allocRows[0]?.totalPct ?? 0.20, 0.20);

  // Collect ALL open LEAPS
  const allOpenLeaps = [
    ...open_leaps,
    ...assigned_shares.flatMap(pos => pos.open_leaps ?? []),
  ];

  const sectionHeader = (title) => (
    <div style={{ fontSize: theme.size.md, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 500, marginBottom: 14 }}>
      {title}
    </div>
  );

  const panel = (children, style = {}) => (
    <div style={{ padding: "20px", background: theme.bg.surface, borderRadius: theme.radius.md, border: `1px solid ${theme.border.default}`, marginBottom: 16, ...style }}>
      {children}
    </div>
  );

  return (
    <div>
      {/* ── Allocation Chart ── */}
      {panel(
        <>
          {sectionHeader("Portfolio Allocation by Ticker")}
          <div>
            {allocRows.map((row) => {
              const sharesW = (row.sharesPct / SCALE) * 100;
              const leapsW  = (row.leapsPct  / SCALE) * 100;
              const cspW    = (row.cspPct    / SCALE) * 100;
              return (
                <div key={row.ticker} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5 }}>
                  <div style={{ width: 52, fontSize: theme.size.sm, fontWeight: 700, color: theme.text.primary, textAlign: "right", flexShrink: 0 }}>
                    {row.ticker}
                  </div>
                  <div style={{ flex: 1, height: 16, background: theme.border.default, borderRadius: 2, position: "relative" }}>
                    {row.sharesPct > 0 && <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${sharesW}%`, background: theme.chart.shares, borderRadius: "2px 0 0 2px" }} />}
                    {row.leapsPct  > 0 && <div style={{ position: "absolute", left: `${sharesW}%`, top: 0, height: "100%", width: `${leapsW}%`, background: theme.chart.leaps }} />}
                    {row.cspPct    > 0 && <div style={{ position: "absolute", left: `${sharesW + leapsW}%`, top: 0, height: "100%", width: `${cspW}%`, background: theme.blue, borderRadius: "0 2px 2px 0" }} />}
                    <div style={{ position: "absolute", left: `${(0.10 / SCALE) * 100}%`, top: -3, bottom: -3, width: 1, background: theme.text.muted, opacity: 0.8, zIndex: 2 }} />
                    <div style={{ position: "absolute", left: `${(0.15 / SCALE) * 100}%`, top: -3, bottom: -3, width: 1, background: theme.red, opacity: 0.8, zIndex: 2 }} />
                  </div>
                  <div style={{ width: 42, fontSize: theme.size.sm, fontWeight: 600, color: allocColor(row.totalPct), textAlign: "right", flexShrink: 0 }}>
                    {(row.totalPct * 100).toFixed(1)}%
                  </div>
                </div>
              );
            })}
            <div style={{ display: "flex", gap: 16, marginTop: 14, paddingLeft: 62, fontSize: theme.size.xs, color: theme.text.subtle }}>
              <span><span style={{ color: theme.chart.shares }}>■</span> Shares</span>
              <span><span style={{ color: theme.chart.leaps }}>■</span> LEAPS</span>
              <span><span style={{ color: theme.blue }}>■</span> CSP</span>
              <span style={{ marginLeft: 8 }}><span style={{ color: theme.text.muted }}>│</span> 10%</span>
              <span><span style={{ color: theme.red }}>│</span> 15%</span>
            </div>
          </div>
        </>
      )}

      {/* ── Open CSPs ── */}
      {panel(
        <>
          {sectionHeader(`Open Cash-Secured Puts (${open_csps.length})`)}
          {isMobile ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {open_csps.map((csp, i) => {
                const dte = calcDTE(csp.expiry_date);
                let dtePct = null;
                if (csp.open_date && csp.expiry_date && dte != null) {
                  const totalDays = Math.ceil(
                    (new Date(csp.expiry_date + "T00:00:00") - new Date(csp.open_date + "T00:00:00")) / 86400000
                  );
                  dtePct = totalDays > 0 ? (dte / totalDays) * 100 : 0;
                }
                const dtePctColor = dtePct == null ? theme.text.muted
                  : dtePct >= 60 ? theme.green
                  : dtePct >= 20 ? theme.amber
                  : theme.red;
                return (
                  <div key={i} style={{ background: theme.bg.surface, border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.sm, padding: "10px 12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 700, color: theme.text.primary, fontSize: theme.size.md }}>{csp.ticker}</span>
                        <span style={{ color: theme.text.primary, fontSize: theme.size.md }}>${csp.strike}</span>
                        <span style={{ color: theme.text.muted, fontSize: theme.size.sm }}>{formatExpiry(csp.expiry_date)}</span>
                      </div>
                      <span style={{ fontWeight: 600, color: theme.green, fontSize: theme.size.md }}>{formatDollarsFull(csp.premium_collected)}</span>
                    </div>
                    <div style={{ display: "flex", gap: 12, fontSize: theme.size.sm, flexWrap: "wrap" }}>
                      <span style={{ color: dte != null && dte <= 5 ? theme.red : theme.text.muted, fontWeight: dte != null && dte <= 5 ? 600 : 400 }}>
                        {dte != null ? `${dte}d` : "—"}
                      </span>
                      {dtePct != null && <span style={{ color: dtePctColor, fontWeight: 600 }}>{dtePct.toFixed(0)}% DTE left</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: theme.size.md }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${theme.border.strong}` }}>
                    {["Ticker", "Strike", "Expiry", "DTE", "% DTE Left", "Premium", "G/L $", "G/L %"].map((h) => (
                      <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: theme.text.muted, fontWeight: 500, fontSize: theme.size.sm, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {open_csps.map((csp, i) => {
                    const dte = calcDTE(csp.expiry_date);

                    let dtePct = null;
                    if (csp.open_date && csp.expiry_date && dte != null) {
                      const totalDays = Math.ceil(
                        (new Date(csp.expiry_date + "T00:00:00") - new Date(csp.open_date + "T00:00:00")) / 86400000
                      );
                      dtePct = totalDays > 0 ? (dte / totalDays) * 100 : 0;
                    }
                    const dtePctColor = dtePct == null ? theme.text.muted
                      : dtePct >= 60 ? theme.green
                      : dtePct >= 20 ? theme.amber
                      : theme.red;

                    let glDollars = null;
                    let glPct     = null;
                    if (csp.expiry_date && csp.strike && csp.contracts) {
                      const sym  = buildOccSymbol(csp.ticker, csp.expiry_date, false, csp.strike);
                      const mid  = quoteMap.get(sym)?.mid;
                      if (mid != null && csp.premium_collected) {
                        const currentCost = mid * csp.contracts * 100;
                        glDollars = csp.premium_collected - currentCost;
                        glPct     = (glDollars / csp.premium_collected) * 100;
                      }
                    }
                    const glColor = glDollars == null ? theme.text.muted : glDollars >= 0 ? theme.green : theme.red;

                    return (
                      <tr key={i} style={{ borderBottom: `1px solid ${theme.border.default}` }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#1a3a5c22")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        <td style={{ padding: "9px 10px", fontWeight: 700, color: theme.text.primary }}>{csp.ticker}</td>
                        <td style={{ padding: "9px 10px", color: theme.text.primary }}>${csp.strike}</td>
                        <td style={{ padding: "9px 10px", color: theme.text.muted }}>{formatExpiry(csp.expiry_date)}</td>
                        <td style={{ padding: "9px 10px", color: dte != null && dte <= 5 ? theme.red : theme.text.muted, fontWeight: dte != null && dte <= 5 ? 600 : 400 }}>
                          {dte != null ? `${dte}d` : "—"}
                        </td>
                        <td style={{ padding: "9px 10px", fontWeight: 600, color: dtePctColor }}>
                          {dtePct != null ? `${dtePct.toFixed(0)}%` : "—"}
                        </td>
                        <td style={{ padding: "9px 10px", color: theme.green, fontWeight: 600 }}>{formatDollarsFull(csp.premium_collected)}</td>
                        <td style={{ padding: "9px 10px", color: glColor, fontWeight: 600 }}>
                          {glDollars != null ? formatDollarsFull(glDollars) : "—"}
                        </td>
                        <td style={{ padding: "9px 10px", color: glColor, fontWeight: 500 }}>
                          {glPct != null ? `${glPct.toFixed(1)}%` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Assigned Shares ── */}
      {panel(
        <>
          {/* Section header + Check Rolls controls */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: theme.space[2], marginBottom: 14 }}>
            <div style={{ fontSize: theme.size.md, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 500 }}>
              Assigned Shares ({assigned_shares.length} tickers)
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: theme.space[2], flexWrap: "wrap" }}>
              {/* Proximity threshold input */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>Proximity threshold:</span>
                <input
                  type="number"
                  value={thresholdInput}
                  onChange={handleThresholdChange}
                  min={10} max={50} step={5}
                  style={{
                    width:         46,
                    background:    theme.bg.elevated,
                    border:        `1px solid ${thresholdError ? theme.red : theme.border.strong}`,
                    borderRadius:  theme.radius.sm,
                    color:         thresholdError ? theme.red : theme.text.primary,
                    fontSize:      theme.size.sm,
                    fontFamily:    "inherit",
                    padding:       "2px 6px",
                    textAlign:     "right",
                  }}
                />
                <span style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>%</span>
                {thresholdError && (
                  <span style={{ fontSize: theme.size.xs, color: theme.red }}>{thresholdError}</span>
                )}
              </div>

              {/* Check Rolls button */}
              <button
                onClick={handleCheckRolls}
                disabled={rollLoading || !!thresholdError}
                style={{
                  background:   theme.bg.elevated,
                  border:       `1px solid ${theme.border.strong}`,
                  borderRadius: theme.radius.sm,
                  color:        rollLoading ? theme.text.subtle : theme.text.secondary,
                  fontSize:     theme.size.sm,
                  fontFamily:   "inherit",
                  cursor:       rollLoading || thresholdError ? "not-allowed" : "pointer",
                  padding:      "4px 12px",
                  opacity:      rollLoading ? 0.6 : 1,
                }}
              >
                ↻ {buttonLabel}
              </button>

              {/* Last checked label */}
              {checkedLabel && (
                <span style={{ fontSize: theme.size.xs, color: isStale ? theme.amber : theme.text.faint }}>
                  Last checked: {checkedLabel}
                </span>
              )}
            </div>
          </div>

          {/* Cards grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12 }}>
            {assigned_shares.map((pos) => {
              const cc  = pos.active_cc;
              const dte = cc ? calcDTE(cc.expiry_date) : null;

              const costBasisPerShare = getCostBasisPerShare(pos.positions);
              const stockPrice        = quoteMap.get(pos.ticker)?.mid ?? null;
              const rollData          = rollMap[pos.ticker] ?? null;

              return (
                <div key={pos.ticker} style={{ background: theme.bg.base, borderRadius: theme.radius.sm, border: `1px solid ${theme.border.default}`, padding: "16px" }}>
                  {/* Header */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                    <span style={{ fontSize: theme.size.lg, fontWeight: 700, color: theme.text.primary }}>{pos.ticker}</span>
                    <span style={{ fontSize: theme.size.md, color: theme.text.muted }}>
                      Cost basis: <span style={{ color: theme.text.primary, fontWeight: 600 }}>{formatDollarsFull(pos.cost_basis_total)}</span>
                    </span>
                  </div>

                  {/* Lots */}
                  <div style={{ marginBottom: 10 }}>
                    {pos.positions.map((p, i) => (
                      <div key={i} style={{ fontSize: theme.size.sm, color: theme.text.subtle, marginBottom: 2 }}>
                        {p.description} — {formatDollarsFull(p.fronted)}
                      </div>
                    ))}
                  </div>

                  {/* Active CC */}
                  {cc ? (
                    <div style={{ padding: "10px 12px", background: "#1a4a3a", border: "1px solid #2a6a5a", borderRadius: theme.radius.sm }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <span style={{ fontSize: theme.size.sm, color: "#6dd9a0", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Active CC</span>
                        <span style={{ fontSize: theme.size.sm, color: dte != null && dte <= 3 ? theme.red : theme.text.muted }}>
                          {dte != null ? `${dte}d DTE` : "—"} · exp {formatExpiry(cc.expiry_date)}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 16 }}>
                        <div>
                          <span style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>Strike </span>
                          <span style={{ fontSize: theme.size.md, color: theme.text.primary, fontWeight: 600 }}>${cc.strike}</span>
                        </div>
                        <div>
                          <span style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>Contracts </span>
                          <span style={{ fontSize: theme.size.md, color: theme.text.primary, fontWeight: 600 }}>{cc.contracts}</span>
                        </div>
                        <div>
                          <span style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>Premium </span>
                          <span style={{ fontSize: theme.size.md, color: theme.green, fontWeight: 600 }}>{formatDollarsFull(cc.premium_collected)}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: "8px 12px", background: "#3a1a1a", border: "1px solid #7c2a2a", borderRadius: theme.radius.sm, fontSize: theme.size.md, color: theme.red, fontWeight: 500 }}>
                      NO ACTIVE CC
                    </div>
                  )}

                  {/* Roll Analysis section — only for below-cost CCs */}
                  {cc && (
                    <RollAnalysisSection
                      ticker={pos.ticker}
                      rollData={rollData}
                      rollLoading={rollLoading}
                      lastCheckedAt={lastCheckedAt}
                      costBasisPerShare={costBasisPerShare}
                      ccStrike={cc.strike}
                      stockPrice={stockPrice}
                      threshold={threshold}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Open LEAPS ── */}
      {panel(
        <>
          {sectionHeader(`Open LEAPS (${allOpenLeaps.length})`)}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {allOpenLeaps.map((l, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 14px", background: "#2a1a3a", border: "1px solid #4a2a5c", borderRadius: theme.radius.sm }}>
                <div>
                  <span style={{ fontSize: theme.size.lg, fontWeight: 700, color: theme.text.primary, marginRight: 12 }}>{l.ticker}</span>
                  <span style={{ fontSize: theme.size.md, color: theme.chart.leaps }}>{l.description}</span>
                </div>
                <div style={{ fontSize: theme.size.sm, color: theme.text.muted }}>
                  Capital: <span style={{ color: theme.text.primary, fontWeight: 600 }}>{formatDollarsFull(l.capital_fronted)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── 60/60 Quick-Check ── */}
      <SixtyCheck />
    </div>
  );
}

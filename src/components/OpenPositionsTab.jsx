import React, { useState, useEffect } from "react";
import { useData } from "../hooks/useData";
import { useQuotes } from "../hooks/useQuotes";
import { useWindowWidth } from "../hooks/useWindowWidth";
import { useRollAnalysis } from "../hooks/useRollAnalysis";
import { formatDollars, formatDollarsFull, formatExpiry } from "../lib/format";
import { calcDTE, allocColor, buildOccSymbol } from "../lib/trading";
import { getOpenLEAPs, getCostBasisPerShare } from "../lib/positionSchema";
import {
  shortOptionGlDollars,
  shortOptionGlPct,
  leapGlDollars,
  leapGlPct,
  dtePctRemaining,
} from "../lib/positionMetrics";
import { TYPE_COLORS, SUBTYPE_LABELS } from "../lib/constants";
import { computePriceTargets } from "../lib/blackScholes";
import { targetProfitPctForDtePct } from "../lib/positionAttention";
import { AssignedShareIncome } from "./AssignedShareIncome";
import { theme } from "../lib/theme";

// ── Roll Analysis card section ────────────────────────────────────────────────

function RollAnalysisSection({ ticker, rollData, rollLoading, lastCheckedAt, costBasisPerShare, ccStrike, stockPrice, threshold }) {
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

  if (rollLoading) {
    return (
      <div style={wrapStyle}>
        <div style={labelStyle}>Roll Analysis</div>
        <div style={{ fontSize: theme.size.sm, color: theme.text.subtle }}>Fetching roll data…</div>
      </div>
    );
  }

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

  const { current_cc_mid, assignment_strike,
          roll_14dte_expiry, roll_14dte_dte, roll_14dte_strike, roll_14dte_mid, roll_14dte_net, roll_14dte_viable,
          roll_21dte_expiry, roll_21dte_dte, roll_21dte_strike, roll_21dte_mid, roll_21dte_net, roll_21dte_viable,
          roll_28dte_expiry, roll_28dte_dte, roll_28dte_strike, roll_28dte_mid, roll_28dte_net, roll_28dte_viable,
          any_viable, data_sufficient, notes } = rollData;

  const sectionBorderColor = any_viable ? theme.green : theme.border.default;

  function RollRow({ expiry, dte, strike, mid, net, viable, label }) {
    if (!expiry) {
      return (
        <div style={{ display: "flex", gap: theme.space[2], alignItems: "center", marginBottom: theme.space[1] }}>
          <span style={{ fontSize: theme.size.sm, color: theme.text.subtle, width: 80 }}>{label}</span>
          <span style={{ fontSize: theme.size.sm, color: theme.text.subtle }}>—</span>
          {notes && <span style={{ fontSize: theme.size.xs, color: theme.text.faint }}>({notes})</span>}
        </div>
      );
    }

    if (mid == null) {
      return (
        <div style={{ display: "flex", gap: theme.space[2], alignItems: "center", marginBottom: theme.space[1] }}>
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
      <div style={{ display: "flex", gap: theme.space[2], alignItems: "center", marginBottom: theme.space[1] }}>
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
            padding:      `2px ${theme.space[1]}px`,
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

// ── Price Target expanded panel ───────────────────────────────────────────────

function PriceTargetPanel({ targets, position, stockPrice }) {
  const isCSP = position.type === "CSP";
  const direction = isCSP ? "stays above" : "stays below";
  const ticker = position.ticker;

  // Format delta from current price, e.g. "(−3.2%)" or "(+1.5%)"
  const pctFrom = (targetPrice) => {
    if (targetPrice == null || stockPrice == null) return "";
    const pct = ((targetPrice - stockPrice) / stockPrice) * 100;
    const sign = pct >= 0 ? "+" : "";
    return `(${sign}${pct.toFixed(1)}%)`;
  };

  const panelStyle = {
    background:   theme.bg.elevated,
    borderTop:    `1px solid ${theme.border.default}`,
    padding:      `${theme.space[3]}px ${theme.space[4]}px`,
  };

  const labelStyle = {
    fontSize:      theme.size.xs,
    color:         theme.text.muted,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    fontWeight:    500,
  };

  // Null state: IV unavailable
  if (targets.iv == null) {
    return (
      <div style={panelStyle}>
        <div style={labelStyle}>Price Targets</div>
        <div style={{ fontSize: theme.size.sm, color: theme.text.subtle, marginTop: theme.space[1] }}>
          IV data unavailable — price targets require implied volatility.
        </div>
      </div>
    );
  }

  // Null state: no Fridays before expiry
  if (targets.targets.length === 0) {
    return (
      <div style={panelStyle}>
        <div style={labelStyle}>Price Targets</div>
        <div style={{ fontSize: theme.size.sm, color: theme.text.subtle, marginTop: theme.space[1] }}>
          Position expires before next Friday — let theta finish.
        </div>
      </div>
    );
  }

  const { targetProfitPct, currentProfitPct, isLosing, isOnTrack, dtePct } = targets;

  // Status line
  let statusText, statusColor;
  if (isLosing) {
    statusText = `Current: ${currentProfitPct}% · Position is at a loss`;
    statusColor = theme.red;
  } else if (!isOnTrack) {
    statusText = `Current: ${currentProfitPct}% profit · Running below target pace`;
    statusColor = theme.amber;
  } else {
    const remaining = targetProfitPct - currentProfitPct;
    statusText = `Current: ${currentProfitPct}% profit · Need ${remaining}% more to hit target`;
    statusColor = theme.green;
  }

  const formatFriday = (date) => {
    const m = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `Fri ${m}`;
  };

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", gap: theme.space[2], flexWrap: "wrap", marginBottom: theme.space[1] }}>
        <span style={labelStyle}>Price Targets</span>
        <span style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>
          · {ticker} ${position.strike}{isCSP ? "p" : "c"} · {dtePct}% DTE left · Target: {targetProfitPct}%
          {stockPrice != null && <> · Stock: <span style={{ color: theme.text.secondary }}>${stockPrice.toFixed(2)}</span></>}
        </span>
      </div>

      {/* Status */}
      {currentProfitPct != null && (
        <div style={{ fontSize: theme.size.sm, color: statusColor, fontWeight: 500, marginBottom: theme.space[2] }}>
          {statusText}
        </div>
      )}

      {/* Friday rows */}
      {targets.targets.map((t, i) => {
        if (isLosing) {
          return (
            <div key={i} style={{ marginBottom: i < targets.targets.length - 1 ? theme.space[2] : 0 }}>
              <div style={{ fontSize: theme.size.sm, color: theme.text.secondary, fontWeight: 600, marginBottom: 2 }}>
                By {formatFriday(t.date)}  ({t.daysAway}d)
              </div>
              {t.breakEvenStockPrice != null ? (
                <div style={{ fontSize: theme.size.sm, color: theme.text.muted, marginLeft: theme.space[3] }}>
                  Break-even: {ticker} {direction} <span style={{ color: theme.text.secondary, fontWeight: 600 }}>${t.breakEvenStockPrice.toFixed(2)}</span>
                  {" "}<span style={{ color: theme.text.subtle }}>{pctFrom(t.breakEvenStockPrice)}</span>
                </div>
              ) : (
                <div style={{ fontSize: theme.size.sm, color: theme.text.subtle, marginLeft: theme.space[3] }}>
                  Break-even: Target price outside model range at this date.
                </div>
              )}
              {t.targetStockPrice != null ? (
                <div style={{ fontSize: theme.size.sm, color: theme.text.muted, marginLeft: theme.space[3] }}>
                  Target ({targetProfitPct}%): {ticker} {direction} <span style={{ color: theme.green, fontWeight: 600 }}>${t.targetStockPrice.toFixed(2)}</span>
                  {" "}<span style={{ color: theme.text.subtle }}>{pctFrom(t.targetStockPrice)}</span>
                </div>
              ) : (
                <div style={{ fontSize: theme.size.sm, color: theme.text.subtle, marginLeft: theme.space[3] }}>
                  Target ({targetProfitPct}%): Target price outside model range at this date.
                </div>
              )}
            </div>
          );
        }

        // On-track or lagging
        return (
          <div key={i} style={{ fontSize: theme.size.sm, color: theme.text.muted, marginBottom: 2 }}>
            <span style={{ color: theme.text.secondary }}>By {formatFriday(t.date)}</span>
            {"  "}({t.daysAway}d){"    "}
            {t.targetStockPrice != null ? (
              <>
                {ticker} {direction}{" "}
                <span style={{ color: theme.text.primary, fontWeight: 600 }}>${t.targetStockPrice.toFixed(2)}</span>
                {" "}<span style={{ color: theme.text.subtle }}>{pctFrom(t.targetStockPrice)}</span>
                {" "}to hit {targetProfitPct}%
              </>
            ) : (
              <span style={{ color: theme.text.subtle }}>Target price outside model range at this date.</span>
            )}
          </div>
        );
      })}

      {/* Footer */}
      <div style={{ fontSize: theme.size.xs, color: theme.text.faint, marginTop: theme.space[2] }}>
        Estimated via Black-Scholes · IV {Math.round(targets.iv * 100)}% · Rate 4.5%
      </div>
    </div>
  );
}

// ── Shared positions table ────────────────────────────────────────────────────

function PositionsTable({ rows, positionType, quoteMap, isMobile, highlightedTicker }) {
  const isLeap = positionType === "leaps";
  const isCC   = positionType === "ccs";
  const [expandedRowKey, setExpandedRowKey] = useState(null);
  const canExpand = !isLeap;

  const numericCols = new Set(["Strike", "% OTM", "DTE", "% DTE Left", "Premium", "Cost", "G/L $", "G/L %"]);
  const colHeader = (label) => (
    <th key={label} style={{
      padding:       `${theme.space[2]}px ${theme.space[3]}px`,
      textAlign:     numericCols.has(label) ? "right" : "left",
      color:         theme.text.muted,
      fontWeight:    500,
      fontSize:      theme.size.sm,
      textTransform: "uppercase",
      letterSpacing: "0.5px",
    }}>
      {label}
    </th>
  );

  if (!rows.length) {
    return (
      <div style={{ fontSize: theme.size.sm, color: theme.text.subtle, padding: "12px 0" }}>
        No open {positionType.toUpperCase()} positions.
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: theme.size.md }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${theme.border.strong}` }}>
            {[
              "Ticker", "Strike",
              ...(!isLeap ? ["% OTM"] : []),
              ...(!isMobile ? ["Expiry"] : []),
              ...(!isMobile ? ["DTE"] : []),
              ...(!isMobile ? ["% DTE Left"] : []),
              ...(!isMobile ? [isLeap ? "Cost" : "Premium"] : []),
              ...(!isMobile ? ["G/L $"] : []),
              "G/L %",
              ...(canExpand ? [""] : []),
            ].map(colHeader)}
          </tr>
        </thead>
        <tbody>
          {rows.map((pos, i) => {
            const dte = calcDTE(pos.expiry_date);
            const dtePct = dtePctRemaining({
              openDateIso:   pos.open_date,
              expiryDateIso: pos.expiry_date,
              dte,
            });
            const dtePctColor = dtePct == null ? theme.text.muted
              : dtePct >= 60 ? theme.green
              : dtePct >= 20 ? theme.amber
              : theme.red;

            // G/L — dispatch to positionMetrics based on long vs short side.
            let glDollars = null, glPct = null;
            if (pos.expiry_date && pos.strike != null && pos.contracts) {
              const sym = buildOccSymbol(pos.ticker, pos.expiry_date, isCC || isLeap, pos.strike);
              const mid = quoteMap.get(sym)?.mid ?? null;
              if (isLeap) {
                glDollars = leapGlDollars({ capitalFronted: pos.capital_fronted, optionMid: mid, contracts: pos.contracts });
                glPct     = leapGlPct({     capitalFronted: pos.capital_fronted, optionMid: mid, contracts: pos.contracts });
              } else {
                glDollars = shortOptionGlDollars({ premiumCollected: pos.premium_collected, optionMid: mid, contracts: pos.contracts });
                glPct     = shortOptionGlPct({     premiumCollected: pos.premium_collected, optionMid: mid, contracts: pos.contracts });
              }
            }
            const glColor = glDollars == null ? theme.text.muted : glDollars >= 0 ? theme.green : theme.red;

            // Row highlight — CSP/CC profit target or LEAPS management signals
            let rowHighlightColor = null;
            if (!isLeap && glPct != null && dtePct != null) {
              const targetPct = targetProfitPctForDtePct(dtePct);
              if (glPct >= targetPct) rowHighlightColor = theme.green;
            } else if (isLeap) {
              if (glPct != null && glPct >= 10) {
                rowHighlightColor = theme.green;   // profit target hit
              } else if (dte != null && dte < 90) {
                rowHighlightColor = theme.red;     // needs managing
              }
            }

            // % OTM — how far stock is from strike (positive = OTM / safe)
            let otmPct = null, otmColor = theme.text.muted;
            if (!isLeap && pos.strike != null) {
              const stockMid = quoteMap.get(pos.ticker)?.mid;
              if (stockMid != null) {
                // CSP (put): OTM when stock > strike. CC (call): OTM when stock < strike.
                otmPct = isCC
                  ? ((pos.strike - stockMid) / stockMid) * 100
                  : ((stockMid - pos.strike) / pos.strike) * 100;
                otmColor = otmPct > 0 ? theme.green : theme.red;
              }
            }

            const displayValue = isLeap ? pos.capital_fronted : pos.premium_collected;
            const valueColor   = isLeap ? theme.chart.leaps : theme.green;

            const td = (content, style = {}) => (
              <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, ...style }}>{content}</td>
            );

            const rowKey = `${pos.ticker}-${pos.expiry_date}-${pos.strike}`;
            const isExpanded = canExpand && expandedRowKey === rowKey;

            // Compute price targets lazily on expand
            let priceTargets = null;
            if (isExpanded) {
              const currentIV = quoteMap.get(pos.ticker)?.iv ?? null;
              const currentStockPrice = quoteMap.get(pos.ticker)?.mid ?? null;
              const sym = buildOccSymbol(pos.ticker, pos.expiry_date, isCC, pos.strike);
              const optionQuote = quoteMap.get(sym);
              const optionMid = optionQuote?.mid ?? null;
              const optionIV = optionQuote?.iv ?? null; // per-strike IV from greeks API
              priceTargets = computePriceTargets(pos, currentIV, currentStockPrice, optionMid, optionIV);
            }

            return (
              <React.Fragment key={i}>
                <tr
                  style={{
                    borderBottom: isExpanded ? "none" : `1px solid ${theme.border.default}`,
                    borderLeft: rowHighlightColor ? `3px solid ${rowHighlightColor}` : "3px solid transparent",
                    cursor: canExpand ? "pointer" : "default",
                    background: highlightedTicker === pos.ticker ? "rgba(58,130,246,0.10)" : "transparent",
                    transition: "background 0.4s",
                  }}
                  onClick={canExpand ? () => setExpandedRowKey(isExpanded ? null : rowKey) : undefined}
                  onMouseEnter={e => (e.currentTarget.style.background = highlightedTicker === pos.ticker ? "rgba(58,130,246,0.15)" : `${TYPE_COLORS.CSP.bg}22`)}
                  onMouseLeave={e => (e.currentTarget.style.background = highlightedTicker === pos.ticker ? "rgba(58,130,246,0.10)" : "transparent")}
                >
                  {td(pos.ticker,                { fontWeight: 700, color: theme.text.primary })}
                  {td(pos.strike != null ? `$${pos.strike}` : "—", { color: theme.text.primary, textAlign: "right" })}
                  {!isLeap && td(otmPct != null ? `${otmPct.toFixed(1)}%` : "—", { color: otmColor, fontWeight: 600, textAlign: "right" })}
                  {!isMobile && td(formatExpiry(pos.expiry_date),               { color: theme.text.muted })}
                  {!isMobile && td(dte != null ? `${dte}d` : "—", {
                    color:      dte != null && dte <= 5 ? theme.red : theme.text.muted,
                    fontWeight: dte != null && dte <= 5 ? 600 : 400,
                    textAlign:  "right",
                  })}
                  {!isMobile && td(dtePct != null ? `${dtePct.toFixed(0)}%` : "—", { color: dtePctColor, fontWeight: 600, textAlign: "right" })}
                  {!isMobile && td(formatDollarsFull(displayValue),               { color: valueColor, fontWeight: 600, textAlign: "right" })}
                  {!isMobile && td(glDollars != null ? formatDollarsFull(glDollars) : "—", { color: glColor, fontWeight: 600, textAlign: "right" })}
                  {td(glPct != null ? `${glPct.toFixed(1)}%` : "—", { color: glColor, fontWeight: 500, textAlign: "right" })}
                  {canExpand && td(
                    <span style={{ color: theme.text.subtle, fontSize: theme.size.xs }}>{isExpanded ? "▴" : "▾"}</span>,
                    { width: 30, textAlign: "center", padding: "9px 4px" }
                  )}
                </tr>
                {isExpanded && priceTargets && (
                  <tr>
                    <td colSpan={isMobile ? 5 : 10} style={{ padding: 0, borderBottom: `1px solid ${theme.border.default}` }}>
                      <PriceTargetPanel targets={priceTargets} position={pos} stockPrice={quoteMap.get(pos.ticker)?.mid ?? null} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const TYPE_TO_TAB = { CSP: "csps", CC: "ccs", LEAP: "leaps" };

export function OpenPositionsTab({ positionIntent, onPositionIntentConsumed }) {
  const { positions, account } = useData();
  const { quoteMap } = useQuotes();
  const isMobile = useWindowWidth() < 600;
  const { assigned_shares, open_csps, open_leaps } = positions;

  const { rollMap, rollLoading, lastCheckedAt, isStale, checkRolls, relativeTime } = useRollAnalysis();

  const [positionTab, setPositionTab] = useState("csps");
  const [highlightedTicker, setHighlightedTicker] = useState(null);

  useEffect(() => {
    if (!positionIntent) return;
    const tab = TYPE_TO_TAB[positionIntent.type];
    if (tab) setPositionTab(tab);
    setHighlightedTicker(positionIntent.ticker);
    onPositionIntentConsumed?.();
    const timer = setTimeout(() => setHighlightedTicker(null), 3000);
    return () => clearTimeout(timer);
  }, [positionIntent]); // eslint-disable-line react-hooks/exhaustive-deps
  const [threshold, setThreshold]     = useState(25);
  const [thresholdInput, setThresholdInput] = useState("25");
  const [thresholdError, setThresholdError] = useState(null);

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

  const checkedLabel = relativeTime();
  const buttonLabel  = rollLoading
    ? "Checking…"
    : isStale && lastCheckedAt
    ? "Check Rolls (stale)"
    : "Check Rolls";

  // ── Derived position lists ────────────────────────────────────────────────
  const open_ccs = assigned_shares.map(pos => pos.active_cc).filter(Boolean);
  const allOpenLeaps = getOpenLEAPs(positions);

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

  const panel = (children, style = {}) => (
    <div style={{ padding: theme.space[5], background: theme.bg.surface, borderRadius: theme.radius.md, border: `1px solid ${theme.border.default}`, marginBottom: theme.space[4], ...style }}>
      {children}
    </div>
  );

  const sectionHeader = (title) => (
    <div style={{ fontSize: theme.size.md, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 500, marginBottom: theme.space[3] }}>
      {title}
    </div>
  );

  // ── Tab button style ──────────────────────────────────────────────────────
  const tabBtnStyle = (key) => ({
    padding:      "3px 12px",
    fontSize:     theme.size.sm,
    fontFamily:   "inherit",
    cursor:       "pointer",
    borderRadius: theme.radius.sm,
    border:       `1px solid ${positionTab === key ? theme.blue : theme.border.strong}`,
    background:   positionTab === key ? "rgba(58,130,246,0.15)" : theme.bg.elevated,
    color:        positionTab === key ? theme.blue : theme.text.secondary,
    fontWeight:   positionTab === key ? 600 : 400,
  });

  const positionTabs = [
    { key: "csps",  label: `CSPs (${open_csps.length})`,      rows: open_csps     },
    { key: "ccs",   label: `CCs (${open_ccs.length})`,        rows: open_ccs      },
    { key: "leaps", label: `LEAPs (${allOpenLeaps.length})`,  rows: allOpenLeaps  },
  ];
  const activeTab = positionTabs.find(t => t.key === positionTab);

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
                <div key={row.ticker} style={{ display: "flex", alignItems: "center", gap: theme.space[2], marginBottom: theme.space[1] }}>
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
            <div style={{ display: "flex", gap: theme.space[4], marginTop: theme.space[3], paddingLeft: 62, fontSize: theme.size.xs, color: theme.text.subtle }}>
              <span><span style={{ color: theme.chart.shares }}>■</span> Shares</span>
              <span><span style={{ color: theme.chart.leaps }}>■</span> LEAPS</span>
              <span><span style={{ color: theme.blue }}>■</span> CSP</span>
              <span style={{ marginLeft: 8 }}><span style={{ color: theme.text.muted }}>│</span> 10%</span>
              <span><span style={{ color: theme.red }}>│</span> 15%</span>
            </div>
          </div>
        </>
      )}

      {/* ── Open Positions (tabbed: CSPs / CCs / LEAPs) ── */}
      {panel(
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: theme.space[3], flexWrap: "wrap", gap: theme.space[2] }}>
            {sectionHeader("Open Positions")}
            <div style={{ display: "flex", gap: theme.space[1], marginBottom: theme.space[3] }}>
              {positionTabs.map(t => (
                <button
                  key={t.key}
                  style={tabBtnStyle(t.key)}
                  onClick={() => setPositionTab(t.key)}
                  onMouseEnter={e => { if (positionTab !== t.key) e.currentTarget.style.background = "rgba(58,130,246,0.06)"; }}
                  onMouseLeave={e => { if (positionTab !== t.key) e.currentTarget.style.background = theme.bg.elevated; }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <PositionsTable
            rows={activeTab?.rows ?? []}
            positionType={positionTab}
            quoteMap={quoteMap}
            isMobile={isMobile}
            highlightedTicker={highlightedTicker}
          />
        </>
      )}

      {/* ── Assigned Shares ── */}
      {panel(
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: theme.space[2], marginBottom: theme.space[3] }}>
            <div style={{ fontSize: theme.size.md, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 500 }}>
              Assigned Shares ({assigned_shares.length} tickers)
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: theme.space[2], flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: theme.space[1] }}>
                <span style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>Proximity threshold:</span>
                <input
                  type="number"
                  value={thresholdInput}
                  onChange={handleThresholdChange}
                  min={10} max={50} step={5}
                  style={{
                    width:        46,
                    background:   theme.bg.elevated,
                    border:       `1px solid ${thresholdError ? theme.red : theme.border.strong}`,
                    borderRadius: theme.radius.sm,
                    color:        thresholdError ? theme.red : theme.text.primary,
                    fontSize:     theme.size.sm,
                    fontFamily:   "inherit",
                    padding:      "2px 6px",
                    textAlign:    "right",
                    outline:      "none",
                  }}
                  onFocus={e => { e.currentTarget.style.boxShadow = `0 0 0 2px ${theme.blue}55`; }}
                  onBlur={e => { e.currentTarget.style.boxShadow = "none"; }}
                />
                <span style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>%</span>
                {thresholdError && (
                  <span style={{ fontSize: theme.size.xs, color: theme.red }}>{thresholdError}</span>
                )}
              </div>

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
                onMouseEnter={e => { if (!rollLoading && !thresholdError) e.currentTarget.style.background = "rgba(58,130,246,0.06)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = theme.bg.elevated; }}
              >
                ↻ {buttonLabel}
              </button>

              {checkedLabel && (
                <span style={{ fontSize: theme.size.xs, color: isStale ? theme.amber : theme.text.faint }}>
                  Last checked: {checkedLabel}
                </span>
              )}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: theme.space[3] }}>
            {assigned_shares.map((pos) => {
              const cc  = pos.active_cc;
              const dte = cc ? calcDTE(cc.expiry_date) : null;

              const costBasisPerShare = getCostBasisPerShare(pos);
              const stockPrice        = quoteMap.get(pos.ticker)?.mid ?? null;
              const rollData          = rollMap[pos.ticker] ?? null;

              return (
                <div key={pos.ticker} style={{ background: theme.bg.base, borderRadius: theme.radius.sm, border: `1px solid ${theme.border.default}`, padding: theme.space[4] }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: theme.space[2] }}>
                    <span style={{ fontSize: theme.size.lg, fontWeight: 700, color: theme.text.primary }}>{pos.ticker}</span>
                    <span style={{ fontSize: theme.size.md, color: theme.text.muted }}>
                      Cost basis: <span style={{ color: theme.text.primary, fontWeight: 600 }}>{formatDollarsFull(pos.cost_basis_total)}</span>
                    </span>
                  </div>

                  <div style={{ marginBottom: theme.space[2] }}>
                    {pos.positions.map((p, i) => (
                      <div key={i} style={{ fontSize: theme.size.sm, color: theme.text.subtle, marginBottom: 2 }}>
                        {p.description} — {formatDollarsFull(p.fronted)}
                      </div>
                    ))}
                  </div>

                  {cc ? (
                    <div style={{ padding: `${theme.space[2]}px ${theme.space[3]}px`, background: TYPE_COLORS.CC.bg, border: `1px solid ${TYPE_COLORS.CC.border}`, borderRadius: theme.radius.sm }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <span style={{ fontSize: theme.size.sm, color: TYPE_COLORS.CC.text, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Active CC</span>
                        <span style={{ fontSize: theme.size.sm, color: dte != null && dte <= 3 ? theme.red : theme.text.muted }}>
                          {dte != null ? `${dte}d DTE` : "—"} · exp {formatExpiry(cc.expiry_date)}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: theme.space[4] }}>
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
                    <div style={{ padding: `${theme.space[2]}px ${theme.space[3]}px`, background: theme.alert.dangerBg, border: `1px solid ${theme.alert.dangerBorder}`, borderRadius: theme.radius.sm, fontSize: theme.size.md, color: theme.red, fontWeight: 500 }}>
                      NO ACTIVE CC
                    </div>
                  )}

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

      {/* ── Assigned Shares — Income & Health ── */}
      <AssignedShareIncome />
    </div>
  );
}

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
import { computeCushion } from "../lib/cushionBreach";
import { computeHoldYield } from "../lib/holdYield";
import { computeRedeploySignal } from "../lib/redeploySignal";
import { computeCspAggregates } from "../lib/cspAggregates";
import { CspSelectionBar } from "./CspSelectionBar";
import { CohortsPanel } from "./CohortsPanel";
import { PositionHistoryPanel } from "./PositionHistoryPanel";
import { slugifyCohortName } from "../lib/cohorts";
import { targetProfitPctForDtePct } from "../lib/positionAttention";
import { AssignedShareIncome } from "./AssignedShareIncome";
import { theme } from "../lib/theme";
import { listJournalEntries } from "../lib/journalApi";
import { groupStrategicTagsByPosition, positionKey, STRATEGIC_TAG_PREFIXES } from "../lib/tags";
import { PositionTagChip } from "./PositionTagChip";

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

// ── Cushion Breach panel ──────────────────────────────────────────────────────

function CushionPanel({ cushion, dte }) {
  if (!cushion || cushion.cushion_state === "safe" || cushion.cushion_state == null) return null;

  const isRed    = cushion.cushion_state === "assignment_risk";
  const color    = isRed ? theme.red : theme.amber;
  const label    = isRed ? "● Assignment Risk" : "⚠ Approaching Strike";
  const subtitle = isRed
    ? "underlying within 1 expected daily move of strike"
    : "underlying within 2 expected daily moves of strike";

  const dailyMovePct = cushion.cushion_iv_used != null
    ? (cushion.cushion_iv_used / Math.sqrt(252) * 100).toFixed(1)
    : null;

  const labelStyle = {
    fontSize:      theme.size.xs,
    color:         theme.text.muted,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    fontWeight:    500,
    marginBottom:  theme.space[1],
  };

  const gridStyle = {
    display:             "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap:                 `${theme.space[2]}px ${theme.space[4]}px`,
    fontSize:            theme.size.sm,
  };

  const row = (rowLabel, value, valueColor) => (
    <div>
      <div style={labelStyle}>{rowLabel}</div>
      <div style={{ color: valueColor ?? theme.text.primary }}>{value ?? "—"}</div>
    </div>
  );

  return (
    <div style={{
      background:   isRed ? `${theme.red}11` : `${theme.amber}11`,
      borderTop:    `1px solid ${color}44`,
      borderBottom: `1px solid ${theme.border.default}`,
      padding:      `${theme.space[3]}px ${theme.space[4]}px`,
    }}>
      <div style={{ marginBottom: theme.space[2] }}>
        <span style={{ fontSize: theme.size.sm, fontWeight: 600, color, textTransform: "uppercase", letterSpacing: "0.4px" }}>
          {label}{dte != null ? ` · ${dte}d DTE` : ""}
        </span>
        <span style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginLeft: theme.space[2] }}>
          {subtitle}
        </span>
      </div>

      <div style={gridStyle}>
        {row("Amber trigger (N=2)",
          cushion.cushion_trigger_amber != null ? `$${cushion.cushion_trigger_amber.toFixed(2)}${cushion.cushion_state !== "safe" ? " ← crossed" : ""}` : null,
          theme.amber)}
        {row("Red trigger (N=1)",
          cushion.cushion_trigger_red != null
            ? `$${cushion.cushion_trigger_red.toFixed(2)}${cushion.cushion_state === "assignment_risk" ? " ← crossed" : " · not yet"}`
            : null,
          cushion.cushion_state === "assignment_risk" ? theme.red : theme.text.muted)}
        {row("Cushion %",
          cushion.cushion_pct != null ? `${(cushion.cushion_pct * 100).toFixed(1)}%` : null,
          color)}
        {row("IV used",
          cushion.cushion_iv_used != null ? `${(cushion.cushion_iv_used * 100).toFixed(1)}%` : null)}
        {dailyMovePct && row("Daily move est.", `${dailyMovePct}%`)}
        {row("Formula", "strike × (1 + IV/√252 × N)", theme.text.subtle)}
      </div>
    </div>
  );
}

// ── Hold-yield signal (green CSPs) ─────────────────────────────────────────────
// "Am I still paid my normal rate to carry this assignment risk?" Risk-shedding
// framing only — never redeploy. See SPEC_HOLD_YIELD_SIGNAL_V2.md.

function holdYieldCopy(hy) {
  const pct = hy.ratio != null ? Math.round(hy.ratio * 100) : null;
  switch (hy.hold_yield_state) {
    case "underpaid_to_hold":
      return hy.priority === "HIGH"
        ? `Paid ~${pct}% of your normal entry rate to hold this, and it's near the strike — shedding the risk is reasonable.`
        : "Below-normal pay to hold, but it's safe — optional cleanup, no urgency.";
    case "below_average": return "Below your normal rate to keep holding — soft watch.";
    case "fairly_paid":   return "Still paying your normal rate — hold.";
    case "fully_captured":return "Fully captured — nothing left to earn, close it.";
    case "late_cycle_let_ride": return "Late in the cycle — let it resolve.";
    case "no_benchmark":  return "Not enough closed-CSP history yet to benchmark against.";
    default: return "";
  }
}

// Collapsed-row indicator. HIGH = visible chip; LOW / fully_captured = muted dot;
// everything else is silent (the detail still shows on expand).
function HoldYieldIndicator({ hy }) {
  if (!hy || hy.skipped) return null;
  if (hy.hold_yield_state === "underpaid_to_hold" && hy.priority === "HIGH") {
    return (
      <span style={{
        marginLeft: theme.space[1], padding: "1px 6px", borderRadius: theme.radius.pill,
        background: `${theme.amber}22`, color: theme.amber, border: `1px solid ${theme.amber}66`,
        fontSize: theme.size.xs, fontWeight: 600, lineHeight: 1.4, flexShrink: 0, whiteSpace: "nowrap",
      }}>underpaid</span>
    );
  }
  if ((hy.hold_yield_state === "underpaid_to_hold" && hy.priority === "LOW") || hy.hold_yield_state === "fully_captured") {
    return (
      <span style={{
        marginLeft: theme.space[1], width: 6, height: 6, borderRadius: "50%",
        background: theme.text.subtle, display: "inline-block", flexShrink: 0,
      }} />
    );
  }
  return null;
}

function HoldYieldPanel({ hy }) {
  if (!hy || hy.skipped || hy.hold_yield_state === "no_benchmark") return null;

  const isHigh = hy.priority === "HIGH";
  const color  = isHigh ? theme.amber : theme.text.muted;
  const pct = (v) => v != null ? `${(v * 100).toFixed(1)}%` : "—";

  const labelStyle = {
    fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase",
    letterSpacing: "0.5px", fontWeight: 500, marginBottom: theme.space[1],
  };
  const cell = (label, value, valueColor) => (
    <div>
      <div style={labelStyle}>{label}</div>
      <div style={{ color: valueColor ?? theme.text.primary }}>{value}</div>
    </div>
  );

  return (
    <div style={{
      background: isHigh ? `${theme.amber}11` : theme.bg.surface,
      borderTop: `1px solid ${isHigh ? `${theme.amber}44` : theme.border.default}`,
      borderBottom: `1px solid ${theme.border.default}`,
      padding: `${theme.space[3]}px ${theme.space[4]}px`,
    }}>
      <div style={{ marginBottom: theme.space[2], fontSize: theme.size.sm, color: theme.text.primary }}>
        <span style={{ fontWeight: 600, color, textTransform: "uppercase", letterSpacing: "0.4px", marginRight: theme.space[2] }}>
          Hold yield
        </span>
        {holdYieldCopy(hy)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: `${theme.space[2]}px ${theme.space[4]}px`, fontSize: theme.size.sm }}>
        {cell("Forward yield", pct(hy.forward_yield_ann), color)}
        {cell("Your typical entry", pct(hy.avg_csp_entry_yield_ann))}
        {cell("Ratio", hy.ratio != null ? `${hy.ratio.toFixed(2)}×` : "—", color)}
      </div>
    </div>
  );
}

// ── Redeploy signal (green CSPs) ───────────────────────────────────────────────
// "Is the leftover premium still decaying fast enough to keep this capital here,
// or would a fresh CSP pay more?" The redeploy complement to hold-yield's risk
// lens. ratio = (1 − %premium kept) / (1 − %time elapsed); below the close line
// the remaining premium pays so slowly that redeploying wins net of churn.

function redeployCopy(rd) {
  const ratioStr = rd.ratio != null ? `${rd.ratio.toFixed(2)}×` : "—";
  switch (rd.redeploy_state) {
    case "redeploy":
      return `Leftover premium is decaying at ${ratioStr} the pace of a fresh CSP — closing to redeploy this capital wins even after churn costs.`;
    case "watch":
      return `Premium captured is running ahead of time elapsed (${ratioStr} of a fresh trade) — approaching the redeploy line, watch the mark.`;
    case "hold":
      return "Remaining premium still decays as fast as a fresh trade would pay — hold.";
    case "underwater":
      return "Mark is above your entry — this is a roll / assignment call, not a redeploy one.";
    default: return "";
  }
}

// Collapsed-row indicator. redeploy = visible chip; watch = muted ratio;
// hold / underwater are silent (the detail still shows on expand).
function RedeployIndicator({ rd }) {
  if (!rd || rd.skipped) return null;
  if (rd.redeploy_state === "redeploy") {
    return (
      <span style={{
        marginLeft: theme.space[1], padding: "1px 6px", borderRadius: theme.radius.pill,
        background: `${theme.blue}22`, color: theme.blue, border: `1px solid ${theme.blue}66`,
        fontSize: theme.size.xs, fontWeight: 600, lineHeight: 1.4, flexShrink: 0, whiteSpace: "nowrap",
      }}>↻ {rd.ratio.toFixed(2)}×</span>
    );
  }
  if (rd.redeploy_state === "watch") {
    return (
      <span style={{
        marginLeft: theme.space[1], color: theme.blue, opacity: 0.75,
        fontSize: theme.size.xs, fontWeight: 500, flexShrink: 0, whiteSpace: "nowrap",
      }}>{rd.ratio.toFixed(2)}×</span>
    );
  }
  return null;
}

function RedeployPanel({ rd }) {
  if (!rd || rd.skipped || rd.redeploy_state === "underwater") return null;

  const actionable = rd.redeploy_state === "redeploy";
  const color = (actionable || rd.redeploy_state === "watch") ? theme.blue : theme.text.muted;

  const labelStyle = {
    fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase",
    letterSpacing: "0.5px", fontWeight: 500, marginBottom: theme.space[1],
  };
  const cell = (label, value, valueColor) => (
    <div>
      <div style={labelStyle}>{label}</div>
      <div style={{ color: valueColor ?? theme.text.primary }}>{value}</div>
    </div>
  );

  return (
    <div style={{
      background: actionable ? `${theme.blue}11` : theme.bg.surface,
      borderTop: `1px solid ${actionable ? `${theme.blue}44` : theme.border.default}`,
      borderBottom: `1px solid ${theme.border.default}`,
      padding: `${theme.space[3]}px ${theme.space[4]}px`,
    }}>
      <div style={{ marginBottom: theme.space[2], fontSize: theme.size.sm, color: theme.text.primary }}>
        <span style={{ fontWeight: 600, color, textTransform: "uppercase", letterSpacing: "0.4px", marginRight: theme.space[2] }}>
          Redeploy
        </span>
        {redeployCopy(rd)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: `${theme.space[2]}px ${theme.space[4]}px`, fontSize: theme.size.sm }}>
        {cell("Ratio vs fresh", `${rd.ratio.toFixed(2)}×`, color)}
        {cell("Premium kept", `${Math.round(rd.kept_pct * 100)}%`)}
        {cell("Time left", `${Math.round(rd.frac_time_left * 100)}% · ${rd.days_remaining}d`)}
        {cell("Close trigger", `≤ $${rd.trigger_mark.toFixed(2)}`, actionable ? theme.blue : undefined)}
      </div>
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

function PositionsTable({ rows, positionType, quoteMap, cspEntryYieldBenchmark, isMobile, highlightedTicker, onOpenTickerDetail, strategicTagsByPos, onShowJournalEntry, onTagPosition, onOpenBasket, selectable, selectedKeys, setSelectedKeys, accountValue, onSaveCohort, onOpenCohort }) {
  const isLeap = positionType === "leaps";
  const isCC   = positionType === "ccs";
  const [expandedRowKey, setExpandedRowKey] = useState(null);
  const canExpand = !isLeap;
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState("desc");

  function handleSort(col) {
    if (sortCol === col) {
      setSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  }

  const numericCols = new Set(["Strike", "% OTM", "DTE", "% DTE Left", "Premium", "Cost", "G/L $", "G/L %"]);
  const colHeader = (label) => {
    if (!label) return <th key="__chevron__" style={{ width: 40 }} />;
    const isActive = sortCol === label;
    const isNumeric = numericCols.has(label);
    return (
      <th
        key={label}
        onClick={() => handleSort(label)}
        style={{
          padding:       `${theme.space[2]}px ${theme.space[3]}px`,
          textAlign:     isNumeric ? "right" : "left",
          color:         isActive ? theme.text.primary : theme.text.muted,
          fontWeight:    isActive ? 600 : 500,
          fontSize:      theme.size.sm,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          cursor:        "pointer",
          userSelect:    "none",
          whiteSpace:    "nowrap",
        }}
      >
        {label}
        <span style={{ marginLeft: 4, opacity: isActive ? 0.8 : 0.25, fontSize: theme.size.xs }}>
          {isActive ? (sortDir === "desc" ? "▼" : "▲") : "⇅"}
        </span>
      </th>
    );
  };

  if (!rows.length) {
    return (
      <div style={{ fontSize: theme.size.sm, color: theme.text.subtle, padding: "12px 0" }}>
        No open {positionType.toUpperCase()} positions.
      </div>
    );
  }

  // Pre-compute all derived values so we can sort on them
  const enriched = rows.map(pos => {
    const dte    = calcDTE(pos.expiry_date);
    const dtePct = dtePctRemaining({ openDateIso: pos.open_date, expiryDateIso: pos.expiry_date, dte });

    let glDollars = null, glPct = null, optionMid = null;
    if (pos.expiry_date && pos.strike != null && pos.contracts) {
      const sym = buildOccSymbol(pos.ticker, pos.expiry_date, isCC || isLeap, pos.strike);
      optionMid = quoteMap.get(sym)?.mid ?? null;
      if (isLeap) {
        glDollars = leapGlDollars({ capitalFronted: pos.capital_fronted, optionMid, contracts: pos.contracts });
        glPct     = leapGlPct({     capitalFronted: pos.capital_fronted, optionMid, contracts: pos.contracts });
      } else {
        glDollars = shortOptionGlDollars({ premiumCollected: pos.premium_collected, optionMid, contracts: pos.contracts });
        glPct     = shortOptionGlPct({     premiumCollected: pos.premium_collected, optionMid, contracts: pos.contracts });
      }
    }

    let otmPct = null;
    if (!isLeap && pos.strike != null) {
      const stockMid = quoteMap.get(pos.ticker)?.mid;
      if (stockMid != null) {
        otmPct = isCC
          ? ((pos.strike - stockMid) / stockMid) * 100
          : ((stockMid - pos.strike) / pos.strike) * 100;
      }
    }

    const displayValue = isLeap ? pos.capital_fronted : pos.premium_collected;

    // Compute cushion fields client-side for CSP positions (not LEAPs, not CCs)
    const isCsp = !isLeap && pos.type === "CSP";
    let enrichedPos = pos;
    let holdYield = null;
    let redeploy = null;
    if (isCsp) {
      const stockMid = quoteMap.get(pos.ticker)?.mid ?? quoteMap.get(pos.ticker)?.last ?? null;
      const iv       = quoteMap.get(pos.ticker)?.iv  ?? null;
      enrichedPos    = { ...pos, ...computeCushion(pos.strike, stockMid, iv) };

      const todayIso = new Date().toISOString().slice(0, 10);

      // Hold-yield signal — green CSPs only (computeHoldYield self-skips underwater
      // / missing-mid). Benchmark may be null in dev (no /api/data) → no_benchmark.
      holdYield = computeHoldYield({
        premiumCollected: pos.premium_collected,
        optionMid,
        contracts:        pos.contracts,
        capitalFronted:   pos.capital_fronted,
        daysToExpiry:     dte,
        openDate:         pos.open_date,
        today:            todayIso,
        cushionState:     enrichedPos.cushion_state,
        benchmark:        cspEntryYieldBenchmark?.avg_csp_entry_yield_ann ?? null,
      });

      // Redeploy signal — is the leftover premium still worth more here than in a
      // fresh CSP? Self-contained per position (no benchmark needed).
      redeploy = computeRedeploySignal({
        premiumCollected: pos.premium_collected,
        optionMid,
        contracts:        pos.contracts,
        daysToExpiry:     dte,
        openDate:         pos.open_date,
        today:            todayIso,
      });
    }

    return { pos: enrichedPos, dte, dtePct, glDollars, glPct, otmPct, displayValue, holdYield, redeploy };
  });

  const sorted = sortCol == null ? enriched : [...enriched].sort((a, b) => {
    let aVal, bVal;
    switch (sortCol) {
      case "Ticker":     aVal = a.pos.ticker;      bVal = b.pos.ticker;      break;
      case "Expiry":     aVal = a.pos.expiry_date; bVal = b.pos.expiry_date; break;
      case "Strike":     aVal = a.pos.strike;      bVal = b.pos.strike;      break;
      case "% OTM":      aVal = a.otmPct;          bVal = b.otmPct;          break;
      case "DTE":        aVal = a.dte;             bVal = b.dte;             break;
      case "% DTE Left": aVal = a.dtePct;          bVal = b.dtePct;          break;
      case "Premium":
      case "Cost":       aVal = a.displayValue;    bVal = b.displayValue;    break;
      case "G/L $":      aVal = a.glDollars;       bVal = b.glDollars;       break;
      case "G/L %":      aVal = a.glPct;           bVal = b.glPct;           break;
      default:           return 0;
    }
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    if (typeof aVal === "string") {
      const cmp = aVal.localeCompare(bVal);
      return sortDir === "desc" ? -cmp : cmp;
    }
    return sortDir === "desc" ? bVal - aVal : aVal - bVal;
  });

  // ── Selection calculator (CSPs tab only) ──────────────────────────────────
  // Selection is keyed by positionKey so it survives re-sorts and quote
  // refreshes; a key whose position closed simply stops matching any row.
  function toggleRow(pos) {
    const key = positionKey(pos);
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // Expiry-cell quick-select: if every row of this expiry is selected,
  // deselect them all; otherwise select them all.
  function toggleExpiry(expiryDate) {
    const keys = enriched.filter(r => r.pos.expiry_date === expiryDate).map(r => positionKey(r.pos));
    setSelectedKeys(prev => {
      const next = new Set(prev);
      const allSelected = keys.every(k => next.has(k));
      keys.forEach(k => { if (allSelected) next.delete(k); else next.add(k); });
      return next;
    });
  }

  const selectedRows = selectable ? enriched.filter(r => selectedKeys.has(positionKey(r.pos))) : [];
  const selectionAgg = selectable ? computeCspAggregates(selectedRows, accountValue) : null;

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: theme.size.md }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${theme.border.strong}` }}>
            {[
              "Ticker",
              ...(!isMobile ? ["Expiry"] : []),
              "Strike",
              ...(!isLeap ? ["% OTM"] : []),
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
          {sorted.map(({ pos, dte, dtePct, glDollars, glPct, otmPct, displayValue, holdYield, redeploy }, i) => {
            const dtePctColor = dtePct == null ? theme.text.muted
              : dtePct >= 60 ? theme.green
              : dtePct >= 20 ? theme.amber
              : theme.red;
            const glColor    = glDollars == null ? theme.text.muted : glDollars >= 0 ? theme.green : theme.red;
            const otmColor   = otmPct == null ? theme.text.muted : otmPct > 0 ? theme.green : theme.red;
            const valueColor = isLeap ? theme.chart.leaps : theme.green;

            let rowHighlightColor = null;
            if (!isLeap && glPct != null && dtePct != null) {
              if (glPct >= targetProfitPctForDtePct(dtePct)) rowHighlightColor = theme.green;
            } else if (isLeap) {
              if (glPct != null && glPct >= 10)      rowHighlightColor = theme.green;
              else if (dte != null && dte < 90)      rowHighlightColor = theme.red;
            }

            if (pos.cushion_state === "assignment_risk" && (dte == null || dte <= 21)) rowHighlightColor = theme.red;
            else if (pos.cushion_state === "approaching" && rowHighlightColor !== theme.red && (dte == null || dte <= 14)) rowHighlightColor = theme.amber;

            const td = (content, style = {}) => (
              <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, ...style }}>{content}</td>
            );

            const rowKey   = `${pos.ticker}-${pos.expiry_date}-${pos.strike}`;
            const isExpanded = canExpand && expandedRowKey === rowKey;
            const isSelected  = selectable && selectedKeys.has(positionKey(pos));
            const rowBg       = isSelected ? "rgba(58,130,246,0.14)" : highlightedTicker === pos.ticker ? "rgba(58,130,246,0.10)" : "transparent";
            const rowHoverBg  = isSelected ? "rgba(58,130,246,0.18)" : highlightedTicker === pos.ticker ? "rgba(58,130,246,0.15)" : `${TYPE_COLORS.CSP.bg}22`;

            const sortedTags = [...(strategicTagsByPos?.get(positionKey(pos)) ?? [])].sort((a, b) => {
              const pa = a.tag.split(":")[0];
              const pb = b.tag.split(":")[0];
              const ia = STRATEGIC_TAG_PREFIXES.indexOf(pa);
              const ib = STRATEGIC_TAG_PREFIXES.indexOf(pb);
              const da = ia === -1 ? Number.MAX_SAFE_INTEGER : ia;
              const db = ib === -1 ? Number.MAX_SAFE_INTEGER : ib;
              if (da !== db) return da - db;
              return a.tag.localeCompare(b.tag);
            });
            const hasTagRow = sortedTags.length > 0;

            let priceTargets = null;
            if (isExpanded) {
              const currentIV         = quoteMap.get(pos.ticker)?.iv ?? null;
              const currentStockPrice = quoteMap.get(pos.ticker)?.mid ?? null;
              const sym               = buildOccSymbol(pos.ticker, pos.expiry_date, isCC, pos.strike);
              const optionQuote       = quoteMap.get(sym);
              priceTargets = computePriceTargets(pos, currentIV, currentStockPrice, optionQuote?.mid ?? null, optionQuote?.iv ?? null);
            }

            return (
              <React.Fragment key={i}>
                <tr
                  style={{
                    borderBottom: isExpanded ? "none" : `1px solid ${theme.border.default}`,
                    borderLeft:   rowHighlightColor ? `3px solid ${rowHighlightColor}` : isSelected ? `3px solid ${theme.blue}` : "3px solid transparent",
                    cursor:       (selectable || canExpand) ? "pointer" : "default",
                    background:   rowBg,
                    transition:   "background 0.4s",
                  }}
                  onClick={selectable ? () => toggleRow(pos) : canExpand ? () => setExpandedRowKey(isExpanded ? null : rowKey) : undefined}
                  onMouseEnter={e => (e.currentTarget.style.background = rowHoverBg)}
                  onMouseLeave={e => (e.currentTarget.style.background = rowBg)}
                >
                  {td(
                    <span style={{ display: "flex", alignItems: "center" }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenTickerDetail?.(pos.ticker);
                        }}
                        style={{
                          background: "transparent", border: "none", padding: 0,
                          display: "inline-block", width: 38, fontWeight: 700,
                          color: theme.text.primary, fontFamily: "inherit",
                          fontSize: "inherit", cursor: onOpenTickerDetail ? "pointer" : "default",
                          textAlign: "left",
                        }}
                        onMouseEnter={(e) => { if (onOpenTickerDetail) e.currentTarget.style.color = theme.blue; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = theme.text.primary; }}
                      >
                        {pos.ticker}
                      </button>
                      {pos.cushion_state === "assignment_risk" && (dte == null || dte <= 21) && (
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: theme.red, display: "inline-block", flexShrink: 0 }} />
                      )}
                      {pos.cushion_state === "approaching" && (dte == null || dte <= 14) && (
                        <span style={{ fontSize: theme.size.sm, color: theme.amber, lineHeight: 1 }}>⚠</span>
                      )}
                      <HoldYieldIndicator hy={holdYield} />
                      <RedeployIndicator rd={redeploy} />
                      {hasTagRow && !isExpanded && (
                        <span
                          onClick={canExpand ? (e) => { e.stopPropagation(); setExpandedRowKey(rowKey); } : undefined}
                          title={`${sortedTags.length} tag${sortedTags.length === 1 ? "" : "s"} — expand to view`}
                          style={{
                            display: "inline-flex", alignItems: "center",
                            marginLeft: theme.space[1], padding: "1px 7px",
                            fontSize: theme.size.xs, fontFamily: theme.font.mono,
                            color: theme.text.muted, background: theme.bg.elevated,
                            border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.pill,
                            lineHeight: 1.3, flexShrink: 0, whiteSpace: "nowrap",
                            cursor: canExpand ? "pointer" : "default",
                          }}
                        >{sortedTags.length} tag{sortedTags.length === 1 ? "" : "s"}</span>
                      )}
                    </span>
                  )}
                  {!isMobile && (
                    <td
                      onClick={selectable ? (e) => { e.stopPropagation(); toggleExpiry(pos.expiry_date); } : undefined}
                      title={selectable ? "Select all CSPs with this expiry" : undefined}
                      style={{
                        padding: `${theme.space[2]}px ${theme.space[2]}px`,
                        color: theme.text.muted,
                        cursor: selectable ? "pointer" : undefined,
                        textDecoration: selectable ? "underline dotted" : "none",
                        textUnderlineOffset: 3,
                      }}
                    >
                      {formatExpiry(pos.expiry_date)}
                    </td>
                  )}
                  {td(pos.strike != null ? `$${pos.strike}` : "—",                 { color: theme.text.primary, textAlign: "right" })}
                  {!isLeap && td(otmPct != null ? `${otmPct.toFixed(1)}%` : "—",   { color: otmColor, fontWeight: 600, textAlign: "right" })}
                  {!isMobile && td(dte != null ? `${dte}d` : "—", {
                    color:     dte != null && dte <= 5 ? theme.red : theme.text.muted,
                    fontWeight: dte != null && dte <= 5 ? 600 : 400,
                    textAlign: "right",
                  })}
                  {!isMobile && td(dtePct != null ? `${dtePct.toFixed(0)}%` : "—", { color: dtePctColor, fontWeight: 600, textAlign: "right" })}
                  {!isMobile && td(formatDollarsFull(displayValue),                 { color: valueColor, fontWeight: 600, textAlign: "right" })}
                  {!isMobile && td(glDollars != null ? formatDollarsFull(glDollars) : "—", { color: glColor, fontWeight: 600, textAlign: "right" })}
                  {td(glPct != null ? `${glPct.toFixed(1)}%` : "—",                { color: glColor, fontWeight: 500, textAlign: "right" })}
                  {canExpand && (
                    <td
                      onClick={(e) => { e.stopPropagation(); setExpandedRowKey(isExpanded ? null : rowKey); }}
                      title={isExpanded ? "Collapse" : "Expand details"}
                      style={{ width: 40, textAlign: "center", padding: "9px 8px", cursor: "pointer" }}
                    >
                      <span style={{ color: theme.text.subtle, fontSize: theme.size.sm }}>{isExpanded ? "▴" : "▾"}</span>
                    </td>
                  )}
                </tr>
                {isExpanded && (
                  <tr>
                    <td colSpan={isMobile ? 5 : 10} style={{ padding: 0, borderBottom: `1px solid ${theme.border.default}` }}>
                      {(hasTagRow || onTagPosition) && (
                        <div style={{
                          padding: `${theme.space[2]}px ${theme.space[3]}px`,
                          background: theme.bg.surface,
                          borderTop: `1px solid ${theme.border.default}`,
                          display: "flex", flexWrap: "wrap", alignItems: "center", gap: theme.space[1],
                        }}>
                          {sortedTags.map(t => (
                            <PositionTagChip
                              key={t.tag}
                              tag={t.tag}
                              compact={false}
                              onClick={
                                t.tag.startsWith("cohort:") && onOpenCohort
                                  ? () => onOpenCohort(t.tag)
                                  : t.tag.startsWith("strategy:") && onOpenBasket
                                  ? () => onOpenBasket(t.tag)
                                  : () => onShowJournalEntry?.(t.entryId)
                              }
                            />
                          ))}
                          {onTagPosition && (
                            <button
                              onClick={(e) => { e.stopPropagation(); onTagPosition(pos); }}
                              style={{
                                background: "transparent", border: "none", padding: 0,
                                color: theme.text.muted, cursor: "pointer",
                                fontSize: theme.size.sm, fontFamily: "inherit",
                                textDecoration: "underline",
                                marginLeft: hasTagRow ? theme.space[1] : 0,
                              }}
                            >
                              + Tag
                            </button>
                          )}
                        </div>
                      )}
                      {pos.cushion_state && pos.cushion_state !== "safe" && (
                        <CushionPanel cushion={pos} dte={dte} />
                      )}
                      <HoldYieldPanel hy={holdYield} />
                      <RedeployPanel rd={redeploy} />
                      {priceTargets && (
                        <PriceTargetPanel targets={priceTargets} position={pos} stockPrice={quoteMap.get(pos.ticker)?.mid ?? null} />
                      )}
                      <PositionHistoryPanel position={pos} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      {selectable && (
        <CspSelectionBar
          agg={selectionAgg}
          isMobile={isMobile}
          onClear={() => setSelectedKeys(new Set())}
          onSaveCohort={onSaveCohort}
        />
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const TYPE_TO_TAB = { CSP: "csps", CC: "ccs", LEAP: "leaps" };

export function OpenPositionsTab({ positionIntent, onPositionIntentConsumed, onOpenTickerDetail, onShowJournalEntry, onTagPosition, onOpenBasket }) {
  const { positions, account, cspEntryYieldBenchmark, trades } = useData();
  const { quoteMap } = useQuotes();
  const isMobile = useWindowWidth() < 600;
  const { assigned_shares, open_csps, open_leaps } = positions;

  const { rollMap, rollLoading, lastCheckedAt, isStale, checkRolls, relativeTime } = useRollAnalysis();

  const [positionTab, setPositionTab] = useState("csps");
  // Selection calculator state — Set of positionKey strings (CSPs tab only).
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [highlightedTicker, setHighlightedTicker] = useState(null);

  // ── Cohorts (tag-based; journal entries are the source of truth) ──────────
  const [selectedCohortTag, setSelectedCohortTag] = useState(null);
  const [cohortEntries, setCohortEntries] = useState([]);
  const [cohortRefreshKey, setCohortRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await listJournalEntries({ hasTags: "1" });
        if (cancelled) return;
        setCohortEntries((data ?? []).filter(e =>
          Array.isArray(e.tags) && e.tags.some(t => typeof t === "string" && t.startsWith("cohort:"))
        ));
      } catch (err) {
        if (cancelled) return;
        console.warn("[OpenPositionsTab] cohort entry fetch failed:", err.message);
        setCohortEntries([]);
      }
    })();
    return () => { cancelled = true; };
  }, [cohortRefreshKey]);

  const cohortCount = new Set(
    cohortEntries.flatMap(e => (e.tags ?? []).filter(t => t.startsWith("cohort:")))
  ).size;

  // Writes one journal entry per selected CSP with the cohort tag, mirroring
  // the JournalQuickAdd POST payload. `source` stays null — a non-null source
  // would propagate to the linked position via the API.
  async function handleSaveCohort(name) {
    const slug = slugifyCohortName(name);
    if (!slug) throw new Error("Name needs letters or digits");
    const tag = `cohort:${slug}`;
    const selected = open_csps.filter(p => selectedKeys.has(positionKey(p)));
    if (!selected.length) throw new Error("Nothing selected");
    const now = new Date().toISOString();
    for (const pos of selected) {
      const payload = {
        entry_type: "position_note", // NOT NULL column, no default — POST fails without it
        trade_id: null,
        position_id: pos.id ?? null,
        entry_date: now.slice(0, 10),
        ticker: pos.ticker,
        type: pos.type,
        strike: pos.strike,
        expiry: pos.expiry_date,
        title: `Cohort: ${slug}`,
        body: "",
        tags: [tag],
        source: null,
        mood: null,
        metadata: null,
        focus_snapshot: null,
        created_at: now,
        updated_at: now,
      };
      const resp = await fetch("/api/journal-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok || !json?.ok) throw new Error(json?.error || `HTTP ${resp.status}`);
    }
    setCohortRefreshKey(k => k + 1);
    setSelectedKeys(new Set());
  }

  useEffect(() => {
    if (!positionIntent) return;
    const tab = TYPE_TO_TAB[positionIntent.type];
    if (tab) setPositionTab(tab);
    setHighlightedTicker(positionIntent.ticker);
    onPositionIntentConsumed?.();
    const timer = setTimeout(() => setHighlightedTicker(null), 3000);
    return () => clearTimeout(timer);
  }, [positionIntent]); // eslint-disable-line react-hooks/exhaustive-deps

  const [strategicTagsByPos, setStrategicTagsByPos] = useState(new Map());

  useEffect(() => {
    const tickers = [
      ...(open_csps        ?? []).map(p => p.ticker),
      ...(open_leaps       ?? []).map(p => p.ticker),
      ...(assigned_shares  ?? []).map(s => s.ticker),
    ];
    const uniqTickers = [...new Set(tickers)];
    if (uniqTickers.length === 0) {
      setStrategicTagsByPos(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      let data;
      try {
        data = await listJournalEntries({ tickers: uniqTickers.join(","), hasTags: "1" });
      } catch (err) {
        if (cancelled) return;
        console.warn("[OpenPositionsTab] tag fetch failed:", err.message);
        setStrategicTagsByPos(new Map());
        return;
      }
      if (cancelled) return;
      setStrategicTagsByPos(groupStrategicTagsByPosition(data ?? [], { open_csps, open_leaps, assigned_shares }));
    })();
    return () => { cancelled = true; };
  }, [open_csps, open_leaps, assigned_shares, cohortRefreshKey]);
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
    { key: "csps",    label: `CSPs (${open_csps.length})`,      rows: open_csps     },
    { key: "ccs",     label: `CCs (${open_ccs.length})`,        rows: open_ccs      },
    { key: "leaps",   label: `LEAPs (${allOpenLeaps.length})`,  rows: allOpenLeaps  },
    { key: "cohorts", label: `Cohorts (${cohortCount})`,        rows: []            },
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
                  onClick={() => { setPositionTab(t.key); setSelectedKeys(new Set()); setSelectedCohortTag(null); }}
                  onMouseEnter={e => { if (positionTab !== t.key) e.currentTarget.style.background = "rgba(58,130,246,0.06)"; }}
                  onMouseLeave={e => { if (positionTab !== t.key) e.currentTarget.style.background = theme.bg.elevated; }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          {positionTab === "cohorts" ? (
            <CohortsPanel
              cohortEntries={cohortEntries}
              openCsps={open_csps}
              trades={trades}
              quoteMap={quoteMap}
              accountValue={account?.account_value ?? null}
              isMobile={isMobile}
              selectedTag={selectedCohortTag}
              onSelectTag={setSelectedCohortTag}
              onCohortsChanged={() => setCohortRefreshKey(k => k + 1)}
            />
          ) : (
            <PositionsTable
              rows={activeTab?.rows ?? []}
              positionType={positionTab}
              quoteMap={quoteMap}
              cspEntryYieldBenchmark={cspEntryYieldBenchmark}
              selectable={positionTab === "csps"}
              selectedKeys={selectedKeys}
              setSelectedKeys={setSelectedKeys}
              accountValue={account?.account_value ?? null}
              onSaveCohort={handleSaveCohort}
              onOpenCohort={(tag) => { setPositionTab("cohorts"); setSelectedKeys(new Set()); setSelectedCohortTag(tag); }}
              isMobile={isMobile}
              highlightedTicker={highlightedTicker}
              onOpenTickerDetail={onOpenTickerDetail}
              strategicTagsByPos={strategicTagsByPos}
              onShowJournalEntry={onShowJournalEntry}
              onTagPosition={onTagPosition}
              onOpenBasket={onOpenBasket}
            />
          )}
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

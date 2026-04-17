import { useState, useMemo, useEffect } from "react";
import marketContextDev from "../data/market-context.json";
import { theme } from "../lib/theme";
import { useRadar } from "../hooks/useRadar";
import { supabase } from "../lib/supabase";
import { DEFAULT_FILTERS, countActiveFilters, expandGroupsToSectors } from "./radar/radarConstants";
import RadarAdvancedFilters from "./radar/RadarAdvancedFilters";
import RadarPresetBar from "./radar/RadarPresetBar";

// ── Score computation ─────────────────────────────────────────────────────────

function compositeIv(iv, ivRank) {
  if (iv == null || ivRank == null) return null;
  return (ivRank / 100 * 0.60) + (Math.min(iv / 1.50, 1.0) * 0.40);
}

function scannerScore(bbPosition, iv, ivRank) {
  if (bbPosition == null) return null;
  const ivComp = compositeIv(iv, ivRank);
  if (ivComp == null) return null;
  return (1 - bbPosition) * 0.50 + ivComp * 0.50;
}

function scoreLabel(score) {
  if (score == null) return null;
  if (score >= 0.70) return "Strong";
  if (score >= 0.50) return "Moderate";
  if (score >= 0.30) return "Neutral";
  return "Weak";
}

// ── BB bucket ─────────────────────────────────────────────────────────────────

function bbBucket(pos) {
  if (pos == null) return null;
  if (pos < 0)    return "below_band";
  if (pos < 0.20) return "near_lower";
  if (pos < 0.80) return "mid_range";
  if (pos <= 1.0) return "near_upper";
  return "above_band";
}

const BB_BUCKET_LABELS = {
  below_band: "Below Band",
  near_lower: "Near Lower",
  mid_range:  "Mid Range",
  near_upper: "Near Upper",
  above_band: "Above Band",
};

// Hardcoded hex — intentional exception (like TYPE_COLORS)
const BB_BUCKET_COLORS = {
  below_band: { bg: "#3d1a1a", text: "#f85149" },
  near_lower: { bg: "#1a3d1a", text: "#3fb950" },
  mid_range:  { bg: "#21262d", text: "#8b949e" },
  near_upper: { bg: "#3d3010", text: "#e3b341" },
  above_band: { bg: "#2d1f00", text: "#e3b341" },
};

// Row background — intentional exception
const SCORE_ROW_BG = {
  Strong:   "#0d1f0d",
  Weak:     "#1f0d0d",
};

// ── Position indicators ───────────────────────────────────────────────────────

function getPositionIndicators(ticker, positions) {
  if (!positions || Array.isArray(positions)) return [];

  const indicators = [];

  // Shares: in assigned_shares
  if ((positions.assigned_shares || []).some(s => s.ticker === ticker)) {
    indicators.push('📌 Shares');
  }

  // CC: nested as active_cc inside assigned_shares
  if ((positions.assigned_shares || []).some(s => s.ticker === ticker && s.active_cc != null)) {
    indicators.push('🔼 CC');
  }

  // CSP: in open_csps
  if ((positions.open_csps || []).some(p => p.ticker === ticker)) {
    indicators.push('📋 CSP');
  }

  // LEAPS: in open_leaps (top-level)
  if ((positions.open_leaps || []).some(l => l.ticker === ticker)) {
    indicators.push('🔭 LEAPS');
  }

  return indicators;
}

// ── Earnings warning ──────────────────────────────────────────────────────────

function getEarningsWarning(ticker, marketContext) {
  if (!marketContext?.positions) return null;
  const ctx = marketContext.positions.find(p => p.ticker === ticker);
  if (!ctx?.nextEarnings?.date) return null;
  const daysAway = Math.ceil((new Date(ctx.nextEarnings.date) - new Date()) / (1000 * 60 * 60 * 24));
  if (daysAway <= 21 && daysAway >= 0) return `⚠ Earnings ${ctx.nextEarnings.date}`;
  return null;
}

function getEarningsDaysAway(ticker, marketContext) {
  if (!marketContext?.positions) return null;
  const ctx = marketContext.positions.find(p => p.ticker === ticker);
  if (!ctx?.nextEarnings?.date) return null;
  return Math.ceil((new Date(ctx.nextEarnings.date) - new Date()) / (1000 * 60 * 60 * 24));
}

// ── Plain-English explanations ────────────────────────────────────────────────

const BB_EXPLANATIONS = {
  below_band: (ticker, bbPos) =>
    `${ticker} is trading below its lower Bollinger Band (position: ${bbPos.toFixed(2)}), ` +
    `meaning price has moved statistically far to the downside relative to its recent 20-day range. ` +
    `Historically this level acts as support. For CSP entry, this is a favorable price location — ` +
    `you're selling puts at a point of statistical stress, with mean reversion likely to work in your favor.`,

  near_lower: (ticker, bbPos) =>
    `${ticker} is approaching its lower Bollinger Band (position: ${bbPos.toFixed(2)}). ` +
    `Price is pulling back toward statistical support. ` +
    `A good entry zone for CSPs — you're getting favorable price placement without waiting for a full breakdown.`,

  mid_range: (ticker, bbPos) =>
    `${ticker} is trading in the middle of its Bollinger Band range (position: ${bbPos.toFixed(2)}). ` +
    `No strong directional signal from price alone. ` +
    `IV conditions matter more here — check the premium quality section below.`,

  near_upper: (ticker, bbPos) =>
    `${ticker} is approaching its upper Bollinger Band (position: ${bbPos.toFixed(2)}). ` +
    `Price is extended to the upside relative to recent history. ` +
    `Less favorable for new CSP entry — puts are further OTM and premium may be thinner. ` +
    `Better to wait for a pullback.`,

  above_band: (ticker, bbPos) =>
    `${ticker} is trading above its upper Bollinger Band (position: ${bbPos.toFixed(2)}). ` +
    `Price is statistically extended to the upside. ` +
    `Avoid new CSP entries here — you'd be selling puts far below a potentially unstable price level. ` +
    `Watch for a pullback toward the midline before entering.`,
};

const IV_EXPLANATIONS = {
  Strong: (ticker, ivPct, ivRank, composite) =>
    `IV rank of ${ivRank.toFixed(1)} puts ${ticker} in the elevated range — ` +
    `options are priced in the upper tier of their 52-week history. ` +
    `Raw IV of ${(ivPct * 100).toFixed(0)}% means premium is meaningful in absolute dollar terms. ` +
    `Strong conditions to sell premium. Composite score: ${composite.toFixed(2)}.`,

  Moderate: (ticker, ivPct, ivRank, composite) =>
    `IV rank of ${ivRank.toFixed(1)} puts ${ticker} around the midpoint of its historical range. ` +
    `You're getting reasonable premium but not at a historically elevated level. ` +
    `Raw IV of ${(ivPct * 100).toFixed(0)}% is ${ivPct > 0.60 ? "meaningful in absolute terms" : "moderate in absolute terms"}. ` +
    `Acceptable conditions to sell premium. Composite score: ${composite.toFixed(2)}.`,

  Neutral: (ticker, ivPct, ivRank, composite) =>
    `IV rank of ${ivRank.toFixed(1)} puts ${ticker} in the middle of its historical range. ` +
    `Options are priced near their median levels for the past year. ` +
    `Raw IV of ${(ivPct * 100).toFixed(0)}% offers modest premium. ` +
    `Acceptable conditions for premium selling, though not a high-conviction IV setup. ` +
    `Composite score: ${composite.toFixed(2)}.`,

  Weak: (ticker, ivPct, ivRank, composite) =>
    `IV rank of ${ivRank.toFixed(1)} puts ${ticker} near its cheapest options levels of the past year. ` +
    `Raw IV of ${(ivPct * 100).toFixed(0)}% means premium is thin. ` +
    `Consider waiting for a volatility event before selling puts on this name. ` +
    `Composite score: ${composite.toFixed(2)}.`,
};

// ── Score bar ─────────────────────────────────────────────────────────────────

function ScoreBar({ score }) {
  if (score == null) return null;
  const clamped = Math.max(0, Math.min(1, score));
  const filled = Math.round(clamped * 10);
  const label = scoreLabel(score);
  const barColor = label === "Strong" ? theme.green
    : label === "Moderate" ? theme.blue
    : label === "Neutral"  ? theme.text.muted
    : theme.red;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: theme.space[2] }}>
      <div style={{ display: "flex", gap: theme.space[1] }}>
        {Array.from({ length: 10 }, (_, i) => (
          <div
            key={i}
            style={{
              width:        6,
              height:       14,
              borderRadius: 2,
              background:   i < filled ? barColor : theme.border.strong,
            }}
          />
        ))}
      </div>
      <span style={{ fontSize: theme.size.xs, color: barColor, fontWeight: 600, minWidth: 52 }}>
        {label}
      </span>
    </div>
  );
}

// ── Compact row ───────────────────────────────────────────────────────────────

function RadarRow({ row, positions, marketContext, expanded, onToggle, sortBy }) {
  const { ticker, company, sector, last, iv, iv_rank, bb_position, bb_upper, bb_lower, bb_sma20, bb_refreshed_at, pe_ttm } = row;
  const bucket   = bbBucket(bb_position);
  const score    = scannerScore(bb_position, iv, iv_rank);
  const ivComp   = compositeIv(iv, iv_rank);
  const label    = scoreLabel(score);
  const bucketColors = bucket ? BB_BUCKET_COLORS[bucket] : null;
  const indicators   = getPositionIndicators(ticker, positions);
  const earningsWarn = getEarningsWarning(ticker, marketContext);

  // Highlight the active sort field's value
  const sortId = sortBy?.id;
  const highlight = (field) => sortId === field
    ? { color: theme.blue, fontWeight: 700 }
    : {};

  const hasPosition = indicators.length > 0;

  const rowBg = label === "Strong" ? SCORE_ROW_BG.Strong
    : label === "Weak"   ? SCORE_ROW_BG.Weak
    : hasPosition        ? "rgba(227,179,65,0.05)"
    : theme.bg.surface;

  return (
    <div>
      {/* Compact row */}
      <div
        onClick={onToggle}
        style={{
          display:       "flex",
          alignItems:    "center",
          gap:           theme.space[2],
          padding:       `${theme.space[2]}px ${theme.space[3]}px`,
          background:    expanded ? theme.bg.elevated : rowBg,
          borderBottom:  `1px solid ${theme.border.default}`,
          cursor:        "pointer",
          flexWrap:      "wrap",
          minHeight:     40,
          transition:    "background 0.1s",
        }}
      >
        {/* Ticker */}
        <span style={{
          fontSize:   theme.size.md,
          fontWeight: 700,
          color:      theme.text.primary,
          minWidth:   52,
          flexShrink: 0,
        }}>
          {ticker}
        </span>

        {/* Left-rail position/earnings indicators */}
        {(indicators.length > 0 || earningsWarn) && (
          <div style={{
            display:     "inline-flex",
            alignItems:  "center",
            gap:         theme.space[1],
            fontSize:    theme.size.xs,
            flexShrink:  0,
            color:       theme.text.muted,
          }}>
            {indicators.includes('📌 Shares') && <span title="Shares held">📌</span>}
            {indicators.includes('🔼 CC')     && <span title="Covered call open">🔼</span>}
            {indicators.includes('📋 CSP')    && <span title="CSP open">📋</span>}
            {indicators.includes('🔭 LEAPS')  && <span title="LEAP open">🔭</span>}
            {earningsWarn && (
              <span style={{ color: theme.amber }} title={earningsWarn}>⚠</span>
            )}
          </div>
        )}

        {/* BB badge */}
        {bucket ? (
          <span style={{
            fontSize:     theme.size.xs,
            fontWeight:   600,
            color:        bucketColors.text,
            background:   bucketColors.bg,
            borderRadius: theme.radius.pill,
            padding:      "2px 8px",
            flexShrink:   0,
          }}>
            {BB_BUCKET_LABELS[bucket]}
          </span>
        ) : (
          <span style={{ fontSize: theme.size.xs, color: theme.text.subtle, flexShrink: 0 }}>No BB data</span>
        )}

        {/* BB value */}
        {bb_position != null && (
          <span style={{ fontSize: theme.size.sm, color: theme.text.muted, flexShrink: 0, ...highlight("bb") }}>
            BB: {bb_position.toFixed(2)}
          </span>
        )}

        {/* IV */}
        <span style={{ fontSize: theme.size.sm, color: theme.text.muted, flexShrink: 0, ...highlight("iv_raw") }}>
          {iv != null ? `IV: ${Math.round(iv * 100)}%` : "IV pending"}
        </span>

        {/* IVR */}
        {iv_rank != null && (
          <span style={{ fontSize: theme.size.sm, color: theme.text.muted, flexShrink: 0, ...highlight("iv_rank") }}>
            IVR: {iv_rank.toFixed(1)}
          </span>
        )}

        {/* Composite IV */}
        {ivComp != null && (
          <span style={{ fontSize: theme.size.sm, color: theme.text.muted, flexShrink: 0, ...highlight("iv_composite") }}>
            IVC: {ivComp.toFixed(2)}
          </span>
        )}

        {/* P/E */}
        {pe_ttm != null && (
          <span style={{ fontSize: theme.size.sm, color: theme.text.muted, flexShrink: 0, ...highlight("pe") }}>
            P/E: {pe_ttm.toFixed(1)}
          </span>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Score bar */}
        {score != null ? (
          <ScoreBar score={score} />
        ) : (
          <span style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>—</span>
        )}

        {/* Expand caret */}
        <span style={{ fontSize: theme.size.xs, color: theme.text.subtle, flexShrink: 0, marginLeft: theme.space[1] }}>
          {expanded ? "▲" : "▼"}
        </span>
      </div>

      {/* Expanded detail panel */}
      {expanded && (
        <ExpandedPanel
          row={row}
          indicators={indicators}
          positions={positions}
          marketContext={marketContext}
          bucket={bucket}
          score={score}
        />
      )}
    </div>
  );
}

// ── Expanded detail panel ─────────────────────────────────────────────────────

function ExpandedPanel({ row, indicators, positions, marketContext, bucket, score }) {
  const { ticker, company, sector, last, iv, iv_rank, bb_position, bb_upper, bb_lower, bb_sma20, pe_ttm, pe_annual, eps_ttm } = row;

  // Detailed position data for this ticker
  const sharePos    = (positions?.assigned_shares || []).find(s => s.ticker === ticker) ?? null;
  const cspPositions = (positions?.open_csps || []).filter(p => p.ticker === ticker);
  const leapPositions = (positions?.open_leaps || []).filter(l => l.ticker === ticker);
  // Also check leaps nested in sharePos
  const nestedLeaps = sharePos?.open_leaps ?? [];
  const allLeaps = [...leapPositions, ...nestedLeaps];

  const ivComp    = compositeIv(iv, iv_rank);
  const label     = scoreLabel(score);
  const ivLabel   = scoreLabel(ivComp != null ? ivComp : null);

  // Earnings info
  const earningsDate = marketContext?.positions?.find(p => p.ticker === ticker)?.nextEarnings?.date ?? null;
  const daysAway = earningsDate
    ? Math.ceil((new Date(earningsDate) - new Date()) / (1000 * 60 * 60 * 24))
    : null;

  const sectionLabelStyle = {
    fontSize:      theme.size.xs,
    fontWeight:    600,
    color:         theme.text.subtle,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    marginBottom:  theme.space[2],
    marginTop:     theme.space[4],
  };

  const monoStyle = {
    fontFamily: theme.font.mono,
    fontSize:   theme.size.sm,
    color:      theme.text.secondary,
  };

  const fieldRow = (label, value, valueColor) => (
    <span style={{ ...monoStyle, color: valueColor ?? theme.text.secondary }}>
      <span style={{ color: theme.text.subtle }}>{label}: </span>
      {value ?? "—"}
    </span>
  );

  return (
    <div style={{
      background:   theme.bg.elevated,
      border:       `1px solid ${theme.border.default}`,
      borderTop:    "none",
      padding:      `${theme.space[3]}px ${theme.space[4]}px ${theme.space[4]}px`,
      marginBottom: 0,
    }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", gap: theme.space[3], flexWrap: "wrap" }}>
        {company && (
          <span style={{ fontSize: theme.size.md, fontWeight: 700, color: theme.text.primary }}>
            {company}
          </span>
        )}
        <span style={{ fontSize: theme.size.sm, color: theme.text.muted }}>
          {last != null ? `$${last.toFixed(2)}` : "price N/A"}
        </span>
        {sector && (
          <span style={{ fontSize: theme.size.sm, color: theme.text.subtle }}>{sector}</span>
        )}
      </div>

      {/* ── Bollinger Band section ── */}
      <div style={sectionLabelStyle}>Bollinger Band Position</div>
      <div style={{ display: "flex", gap: theme.space[4], flexWrap: "wrap", marginBottom: theme.space[2] }}>
        {fieldRow("BB Position", bb_position != null ? bb_position.toFixed(2) : null)}
        {bucket && (
          <span style={{ ...monoStyle }}>
            <span style={{ color: theme.text.subtle }}>Bucket: </span>
            <span style={{ color: BB_BUCKET_COLORS[bucket]?.text }}>{BB_BUCKET_LABELS[bucket]}</span>
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: theme.space[4], flexWrap: "wrap", marginBottom: theme.space[3] }}>
        {fieldRow("SMA 20", bb_sma20 != null ? `$${bb_sma20.toFixed(2)}` : null)}
        {fieldRow("Upper", bb_upper != null ? `$${bb_upper.toFixed(2)}` : null)}
        {fieldRow("Lower", bb_lower != null ? `$${bb_lower.toFixed(2)}` : null)}
        {fieldRow("Current", last != null ? `$${last.toFixed(2)}` : null)}
      </div>
      {bucket && bb_position != null && (
        <div style={{
          fontSize:   theme.size.sm,
          color:      theme.text.muted,
          lineHeight: 1.6,
          padding:    `${theme.space[2]}px ${theme.space[3]}px`,
          background: theme.bg.surface,
          borderRadius: theme.radius.sm,
          border:     `1px solid ${theme.border.default}`,
        }}>
          {BB_EXPLANATIONS[bucket](ticker, bb_position)}
        </div>
      )}

      {/* ── IV & Premium Quality section ── */}
      <div style={sectionLabelStyle}>IV &amp; Premium Quality</div>
      {iv != null && iv_rank != null && ivComp != null ? (
        <>
          <div style={{ display: "flex", gap: theme.space[4], flexWrap: "wrap", marginBottom: theme.space[2] }}>
            {fieldRow("Raw IV", `${(iv * 100).toFixed(0)}%`)}
            {fieldRow("IV Rank", iv_rank.toFixed(1))}
            {fieldRow("Composite", `${ivLabel} (${ivComp.toFixed(2)})`)}
          </div>
          {ivLabel && (IV_EXPLANATIONS[ivLabel] || IV_EXPLANATIONS.Moderate) && (
            <div style={{
              fontSize:     theme.size.sm,
              color:        theme.text.muted,
              lineHeight:   1.6,
              padding:      `${theme.space[2]}px ${theme.space[3]}px`,
              background:   theme.bg.surface,
              borderRadius: theme.radius.sm,
              border:       `1px solid ${theme.border.default}`,
            }}>
              {(IV_EXPLANATIONS[ivLabel] ?? IV_EXPLANATIONS.Moderate)(ticker, iv, iv_rank, ivComp)}
            </div>
          )}
        </>
      ) : (
        <div style={{ fontSize: theme.size.sm, color: theme.text.subtle }}>IV data pending</div>
      )}

      {/* ── Current Positions section ── */}
      <div style={sectionLabelStyle}>Current Positions</div>
      {indicators.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.space[2] }}>

          {/* Shares */}
          {sharePos && (
            <div style={{ display: "flex", gap: theme.space[3], flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: theme.size.sm, color: theme.text.secondary, fontWeight: 600 }}>📌 Shares</span>
              {sharePos.cost_basis_total != null && fieldRow("Collateral", `$${sharePos.cost_basis_total.toLocaleString()}`)}
            </div>
          )}

          {/* CC nested in shares */}
          {sharePos?.active_cc && (() => {
            const cc = sharePos.active_cc;
            return (
              <div style={{ display: "flex", gap: theme.space[3], flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: theme.size.sm, color: theme.text.secondary, fontWeight: 600 }}>🔼 CC</span>
                {cc.strike != null && fieldRow("Strike", `$${cc.strike}`)}
                {cc.contracts != null && fieldRow("Contracts", cc.contracts)}
                {cc.expiry_date && fieldRow("Expiry", cc.expiry_date)}
                {cc.days_to_expiry != null && fieldRow("DTE", cc.days_to_expiry)}
                {cc.premium_collected != null && fieldRow("Premium", `$${cc.premium_collected.toLocaleString()}`)}
              </div>
            );
          })()}

          {/* CSPs */}
          {cspPositions.map((csp, i) => (
            <div key={i} style={{ display: "flex", gap: theme.space[3], flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: theme.size.sm, color: theme.text.secondary, fontWeight: 600 }}>📋 CSP</span>
              {csp.strike != null && fieldRow("Strike", `$${csp.strike}`)}
              {csp.contracts != null && fieldRow("Contracts", csp.contracts)}
              {csp.expiry_date && fieldRow("Expiry", csp.expiry_date)}
              {csp.days_to_expiry != null && fieldRow("DTE", csp.days_to_expiry)}
              {csp.premium_collected != null && fieldRow("Premium", `$${csp.premium_collected.toLocaleString()}`)}
              {csp.capital_fronted != null && fieldRow("Collateral", `$${csp.capital_fronted.toLocaleString()}`)}
            </div>
          ))}

          {/* LEAPS */}
          {allLeaps.map((leap, i) => (
            <div key={i} style={{ display: "flex", gap: theme.space[3], flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: theme.size.sm, color: theme.text.secondary, fontWeight: 600 }}>🔭 LEAPS</span>
              {leap.strike != null && fieldRow("Strike", `$${leap.strike}`)}
              {leap.contracts != null && fieldRow("Contracts", leap.contracts)}
              {leap.expiry_date && fieldRow("Expiry", leap.expiry_date)}
              {leap.entry_cost != null && fieldRow("Cost", `$${leap.entry_cost.toLocaleString()}`)}
            </div>
          ))}

        </div>
      ) : (
        <div style={{ fontSize: theme.size.sm, color: theme.text.subtle }}>
          No current positions in this ticker
        </div>
      )}

      {/* ── Scanner Score section ── */}
      <div style={sectionLabelStyle}>Scanner Score</div>
      {score != null && bb_position != null && ivComp != null ? (
        <div style={{ display: "flex", gap: theme.space[4], flexWrap: "wrap", alignItems: "center" }}>
          {fieldRow("Score", `${score.toFixed(3)} (${label})`)}
          <span style={{ ...monoStyle, color: theme.text.subtle }}>
            BB component: {((1 - bb_position) * 0.5).toFixed(3)}
          </span>
          <span style={{ ...monoStyle, color: theme.text.subtle }}>
            IV component: {(ivComp * 0.5).toFixed(3)}
          </span>
          <span style={{ ...monoStyle, color: theme.text.subtle }}>
            Combined: {score.toFixed(3)}
          </span>
        </div>
      ) : (
        <div style={{ fontSize: theme.size.sm, color: theme.text.subtle }}>
          Insufficient data to compute score
        </div>
      )}

      {/* ── Valuation section ── */}
      <div style={sectionLabelStyle}>Valuation</div>
      {pe_ttm != null || pe_annual != null || eps_ttm != null ? (
        <div style={{ display: "flex", gap: theme.space[4], flexWrap: "wrap" }}>
          {pe_ttm    != null && fieldRow("P/E TTM",    pe_ttm.toFixed(1))}
          {pe_annual != null && fieldRow("P/E Annual",  pe_annual.toFixed(1))}
          {eps_ttm   != null && fieldRow("EPS TTM",    `$${eps_ttm.toFixed(2)}`)}
        </div>
      ) : (
        <div style={{ fontSize: theme.size.sm, color: theme.text.subtle }}>Valuation data pending</div>
      )}

      {/* ── Earnings section ── */}
      <div style={sectionLabelStyle}>Earnings</div>
      {earningsDate ? (
        <div style={{ display: "flex", alignItems: "center", gap: theme.space[2], ...monoStyle }}>
          <span style={{ color: theme.text.subtle }}>Next earnings:</span>
          <span style={{ color: theme.text.secondary }}>{earningsDate}</span>
          {daysAway != null && (
            <span style={{ color: theme.text.muted }}>({daysAway} days away)</span>
          )}
          {daysAway != null && daysAway <= 21 ? (
            <span style={{ color: theme.amber, fontWeight: 600 }}>⚠</span>
          ) : (
            <span style={{ color: theme.green }}>✓</span>
          )}
        </div>
      ) : (
        <div style={{ fontSize: theme.size.sm, color: theme.text.subtle }}>No earnings date available</div>
      )}
    </div>
  );
}

// ── Filter button ─────────────────────────────────────────────────────────────

function FilterBtn({ label, active, onClick }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background:   active ? theme.bg.elevated : hovered ? "rgba(58,130,246,0.06)" : "transparent",
        border:       `1px solid ${active ? theme.border.strong : theme.border.default}`,
        borderRadius: theme.radius.sm,
        color:        active ? theme.text.primary : theme.text.muted,
        fontSize:     theme.size.sm,
        fontFamily:   "inherit",
        cursor:       "pointer",
        padding:      `2px ${theme.space[2]}px`,
        fontWeight:   active ? 600 : 400,
        transition:   "all 0.1s",
      }}
    >
      {label}
    </button>
  );
}

// ── Sort button ───────────────────────────────────────────────────────────────
// Tri-state: first click → default dir, second click → reversed, third → off.

const SORT_DEFAULT_DIR = {
  score:        "desc",
  bb:           "asc",
  iv_rank:      "desc",
  iv_raw:       "desc",
  iv_composite: "desc",
  pe:           "asc",
};

function SortBtn({ id, label, sortBy, setSortBy }) {
  const active = sortBy?.id === id;
  const dir    = active ? sortBy.dir : null;
  const arrow  = dir === "asc" ? " ▲" : dir === "desc" ? " ▼" : "";

  function handleClick() {
    if (!active) {
      // Inactive → default direction
      setSortBy({ id, dir: SORT_DEFAULT_DIR[id] ?? "desc" });
    } else {
      // Active → flip direction
      setSortBy({ id, dir: dir === "asc" ? "desc" : "asc" });
    }
  }

  return (
    <FilterBtn
      label={`${label}${arrow}`}
      active={active}
      onClick={handleClick}
    />
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function RadarTab({ positions = null }) {
  const { rows, loading, error } = useRadar();

  const [marketContext, setMarketContext]       = useState(null);
  const [bbFilter, setBbFilter]                 = useState("all");
  const [sortBy, setSortBy]                     = useState({ id: "score", dir: "desc" });
  const [expandedTicker, setExpandedTicker]     = useState(null);
  const [advancedFilters, setAdvancedFilters]   = useState(DEFAULT_FILTERS);
  const [filtersExpanded, setFiltersExpanded]   = useState(false);
  const [presets, setPresets]                   = useState([]);
  const [activePresetId, setActivePresetId]     = useState(null);
  const [saveModalOpen, setSaveModalOpen]       = useState(false);

  useEffect(() => {
    if (!import.meta.env.PROD) {
      setMarketContext(marketContextDev);
      return;
    }
    fetch("/api/focus-context")
      .then(r => r.json())
      .then(data => { if (data.ok && data.marketContext) setMarketContext(data.marketContext); })
      .catch(err => console.warn("[RadarTab] market context fetch failed:", err.message));
  }, []);

  // Load presets from Supabase
  useEffect(() => {
    supabase.from('radar_presets').select('*').order('display_order', { ascending: true })
      .then(({ data }) => { if (data) setPresets(data); });
  }, []);

  // BB data freshness
  const bbAsOf = useMemo(() => {
    const withTs = rows.filter(r => r.bb_refreshed_at);
    if (!withTs.length) return null;
    return withTs.reduce((latest, r) =>
      r.bb_refreshed_at > latest ? r.bb_refreshed_at : latest,
      withTs[0].bb_refreshed_at
    );
  }, [rows]);

  const bbAsOfLabel = useMemo(() => {
    if (!bbAsOf) return null;
    const d = new Date(bbAsOf);
    return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  }, [bbAsOf]);

  const bbAsOfStale = useMemo(() => {
    if (!bbAsOf) return false;
    return (new Date() - new Date(bbAsOf)) / (1000 * 60 * 60) > 2.5;
  }, [bbAsOf]);

  // Filter handlers
  function updateFilter(field, value) {
    setActivePresetId(null); // deactivate preset on any manual filter change
    setAdvancedFilters(prev => ({ ...prev, [field]: value }));
  }

  function applyPreset(preset) {
    if (!preset) {
      setActivePresetId(null);
      setAdvancedFilters(DEFAULT_FILTERS);
      return;
    }
    setActivePresetId(preset.id);
    setAdvancedFilters({ ...DEFAULT_FILTERS, ...preset.filters });
  }

  // Filter + sort
  const processedRows = useMemo(() => {
    let result = [...rows];

    // 1. BB bucket filter
    if (bbFilter !== "all") {
      result = result.filter(r => bbBucket(r.bb_position) === bbFilter);
    }

    // 2. Advanced filters
    const f = advancedFilters;
    const includeSectors = expandGroupsToSectors(f.sectors_include);
    const excludeSectors = expandGroupsToSectors(f.sectors_exclude);

    result = result.filter(row => {
      if (f.bb_position_min  !== null && row.bb_position < f.bb_position_min)  return false;
      if (f.bb_position_max  !== null && row.bb_position > f.bb_position_max)  return false;
      if (f.raw_iv_min       !== null && row.iv          < f.raw_iv_min)        return false;
      if (f.raw_iv_max       !== null && row.iv          > f.raw_iv_max)        return false;
      const civ = compositeIv(row.iv, row.iv_rank);
      if (f.composite_iv_min !== null && civ             < f.composite_iv_min)  return false;
      if (f.composite_iv_max !== null && civ             > f.composite_iv_max)  return false;
      if (f.iv_rank_min      !== null && row.iv_rank     < f.iv_rank_min)       return false;
      if (f.iv_rank_max      !== null && row.iv_rank     > f.iv_rank_max)       return false;
      // P/E — tickers with no P/E data pass the filter (unknown = no penalty)
      if (f.pe_min !== null && row.pe_ttm != null && row.pe_ttm < f.pe_min)  return false;
      if (f.pe_max !== null && row.pe_ttm != null && row.pe_ttm > f.pe_max)  return false;
      // Sectors
      if (includeSectors.length > 0) {
        if (!includeSectors.includes(row.sector)) return false;
      } else if (excludeSectors.length > 0) {
        if (excludeSectors.includes(row.sector)) return false;
      }
      // Ownership
      const isHeld = getPositionIndicators(row.ticker, positions).length > 0;
      if (f.ownership === 'not_held' && isHeld)  return false;
      if (f.ownership === 'held'     && !isHeld) return false;
      // Earnings
      if (f.earnings_days_min !== null) {
        const days = getEarningsDaysAway(row.ticker, marketContext);
        if (days !== null && days < f.earnings_days_min) return false;
      }
      return true;
    });

    // 3. Sort — sortBy is { id, dir } where dir is "asc" | "desc"
    if (sortBy) {
      const d = sortBy.dir === "asc" ? 1 : -1;  // multiplier: asc=1, desc=-1

      const getVal = {
        score:        r => scannerScore(r.bb_position, r.iv, r.iv_rank),
        bb:           r => r.bb_position,
        iv_rank:      r => r.iv_rank,
        iv_raw:       r => r.iv,
        iv_composite: r => compositeIv(r.iv, r.iv_rank),
        pe:           r => r.pe_ttm,
      }[sortBy.id];

      if (getVal) {
        result.sort((a, b) => {
          const va = getVal(a);
          const vb = getVal(b);
          if (va == null && vb == null) return 0;
          if (va == null) return 1;   // nulls always last
          if (vb == null) return -1;
          return (va - vb) * d;
        });
      }
    }

    return result;
  }, [rows, bbFilter, advancedFilters, sortBy, positions, marketContext]);

  const strongCount = useMemo(() =>
    processedRows.filter(r => scoreLabel(scannerScore(r.bb_position, r.iv, r.iv_rank)) === "Strong").length,
    [processedRows]
  );

  function handleRowToggle(ticker) {
    setExpandedTicker(prev => prev === ticker ? null : ticker);
  }

  const panelStyle = {
    background:   theme.bg.surface,
    border:       `1px solid ${theme.border.default}`,
    borderRadius: theme.radius.md,
    marginBottom: theme.space[4],
    overflow:     "hidden",
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: `${theme.space[6]}px 0`, color: theme.text.muted, fontSize: theme.size.md }}>
        Loading radar data...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ textAlign: "center", padding: `${theme.space[6]}px 0`, color: theme.red, fontSize: theme.size.md }}>
        {error}
      </div>
    );
  }

  return (
    <div>
      {/* ── Filter + sort bar ── */}
      <div style={{
        background:   theme.bg.surface,
        border:       `1px solid ${theme.border.default}`,
        borderRadius: theme.radius.md,
        padding:      `${theme.space[3]}px ${theme.space[4]}px`,
        marginBottom: theme.space[4],
      }}>

        {/* BB Position filters */}
        <div style={{ display: "flex", alignItems: "center", gap: theme.space[2], flexWrap: "wrap", marginBottom: theme.space[3] }}>
          <span style={{ fontSize: theme.size.sm, color: theme.text.subtle, marginRight: theme.space[1], flexShrink: 0 }}>
            BB Position:
          </span>
          <FilterBtn label="All" active={bbFilter === "all"} onClick={() => setBbFilter("all")} />
          {Object.entries(BB_BUCKET_LABELS).map(([key, label]) => (
            <FilterBtn key={key} label={label} active={bbFilter === key} onClick={() => setBbFilter(key)} />
          ))}
        </div>

        {/* Presets row */}
        <div style={{ marginBottom: theme.space[2] }}>
          <RadarPresetBar
            presets={presets}
            activePresetId={activePresetId}
            filtersExpanded={filtersExpanded}
            activeFilterCount={countActiveFilters(advancedFilters)}
            currentFilters={advancedFilters}
            onSelect={applyPreset}
            onPresetsChange={(next, nextActiveId) => {
              setPresets(next);
              setActivePresetId(nextActiveId);
            }}
            onToggleFilters={() => setFiltersExpanded(e => !e)}
            saveModalOpen={saveModalOpen}
            onSaveModalClose={() => setSaveModalOpen(false)}
          />
        </div>

        {/* Sort buttons row */}
        <div style={{ display: "flex", alignItems: "center", gap: theme.space[3], flexWrap: "wrap", marginBottom: theme.space[2] }}>
          <span style={{ fontSize: theme.size.sm, color: theme.text.subtle, flexShrink: 0 }}>Sort by:</span>
          <SortBtn id="score"        label="Scanner Score" sortBy={sortBy} setSortBy={setSortBy} />
          <SortBtn id="bb"           label="BB Position"   sortBy={sortBy} setSortBy={setSortBy} />
          <SortBtn id="iv_rank"      label="IV Rank"       sortBy={sortBy} setSortBy={setSortBy} />
          <SortBtn id="iv_raw"       label="Raw IV"        sortBy={sortBy} setSortBy={setSortBy} />
          <SortBtn id="iv_composite" label="Composite IV"  sortBy={sortBy} setSortBy={setSortBy} />
          <SortBtn id="pe"           label="P/E"           sortBy={sortBy} setSortBy={setSortBy} />
        </div>

        {/* Stats + BB freshness line */}
        <div style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>
          {bbAsOfLabel && (
            <span style={{ color: bbAsOfStale ? theme.amber : theme.text.subtle }}>
              {bbAsOfStale ? "⚠ " : ""}BB data as of: {bbAsOfLabel}
              {" · "}
            </span>
          )}
          <span>{processedRows.length} tickers</span>
          {strongCount > 0 && (
            <span style={{ color: theme.green }}> · {strongCount} strong candidates</span>
          )}
        </div>
      </div>

      {/* Advanced filters panel */}
      {filtersExpanded && (
        <RadarAdvancedFilters
          filters={advancedFilters}
          onChange={updateFilter}
          onClear={() => {
            setAdvancedFilters(DEFAULT_FILTERS);
            setActivePresetId(null);
          }}
          onSavePreset={() => setSaveModalOpen(true)}
        />
      )}

      {/* ── Rows ── */}
      <div style={panelStyle}>
        {processedRows.length === 0 ? (
          <div style={{ padding: `${theme.space[4]}px`, fontSize: theme.size.md, color: theme.text.subtle, textAlign: "center" }}>
            No tickers match the current filter.
          </div>
        ) : (
          processedRows.map(row => (
            <RadarRow
              key={row.ticker}
              row={row}
              positions={positions}
              marketContext={marketContext}
              expanded={expandedTicker === row.ticker}
              onToggle={() => handleRowToggle(row.ticker)}
              sortBy={sortBy}
            />
          ))
        )}
      </div>
    </div>
  );
}

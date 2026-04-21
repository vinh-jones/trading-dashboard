import { useState, useMemo, useEffect } from "react";
import marketContextDev from "../data/market-context.json";
import { theme } from "../lib/theme";
import { useRadar } from "../hooks/useRadar";
import { supabase } from "../lib/supabase";
import { DEFAULT_FILTERS, countActiveFilters, expandGroupsToSectors } from "./radar/radarConstants";
import RadarAdvancedFilters from "./radar/RadarAdvancedFilters";
import RadarPresetBar from "./radar/RadarPresetBar";
import { getVixBand } from "../lib/vixBand";
import { useRadarSamples } from "../hooks/useRadarSamples";
import { useIvTrends } from "../hooks/useIvTrends";

// ── Score computation ─────────────────────────────────────────────────────────

function compositeIv(iv, ivRank) {
  if (iv == null || ivRank == null) return null;
  return (ivRank / 100 * 0.60) + (Math.min(iv / 1.50, 1.0) * 0.40);
}

function getTrendState(price, ma50, ma200) {
  if (price == null) return null;
  const above200 = ma200 == null || price >= ma200;
  const above50  = ma50  == null || price >= ma50;
  if (above200 && above50)   return { state: "uptrend",   label: "Uptrend",    modifier: 1.00 };
  if (above200 && !above50)  return { state: "pullback",  label: "Pullback",   modifier: 0.90 };
  if (!above200 && above50)  return { state: "recovering",label: "Recovering", modifier: 0.85 };
  return                            { state: "downtrend", label: "Downtrend",  modifier: 0.70 };
}

function scannerScore(bbPosition, iv, ivRank, price, ma50, ma200, ivTrend) {
  if (bbPosition == null) return null;
  const ivComp  = compositeIv(iv, ivRank);
  if (ivComp == null) return null;
  const base    = (1 - bbPosition) * 0.50 + ivComp * 0.50;
  const trend   = getTrendState(price, ma50, ma200);
  const ivMod   = (ivTrend?.state && ivTrend.state !== "insufficient") ? (ivTrend.modifier ?? 1.0) : 1.0;
  return base * (trend?.modifier ?? 1.0) * ivMod;
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
  below_band: (ticker, bbPos, vixSentiment, ivLabel) =>
    `${ticker} is below its lower Bollinger Band (position: ${bbPos.toFixed(2)}) — ` +
    `price has moved two standard deviations to the downside, which Ryan targets as the ` +
    `primary CSP entry zone. 95% of the time, price reverts from here. ` +
    `${ivLabel === 'Weak'
      ? `IV is currently weak — wait for a vol spike or enter at reduced size.`
      : `Combined with ${ivLabel.toLowerCase()} IV, this is a high-conviction setup.`} ` +
    `Enter a CSP below the lower band strike, 20–30 delta, ~30 DTE. ` +
    `Re-evaluate if price breaks further below and stays there for 3+ days (trend breakdown, not reversion).`,

  near_lower: (ticker, bbPos, vixSentiment, ivLabel) =>
    `${ticker} is approaching its lower Bollinger Band (position: ${bbPos.toFixed(2)}). ` +
    `Price is pulling back toward statistical support but hasn't reached Ryan's preferred entry zone yet. ` +
    `${ivLabel === 'Strong' || ivLabel === 'Moderate'
      ? `IV conditions are favorable — a small starter position is reasonable here, with room to add if price reaches below the lower band.`
      : `IV is weak — hold off and let price come to you. Enter below the lower band, not approaching it.`} ` +
    `Watch for: BB position dropping below 0 (becomes high-conviction entry). ` +
    `Skip if: price is bouncing off support and heading back toward mid-band.`,

  mid_range: (ticker, bbPos, vixSentiment, ivLabel) =>
    `${ticker} is in the middle of its Bollinger Band range (position: ${bbPos.toFixed(2)}). ` +
    `No edge from price location — you're not buying fear or selling into extension. ` +
    `${ivLabel === 'Strong'
      ? `IV rank is elevated, which partially offsets the neutral price location. ` +
        `Consider a small position if IV rank is above 70 and a catalyst explains the vol premium.`
      : ivLabel === 'Weak'
      ? `Combined with weak IV, there's no edge here on either dimension. Skip for now.`
      : `IV is moderate — no strong case to enter. ` +
        `This name becomes actionable when BB position drops below 0.20, or IV rank climbs above 70.`} ` +
    `Next check: BB position < 0.20 OR IV rank > 70.`,

  near_upper: (ticker, bbPos, vixSentiment, ivLabel) =>
    `${ticker} is near its upper Bollinger Band (position: ${bbPos.toFixed(2)}). ` +
    `Price is extended to the upside — your strike would be far OTM and premium thins out significantly. ` +
    `Do not open a new CSP here. The risk/reward is inverted: limited premium, elevated assignment risk if the extension reverses. ` +
    `${ivLabel === 'Strong'
      ? `IV rank is elevated (likely from recent volatility driving the move). ` +
        `If you want exposure, wait for BB to pull back to mid-range (< 0.60) before entering.`
      : `Wait for a pullback to mid-band or below before considering entry.`} ` +
    `Next check: BB position drops below 0.60.`,

  above_band: (ticker, bbPos, vixSentiment, ivLabel) =>
    `${ticker} is above its upper Bollinger Band (position: ${bbPos.toFixed(2)}) — ` +
    `statistically extended beyond two standard deviations to the upside. ` +
    `Avoid new CSP entries. This is Ryan's signal to avoid, not enter — you'd be selling puts ` +
    `far below an overextended price that could reverse sharply. ` +
    `This zone is better suited for a bear call spread than a CSP. ` +
    `Next check: BB position drops below 0.80 (near_upper) before re-evaluating for CSP entry.`,
};

const IV_EXPLANATIONS = {
  Strong: (ticker, ivPct, ivRank, composite, vixSentiment) =>
    `IV rank ${ivRank.toFixed(1)} — options are in the upper tier of their 52-week history. ` +
    `Raw IV ${(ivPct * 100).toFixed(0)}% is meaningful in absolute dollar terms. ` +
    `${vixSentiment
      ? `At VIX ${vixSentiment}, elevated IV here is consistent with the broader fear environment — ` +
        `this is exactly when Ryan deploys. `
      : ``}` +
    `Strong conditions to sell premium. Full-size position appropriate if BB location confirms. ` +
    `Watch for IV compression after entry (normal) — don't close early just because IV drops. ` +
    `Composite: ${composite.toFixed(2)}.`,

  Moderate: (ticker, ivPct, ivRank, composite, vixSentiment) =>
    `IV rank ${ivRank.toFixed(1)} — around the midpoint of historical range. ` +
    `Raw IV ${(ivPct * 100).toFixed(0)}% is ${ivPct > 0.60 ? "meaningful" : "moderate"} in absolute terms. ` +
    `${vixSentiment
      ? `At VIX ${vixSentiment}, this IV level is acceptable for deployment. `
      : ``}` +
    `Acceptable to sell premium, but not a high-conviction IV setup. ` +
    `Reduce size by 25–30% vs a Strong IV name. Enter only if BB location is favorable (near_lower or below_band). ` +
    `Composite: ${composite.toFixed(2)}.`,

  Weak: (ticker, ivPct, ivRank, composite, vixSentiment) =>
    `IV rank ${ivRank.toFixed(1)} — near the cheapest options levels of the past year. ` +
    `Raw IV ${(ivPct * 100).toFixed(0)}% means premium is thin in absolute terms. ` +
    `${vixSentiment
      ? `Even with VIX ${vixSentiment}, this name's own IV isn't generating meaningful premium. `
      : ``}` +
    `Skip unless BB position is below the lower band AND you have a strong fundamental reason for the name. ` +
    `Wait for a vol event (earnings, macro shock) to reprice IV before entering. ` +
    `Composite: ${composite.toFixed(2)}.`,
};

// Hardcoded hex — intentional exception (like BB_BUCKET_COLORS)
const TREND_COLORS = {
  pullback:   { bg: "#2d2600", text: "#e3b341" },
  recovering: { bg: "#2d2600", text: "#e3b341" },
  downtrend:  { bg: "#3d1a1a", text: "#f85149" },
};

const TREND_EXPLANATIONS = {
  uptrend: (ticker, price, ma50, ma200) =>
    `${ticker} is above both its 50-day (${ma50 != null ? `$${ma50.toFixed(2)}` : "N/A"}) and 200-day (${ma200 != null ? `$${ma200.toFixed(2)}` : "N/A"}) moving averages — ` +
    `a healthy uptrend. Mean reversion setups work as intended here. No trend penalty applied. Modifier: 1.00×.`,

  pullback: (ticker, price, ma50, ma200) =>
    `${ticker} is in a pullback within a broader uptrend — price (${price != null ? `$${price.toFixed(2)}` : "N/A"}) has dropped below its 50-day (${ma50 != null ? `$${ma50.toFixed(2)}` : "N/A"}) ` +
    `but remains above its 200-day (${ma200 != null ? `$${ma200.toFixed(2)}` : "N/A"}). This is typically transient, not a structural breakdown. ` +
    `CSP entries still have mean-reversion support. Reduce size 10–15% vs a full uptrend setup. ` +
    `If price breaks below the 200-day, re-evaluate — that's the shift to structural downtrend. Modifier: 0.90×.`,

  recovering: (ticker, price, ma50, ma200) =>
    `${ticker} is recovering from a downtrend — price (${price != null ? `$${price.toFixed(2)}` : "N/A"}) has reclaimed its 50-day (${ma50 != null ? `$${ma50.toFixed(2)}` : "N/A"}) ` +
    `but remains below its 200-day (${ma200 != null ? `$${ma200.toFixed(2)}` : "N/A"}). The shorter-term trend has flipped ` +
    `but the longer-term trend hasn't confirmed yet. Size down 15–20% and watch for price to reclaim the 200-day as confirmation. Modifier: 0.85×.`,

  downtrend: (ticker, price, ma50, ma200) =>
    `${ticker} is in a structural downtrend — price (${price != null ? `$${price.toFixed(2)}` : "N/A"}) is below both its 50-day (${ma50 != null ? `$${ma50.toFixed(2)}` : "N/A"}) ` +
    `and 200-day (${ma200 != null ? `$${ma200.toFixed(2)}` : "N/A"}). This is not mean-reversion territory. A name below its lower Bollinger Band ` +
    `in a downtrend often continues lower rather than reverting. Ryan actively avoids these setups. ` +
    `Skip unless you have a specific fundamental thesis and are willing to size way down. ` +
    `Re-evaluate when price reclaims the 50-day MA. Modifier: 0.70×.`,
};

// Hardcoded hex — intentional exception (like BB_BUCKET_COLORS)
const IV_TREND_COLORS = {
  rising:     { bg: "#0d1f0d", text: "#3fb950" },
  falling:    { bg: "#2d2600", text: "#e3b341" },
  spiking:    { bg: "#2d2600", text: "#e3b341" },
  collapsing: { bg: "#2d2600", text: "#e3b341" },
};

const IV_TREND_EXPLANATIONS = {
  rising: (ticker, fiveDayChange, oneDayChange, vixSentiment) =>
    `IV rank has been rising ${fiveDayChange.toFixed(1)} points over the past 5 days — ` +
    `premium is getting richer on ${ticker}. This is a favorable IV trend for CSP entry: ` +
    `conditions are improving, not deteriorating. ` +
    `${vixSentiment ? `Consistent with the broader ${vixSentiment} environment. ` : ""}` +
    `Scanner score boosted 10%. Enter with confidence if BB position confirms.`,

  falling: (ticker, fiveDayChange) =>
    `IV rank has dropped ${Math.abs(fiveDayChange).toFixed(1)} points over the past 5 days — ` +
    `premium is compressing on ${ticker}. The window for rich premium may be narrowing. ` +
    `If you want this name, enter sooner rather than later. ` +
    `If IV rank drops below 30, consider waiting for the next vol event before entering. ` +
    `Scanner score reduced 10%.`,

  spiking: (ticker, fiveDayChange, oneDayChange) =>
    `IV rank surged ${oneDayChange != null ? oneDayChange.toFixed(1) : fiveDayChange.toFixed(1)} points in the past 24 hours on ${ticker} — ` +
    `an anomalous move that typically signals a catalyst, news event, or earnings approaching. ` +
    `Elevated IV creates rich premium, but the cause matters. ` +
    `Check: is there an earnings date within 14 days? Is there a macro event affecting this sector? ` +
    `Size down 15% until the catalyst is identified. Scanner score reduced 15%.`,

  collapsing: (ticker, fiveDayChange, oneDayChange) =>
    `IV rank dropped ${oneDayChange != null ? Math.abs(oneDayChange).toFixed(1) : Math.abs(fiveDayChange).toFixed(1)} points in the past 24 hours on ${ticker} — ` +
    `a sharp IV crush, typically following an earnings print or major news event. ` +
    `This is actually Ryan's preferred post-earnings entry setup: IV is still elevated ` +
    `relative to pre-event baseline but has shed the binary risk premium. ` +
    `If BB position is favorable, this may be an opportunity. ` +
    `Scanner score reduced 10% (compressing, but post-crush entries are still valid).`,
};

// ── VIX context line (new, for ExpandedPanel top) ────────────────────────────
function vixContextLine(vix, vixBand, ivRank) {
  if (!vix || !vixBand) return null;
  const deploymentVerb = vix >= 20
    ? `deploy aggressively (${vixBand.floorPct * 100}–${vixBand.ceilingPct * 100}% cash target)`
    : vix >= 15
    ? `deploy selectively (${vixBand.floorPct * 100}–${vixBand.ceilingPct * 100}% cash target)`
    : `hold patience — premiums are thin at this VIX level`;

  return `At VIX ${vix.toFixed(2)} (${vixBand.sentiment}): ${deploymentVerb}. ` +
    `IV rank ${ivRank != null ? ivRank.toFixed(1) : '—'} on this name is ` +
    `${ivRank >= 60 ? 'consistent with the elevated vol environment' :
      ivRank >= 40 ? 'moderate relative to the broader fear level' :
      'below what the macro environment would suggest — idiosyncratic, not macro-driven'}.`;
}

// ── Concentration check (new) ────────────────────────────────────────────────
function concentrationCheck(ticker, sharePos, cspPositions, allLeaps, accountValue) {
  if (!accountValue) return null;

  const sharesExposure = sharePos?.cost_basis_total ?? 0;
  const cspExposure    = (cspPositions || []).reduce((sum, p) => sum + (p.capital_fronted ?? 0), 0);
  const leapExposure   = (allLeaps || []).reduce((sum, l) => sum + (l.entry_cost ?? 0), 0);

  const totalExposure     = sharesExposure + cspExposure + leapExposure;
  const concentrationPct  = totalExposure / accountValue;

  const WARNING_THRESHOLD = 0.10;
  const HARD_CEILING      = 0.15;

  const typicalNewCsp  = accountValue * 0.05;
  const projectedPct   = (totalExposure + typicalNewCsp) / accountValue;

  if (totalExposure === 0) {
    return { status: 'none', concentrationPct: 0, message: null };
  }

  if (concentrationPct >= HARD_CEILING) {
    return {
      status: 'over_ceiling',
      concentrationPct,
      message: `${(concentrationPct * 100).toFixed(1)}% concentration — at hard ceiling (15%). ` +
        `Do not add. Consider reducing before next entry.`,
    };
  }

  if (projectedPct >= HARD_CEILING) {
    return {
      status: 'would_breach',
      concentrationPct,
      projectedPct,
      message: `Currently ${(concentrationPct * 100).toFixed(1)}% — a new standard CSP would push to ` +
        `~${(projectedPct * 100).toFixed(1)}%, approaching the 15% ceiling. ` +
        `Reduce size if entering.`,
    };
  }

  if (concentrationPct >= WARNING_THRESHOLD) {
    return {
      status: 'elevated',
      concentrationPct,
      message: `${(concentrationPct * 100).toFixed(1)}% concentration — above the 10% target. ` +
        `New entry possible but keep size small.`,
    };
  }

  return {
    status: 'ok',
    concentrationPct,
    message: `${(concentrationPct * 100).toFixed(1)}% concentration — within limits. ` +
        `Room for a standard position.`,
  };
}

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

// ── Scanner score formula display ────────────────────────────────────────────

function ScannerScoreFormula({ bbPosition, ivComp, priceTrend, ivTrend, score, label }) {
  const base = (1 - bbPosition) * 0.50 + ivComp * 0.50;

  const hasPriceMod = priceTrend != null && priceTrend.modifier !== 1.0;
  const hasIvMod    = ivTrend != null && ivTrend.state !== "insufficient" && ivTrend.modifier !== 1.0;
  const hasAnyMod   = hasPriceMod || hasIvMod;

  const labelColor = label === "Strong"   ? theme.green
                   : label === "Moderate" ? theme.blue
                   : label === "Neutral"  ? theme.text.muted
                   : theme.red;

  const monoSm  = { fontFamily: theme.font.mono, fontSize: theme.size.sm };
  const subStyle = { fontSize: theme.size.xs, color: theme.text.subtle, marginTop: 3, whiteSpace: "nowrap" };

  // Value column: formula term on top, label on bottom
  const Term = ({ value, sub, valueStyle = {} }) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <span style={{ ...monoSm, color: theme.text.secondary, ...valueStyle }}>{value}</span>
      <span style={subStyle}>{sub || " "}</span>
    </div>
  );

  // Operator: sits at value level, invisible spacer below keeps label row aligned
  const Op = ({ sym }) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <span style={{ ...monoSm, color: theme.text.subtle }}>{sym}</span>
      <span style={{ ...subStyle, visibility: "hidden" }}>x</span>
    </div>
  );

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: theme.space[1] }}>
      <Term value={`(1 − ${bbPosition.toFixed(3)}) × 0.50`} sub="BB component" />
      <Op sym="+" />
      <Term value={`${ivComp.toFixed(3)} × 0.50`} sub="IV component" />
      <Op sym="=" />
      <Term
        value={base.toFixed(3)}
        sub={hasAnyMod ? "base" : ""}
        valueStyle={{ color: hasAnyMod ? theme.text.muted : theme.text.primary, fontWeight: hasAnyMod ? 400 : 700 }}
      />
      {hasPriceMod && <>
        <Op sym="×" />
        <Term
          value={priceTrend.modifier.toFixed(2)}
          sub={priceTrend.label}
          valueStyle={{ color: priceTrend.state === "downtrend" ? theme.red : theme.amber }}
        />
      </>}
      {hasIvMod && <>
        <Op sym="×" />
        <Term
          value={ivTrend.modifier.toFixed(2)}
          sub={ivTrend.label}
          valueStyle={{ color: ivTrend.modifier > 1.0 ? theme.green : theme.amber }}
        />
      </>}
      {hasAnyMod && <>
        <Op sym="=" />
        <Term value={score.toFixed(3)} sub="final" valueStyle={{ color: theme.text.primary, fontWeight: 700 }} />
      </>}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ ...monoSm, color: labelColor, fontWeight: 700, paddingLeft: 4 }}>({label})</span>
        <span style={{ ...subStyle, visibility: "hidden" }}>x</span>
      </div>
    </div>
  );
}

// ── Compact row ───────────────────────────────────────────────────────────────

function RadarRow({ row, sample, positions, marketContext, expanded, onToggle, sortBy, account, ivTrend }) {
  const { ticker, company, sector, last, iv, iv_rank, bb_position, bb_upper, bb_lower, bb_sma20, bb_refreshed_at, pe_ttm, ma_50, ma_200 } = row;
  const bucket   = bbBucket(bb_position);
  const score    = scannerScore(bb_position, iv, iv_rank, last, ma_50, ma_200, ivTrend);
  const ivComp   = compositeIv(iv, iv_rank);
  const trend    = getTrendState(last, ma_50, ma_200);
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
          flexDirection: "column",
          gap:           theme.space[1],
          padding:       `${theme.space[2]}px ${theme.space[3]}px`,
          background:    expanded ? theme.bg.elevated : rowBg,
          borderBottom:  `1px solid ${theme.border.default}`,
          cursor:        "pointer",
          transition:    "background 0.1s",
        }}
      >
        {/* Row 1: ticker · indicators · BB badge · spacer · score bar · caret */}
        <div style={{ display: "flex", alignItems: "center", gap: theme.space[2] }}>
          {/* Ticker */}
          <span style={{
            fontSize:   theme.size.md,
            fontWeight: 700,
            color:      theme.text.primary,
            flexShrink: 0,
          }}>
            {ticker}
          </span>

          {/* Left-rail position/earnings indicators */}
          {(indicators.length > 0 || earningsWarn) && (
            <div style={{
              display:    "inline-flex",
              alignItems: "center",
              gap:        theme.space[1],
              fontSize:   theme.size.xs,
              flexShrink: 0,
              color:      theme.text.muted,
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

          {/* Trend badge — only shown when not uptrend */}
          {trend && trend.state !== "uptrend" && TREND_COLORS[trend.state] && (
            <span style={{
              fontSize:     theme.size.xs,
              fontWeight:   600,
              color:        TREND_COLORS[trend.state].text,
              background:   TREND_COLORS[trend.state].bg,
              borderRadius: theme.radius.pill,
              padding:      "2px 8px",
              flexShrink:   0,
            }}>
              {trend.label}
            </span>
          )}

          {/* IV trend badge — only shown when not stable or insufficient */}
          {ivTrend && ivTrend.state !== "stable" && ivTrend.state !== "insufficient" && IV_TREND_COLORS[ivTrend.state] && (
            <span style={{
              fontSize:     theme.size.xs,
              fontWeight:   600,
              color:        IV_TREND_COLORS[ivTrend.state].text,
              background:   IV_TREND_COLORS[ivTrend.state].bg,
              borderRadius: theme.radius.pill,
              padding:      "2px 8px",
              flexShrink:   0,
            }}>
              {ivTrend.label}
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

        {/* Row 2: BB value · IV · IVR · IVC · P/E */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: theme.space[2] }}>
          {bb_position != null && (
            <span style={{ fontSize: theme.size.sm, color: theme.text.muted, flexShrink: 0, ...highlight("bb") }}>
              BB: {bb_position.toFixed(2)}
            </span>
          )}
          <span style={{ fontSize: theme.size.sm, color: theme.text.muted, flexShrink: 0, ...highlight("iv_raw") }}>
            {iv != null ? `IV: ${Math.round(iv * 100)}%` : "IV pending"}
          </span>
          {iv_rank != null && (
            <span style={{ fontSize: theme.size.sm, color: theme.text.muted, flexShrink: 0, ...highlight("iv_rank") }}>
              IVR: {iv_rank.toFixed(1)}
            </span>
          )}
          {ivComp != null && (
            <span style={{ fontSize: theme.size.sm, color: theme.text.muted, flexShrink: 0, ...highlight("iv_composite") }}>
              IVC: {ivComp.toFixed(2)}
            </span>
          )}
          {pe_ttm != null && (
            <span style={{ fontSize: theme.size.sm, color: theme.text.muted, flexShrink: 0, ...highlight("pe") }}>
              P/E: {pe_ttm.toFixed(1)}
            </span>
          )}
        </div>

        {/* Row 3: sample CSP line */}
        {sample?.status === "ok" ? (() => {
          const ror = (sample.mid * 100 / sample.collateral) * 100;
          const collatStr = sample.collateral >= 1000
            ? `$${(sample.collateral / 1000).toFixed(1)}k`
            : `$${sample.collateral}`;
          const deltaLabel = sample.delta != null ? `${Math.round(sample.delta * 100)}Δ` : null;
          const label = [sample.dte != null ? `${sample.dte}DTE` : null, deltaLabel, "CSP"].filter(Boolean).join(" ");
          return (
            <div style={{ display: "flex", alignItems: "center", gap: theme.space[2] }}>
              <span style={{ fontSize: theme.size.sm, color: theme.text.subtle, flexShrink: 0 }}>
                {label}:
              </span>
              <span style={{ fontSize: theme.size.sm, color: theme.text.muted }}>
                <span style={{ color: theme.text.primary, fontWeight: 600 }}>${sample.strike}p</span>
                {" · "}
                <span style={{ color: theme.text.secondary }}>${sample.mid.toFixed(2)}</span>
                {" · "}
                {ror.toFixed(1)}% RoR
                {" · "}
                {collatStr}
              </span>
            </div>
          );
        })() : sample?.status === "no_suitable_strike" ? (
          <div style={{ fontSize: theme.size.sm, color: theme.text.subtle, fontStyle: "italic" }}>
            CSP: no 25–35δ strike found
          </div>
        ) : null}
      </div>

      {/* Expanded detail panel */}
      {expanded && (
        <ExpandedPanel
          row={row}
          sample={sample}
          indicators={indicators}
          positions={positions}
          marketContext={marketContext}
          bucket={bucket}
          score={score}
          account={account}
          ivTrend={ivTrend}
        />
      )}
    </div>
  );
}

// ── Expanded detail panel ─────────────────────────────────────────────────────

function ExpandedPanel({ row, sample, indicators, positions, marketContext, bucket, score, account, ivTrend }) {
  const { ticker, company, sector, last, iv, iv_rank, bb_position, bb_upper, bb_lower, bb_sma20, pe_ttm, pe_annual, eps_ttm, ma_50, ma_200 } = row;
  const trend = getTrendState(last, ma_50, ma_200);

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
  // For template selection, collapse Neutral → Moderate. Leave scoreLabel unchanged so
  // the row-level visual pill still shows "Neutral" on the compact row.
  const ivLabelForTemplate = ivLabel === "Neutral" ? "Moderate" : ivLabel;
  const vixSentiment       = getVixBand(account?.vix_current)?.sentiment ?? null;

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

      {/* ── VIX context line ── */}
      {(() => {
        const vix     = account?.vix_current;
        const vixBand = getVixBand(vix);
        const line    = vixContextLine(vix, vixBand, iv_rank);
        if (!line) return null;
        return (
          <div style={{
            fontSize:     theme.size.sm,
            color:        theme.text.secondary,
            lineHeight:   1.6,
            padding:      `${theme.space[2]}px ${theme.space[3]}px`,
            background:   theme.bg.surface,
            borderLeft:   `3px solid ${theme.blue}`,
            borderRadius: theme.radius.sm,
            marginTop:    theme.space[3],
            marginBottom: theme.space[3],
          }}>
            {line}
          </div>
        );
      })()}

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
          {BB_EXPLANATIONS[bucket](ticker, bb_position, vixSentiment, ivLabelForTemplate)}
        </div>
      )}

      {/* ── Trend Context section ── */}
      <div style={sectionLabelStyle}>Trend Context</div>
      {trend ? (
        <>
          <div style={{ display: "flex", gap: theme.space[4], flexWrap: "wrap", marginBottom: theme.space[2] }}>
            {fieldRow("Price",    last   != null ? `$${last.toFixed(2)}`   : null)}
            {fieldRow("50-day MA", ma_50  != null ? `$${ma_50.toFixed(2)}`  : "—")}
            {fieldRow("200-day MA",ma_200 != null ? `$${ma_200.toFixed(2)}` : "—")}
            <span style={{ ...monoStyle }}>
              <span style={{ color: theme.text.subtle }}>State: </span>
              <span style={{
                color: trend.state === "uptrend"   ? theme.green
                     : trend.state === "downtrend" ? theme.red
                     : theme.amber,
                fontWeight: 600,
              }}>
                {trend.label}
              </span>
              <span style={{ color: theme.text.subtle }}> · {trend.modifier.toFixed(2)}× modifier</span>
            </span>
          </div>
          <div style={{
            fontSize:     theme.size.sm,
            color:        theme.text.muted,
            lineHeight:   1.6,
            padding:      `${theme.space[2]}px ${theme.space[3]}px`,
            background:   theme.bg.surface,
            borderRadius: theme.radius.sm,
            border:       `1px solid ${theme.border.default}`,
          }}>
            {TREND_EXPLANATIONS[trend.state](ticker, last, ma_50, ma_200)}
          </div>
        </>
      ) : (
        <div style={{ fontSize: theme.size.sm, color: theme.text.subtle }}>Trend data pending</div>
      )}

      {/* ── IV Trend section — only rendered when non-stable/non-null ── */}
      {ivTrend && ivTrend.state !== "stable" && (
        <>
          <div style={sectionLabelStyle}>IV Trend</div>
          {ivTrend.state === "insufficient" ? (
            <div style={{ fontSize: theme.size.sm, color: theme.text.subtle }}>
              Only {ivTrend.dataPoints} data point{ivTrend.dataPoints === 1 ? "" : "s"} available — insufficient history for trend analysis. Check back after 24–48 hours.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: theme.space[4], flexWrap: "wrap", marginBottom: theme.space[2] }}>
                {fieldRow("IV Rank today", iv_rank != null ? iv_rank.toFixed(1) : null)}
                {fieldRow("5-day change", ivTrend.fiveDayChange != null ? `${ivTrend.fiveDayChange > 0 ? "+" : ""}${ivTrend.fiveDayChange.toFixed(1)} pts` : null)}
                {ivTrend.oneDayChange != null && fieldRow("1-day change", `${ivTrend.oneDayChange > 0 ? "+" : ""}${ivTrend.oneDayChange.toFixed(1)} pts`)}
                <span style={{ ...monoStyle }}>
                  <span style={{ color: theme.text.subtle }}>State: </span>
                  <span style={{
                    color:      IV_TREND_COLORS[ivTrend.state]?.text ?? theme.text.secondary,
                    fontWeight: 600,
                  }}>
                    {ivTrend.label}
                  </span>
                  <span style={{ color: theme.text.subtle }}> · {ivTrend.modifier.toFixed(2)}× modifier</span>
                </span>
              </div>
              {IV_TREND_EXPLANATIONS[ivTrend.state] && (
                <div style={{
                  fontSize:     theme.size.sm,
                  color:        theme.text.muted,
                  lineHeight:   1.6,
                  padding:      `${theme.space[2]}px ${theme.space[3]}px`,
                  background:   theme.bg.surface,
                  borderRadius: theme.radius.sm,
                  border:       `1px solid ${theme.border.default}`,
                }}>
                  {IV_TREND_EXPLANATIONS[ivTrend.state](ticker, ivTrend.fiveDayChange, ivTrend.oneDayChange, vixSentiment)}
                </div>
              )}
            </>
          )}
        </>
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
          {sample?.status === "ok" && (
            <div style={{
              display:      "flex",
              gap:          theme.space[4],
              flexWrap:     "wrap",
              marginTop:    theme.space[2],
              marginBottom: theme.space[2],
            }}>
              {fieldRow("Sample", `$${sample.strike}p @ $${sample.mid.toFixed(2)} mid`)}
              {fieldRow("DTE",    `${sample.dte}d`)}
              {fieldRow("Delta",  `${(sample.delta * 100).toFixed(0)}δ`)}
              {fieldRow("RoR",    `${((sample.mid * 100 / sample.collateral) * 100).toFixed(2)}%`)}
              {fieldRow("Collateral", `$${sample.collateral.toLocaleString()}`)}
            </div>
          )}
          {sample?.status === "no_suitable_strike" && (
            <div style={{
              fontSize:   theme.size.sm,
              color:      theme.text.subtle,
              marginTop:  theme.space[2],
              fontStyle:  "italic",
            }}>
              No strike in the 25–35δ window at {sample.dte ?? "~30"}-day expiry. Illiquid chain or extreme IV.
            </div>
          )}
          {ivLabel && IV_EXPLANATIONS[ivLabelForTemplate] && (
            <div style={{
              fontSize:     theme.size.sm,
              color:        theme.text.muted,
              lineHeight:   1.6,
              padding:      `${theme.space[2]}px ${theme.space[3]}px`,
              background:   theme.bg.surface,
              borderRadius: theme.radius.sm,
              border:       `1px solid ${theme.border.default}`,
            }}>
              {(IV_EXPLANATIONS[ivLabelForTemplate] ?? IV_EXPLANATIONS.Moderate)(ticker, iv, iv_rank, ivComp, vixSentiment)}
            </div>
          )}
        </>
      ) : (
        <div style={{ fontSize: theme.size.sm, color: theme.text.subtle }}>IV data pending</div>
      )}

      {/* ── Current Positions section ── */}
      <div style={sectionLabelStyle}>Current Positions</div>
      {(() => {
        const concentration = concentrationCheck(ticker, sharePos, cspPositions, allLeaps, account?.account_value);
        if (!concentration?.message) return null;
        const color =
          concentration.status === 'over_ceiling' ? theme.red :
          concentration.status === 'ok'           ? theme.green :
                                                    theme.amber;
        return (
          <div style={{
            fontSize:     theme.size.sm,
            color,
            lineHeight:   1.5,
            marginBottom: theme.space[2],
          }}>
            {concentration.message}
          </div>
        );
      })()}
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
        <ScannerScoreFormula
          bbPosition={bb_position}
          ivComp={ivComp}
          priceTrend={trend}
          ivTrend={ivTrend}
          score={score}
          label={label}
        />
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

export function RadarTab({ positions = null, account = null }) {
  const { rows, loading, error } = useRadar();

  const allTickers = useMemo(() => rows.map(r => r.ticker).filter(Boolean), [rows]);
  const ivTrendsByTicker = useIvTrends(allTickers);

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
        score:        r => scannerScore(r.bb_position, r.iv, r.iv_rank, r.last, r.ma_50, r.ma_200, ivTrendsByTicker.get(r.ticker) ?? null),
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
  }, [rows, bbFilter, advancedFilters, sortBy, positions, marketContext, ivTrendsByTicker]);

  const strongCount = useMemo(() =>
    processedRows.filter(r => scoreLabel(scannerScore(r.bb_position, r.iv, r.iv_rank, r.last, r.ma_50, r.ma_200, ivTrendsByTicker.get(r.ticker) ?? null)) === "Strong").length,
    [processedRows, ivTrendsByTicker]
  );

  const visibleTickers = useMemo(
    () => (processedRows || []).map(r => r.ticker).filter(Boolean),
    [processedRows]
  );
  const { samplesByTicker, fetchedAt: samplesFetchedAt } = useRadarSamples(visibleTickers);

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
          {samplesFetchedAt && (
            <span style={{ color: theme.text.subtle, fontSize: theme.size.xs }}>
              {"Sample data as of: "}
              {new Date(samplesFetchedAt).toLocaleString()}
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
              sample={samplesByTicker.get(row.ticker) ?? null}
              positions={positions}
              marketContext={marketContext}
              expanded={expandedTicker === row.ticker}
              onToggle={() => handleRowToggle(row.ticker)}
              sortBy={sortBy}
              account={account}
              ivTrend={ivTrendsByTicker.get(row.ticker) ?? null}
            />
          ))
        )}
      </div>
    </div>
  );
}

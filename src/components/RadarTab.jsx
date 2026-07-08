import { useState, useMemo, useEffect } from "react";
import marketContextDev from "../data/market-context.json";
import { theme } from "../lib/theme";
import { useRadar } from "../hooks/useRadar";
import { supabase } from "../lib/supabase";
import { DEFAULT_FILTERS, countActiveFilters, expandGroupsToSectors } from "./radar/radarConstants";
import { bbBucket, BB_BUCKET_LABELS, BB_BUCKET_COLORS } from "../lib/bbBucket";
import { rsiBucket, RSI_BUCKET_LABELS, RSI_BUCKET_DEFINITIONS, RSI_BUCKET_COLORS } from "../lib/rsi";
import { compositeIv, getTrendState, entryScore, scoreLabel } from "../lib/entryScore";
import { rowMatchesFilters } from "../lib/radarFilter";
import { describeStrikeVsGex } from "../lib/gexLevels";
import { WhaleFlowPanel } from "./WhaleFlowPanel";
import { tickerExposure } from "../lib/exposure";
import RadarAdvancedFilters from "./radar/RadarAdvancedFilters";
import RadarPresetBar from "./radar/RadarPresetBar";
import { CURATED_PRESETS } from "./radar/curatedPresets";
import { getVixBand } from "../lib/vixBand";
import { useRadarSamples } from "../hooks/useRadarSamples";
import { useIvTrends } from "../hooks/useIvTrends";

// ── Score computation ─────────────────────────────────────────────────────────
// compositeIv, getTrendState, entryScore (formerly scannerScore), and scoreLabel
// now live in ../lib/entryScore (shared with the CSP selection calculator and
// ticker detail) and are imported above.

// ── Beta (market sensitivity) ───────────────────────────────────────────────────
// Beta is a stock-level statistic (not an option Greek): how much a name moves
// relative to the broader market (S&P 500). >1 amplifies market moves, <1 dampens
// them, <0 inverts. Slow-moving — sourced from the fundamentals ingest, not live.
function betaDescriptor(beta) {
  if (beta == null) return null;
  if (beta >= 1.3) return { label: "high-beta",    color: theme.amber,      note: "amplifies market moves" };
  if (beta >= 0.8) return { label: "market-like",  color: theme.text.muted, note: "tracks the market" };
  if (beta >= 0)   return { label: "low-beta",     color: theme.blue,       note: "dampens market moves" };
  return                  { label: "inverse",      color: theme.green,      note: "moves opposite the market" };
}

// ── BB bucket ─────────────────────────────────────────────────────────────────
// bbBucket(), BB_BUCKET_LABELS, and BB_BUCKET_COLORS now live in ../lib/bbBucket
// (shared with the AI Thesis page) and are imported above.

// One-line definitions shown as hover tooltips on the compact-row chips.
// Longer paragraph explanations live in BB_EXPLANATIONS below for the expanded panel.
const BB_BUCKET_DEFINITIONS = {
  below_band: "Price is below the lower Bollinger Band (>2σ down). Ryan's primary CSP entry zone — 95% mean-reversion historically.",
  near_lower: "Price approaching the lower Bollinger Band (0 ≤ pos < 0.20). Pulling back toward statistical support but not yet at the high-conviction entry zone.",
  mid_range:  "Price in the middle of the Bollinger Band range (0.20 ≤ pos < 0.80). No edge from price location — neither fear nor extension.",
  near_upper: "Price approaching the upper Bollinger Band (0.80 ≤ pos ≤ 1.0). Extended to the upside — premium thins and risk/reward inverts.",
  above_band: "Price is above the upper Bollinger Band (>2σ up). Statistically extended — avoid new CSP entries.",
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

// One-line definitions for the trend chips (compact-row tooltips).
const TREND_DEFINITIONS = {
  uptrend:    "Price above both the 50-day and 200-day moving averages — healthy uptrend, mean-reversion setups work as intended. 1.00× score modifier.",
  pullback:   "Price below the 50-day MA but above the 200-day — transient dip within a broader uptrend. Reduce size 10–15%. 0.90× score modifier.",
  recovering: "Price reclaimed the 50-day MA but is still below the 200-day — short-term trend flipped, long-term unconfirmed. Size down 15–20%. 0.85× score modifier.",
  downtrend:  "Price below both the 50-day and 200-day moving averages — structural downtrend. Mean-reversion unreliable; Ryan actively avoids these. 0.70× score modifier.",
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

// One-line definitions for the IV trend chips (compact-row tooltips).
const IV_TREND_DEFINITIONS = {
  rising:     "IV rank up ≥8 points over the past 5 days with raw IV also moving — premium is getting richer. Favorable for CSP entry. 1.10× score modifier.",
  falling:    "IV rank down ≥8 points over the past 5 days with raw IV also moving — premium is compressing. Window for rich premium may be narrowing. 0.90× score modifier.",
  spiking:    "IV rank surged ≥15 points in the past 24 hours — anomalous move, often signals a catalyst, news event, or upcoming earnings. Size down 15%. 0.85× score modifier.",
  collapsing: "IV rank dropped ≥15 points in the past 24 hours — typically post-earnings IV crush. Often Ryan's preferred post-event entry if BB position confirms. 0.90× score modifier.",
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

// ── GEX / dealer-gamma environment (Consumer 3) ──────────────────────────────
// Net-gamma regime from the per-strike profile (api/uw-gex → uw_signals).
// Compact-row chip is loud on choppy, subtle on stable, hidden on neutral.
const GEX_ENV_META = {
  stabilized: { label: "Gamma: Stable",  color: theme.green,      bg: theme.alert.successBg,
    tip: "Positive net dealer gamma — market-makers buy dips / sell rips, dampening moves. Ryan's preferred CSP regime." },
  choppy:     { label: "Gamma: Choppy",  color: theme.red,        bg: theme.alert.dangerBg,
    tip: "Negative net dealer gamma — market-makers amplify moves. Faster, gappier action and higher assignment risk; size down or wait." },
  neutral:    { label: "Gamma: Neutral", color: theme.text.muted, bg: theme.bg.surface,
    tip: "Dealer gamma roughly balanced — no strong stabilizing or accelerating bias." },
};

const GEX_EXPLANATIONS = {
  stabilized: (t) =>
    `${t} is in a positive net-gamma regime — dealers are net long gamma, so they buy dips and sell rips, ` +
    `dampening intraday moves. This is the CSP-friendly environment: price tends to grind and pin rather than gap. ` +
    `Sell with normal size if Bollinger position and IV confirm.`,
  choppy: (t) =>
    `${t} is in a negative net-gamma regime — dealers are net short gamma, so they sell into weakness and buy into ` +
    `strength, amplifying moves. Expect faster, gappier price action and elevated assignment risk on a sharp drop. ` +
    `Size down, or wait for the regime to flip positive.`,
  neutral: (t) =>
    `${t}'s dealer gamma is roughly balanced — no strong stabilizing or accelerating bias. Lean on Bollinger ` +
    `position, IV, and the gamma walls below for strike placement.`,
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

  const totalExposure     = tickerExposure(sharePos, cspPositions, allLeaps);
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

// Pill chip with a styled hover tooltip. Native `title` attributes were unreliable
// here (slow, sometimes silently dropped on small inline elements), so we render
// our own absolutely-positioned tooltip on mouseenter — same pattern as
// SectorTooltip in RadarAdvancedFilters.jsx.
function ChipWithTooltip({ label, tooltip, color, background }) {
  const [hovered, setHovered] = useState(false);
  return (
    <span
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position:     "relative",
        display:      "inline-block",
        fontSize:     theme.size.xs,
        fontWeight:   600,
        color,
        background,
        borderRadius: theme.radius.pill,
        padding:      "2px 8px",
        flexShrink:   0,
        cursor:       "help",
      }}
    >
      {label}
      {hovered && tooltip && (
        <span
          style={{
            position:      "absolute",
            top:           "calc(100% + 6px)",
            left:          "50%",
            transform:     "translateX(-50%)",
            background:    theme.bg.elevated,
            border:        `1px solid ${theme.border.strong}`,
            borderRadius:  theme.radius.md,
            padding:       `${theme.space[2]}px ${theme.space[3]}px`,
            zIndex:        300,
            minWidth:      220,
            maxWidth:      320,
            fontSize:      theme.size.xs,
            fontWeight:    400,
            color:         theme.text.secondary,
            lineHeight:    1.5,
            textAlign:     "left",
            whiteSpace:    "normal",
            pointerEvents: "none",
            boxShadow:     "0 4px 12px rgba(0,0,0,0.4)",
          }}
        >
          {tooltip}
        </span>
      )}
    </span>
  );
}

function RadarRow({ row, sample, positions, marketContext, expanded, onToggle, sortBy, account, ivTrend }) {
  const { ticker, company, sector, last, iv, iv_rank, bb_position, bb_upper, bb_lower, bb_sma20, bb_refreshed_at, pe_ttm, beta, ma_50, ma_200, rsi_14, gamma_env, flow_tape_ema, gex_env } = row;
  const bucket   = bbBucket(bb_position);
  const rsiBkt   = rsiBucket(rsi_14);
  // Entry-score flow nudge is a conviction consumer → keys off the SMOOTHED
  // full-tape reading (flow_tape_ema), null until sourced (flowMod is a no-op
  // until then). No streak gate here — the ±15% cap is the guardrail.
  const score    = entryScore(bb_position, iv, iv_rank, last, ma_50, ma_200, ivTrend, gamma_env, flow_tape_ema);
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
            <ChipWithTooltip
              label={BB_BUCKET_LABELS[bucket]}
              tooltip={BB_BUCKET_DEFINITIONS[bucket]}
              color={bucketColors.text}
              background={bucketColors.bg}
            />
          ) : (
            <span style={{ fontSize: theme.size.xs, color: theme.text.subtle, flexShrink: 0 }}>No BB data</span>
          )}

          {/* RSI badge — context only (not scored); shown only at actionable extremes */}
          {rsiBkt && rsiBkt !== "neutral" && RSI_BUCKET_COLORS[rsiBkt] && (
            <ChipWithTooltip
              label={`RSI ${RSI_BUCKET_LABELS[rsiBkt]}`}
              tooltip={RSI_BUCKET_DEFINITIONS[rsiBkt]}
              color={RSI_BUCKET_COLORS[rsiBkt].text}
              background={RSI_BUCKET_COLORS[rsiBkt].bg}
            />
          )}

          {/* Trend badge — only shown when not uptrend */}
          {trend && trend.state !== "uptrend" && TREND_COLORS[trend.state] && (
            <ChipWithTooltip
              label={trend.label}
              tooltip={TREND_DEFINITIONS[trend.state]}
              color={TREND_COLORS[trend.state].text}
              background={TREND_COLORS[trend.state].bg}
            />
          )}

          {/* IV trend badge — only shown when not stable or insufficient */}
          {ivTrend && ivTrend.state !== "stable" && ivTrend.state !== "insufficient" && IV_TREND_COLORS[ivTrend.state] && (
            <ChipWithTooltip
              label={ivTrend.label}
              tooltip={IV_TREND_DEFINITIONS[ivTrend.state]}
              color={IV_TREND_COLORS[ivTrend.state].text}
              background={IV_TREND_COLORS[ivTrend.state].bg}
            />
          )}

          {/* GEX dealer-gamma badge — loud on choppy, subtle on stable, hidden on neutral/none */}
          {gex_env && gex_env !== "neutral" && GEX_ENV_META[gex_env] && (
            <ChipWithTooltip
              label={GEX_ENV_META[gex_env].label}
              tooltip={GEX_ENV_META[gex_env].tip}
              color={GEX_ENV_META[gex_env].color}
              background={GEX_ENV_META[gex_env].bg}
            />
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
          {rsi_14 != null && (
            <span style={{ fontSize: theme.size.sm, color: rsiBkt && rsiBkt !== "neutral" ? RSI_BUCKET_COLORS[rsiBkt].text : theme.text.muted, flexShrink: 0, ...highlight("rsi") }}>
              RSI: {Math.round(rsi_14)}
            </span>
          )}
          <span style={{ fontSize: theme.size.sm, color: theme.text.muted, flexShrink: 0, ...highlight("iv_raw") }}>
            {iv != null ? `IV: ${Math.round(iv * 100)}%` : "IV pending"}
          </span>
          {iv_rank != null && (
            <span style={{ fontSize: theme.size.sm, color: theme.text.muted, flexShrink: 0, ...highlight("iv_rank") }}>
              IVR: {iv_rank.toFixed(1)}
              {ivTrend?.drift?.detected && (
                <span
                  title="IVR reading currently affected by window drift. See expanded panel for detail."
                  style={{
                    marginLeft: 4,
                    color:      theme.text.muted,
                    cursor:     "help",
                  }}
                  tabIndex={0}
                  aria-label="IV Rank affected by window drift"
                >
                  ⓘ
                </span>
              )}
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
          {beta != null && (
            <span
              title={`Beta — market sensitivity vs S&P 500 (${betaDescriptor(beta)?.label})`}
              style={{ fontSize: theme.size.sm, color: theme.text.muted, flexShrink: 0, ...highlight("beta") }}
            >
              β: {beta.toFixed(2)}
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
  const { ticker, company, sector, last, iv, iv_rank, bb_position, bb_upper, bb_lower, bb_sma20, rsi_14, pe_ttm, pe_annual, eps_ttm, beta, ma_50, ma_200, gex_env, gex_support, gex_resistance, gex_air_pocket } = row;
  const rsiBkt = rsiBucket(rsi_14);
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
        {rsi_14 != null && (
          <span style={{ ...monoStyle }} title={rsiBkt ? RSI_BUCKET_DEFINITIONS[rsiBkt] : undefined}>
            <span style={{ color: theme.text.subtle }}>RSI(14): </span>
            <span style={{ color: rsiBkt ? RSI_BUCKET_COLORS[rsiBkt].text : theme.text.primary }}>
              {Math.round(rsi_14)}{rsiBkt && rsiBkt !== "neutral" ? ` · ${RSI_BUCKET_LABELS[rsiBkt]}` : ""}
            </span>
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

      {/* ── IV Trend section ── */}
      {/* Renders when there's a non-stable trend, insufficient history,
          or window drift is flagged (drift can coexist with a "stable" label
          — the COHR case: IVR moved via window roll-off, not a vol event). */}
      {ivTrend && (ivTrend.state !== "stable" || ivTrend.drift?.detected) && (
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
                {iv != null && fieldRow("Raw IV", `${(iv * 100).toFixed(0)}%`)}
                <span style={{ ...monoStyle }}>
                  <span style={{ color: theme.text.subtle }}>State: </span>
                  <span style={{
                    color:      IV_TREND_COLORS[ivTrend.state]?.text ?? theme.text.secondary,
                    fontWeight: 600,
                  }}>
                    {ivTrend.label ?? "Stable"}
                    {ivTrend.drift?.detected && " — window drift detected"}
                  </span>
                  <span style={{ color: theme.text.subtle }}> · {ivTrend.modifier.toFixed(2)}× modifier</span>
                </span>
              </div>
              {ivTrend.drift?.detected && (
                <div style={{
                  fontSize:     theme.size.sm,
                  color:        theme.text.secondary,
                  lineHeight:   1.6,
                  padding:      `${theme.space[2]}px ${theme.space[3]}px`,
                  background:   theme.bg.elevated,
                  borderRadius: theme.radius.sm,
                  border:       `1px solid ${theme.border.strong}`,
                  marginBottom: theme.space[2],
                }}>
                  <div style={{ fontWeight: 600, color: theme.amber, marginBottom: theme.space[1] }}>
                    ⚠ IVR reading recently shifted by 52-week window change
                  </div>
                  {ticker}&apos;s IV Rank {ivTrend.drift.direction === "deflated" ? "dropped" : "rose"}{" "}
                  {Math.abs(ivTrend.drift.ivrChange).toFixed(1)} points over the past {ivTrend.drift.daysAgo} days
                  {iv != null ? ` while raw IV stayed flat at ~${(iv * 100).toFixed(0)}%` : " while raw IV stayed flat"}.
                  This happens when an extreme IV reading from ~52 weeks ago rolls off the lookback window.
                  <div style={{ marginTop: theme.space[2] }}>
                    Neither the old nor new IVR is &quot;wrong&quot; — they measure current IV against
                    different historical windows. The new reading reflects where IV sits relative to
                    a more recent baseline (the last 3–6 months) rather than including older extremes.
                  </div>
                  <div style={{ marginTop: theme.space[2] }}>
                    <strong style={{ color: theme.text.primary }}>How to read it:</strong>{" "}
                    {iv != null && <>Use raw IV (<strong style={{ color: theme.text.primary }}>{(iv * 100).toFixed(0)}%</strong>) as the absolute premium reading. </>}
                    Use current IVR ({iv_rank != null ? iv_rank.toFixed(0) : "—"}) for &quot;is this rich
                    relative to the recent regime.&quot; The pre-drift IVR is no longer a useful reference.
                  </div>
                </div>
              )}
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
              {ivTrend?.drift?.detected && (
                <div style={{ marginTop: theme.space[2], color: theme.amber }}>
                  ⚠ Note: IVR reading recently shifted by a 52-week window change —
                  see IV Trend section for context. Raw IV of {(iv * 100).toFixed(0)}%
                  is the more stable reading; the current IVR reflects a revised
                  historical baseline.
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div style={{ fontSize: theme.size.sm, color: theme.text.subtle }}>IV data pending</div>
      )}

      {/* ── Dealer Gamma (GEX) section ── */}
      {gex_env && GEX_ENV_META[gex_env] && (() => {
        const meta = GEX_ENV_META[gex_env];
        const fmt = (n) => (n == null ? "—" : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
        const sampleStrike = sample?.status === "ok" ? sample.strike : null;
        const strikeRead = sampleStrike != null
          ? describeStrikeVsGex({ strike: sampleStrike, support: gex_support, airPocket: gex_air_pocket })
          : null;
        const toneColor = strikeRead?.tone === "exposed" ? theme.red
          : strikeRead?.tone === "defended" ? theme.green
          : theme.text.secondary;
        return (
          <>
            <div style={sectionLabelStyle}>Dealer Gamma (GEX)</div>
            <div style={{ display: "flex", gap: theme.space[4], flexWrap: "wrap", marginBottom: theme.space[2] }}>
              <span style={{ ...monoStyle }}>
                <span style={{ color: theme.text.subtle }}>Environment: </span>
                <span style={{ color: meta.color, fontWeight: 600 }}>{meta.label.replace("Gamma: ", "")}</span>
              </span>
              {fieldRow("Resistance (+γ above)", fmt(gex_resistance))}
              {fieldRow("Support shelf (+γ below)", fmt(gex_support), theme.green)}
              {fieldRow("Air pocket (−γ below)", fmt(gex_air_pocket), theme.red)}
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
              {GEX_EXPLANATIONS[gex_env](ticker)}
              {strikeRead && (
                <div style={{ marginTop: theme.space[2], color: toneColor }}>
                  Sample ${sampleStrike}p: {strikeRead.text}
                </div>
              )}
            </div>
          </>
        );
      })()}

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
        <>
          <ScannerScoreFormula
            bbPosition={bb_position}
            ivComp={ivComp}
            priceTrend={trend}
            ivTrend={ivTrend}
            score={score}
            label={label}
          />
          {ivTrend?.drift?.detected && (
            <div style={{
              fontSize:   theme.size.xs,
              color:      theme.amber,
              lineHeight: 1.5,
              marginTop:  theme.space[2],
            }}>
              ⚠ IV component reflects a recently shifted IVR baseline — see IV Trend section
            </div>
          )}
          <div style={{
            fontSize:   theme.size.xs,
            color:      theme.text.subtle,
            lineHeight: 1.5,
            marginTop:  theme.space[2],
          }}>
            This score ranks <em>attractiveness</em> — it is not a deploy authorization. Your OTU checklist (chart, P/E, earnings beats, the 2%-on-30Δ rule) and VIX cash target sit above it.
          </div>
        </>
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

      {/* ── Market Sensitivity (beta) section ── */}
      {beta != null && (() => {
        const b = betaDescriptor(beta);
        return (
          <>
            <div style={sectionLabelStyle}>Market Sensitivity</div>
            <div style={{ display: "flex", gap: theme.space[4], flexWrap: "wrap", marginBottom: theme.space[2] }}>
              <span style={{ ...monoStyle }}>
                <span style={{ color: theme.text.subtle }}>Beta: </span>
                <span style={{ color: b.color, fontWeight: 600 }}>{beta.toFixed(2)}</span>
                <span style={{ color: theme.text.subtle }}> · {b.label}</span>
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
              {ticker} {b.note} — a 1% market move historically implies roughly a {Math.abs(beta).toFixed(1)}% move in this name (vs the S&P 500).{" "}
              {beta >= 1.3
                ? "Elevated assignment risk in a broad selloff; watch concentration across high-beta names — they fall together."
                : beta >= 0 && beta < 0.8
                ? "More defensive — tends to hold up better than the market in a drawdown."
                : "Roughly tracks the index, so it offers little diversification on a market move."}
            </div>
          </>
        );
      })()}

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
  beta:         "desc",
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

  // Tickers you currently hold — annotates the whale-flow feed. Tolerant of
  // either an array of positions or the grouped {csps, ccs, leaps, ...} shape.
  const heldTickers = useMemo(() => {
    const set = new Set();
    const add = (arr) => (arr ?? []).forEach((p) => p?.ticker && set.add(p.ticker));
    if (Array.isArray(positions)) add(positions);
    else if (positions && typeof positions === "object") {
      add(positions.csps); add(positions.ccs); add(positions.leaps);
      add(positions.open_csps); add(positions.open_leaps); add(positions.shares);
    }
    return set;
  }, [positions]);

  // Per-ticker entry score for the whale-flow shortlist join.
  const scoreByTicker = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const s = entryScore(r.bb_position, r.iv, r.iv_rank, r.last, r.ma_50, r.ma_200, ivTrendsByTicker.get(r.ticker) ?? null, r.gamma_env, r.flow_tape_ema);
      m.set(r.ticker, { label: scoreLabel(s), ivRank: r.iv_rank, score: s });
    }
    return m;
  }, [rows, ivTrendsByTicker]);

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

  const allPresets = useMemo(() => [...CURATED_PRESETS, ...presets], [presets]);

  const curatedCounts = useMemo(() => {
    const counts = {};
    for (const p of CURATED_PRESETS) {
      const pf = { ...DEFAULT_FILTERS, ...p.filters };
      const ctx = {
        isHeld:           (ticker) => getPositionIndicators(ticker, positions).length > 0,
        earningsDaysAway: (ticker) => getEarningsDaysAway(ticker, marketContext),
        ivTrend:          (ticker) => ivTrendsByTicker.get(ticker) ?? null,
        includeSectors:   expandGroupsToSectors(pf.sectors_include),
        excludeSectors:   expandGroupsToSectors(pf.sectors_exclude),
      };
      counts[p.id] = rows.filter(row => rowMatchesFilters(row, pf, ctx)).length;
    }
    return counts;
  }, [rows, positions, marketContext, ivTrendsByTicker]);

  // Filter + sort
  const processedRows = useMemo(() => {
    let result = [...rows];

    // 1. BB bucket filter
    if (bbFilter !== "all") {
      result = result.filter(r => bbBucket(r.bb_position) === bbFilter);
    }

    // 2. Advanced filters — delegated to the pure, tested helper.
    const f = advancedFilters;
    const ctx = {
      isHeld:           (ticker) => getPositionIndicators(ticker, positions).length > 0,
      earningsDaysAway: (ticker) => getEarningsDaysAway(ticker, marketContext),
      ivTrend:          (ticker) => ivTrendsByTicker.get(ticker) ?? null,
      includeSectors:   expandGroupsToSectors(f.sectors_include),
      excludeSectors:   expandGroupsToSectors(f.sectors_exclude),
    };
    result = result.filter(row => rowMatchesFilters(row, f, ctx));

    // 3. Sort — sortBy is { id, dir } where dir is "asc" | "desc"
    if (sortBy) {
      const d = sortBy.dir === "asc" ? 1 : -1;  // multiplier: asc=1, desc=-1

      const getVal = {
        score:        r => entryScore(r.bb_position, r.iv, r.iv_rank, r.last, r.ma_50, r.ma_200, ivTrendsByTicker.get(r.ticker) ?? null, r.gamma_env, r.flow_tape_ema),
        bb:           r => r.bb_position,
        rsi:          r => r.rsi_14,
        iv_rank:      r => r.iv_rank,
        iv_raw:       r => r.iv,
        iv_composite: r => compositeIv(r.iv, r.iv_rank),
        pe:           r => r.pe_ttm,
        beta:         r => r.beta,
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
    processedRows.filter(r => scoreLabel(entryScore(r.bb_position, r.iv, r.iv_rank, r.last, r.ma_50, r.ma_200, ivTrendsByTicker.get(r.ticker) ?? null, r.gamma_env, r.flow_tape_ema)) === "Strong").length,
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
      <WhaleFlowPanel heldTickers={heldTickers} scoreByTicker={scoreByTicker} />

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
            presets={allPresets}
            curatedCounts={curatedCounts}
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
          <SortBtn id="rsi"          label="RSI"           sortBy={sortBy} setSortBy={setSortBy} />
          <SortBtn id="iv_rank"      label="IV Rank"       sortBy={sortBy} setSortBy={setSortBy} />
          <SortBtn id="iv_raw"       label="Raw IV"        sortBy={sortBy} setSortBy={setSortBy} />
          <SortBtn id="iv_composite" label="Composite IV"  sortBy={sortBy} setSortBy={setSortBy} />
          <SortBtn id="pe"           label="P/E"           sortBy={sortBy} setSortBy={setSortBy} />
          <SortBtn id="beta"         label="Beta"          sortBy={sortBy} setSortBy={setSortBy} />
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

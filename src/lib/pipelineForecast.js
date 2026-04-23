/**
 * Pipeline Forecast v2 algorithm.
 *
 * Layered: (1) determine capture bucket from open-position state,
 * (2) look up expected-final-capture rate from calibration map
 * (with spec-starting-value fallback), (3) apply calendar-month timing
 * to separate expected realization from when it lands.
 *
 * See docs/pipeline_forecast_v2_spec.md and docs/pipeline_forecast_v2_backtest.md.
 */

// ── Tunable parameters (single source of truth) ─────────────────────────────
//
// Every magic number used by the forecast lives in FORECAST_PARAMS below. If
// you want to change the algorithm's behavior — bucket thresholds, VIX regime
// breakpoints, cross-month attribution weights — change it here, not inline.
// Each group carries a comment explaining what the numbers mean and the
// rationale for their current values, so the next person tuning the forecast
// (including future-you) has the "why" preserved alongside the "what".
//
// These are treated as constants, not config — changes should ship with test
// updates and a pipelineForecast.test.js run to confirm the intended effect.
export const FORECAST_PARAMS = {
  // Cap on how negative "expected remaining" can swing, as a fraction of
  // premium-at-open. Prevents runaway negatives from below-cost CC scenarios.
  REMAINING_FLOOR_PCT: -0.50,

  // Maximum "window scalar" denominator — cross-month contributions from
  // underwater CSPs decay linearly as days-to-EOM approaches zero. 20 days is
  // the full-weight threshold; less → scaled down proportionally.
  CROSS_MONTH_WINDOW_DAYS: 20,

  // VIX regime multiplier applied to probabilistic cross-month branches.
  // Low VIX (complacency) → higher early-close probability (profits taken
  // sooner, IV collapses faster). High VIX (fear) → lower early-close
  // probability (positions stick, IV keeps them expensive).
  // Breakpoints form half-open intervals [ , ):  [0,18), [18,25), [25,30), [30,∞).
  VIX_REGIME_BREAKPOINTS: [18, 25, 30],
  VIX_REGIME_MULTIPLIERS: [1.15, 1.00, 0.80, 0.60],

  // Cross-month CSP attribution: fraction of remaining realization that lands
  // in the current calendar month for a CSP that expires later. Tiered by
  // profit %, scaled by VIX (and by window-scalar for underwater tiers).
  //  - "certainty" tier (≥60% profit) lands in full regardless of VIX.
  //  - probabilistic tiers multiply by VIX; deep-profit underwater tiers also
  //    multiply by window scalar (less window → less chance of surprise close).
  //  - deeply underwater (< −20%) has no realistic path to close early.
  CSP_CROSS_MONTH: [
    // [min profit %, attribution fraction, use window scalar, is certainty]
    { minProfitPct:  0.60, fraction: 1.00, useWindowScalar: false, certainty: true  },
    { minProfitPct:  0.40, fraction: 0.55, useWindowScalar: false, certainty: false },
    { minProfitPct:  0.20, fraction: 0.20, useWindowScalar: false, certainty: false },
    { minProfitPct:  0.00, fraction: 0.08, useWindowScalar: true,  certainty: false },
    { minProfitPct: -0.20, fraction: 0.03, useWindowScalar: true,  certainty: false },
    { minProfitPct: -Infinity, fraction: 0.00, useWindowScalar: false, certainty: false },
  ],

  // Cross-month CC attribution — two probabilistic tiers + a certainty tier.
  //  - ≥80% profit: will close at the 80/80 target (certainty, no VIX mult).
  //  - ≥60% profit: decent chance of close (0.60 × VIX).
  //  - otherwise: residual chance (0.15 × VIX).
  CC_CROSS_MONTH: [
    { minProfitPct:  0.80, fraction: 1.00, certainty: true  },
    { minProfitPct:  0.60, fraction: 0.60, certainty: false },
    { minProfitPct: -Infinity, fraction: 0.15, certainty: false },
  ],
};

// Spec starting values — used when no row exists in forecast_calibration.
// Match migration 2026-04-22-forecast-v2-scaffold.sql exactly.
export const SPEC_STARTING_VALUES = {
  csp: {
    profit_60_plus:         0.60,
    profit_40_60_dte_high:  0.65,
    profit_40_60_dte_low:   0.70,
    profit_20_plus_dte_low: 0.90,
    profit_20_40_dte_high:  0.58,
    profit_low_dte_low:     0.93,
    profit_low_dte_high:    0.55,
  },
  cc: {
    profit_80_plus:              0.85,
    profit_60_plus_dte_low:      0.85,
    dte_very_low:                0.92,
    default:                     0.75,
    below_cost_strike_near:      0.20,   // conditional: -0.20 if pnl < 0
    strike_near_non_below_cost:  0.50,
  },
};

// ── Bucket classification ───────────────────────────────────────────────────

export function cspBucket(state) {
  const { currentProfitPct: p, dte } = state;
  if (p == null) return null;                       // no quote → fall back to default
  if (p >= 0.60) return 'profit_60_plus';
  if (p >= 0.40 && p < 0.60 && dte != null && dte > 10)  return 'profit_40_60_dte_high';
  if (p >= 0.40 && p < 0.60 && dte != null && dte <= 10) return 'profit_40_60_dte_low';
  if (p >= 0.20 && p < 0.40 && dte != null && dte > 10)  return 'profit_20_40_dte_high';
  if (p >= 0.20 && dte != null && dte <= 10)             return 'profit_20_plus_dte_low';
  if (p < 0.20 && dte != null && dte <= 10)              return 'profit_low_dte_low';
  if (p < 0.20 && dte != null && dte > 10)               return 'profit_low_dte_high';
  return null;   // unclassified — fall through to default 0.60
}

export function ccBucket(state) {
  const { currentProfitPct: p, dte, stockPrice, strike, costBasis } = state;
  if (p == null) return null;                       // no quote → fall back to default
  const distanceToStrike = (stockPrice != null && strike)
    ? (strike - stockPrice) / strike
    : null;
  const isBelowCost = (costBasis != null && strike != null) ? strike < costBasis : false;

  if (isBelowCost && distanceToStrike != null && distanceToStrike < 0.02) {
    return 'below_cost_strike_near';
  }
  if (distanceToStrike != null && distanceToStrike < 0.015) {
    return 'strike_near_non_below_cost';
  }
  if (p >= 0.80) return 'profit_80_plus';
  if (p >= 0.60 && dte != null && dte <= 5) return 'profit_60_plus_dte_low';
  if (dte != null && dte <= 3) return 'dte_very_low';
  return 'default';
}

// ── Capture curve (dispatch + calibration lookup) ───────────────────────────

// Fallback std (of kept_pct) when a bucket has no calibrated std — either
// because it's uncalibrated (n<5) or because the calibration row predates
// the std column. 0.15 is wider than the calibrated buckets' observed stds
// (0.158 CSP≥60, 0.061 CC≥80), reflecting honest uncertainty for unknown buckets.
export const DEFAULT_UNCERTAINTY_STD = 0.15;

/**
 * Look up the std (of kept_pct) for a bucket from calibrationStd map, with
 * DEFAULT_UNCERTAINTY_STD as fallback.
 */
export function bucketStd(pt, bucket, calibrationStd = {}) {
  const s = calibrationStd?.[pt]?.[bucket];
  return (s != null && isFinite(s) && s > 0) ? s : DEFAULT_UNCERTAINTY_STD;
}

/**
 * Get the expected-final-capture rate for a position's current state.
 *
 * @param {Object} state — { type, currentProfitPct, dte, stockPrice, strike, costBasis, positionPnl }
 * @param {Object} [calibration] — map { [positionType]: { [bucket]: value } }. Takes precedence over starting values.
 * @returns {{ bucket: string|null, pct: number }}
 */
export function expectedFinalCapturePct(state, calibration = {}) {
  const pt = state.type;
  let bucket;

  if (pt === 'csp') {
    bucket = cspBucket(state);
  } else if (pt === 'cc') {
    bucket = ccBucket(state);
  } else {
    return { bucket: null, pct: 0.60 };   // fallback for unknown types
  }

  // Below-cost-strike-near CC has a conditional: -0.20 if position PnL < 0, else 0.20
  if (bucket === 'below_cost_strike_near') {
    const baseline = calibration?.cc?.below_cost_strike_near ?? SPEC_STARTING_VALUES.cc.below_cost_strike_near;
    const pct = state.positionPnl != null && state.positionPnl < 0 ? -baseline : baseline;
    return { bucket, pct };
  }

  if (!bucket) return { bucket: null, pct: 0.60 };
  const calibrated = calibration?.[pt]?.[bucket];
  const starting = SPEC_STARTING_VALUES[pt]?.[bucket];
  return { bucket, pct: calibrated ?? starting ?? 0.60 };
}

// ── Expected realization (lifetime) ─────────────────────────────────────────

export function expectedTotalRealization(state, calibration) {
  const { pct } = expectedFinalCapturePct(state, calibration);
  return (state.premiumAtOpen ?? 0) * pct;
}

export function expectedRemainingRealization(state, calibration) {
  const total = expectedTotalRealization(state, calibration);
  const already = state.realizedToDate ?? 0;
  const remaining = total - already;
  const floor = (state.premiumAtOpen ?? 0) * FORECAST_PARAMS.REMAINING_FLOOR_PCT;
  return Math.max(remaining, floor);
}

// ── Calendar-month realization timing ───────────────────────────────────────

function endOfMonth(d) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return new Date(Date.UTC(y, m + 1, 0));   // last day of month
}

/**
 * VIX regime multiplier for cross-month early-close probability.
 *
 * Low VIX (complacency) → higher early-close probability (people take
 * profits sooner, option prices collapse faster). High VIX (fear) → lower
 * early-close probability (positions stuck, IV keeps them expensive).
 *
 * Applied only to probabilistic cross-month branches — NOT to the "near-
 * certainty" branches (≥60% CSP / ≥80% CC) which return full remaining
 * regardless of regime.
 */
export function vixRegimeMultiplier(vix) {
  if (vix == null || !isFinite(vix)) return 1.00;
  const { VIX_REGIME_BREAKPOINTS: bps, VIX_REGIME_MULTIPLIERS: mults } = FORECAST_PARAMS;
  for (let i = 0; i < bps.length; i++) {
    if (vix < bps[i]) return mults[i];
  }
  return mults[bps.length];
}

/**
 * How much of this position's expected realization lands in the current
 * calendar month, given today's date. For cross-month positions, only the
 * probability-weighted "early close" portion lands now.
 *
 * Low-profit CSPs are tiered (mildly profitable / slightly underwater /
 * deeply underwater) and scaled by remaining window — deeply underwater
 * positions have no realistic path to 60/60 before month-end, so they
 * contribute nothing rather than a flat 5% that overstates attribution.
 *
 * VIX regime multiplies the probabilistic branches (not the certainty
 * branches like ≥60% CSP / ≥80% CC).
 */
export function realizationThisMonth(state, today, calibration, vix = null) {
  const remaining = expectedRemainingRealization(state, calibration);
  const eom = endOfMonth(today);

  const expiry = state.expiry instanceof Date ? state.expiry : new Date(state.expiry);
  if (isNaN(expiry.getTime())) return remaining;

  // Position expires in current calendar month → all of it lands now
  if (expiry <= eom) return remaining;

  // Position expires in a later month — only early-close portion lands now.
  // Cross-month contributions decay as the month progresses (less window for
  // surprise closes).
  const daysToEom = Math.max(0, Math.round((eom - today) / (1000 * 60 * 60 * 24)));
  const windowScalar = Math.min(daysToEom / FORECAST_PARAMS.CROSS_MONTH_WINDOW_DAYS, 1);
  const vixMult = vixRegimeMultiplier(vix);

  const p = state.currentProfitPct;
  if (p == null) return 0;

  const tiers =
    state.type === 'csp' ? FORECAST_PARAMS.CSP_CROSS_MONTH :
    state.type === 'cc'  ? FORECAST_PARAMS.CC_CROSS_MONTH  : null;
  if (!tiers) return 0;

  for (const tier of tiers) {
    if (p >= tier.minProfitPct) {
      if (tier.certainty) return remaining;        // near-certainty tiers ignore VIX & window
      const ws = tier.useWindowScalar ? windowScalar : 1;
      return remaining * tier.fraction * ws * vixMult;
    }
  }
  return 0;
}

// ── Position-state derivation ───────────────────────────────────────────────

/**
 * Build an OCC symbol for a position row. Must match the format written by
 * api/quotes.js (via api/_lib/occ.js) exactly — otherwise quoteBySymbol
 * lookups miss and every position falls back to the 60% default.
 *
 * Example: SOFI 2025-11-28 Put $24 → SOFI251128P00024000
 */
export function buildOccForPosition(row) {
  if (!row?.ticker || !row?.expiry_date || !row?.strike) return null;
  const d = new Date(row.expiry_date);
  if (isNaN(d.getTime())) return null;
  const yy = String(d.getUTCFullYear()).slice(-2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const cp = row.type === 'CC' ? 'C' : 'P';
  const strikeInt = Math.round(row.strike * 1000);
  const strikeStr = String(strikeInt).padStart(8, '0');
  return `${row.ticker}${yy}${mm}${dd}${cp}${strikeStr}`;
}

/**
 * Derive open-position state required by the capture curves.
 *
 * @param {Object} position — row from `positions` table
 * @param {Object} quoteBySymbol — { [symbol]: { mid, last, bid, ask } }
 * @param {number|null} costBasis — per-share cost basis (CCs only)
 * @param {Date} today
 * @returns {Object|null} state, or null if unable to derive (caller should skip)
 */
export function derivePositionState(position, quoteBySymbol, costBasis, today) {
  if (!position || !['CSP', 'CC'].includes(position.type)) return null;
  const type = position.type === 'CSP' ? 'csp' : 'cc';

  const contracts = position.contracts ?? 0;
  // premium_collected is stored as total $ on the position row already
  const premiumAtOpen = position.premium_collected ?? 0;
  if (!premiumAtOpen || !contracts) return null;

  // DTE from today to expiry (spec uses ET market hours — day resolution is fine)
  const expiry = position.expiry_date ? new Date(position.expiry_date) : null;
  const dte = expiry
    ? Math.max(0, Math.round((expiry - today) / (1000 * 60 * 60 * 24)))
    : null;

  // Current option mid → current BTC cost per share → profit%
  const occ = buildOccForPosition(position);
  const optQuote = occ ? quoteBySymbol[occ] : null;
  const currentMid = optQuote?.mid ?? null;

  let currentProfitPct = null;
  if (currentMid != null && contracts) {
    // premium_per_share_open = premiumAtOpen / (contracts * 100)
    const premPerShareOpen = premiumAtOpen / (contracts * 100);
    if (premPerShareOpen > 0) {
      currentProfitPct = (premPerShareOpen - currentMid) / premPerShareOpen;
    }
  }

  // Stock quote (CC state)
  const stockQuote = quoteBySymbol[position.ticker];
  const stockPrice = stockQuote?.mid ?? stockQuote?.last ?? null;

  // Position PnL (CC only) — signed $ gain on the option leg
  // Approximation: (premium per share - current mid) * contracts * 100
  let positionPnl = null;
  if (type === 'cc' && currentMid != null) {
    const premPerShareOpen = premiumAtOpen / (contracts * 100);
    positionPnl = (premPerShareOpen - currentMid) * contracts * 100;
  }

  return {
    type,
    ticker: position.ticker,
    strike: position.strike,
    contracts,
    expiry,
    premiumAtOpen,
    currentProfitPct,
    currentMid,
    dte,
    stockPrice,
    costBasis,
    positionPnl,
    // positions that have rolled would carry realized-to-date; not tracked yet
    realizedToDate: 0,
  };
}

// ── Aggregate pipeline forecast ─────────────────────────────────────────────

/**
 * Given a list of open positions + quotes + calibration, produce the summary
 * numbers the dashboard and Pipeline Detail page need.
 *
 * @returns {{
 *   forecast_realized_to_date, forecast_this_month_remaining, forecast_month_total,
 *   forecast_target_gap, forward_pipeline_premium, csp_pipeline_premium,
 *   cc_pipeline_premium, below_cost_cc_premium, pipeline_phase,
 *   per_position: Array<{ state, bucket, capturePct, remaining, thisMonth }>,
 * }}
 */
export function computePipelineForecast({
  openPositions,          // array of position rows from `positions` table
  costBasisByTicker,      // { [ticker]: costBasisPerShare }
  quoteBySymbol,          // { [symbol]: { mid, last, ... } }
  calibration,            // { csp: { bucket: value }, cc: { bucket: value } }
  calibrationStd,         // { csp: { bucket: std }, cc: { bucket: std } } — optional
  mtdRealized,            // $ already realized this calendar month
  monthlyTarget,          // target $ for the month
  today,                  // Date
  vix = null,             // VIX level — scales cross-month early-close probability
}) {
  const perPosition = [];
  let forwardTotal = 0;
  let cspPipeline = 0;
  let ccPipeline = 0;
  let belowCostCC = 0;
  let thisMonthRemaining = 0;
  let thisMonthVariance = 0;  // portfolio $ variance (sum of per-position variances)

  for (const pos of openPositions) {
    const costBasis = costBasisByTicker[pos.ticker] ?? null;
    const state = derivePositionState(pos, quoteBySymbol, costBasis, today);
    if (!state) continue;

    const { bucket, pct } = expectedFinalCapturePct(state, calibration);
    const remaining = expectedRemainingRealization(state, calibration);
    const thisMonth = realizationThisMonth(state, today, calibration, vix);

    // Per-position uncertainty for THIS MONTH's realization (not lifetime).
    // Modeled as a Bernoulli mixture: with probability p the position closes
    // this month and realization ≈ remaining ± (premium × σ_c); with
    // probability 1-p it doesn't and realization = 0. Then:
    //   Var(thisMonth) = p(1-p) × remaining² + p × (premium × σ_c)²
    //                    └────── between-states ─┘   └─ within-close std ─┘
    // p is read off the model's own early-close attribution:
    //   p = |thisMonth| / |remaining|   (clamped to [0,1])
    // Same-month expiries (p=1) collapse to Var = (premium × σ_c)² (lifetime
    // std). Zero-path positions (thisMonth=0) contribute 0 variance.
    // Independence assumed across positions.
    const sigmaC = bucketStd(state.type, bucket, calibrationStd);
    const premium = state.premiumAtOpen ?? 0;
    const remainingAbs = Math.abs(remaining);
    const thisMonthAbs = Math.abs(thisMonth);
    const p = remainingAbs > 0 ? Math.min(thisMonthAbs / remainingAbs, 1) : 0;
    const sigmaWithin = premium * sigmaC;
    const positionVariance = p * (1 - p) * remainingAbs * remainingAbs
                           + p * sigmaWithin * sigmaWithin;
    thisMonthVariance += positionVariance;

    thisMonthRemaining += thisMonth;
    forwardTotal += remaining;

    if (state.type === 'csp') cspPipeline += remaining;
    else if (state.type === 'cc') {
      ccPipeline += remaining;
      if (costBasis && state.strike < costBasis) belowCostCC += remaining;
    }

    perPosition.push({
      ticker: state.ticker,
      type: state.type,
      strike: state.strike,
      expiry: state.expiry,
      bucket,
      capturePct: pct,
      remaining,
      thisMonth,
      state,
    });
  }

  const thisMonthStd = Math.sqrt(thisMonthVariance);

  const monthTotal = (mtdRealized ?? 0) + thisMonthRemaining;
  const targetGap = monthlyTarget != null ? monthTotal - monthlyTarget : null;

  // Phase classification
  let phase = 'mixed';
  if (forwardTotal > 0) {
    const cspShare = cspPipeline / forwardTotal;
    const ccShare = ccPipeline / forwardTotal;
    if (cspShare > 0.55) phase = 'flexible';
    else if (ccShare > 0.55) phase = 'constraint';
  }

  return {
    forecast_realized_to_date:     Math.round(mtdRealized ?? 0),
    forecast_this_month_remaining: Math.round(thisMonthRemaining),
    forecast_this_month_std:       Math.round(thisMonthStd),
    forecast_month_total:          Math.round(monthTotal),
    forecast_target_gap:           targetGap != null ? Math.round(targetGap) : null,
    forward_pipeline_premium:      Math.round(forwardTotal),
    csp_pipeline_premium:          Math.round(cspPipeline),
    cc_pipeline_premium:           Math.round(ccPipeline),
    below_cost_cc_premium:         Math.round(belowCostCC),
    pipeline_phase:                phase,
    forecast_vix:                  vix != null && isFinite(vix) ? Number(vix) : null,
    forecast_vix_multiplier:       vixRegimeMultiplier(vix),
    per_position:                  perPosition,
  };
}

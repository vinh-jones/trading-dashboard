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
  // Floor at -50% of premium at open — prevents runaway negatives from
  // below-cost CC scenarios.
  const floor = (state.premiumAtOpen ?? 0) * -0.50;
  return Math.max(remaining, floor);
}

// ── Calendar-month realization timing ───────────────────────────────────────

function endOfMonth(d) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return new Date(Date.UTC(y, m + 1, 0));   // last day of month
}

/**
 * How much of this position's expected realization lands in the current
 * calendar month, given today's date. For cross-month positions, only the
 * probability-weighted "early close" portion lands now.
 */
export function realizationThisMonth(state, today, calibration) {
  const remaining = expectedRemainingRealization(state, calibration);
  const eom = endOfMonth(today);

  const expiry = state.expiry instanceof Date ? state.expiry : new Date(state.expiry);
  if (isNaN(expiry.getTime())) return remaining;

  // Position expires in current calendar month → all of it lands now
  if (expiry <= eom) return remaining;

  // Position expires in a later month — only early-close portion lands now
  const p = state.currentProfitPct;
  if (state.type === 'csp') {
    if (p >= 0.60) return remaining;          // will close now at 60/60
    if (p >= 0.40) return remaining * 0.55;   // might close early
    if (p >= 0.20) return remaining * 0.20;   // less likely
    return remaining * 0.05;                  // unlikely
  }
  if (state.type === 'cc') {
    if (p >= 0.80) return remaining;
    if (p >= 0.60) return remaining * 0.60;
    return remaining * 0.15;
  }
  return 0;
}

// ── Position-state derivation ───────────────────────────────────────────────

/**
 * Build an OCC symbol for a position row. Matches the format used by
 * api/_lib/occ.js — simplified inline to avoid import churn.
 *
 * Example: SOFI 2025-11-28 Put $24 → SOFI  251128P00024000
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
  const ticker = row.ticker.padEnd(6, ' ');
  return `${ticker}${yy}${mm}${dd}${cp}${strikeStr}`;
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
  mtdRealized,            // $ already realized this calendar month
  monthlyTarget,          // target $ for the month
  today,                  // Date
}) {
  const perPosition = [];
  let forwardTotal = 0;
  let cspPipeline = 0;
  let ccPipeline = 0;
  let belowCostCC = 0;
  let thisMonthRemaining = 0;

  for (const pos of openPositions) {
    const costBasis = costBasisByTicker[pos.ticker] ?? null;
    const state = derivePositionState(pos, quoteBySymbol, costBasis, today);
    if (!state) continue;

    const { bucket, pct } = expectedFinalCapturePct(state, calibration);
    const remaining = expectedRemainingRealization(state, calibration);
    const thisMonth = realizationThisMonth(state, today, calibration);

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
    forecast_month_total:          Math.round(monthTotal),
    forecast_target_gap:           targetGap != null ? Math.round(targetGap) : null,
    forward_pipeline_premium:      Math.round(forwardTotal),
    csp_pipeline_premium:          Math.round(cspPipeline),
    cc_pipeline_premium:           Math.round(ccPipeline),
    below_cost_cc_premium:         Math.round(belowCostCC),
    pipeline_phase:                phase,
    per_position:                  perPosition,
  };
}

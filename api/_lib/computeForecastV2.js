/**
 * api/_lib/computeForecastV2.js
 *
 * Shared helper — loads positions, quotes, calibration, MTD premium from
 * Supabase and runs computePipelineForecast. Used by:
 *   - /api/snapshot (EOD cron) — part of the full daily_snapshots build
 *   - /api/sync     (user-triggered)  — refresh forecast fields mid-day
 */

import {
  computePipelineForecast,
} from "../../src/lib/pipelineForecast.js";
import { MONTHLY_TARGETS } from "../../src/lib/monthlyTargets.js";

function parseSharesFromDescription(description) {
  if (!description) return 0;
  const withoutPrices = String(description).replace(/\$[\d,.]+/g, "");
  const m = withoutPrices.match(/\b(\d[\d,]*)\b/);
  return m ? parseInt(m[1].replace(/,/g, ""), 10) : 0;
}

function getCostBasisPerShare(lots) {
  const totalFronted = lots.reduce((sum, lot) => sum + (lot.fronted || 0), 0);
  const totalShares  = lots.reduce((sum, lot) => sum + parseSharesFromDescription(lot.description), 0);
  if (!totalShares) return null;
  return Math.round((totalFronted / totalShares) * 100) / 100;
}

export function serializePerPosition(perPosition) {
  if (!Array.isArray(perPosition)) return null;
  return perPosition.map(p => ({
    ticker:            p.ticker,
    type:              p.type,
    strike:            p.strike,
    expiry:            p.expiry instanceof Date ? p.expiry.toISOString().slice(0, 10) : p.expiry,
    bucket:            p.bucket,
    capture_pct:       p.capturePct,
    premium_at_open:   p.state?.premiumAtOpen ?? null,
    realized_to_date:  p.state?.realizedToDate ?? null,
    current_profit_pct:p.state?.currentProfitPct ?? null,
    dte:               p.state?.dte ?? null,
    stock_price:       p.state?.stockPrice ?? null,
    cost_basis:        p.state?.costBasis ?? null,
    position_pnl:      p.state?.positionPnl ?? null,
    remaining:         p.remaining,
    this_month:        p.thisMonth,
  }));
}

/**
 * Map a v2 forecast result onto the pipeline fields a snapshot row carries.
 *
 * Single source of truth shared by every snapshot writer (EOD cron via
 * /api/snapshot, intraday live fallback via /api/eod-snapshot, /api/sync). Two
 * hand-maintained copies of this mapping previously drifted apart, which is why
 * the intraday snapshot showed stale flat-60% pipeline numbers while the
 * dashboard read the v2 fields. Keep it here so they cannot diverge again.
 *
 * Emits both:
 *   - legacy flat-60% fields (open_premium_expected, pipeline_implied_monthly) —
 *     retained for backwards compatibility; NOT what the dashboard reads.
 *   - v2 fields (forecast_month_total, forward_pipeline_premium, …) — the
 *     calendar-month-aware, per-position-capture numbers the dashboard shows.
 *
 * When forecastV2 is null (computeForecastV2 failed), v2 fields null-fill and the
 * legacy fields still compute, so a v2 failure never blanks the pipeline block.
 */
export function pipelineSnapshotFields({ forecastV2, openPremiumGross, mtdPremium }) {
  const gross               = openPremiumGross ?? 0;
  const mtd                 = mtdPremium ?? 0;
  const openPremiumExpected = Math.round(gross * 0.6);
  return {
    open_premium_gross:            gross,
    open_premium_expected:         openPremiumExpected,
    pipeline_implied_monthly:      mtd + openPremiumExpected,
    // v2 forecast fields — null-filled if v2 computation failed
    forecast_realized_to_date:     forecastV2?.forecast_realized_to_date     ?? null,
    forecast_this_month_remaining: forecastV2?.forecast_this_month_remaining ?? null,
    forecast_this_month_std:       forecastV2?.forecast_this_month_std       ?? null,
    forecast_month_total:          forecastV2?.forecast_month_total          ?? null,
    forecast_target_gap:           forecastV2?.forecast_target_gap           ?? null,
    forward_pipeline_premium:      forecastV2?.forward_pipeline_premium      ?? null,
    csp_pipeline_premium:          forecastV2?.csp_pipeline_premium          ?? null,
    cc_pipeline_premium:           forecastV2?.cc_pipeline_premium           ?? null,
    below_cost_cc_premium:         forecastV2?.below_cost_cc_premium         ?? null,
    pipeline_phase:                forecastV2?.pipeline_phase                ?? null,
    forecast_per_position:         forecastV2 ? serializePerPosition(forecastV2.per_position) : null,
  };
}

/**
 * Build the v2 pipeline forecast from current Supabase state. Caller passes
 * already-fetched positions (avoids a duplicate round-trip for callers that
 * already loaded them) and the day's VIX.
 *
 * Returns { forecastV2, positionStatesForWrite, mtdPremium } or throws.
 */
export async function computeForecastV2({ supabase, today, vix, positions }) {
  const openCSPs       = positions.filter(p => p.position_type === "open_csp" && p.type === "CSP");
  const openCCs        = positions.filter(p => p.position_type === "open_csp" && p.type === "CC");
  const assignedShares = positions.filter(p => p.position_type === "assigned_shares");

  const monthStart = `${today.slice(0, 7)}-01`;
  const [mtdResult, quotesResult, calibrationResult] = await Promise.all([
    supabase.from("trades")
      .select("premium_collected")
      .gte("close_date", monthStart)
      .lte("close_date", today),
    supabase.from("quotes").select("symbol, mid, last, bid, ask"),
    supabase.from("forecast_calibration")
      .select("position_type, bucket, calibrated_capture, calibrated_std, calibration_date")
      .order("calibration_date", { ascending: false }),
  ]);

  const mtdPremium = (mtdResult.data || []).reduce(
    (sum, t) => sum + (t.premium_collected || 0), 0
  );

  const calibration    = { csp: {}, cc: {} };
  const calibrationStd = { csp: {}, cc: {} };
  const seen = new Set();
  for (const row of (calibrationResult.data || [])) {
    const key = `${row.position_type}.${row.bucket}`;
    if (seen.has(key)) continue;
    seen.add(key);
    calibration[row.position_type][row.bucket] = Number(row.calibrated_capture);
    if (row.calibrated_std != null) {
      calibrationStd[row.position_type][row.bucket] = Number(row.calibrated_std);
    }
  }

  const quoteBySymbol = {};
  for (const q of (quotesResult.data || [])) quoteBySymbol[q.symbol] = q;

  const costBasisByTicker = {};
  for (const s of assignedShares) {
    const cb = getCostBasisPerShare(s.lots || []);
    if (cb) costBasisByTicker[s.ticker] = cb;
  }

  const todayDate = new Date(`${today}T00:00:00Z`);
  const forecastV2 = computePipelineForecast({
    openPositions:     [...openCSPs, ...openCCs],
    costBasisByTicker,
    quoteBySymbol,
    calibration,
    calibrationStd,
    mtdRealized:       mtdPremium,
    monthlyTarget:     MONTHLY_TARGETS.baseline,
    today:             todayDate,
    vix,
  });

  return {
    forecastV2,
    positionStatesForWrite: forecastV2.per_position,
    mtdPremium,
  };
}

/**
 * Build position_daily_state rows for upsert. One row per open CSP/CC.
 */
export function buildPositionStateRows({ positionStates, today }) {
  return positionStates.map(({ state, bucket, capturePct }) => {
    const key = [state.ticker, state.type, state.strike, state.expiry?.toISOString().slice(0, 10)].join('|');
    const costBasis = state.costBasis ?? null;
    const isBelowCost = state.type === 'cc' && costBasis != null && state.strike != null
      ? state.strike < costBasis
      : null;
    const distToStrike = (state.type === 'cc' && state.stockPrice && state.strike)
      ? (state.strike - state.stockPrice) / state.strike
      : null;
    return {
      snapshot_date:          today,
      position_key:           key,
      ticker:                 state.ticker,
      position_type:          state.type,
      strike:                 state.strike ?? null,
      expiry:                 state.expiry ? state.expiry.toISOString().slice(0, 10) : null,
      contracts:              state.contracts ?? null,
      premium_at_open:        state.premiumAtOpen ?? null,
      current_profit_pct:     state.currentProfitPct ?? null,
      dte:                    state.dte ?? null,
      stock_price:            state.stockPrice ?? null,
      cost_basis:             costBasis,
      is_below_cost:          isBelowCost,
      position_pnl:           state.positionPnl ?? null,
      distance_to_strike_pct: distToStrike,
    };
  });
}

/**
 * api/snapshot.js — Vercel serverless function
 * POST /api/snapshot
 *
 * 1. Runs a full Google Sheets sync (same as /api/sync)
 * 2. Fetches VIX, SPY, QQQ from Yahoo Finance
 * 3. Computes portfolio metrics from freshly-synced Supabase data
 * 4. Upserts one row into daily_snapshots (one row per market day)
 * 5. Evaluates Focus Engine and sends Pushover push per rule flagged
 *    push-worthy in NOTIFY_RULES (src/lib/focusEngine.js); deduped via
 *    transition-based alert_state table (shared with intraday alert-check
 *    cron). Failure here is logged but never blocks the snapshot.
 *
 * Triggered automatically by Vercel cron at 9:30 PM UTC (4:30 PM ET) Mon–Fri.
 * Can also be triggered manually:
 *   curl -X POST https://<your-domain>/api/snapshot \
 *     -H "Authorization: Bearer YOUR_CRON_SECRET"
 */

import { createClient } from "@supabase/supabase-js";
import { syncFromSheets } from "../lib/syncSheets.js";
import { getVixBand } from "../src/lib/vixBand.js";
import { evaluateAlerts } from "./_lib/evaluateAlerts.js";
import {
  computePipelineForecast,
  buildOccForPosition,
} from "../src/lib/pipelineForecast.js";
import { MONTHLY_TARGETS } from "../src/lib/monthlyTargets.js";

// ── Cost basis helpers (duplicated from api/roll-analysis.js for now) ────────
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

// Compact per-position rows for the JSONB column feeding the Pipeline Detail
// panel. The `state` object is stripped — it's internal to the algorithm and
// includes things like raw quotes we don't need to persist.
function serializePerPosition(perPosition) {
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

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set");
  return createClient(url, key);
}

async function fetchMarketData() {
  const symbols = ["%5EVIX", "SPY", "QQQ"];
  const results = {};

  await Promise.all(symbols.map(async (symbol) => {
    try {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`
      );
      const data = await res.json();
      const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
      const key = symbol.replace("%5E", "");  // VIX, SPY, QQQ
      results[key] = price ?? null;
    } catch {
      results[symbol] = null;
    }
  }));

  return { vix: results.VIX, spy: results.SPY, qqq: results.QQQ };
}

export default async function handler(req, res) {
  // Guard: only allow cron invocation or manual trigger with secret
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  // Skip weekends
  const dayOfWeek = new Date().getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return res.status(200).json({ skipped: "Weekend" });
  }

  const supabase = getSupabase();

  // 1. Run full sync first — must complete before snapshot computation
  try {
    await syncFromSheets(supabase);
  } catch (syncError) {
    console.error("[api/snapshot] Sync failed — aborting snapshot:", syncError);
    return res.status(500).json({ error: `Sync failed: ${syncError.message}` });
  }

  // 2. Fetch market data and load freshly-synced data in parallel
  const [marketData, accountResult, positionsResult] = await Promise.all([
    fetchMarketData(),
    supabase
      .from("account_snapshots")
      .select("*")
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .single(),
    supabase.from("positions").select("*"),
  ]);

  const { vix, spy, qqq } = marketData;

  if (accountResult.error) {
    console.error("[api/snapshot] Failed to load account snapshot:", accountResult.error);
    return res.status(500).json({ error: `Account snapshot load failed: ${accountResult.error.message}` });
  }
  if (positionsResult.error) {
    console.error("[api/snapshot] Failed to load positions:", positionsResult.error);
    return res.status(500).json({ error: `Positions load failed: ${positionsResult.error.message}` });
  }

  const accountSnap = accountResult.data;
  const positions   = positionsResult.data ?? [];

  // 3. Account-level metrics
  const accountValue = accountSnap?.account_value ?? 0;
  const costBasis    = accountSnap?.cost_basis ?? 0;
  const freeCashPct  = accountSnap?.free_cash_pct_est ?? null;
  const freeCash     = accountSnap?.free_cash_est ?? null;

  // 4. Position counts
  const openCSPs      = positions.filter(p => p.position_type === "open_csp" && p.type === "CSP");
  const openCCs       = positions.filter(p => p.position_type === "open_csp" && p.type === "CC");
  const openLEAPS     = positions.filter(p => p.position_type === "open_leaps");
  const assignedShares = positions.filter(p => p.position_type === "assigned_shares");

  // 5. Per-ticker allocations and total deployed
  // Each position has capital_fronted which is the total for that row.
  // Assigned shares: capital_fronted = cost_basis_total (sum of all lots — don't double-count lots).
  const tickerTotals = {};
  positions.forEach(p => {
    const fronted = p.capital_fronted || 0;
    if (p.ticker && fronted > 0) {
      tickerTotals[p.ticker] = (tickerTotals[p.ticker] || 0) + fronted;
    }
  });

  const tickerAllocations = {};
  let totalDeployed = 0;
  Object.entries(tickerTotals).forEach(([ticker, amount]) => {
    tickerAllocations[ticker] = accountValue > 0
      ? Math.round((amount / accountValue) * 10000) / 10000  // 4 decimal places
      : 0;
    totalDeployed += amount;
  });

  // 6. MTD premium from trades table
  const monthStart = `${today.slice(0, 7)}-01`;  // YYYY-MM-01
  const { data: mtdTrades } = await supabase
    .from("trades")
    .select("premium_collected")
    .gte("close_date", monthStart)
    .lte("close_date", today);

  const mtdPremium = (mtdTrades || []).reduce(
    (sum, t) => sum + (t.premium_collected || 0), 0
  );

  // 7. Open premium pipeline (CSPs and CCs only)
  const openPremiumGross = [...openCSPs, ...openCCs].reduce(
    (sum, p) => sum + (p.premium_collected || 0), 0
  );
  // Legacy flat-60% — retained for 30-day backcompat per spec §Implementation Note 9.
  const openPremiumExpected  = Math.round(openPremiumGross * 0.60);
  const pipelineImplied      = mtdPremium + openPremiumExpected;

  // 7b. v2 pipeline forecast — position-type-aware capture curves + calendar-month timing.
  // Loads quotes + forecast_calibration in parallel. Fails silently (logs + null-fills)
  // so a v2-forecast failure never blocks the snapshot write.
  let forecastV2 = null;
  let positionStatesForWrite = [];
  try {
    const [quotesResult, calibrationResult] = await Promise.all([
      supabase.from("quotes").select("symbol, mid, last, bid, ask"),
      supabase.from("forecast_calibration")
        .select("position_type, bucket, calibrated_capture, calibrated_std, calibration_date")
        .order("calibration_date", { ascending: false }),
    ]);
    const quoteBySymbol = {};
    for (const q of (quotesResult.data || [])) quoteBySymbol[q.symbol] = q;

    // Keep only the most recent row per (position_type, bucket)
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

    // Build costBasisByTicker from assigned_shares rows (lots JSONB)
    const costBasisByTicker = {};
    for (const s of assignedShares) {
      const cb = getCostBasisPerShare(s.lots || []);
      if (cb) costBasisByTicker[s.ticker] = cb;
    }

    const todayDate = new Date(`${today}T00:00:00Z`);
    forecastV2 = computePipelineForecast({
      openPositions:     [...openCSPs, ...openCCs],
      costBasisByTicker,
      quoteBySymbol,
      calibration,
      calibrationStd,
      mtdRealized:       mtdPremium,
      monthlyTarget:     MONTHLY_TARGETS.baseline,
      today:             todayDate,
    });
    positionStatesForWrite = forecastV2.per_position;
  } catch (v2Err) {
    console.error("[api/snapshot] v2 forecast failed (non-blocking):", v2Err);
  }

  // 8. VIX band and deployment flags
  const band = getVixBand(vix);
  const withinBand   = band && freeCashPct !== null ? freeCashPct >= band.floorPct && freeCashPct <= band.ceilingPct : null;
  const overdeployed = band && freeCashPct !== null ? freeCashPct < band.floorPct   : null;
  const underdeployed= band && freeCashPct !== null ? freeCashPct > band.ceilingPct : null;

  const allocValues  = Object.values(tickerAllocations);
  const anyAbove10   = allocValues.some(v => v >= 0.10);
  const anyAbove15   = allocValues.some(v => v >= 0.15);

  // 9. Build and upsert snapshot row
  const snapshot = {
    snapshot_date:             today,
    account_value:             accountValue,
    cost_basis:                costBasis,
    free_cash:                 freeCash,
    free_cash_pct:             freeCashPct,
    total_deployed:            totalDeployed,
    total_deployed_pct:        accountValue > 0 ? totalDeployed / accountValue : null,
    vix,
    vix_band:                  band?.label ?? null,
    cash_floor_target_pct:     band?.floor ?? null,
    cash_ceiling_target_pct:   band?.ceiling ?? null,
    within_band:               withinBand,
    open_csp_count:            openCSPs.length,
    open_cc_count:             openCCs.length,
    open_leaps_count:          openLEAPS.length,
    assigned_share_tickers:    assignedShares.length,
    total_open_positions:      positions.length,
    mtd_premium_collected:     mtdPremium,
    open_premium_gross:        openPremiumGross,
    open_premium_expected:     openPremiumExpected,
    pipeline_implied_monthly:  pipelineImplied,
    // v2 forecast fields — null-filled if v2 computation failed
    forecast_realized_to_date:     forecastV2?.forecast_realized_to_date      ?? null,
    forecast_this_month_remaining: forecastV2?.forecast_this_month_remaining  ?? null,
    forecast_this_month_std:       forecastV2?.forecast_this_month_std        ?? null,
    forecast_month_total:          forecastV2?.forecast_month_total           ?? null,
    forecast_target_gap:           forecastV2?.forecast_target_gap            ?? null,
    forward_pipeline_premium:      forecastV2?.forward_pipeline_premium       ?? null,
    csp_pipeline_premium:          forecastV2?.csp_pipeline_premium           ?? null,
    cc_pipeline_premium:           forecastV2?.cc_pipeline_premium            ?? null,
    below_cost_cc_premium:         forecastV2?.below_cost_cc_premium          ?? null,
    pipeline_phase:                forecastV2?.pipeline_phase                 ?? null,
    forecast_per_position:         forecastV2 ? serializePerPosition(forecastV2.per_position) : null,
    ticker_allocations:        tickerAllocations,
    any_ticker_above_10pct:    anyAbove10,
    any_ticker_above_15pct:    anyAbove15,
    overdeployed,
    underdeployed,
    spy_close:                 spy ?? null,
    qqq_close:                 qqq ?? null,
  };

  const { error } = await supabase
    .from("daily_snapshots")
    .upsert(snapshot, { onConflict: "snapshot_date" });

  if (error) {
    console.error("[api/snapshot] Snapshot write failed:", error);
    return res.status(500).json({ error: error.message });
  }

  // 9b. Write position_daily_state rows — one per open CSP/CC position.
  // Enables trajectory-based calibration once 3+ months accumulates.
  // See docs/pipeline_forecast_v2_backtest.md §Structural fix.
  if (positionStatesForWrite.length > 0) {
    try {
      const stateRows = positionStatesForWrite.map(({ state, bucket, capturePct }) => {
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
      const { error: stateErr } = await supabase
        .from("position_daily_state")
        .upsert(stateRows, { onConflict: "snapshot_date,position_key" });
      if (stateErr) console.error("[api/snapshot] position_daily_state write failed:", stateErr);
    } catch (stateErr) {
      console.error("[api/snapshot] position_daily_state unexpected error:", stateErr);
    }
  }

  // 10. Fetch macro signals and write to macro_snapshots
  // Wrapped in try/catch — a macro failure must NOT fail the portfolio snapshot.
  try {
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host;
    const macroRes = await fetch(`${protocol}://${host}/api/macro`, {
      headers: { "User-Agent": "internal-snapshot-cron" },
    });
    const macroData = await macroRes.json();

    if (macroData.ok) {
      const macroSnapshot = {
        snapshot_date: today,
        vix: macroData.signals.vix.value,
        s5fi_pct: macroData.signals.s5fi.value,
        fear_greed_score: macroData.signals.fearGreed.value,
        fed_cuts_priced_in: macroData.signals.fedWatch.cutsPricedIn,
        spy_pct_from_ath: macroData.signals.spyVsAth.pctFromHigh,
        posture: macroData.posture.posture,
        posture_score: macroData.posture.avg,
        ai_context: macroData.ai_context,
      };

      const { error: macroError } = await supabase
        .from("macro_snapshots")
        .upsert(macroSnapshot, { onConflict: "snapshot_date" });

      if (macroError) {
        console.error("[api/snapshot] Macro snapshot write failed:", macroError);
      }
    }
  } catch (macroErr) {
    console.error("[api/snapshot] Macro fetch/write failed:", macroErr.message);
  }

  // 11. Evaluate Focus Engine and send Pushover pushes for push-worthy rules.
  // Transition-based dedup via alert_state (shared helper with /api/alert-check).
  // Wrapped in try/catch — a notification failure must NOT fail the snapshot.
  let notifications = { sent: [], skipped: [], resolved: [], errors: [] };
  try {
    notifications = await evaluateAlerts({
      supabase,
      accountSnap,
      positionRows: positions,
      liveVix: vix,
    });
  } catch (notifyError) {
    console.error("[api/snapshot] Notification step failed:", notifyError);
    notifications = { sent: [], skipped: [], resolved: [], errors: [notifyError.message] };
  }

  return res.status(200).json({
    success: true,
    date: today,
    vix,
    free_cash_pct: freeCashPct,
    within_band: withinBand,
    mtd_premium: mtdPremium,
    pipeline_implied: pipelineImplied,
    forecast_v2: forecastV2 ? {
      month_total:   forecastV2.forecast_month_total,
      target_gap:    forecastV2.forecast_target_gap,
      forward:       forecastV2.forward_pipeline_premium,
      phase:         forecastV2.pipeline_phase,
      positions:     forecastV2.per_position.length,
    } : null,
    notifications,
  });
}

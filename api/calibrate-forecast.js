/**
 * api/calibrate-forecast.js — Vercel serverless function
 * POST /api/calibrate-forecast
 *
 * Re-runs the v2 forecast calibration against closed-trade data in the
 * `trades` table and upserts fresh rows into `forecast_calibration`.
 *
 * Runs monthly via Vercel cron. Can also be triggered manually:
 *   curl -X POST https://<domain>/api/calibrate-forecast \
 *     -H "Authorization: Bearer $CRON_SECRET"
 *
 * IMPORTANT: closed-trade data is tautological for in-band buckets (a trade
 * that closed at 40-60% profit has mean capture in that band by construction).
 * This endpoint preserves spec starting values for those buckets and only
 * updates cross-threshold buckets (csp.profit_60_plus, cc.profit_80_plus).
 *
 * Proper trajectory-based calibration requires position_daily_state to
 * accumulate 3+ months of open-position snapshots. See
 * docs/pipeline_forecast_v2_backtest.md §Structural fix.
 */

import { createClient } from "@supabase/supabase-js";

// Spec starting values — kept in sync with scripts/calibrate_forecast.js
const SPEC_START = {
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
    below_cost_strike_near:      0.20,
    strike_near_non_below_cost:  0.50,
  },
};

// Buckets where closed-trade data is tautological — preserve spec value.
const TAUTOLOGICAL = new Set([
  "csp.profit_40_60_dte_high",
  "csp.profit_40_60_dte_low",
  "csp.profit_20_plus_dte_low",
  "csp.profit_20_40_dte_high",
  "csp.profit_low_dte_high",
  "csp.profit_low_dte_low",
  "cc.dte_very_low",
  "cc.default",
]);

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set");
  return createClient(url, key);
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

function cspBucket(cap, dte) {
  if (cap >= 0.60) return "profit_60_plus";
  if (cap >= 0.40 && cap < 0.60 && dte != null && dte >  10) return "profit_40_60_dte_high";
  if (cap >= 0.40 && cap < 0.60 && dte != null && dte <= 10) return "profit_40_60_dte_low";
  if (cap >= 0.20 && cap < 0.40 && dte != null && dte >  10) return "profit_20_40_dte_high";
  if (cap >= 0.20 && dte != null && dte <= 10)               return "profit_20_plus_dte_low";
  if (cap <  0.20 && dte != null && dte <= 10)               return "profit_low_dte_low";
  if (cap <  0.20 && dte != null && dte >  10)               return "profit_low_dte_high";
  return "unclassified";
}

function ccBucket(cap, dte) {
  if (cap >= 0.80) return "profit_80_plus";
  if (cap >= 0.60 && dte != null && dte <= 5) return "profit_60_plus_dte_low";
  if (dte != null && dte <= 3)                return "dte_very_low";
  return "default";
}

function stats(arr) {
  if (!arr.length) return null;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const sq = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
  return { n: arr.length, mean: +mean.toFixed(4), std: +Math.sqrt(sq).toFixed(4) };
}

export default async function handler(req, res) {
  // Guard: only allow cron invocation or manual trigger with secret.
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const supabase = getSupabase();
  const today = new Date().toISOString().slice(0, 10);

  // Load all closed CSP / CC trades.
  const { data: trades, error: tradesErr } = await supabase
    .from("trades")
    .select("ticker, type, close_date, expiry_date, kept_pct")
    .in("type", ["CSP", "CC"])
    .not("close_date", "is", null);

  if (tradesErr) {
    console.error("[api/calibrate-forecast] trades load failed:", tradesErr);
    return res.status(500).json({ error: `trades load failed: ${tradesErr.message}` });
  }

  // Bucket each closed trade.
  const cspGroups = {}, ccGroups = {};
  let skipped = 0;
  for (const t of trades) {
    const kept = t.kept_pct;
    // kept_pct can be 0-1 or 0-100 — normalize to fraction.
    const cap = kept == null ? null : (kept > 1 ? kept / 100 : kept);
    if (cap == null || isNaN(cap)) { skipped++; continue; }
    const dte = t.close_date && t.expiry_date ? daysBetween(t.close_date, t.expiry_date) : null;
    if (t.type === "CSP") {
      const b = cspBucket(cap, dte);
      (cspGroups[b] ||= []).push(cap);
    } else if (t.type === "CC") {
      const b = ccBucket(cap, dte);
      (ccGroups[b] ||= []).push(cap);
    }
  }

  // Resolve each bucket's calibrated value (spec start for n<5 / tautological).
  // std is preserved whenever available (even on tautological buckets, the
  // observed spread is still informative for uncertainty bands).
  function resolve(pt, bucket, s) {
    const key = `${pt}.${bucket}`;
    const start = SPEC_START[pt]?.[bucket];
    const std   = s && s.n >= 5 ? s.std : null;
    if (!s || s.n < 5)         return { value: start, std, reason: s ? "n<5, keep spec start" : "no data, keep spec start" };
    if (TAUTOLOGICAL.has(key)) return { value: start, std, reason: `tautological, keep spec start (observed ${s.mean})` };
    return { value: s.mean, std, reason: `calibrated n=${s.n}` };
  }

  const allBuckets = [
    ...Object.keys(SPEC_START.csp).map(b => ["csp", b]),
    ...Object.keys(SPEC_START.cc).map(b => ["cc", b]),
  ];

  const rowsToUpsert = [];
  const report = [];
  for (const [pt, b] of allBuckets) {
    const groups = pt === "csp" ? cspGroups : ccGroups;
    const s = stats(groups[b] || []);
    const { value, std, reason } = resolve(pt, b, s);
    rowsToUpsert.push({
      position_type:      pt,
      bucket:             b,
      calibrated_capture: value,
      calibrated_std:     std,
      sample_size:        s?.n ?? 0,
      calibration_date:   today,
      notes:              reason,
    });
    report.push({ position_type: pt, bucket: b, n: s?.n ?? 0, observed: s?.mean ?? null, std, applied: value, reason });
  }

  const { error: upsertErr } = await supabase
    .from("forecast_calibration")
    .upsert(rowsToUpsert, { onConflict: "position_type,bucket,calibration_date" });

  if (upsertErr) {
    console.error("[api/calibrate-forecast] upsert failed:", upsertErr);
    return res.status(500).json({ error: `upsert failed: ${upsertErr.message}` });
  }

  return res.status(200).json({
    success:              true,
    calibration_date:     today,
    trades_evaluated:     trades.length,
    trades_skipped:       skipped,
    buckets_upserted:     rowsToUpsert.length,
    report,
    note:                 "Closed-trade data is tautological for in-band buckets — spec starting values are preserved for those. Full trajectory calibration needs position_daily_state accumulation.",
  });
}

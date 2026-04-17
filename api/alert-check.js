/**
 * api/alert-check.js — Vercel serverless function
 * GET|POST /api/alert-check
 *
 * Intraday Focus Engine alert checker. Cron-triggered every 30 min during
 * market hours (see vercel.json). Read-only from the Supabase perspective
 * except for the alert_state writes inside evaluateAlerts.
 *
 * Unlike /api/snapshot, this does NOT:
 *   - sync Google Sheets
 *   - fetch VIX/SPY/QQQ
 *   - compute account metrics
 *   - upsert daily_snapshots
 *
 * It reuses the latest account_snapshot + live positions + cached quotes,
 * so dollar load is tiny (no external APIs except the pushover call, and
 * only if something transitions from not-firing → firing).
 *
 * Auth: Vercel cron invokes with Bearer ${CRON_SECRET}.
 *   curl -X POST https://<your-domain>/api/alert-check \
 *     -H "Authorization: Bearer YOUR_CRON_SECRET"
 */

import { createClient } from "@supabase/supabase-js";
import { evaluateAlerts } from "./_lib/evaluateAlerts.js";
import { isMarketOpen } from "./_marketHours.js";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set");
  return createClient(url, key);
}

export default async function handler(req, res) {
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!isMarketOpen()) {
    return res.status(200).json({ skipped: "Market closed" });
  }

  const supabase = getSupabase();

  // Load latest account snapshot + all open positions in parallel.
  // We intentionally use the most recent daily account snapshot rather than
  // recomputing — intraday account_value drift doesn't affect which rules fire
  // (the free-cash-floor rule is off in NOTIFY_RULES anyway).
  const [accountResult, positionsResult] = await Promise.all([
    supabase
      .from("account_snapshots")
      .select("*")
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .single(),
    supabase.from("positions").select("*"),
  ]);

  if (accountResult.error) {
    console.error("[api/alert-check] account_snapshots load failed:", accountResult.error);
    return res.status(500).json({ error: `Account load failed: ${accountResult.error.message}` });
  }
  if (positionsResult.error) {
    console.error("[api/alert-check] positions load failed:", positionsResult.error);
    return res.status(500).json({ error: `Positions load failed: ${positionsResult.error.message}` });
  }

  try {
    const notifications = await evaluateAlerts({
      supabase,
      accountSnap:  accountResult.data,
      positionRows: positionsResult.data ?? [],
      liveVix:      null,   // no live VIX fetch — the quote-cached marketContext row fills in recent VIX
    });

    return res.status(200).json({
      success: true,
      at:      new Date().toISOString(),
      notifications,
    });
  } catch (err) {
    console.error("[api/alert-check]", err);
    return res.status(500).json({ error: err.message });
  }
}

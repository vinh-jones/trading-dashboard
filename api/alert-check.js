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
import {
  computeCcWritability,
  writeCcWritabilityShadowLog,
  loadRecentlyPushedTickers,
  recordCcWritabilityPush,
  ccWritabilityAlertId,
} from "./_lib/computeCcWritability.js";

const CC_WRITABILITY_CACHE_KEY = "cc_writability_latest";
const CC_WRITABILITY_TTL_MS    = 60 * 60 * 1000;

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

  const positionRows = positionsResult.data ?? [];
  const todayISO     = new Date().toISOString().slice(0, 10);

  // Covered-call writability (docs/spec_cc_writability_alert_v1.md). Computed
  // here rather than inside evaluateAlerts because it needs live option data,
  // its own cache, and its own suppression state. Fails soft: a Public.com or
  // UW outage costs this one rule, not the whole alert run.
  let ccWritability = null;
  try {
    ccWritability = await computeCcWritability({ supabase, positions: positionRows, todayISO });

    // §4.2 — the 5-trading-day re-arm floor sits on top of alert_state's
    // fire-once-per-crossing. A genuine re-cross three days later stays quiet;
    // an ignored alert is worse than none.
    const reArmed = await loadRecentlyPushedTickers({
      supabase, tickers: ccWritability.in_scope, todayISO,
    });
    if (reArmed.size) {
      ccWritability.per_position = ccWritability.per_position.map(p =>
        reArmed.has(p.ticker) && p.pushable
          ? { ...p, pushable: false, push_blocked_reason: "rearm_window" }
          : p
      );
    }

    // Dashboard state — AMBER is dashboard-only (§2.4), so the payload has to
    // land somewhere the UI can read it whether or not anything pushed.
    await supabase.from("app_cache").upsert({
      key:        CC_WRITABILITY_CACHE_KEY,
      value:      JSON.stringify(ccWritability),
      expires_at: new Date(Date.now() + CC_WRITABILITY_TTL_MS).toISOString(),
    });

    // §8.2 — shadow log on EVERY evaluation, firing or not.
    await writeCcWritabilityShadowLog({ supabase, payload: ccWritability, todayISO });
  } catch (err) {
    console.error("[api/alert-check] cc-writability failed:", err);
  }

  try {
    const notifications = await evaluateAlerts({
      supabase,
      accountSnap:  accountResult.data,
      positionRows,
      liveVix:      null,   // no live VIX fetch — focusEngine falls back to accountSnap.vix_current
      ccWritability,
    });

    // Record CC-writability pushes into sent_alerts so the re-arm floor above
    // can see them on later runs. alert_state already tracks the crossing; this
    // adds the "how long ago" the floor needs.
    for (const p of ccWritability?.per_position ?? []) {
      if (notifications.sent?.includes(ccWritabilityAlertId(p.ticker))) {
        await recordCcWritabilityPush({ supabase, ticker: p.ticker, title: p.push_copy, todayISO });
      }
    }

    return res.status(200).json({
      success: true,
      at:      new Date().toISOString(),
      notifications,
      cc_writability: ccWritability
        ? {
            in_scope: ccWritability.in_scope,
            tiers: Object.fromEntries(
              ccWritability.per_position.map(p => [p.ticker, p.tier ?? "none"])
            ),
          }
        : null,
    });
  } catch (err) {
    console.error("[api/alert-check]", err);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * api/uw-snapshot.js — Vercel serverless function (intraday cron)
 *
 * GET /api/uw-snapshot                 → ingest UW signals for open-position tickers
 * GET /api/uw-snapshot?tickers=NVDA    → ingest just these (smoke test: 2 UW calls)
 * GET /api/uw-snapshot?scope=approved  → ingest the full approved wheel universe
 *
 * For each ticker: fetch greek exposure + flow alerts from Unusual Whales,
 * normalize to the scalars the entry score consumes (gamma_env, flow_sentiment)
 * plus the whale put-sell list, and upsert into uw_signals.
 *
 * Rate-limited by uwClient (≈109/min). Default scope = open positions so a run
 * comfortably fits the function timeout under UW's 120/min cap. If Unusual
 * Whales blocks datacenter IPs (as Tastytrade does), the direct fetch will fail
 * and this would need to route through the OpenClaw residential-IP path like
 * /api/ingest-iv — confirm on the first real run.
 */

import { createClient } from "@supabase/supabase-js";
import { hasUwKey, fetchGreekExposure, fetchFlowAlerts } from "./_lib/uwClient.js";
import { gammaEnvFromGreek, flowSentimentFromAlerts, whalePutSellsFromAlerts } from "../src/lib/uwNormalize.js";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

// In middleware BYPASS, so this self-authenticates: Vercel cron sends
// `Authorization: Bearer ${CRON_SECRET}`; a logged-in manual trigger from the
// dashboard carries the app_auth cookie (or Bearer APP_SECRET).
function authorized(req) {
  const auth   = req.headers["authorization"] || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const cron   = process.env.CRON_SECRET;
  const app    = process.env.APP_SECRET;
  if (cron && bearer === cron) return true;
  if (app && bearer === app) return true;
  const cookie = req.headers.cookie || "";
  const m = cookie.match(/(?:^|;\s*)app_auth=([^;]+)/);
  const cookieTok = m ? decodeURIComponent(m[1]) : null;
  return !!(app && cookieTok === app);
}

async function resolveTickers(supabase, req) {
  const override = (req.query.tickers || "").trim();
  if (override) {
    return [...new Set(override.toUpperCase().split(",").map((t) => t.trim()).filter(Boolean))];
  }
  if (req.query.scope === "positions") {
    const { data } = await supabase.from("positions").select("ticker");
    return [...new Set((data ?? []).map((r) => r.ticker).filter(Boolean))].sort();
  }
  // Default: the approved wheel universe — covers the Radar score AND the
  // Whale CSP flow idea-generation feed across the whole watchlist.
  const { data } = await supabase.from("wheel_universe").select("ticker").eq("list_type", "approved");
  return [...new Set((data ?? []).map((r) => r.ticker))].sort();
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  if (!authorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  if (!hasUwKey()) {
    // Soft no-op so the cron doesn't error before the key is configured.
    return res.status(200).json({ ok: true, skipped: "UW_API_KEY not configured", updated: 0 });
  }

  try {
    const supabase = getSupabase();
    const tickers  = await resolveTickers(supabase, req);
    const now      = new Date().toISOString();
    const todayStartMs = (() => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.getTime(); })();

    // Greek exposure is daily data — only refetch when we don't already have a
    // gamma_env from today. Keeps intraday runs to one call/ticker (flow only),
    // well within the rate limit + function timeout across the full universe.
    const { data: existingRows } = await supabase.from("uw_signals").select("ticker, gamma_env, refreshed_at");
    const existing = new Map((existingRows ?? []).map((r) => [r.ticker, r]));

    const results = [];
    for (const ticker of tickers) {
      try {
        const prev = existing.get(ticker);
        const greekFresh = prev?.gamma_env != null && prev?.refreshed_at &&
          new Date(prev.refreshed_at).getTime() >= todayStartMs;

        const alerts = await fetchFlowAlerts(ticker);
        let gammaEnv = prev?.gamma_env ?? null;
        if (!greekFresh) {
          const greek = await fetchGreekExposure(ticker);
          gammaEnv = gammaEnvFromGreek(greek);
        }

        const row = {
          ticker,
          gamma_env:       gammaEnv,
          flow_sentiment:  flowSentimentFromAlerts(alerts),
          whale_put_sells: whalePutSellsFromAlerts(alerts),
          next_earnings_date: alerts?.[0]?.next_earnings_date ?? null,
          refreshed_at:    now,
        };
        const { error } = await supabase.from("uw_signals").upsert(row, { onConflict: "ticker" });
        results.push({ ticker, ok: !error, error: error?.message });
      } catch (err) {
        results.push({ ticker, ok: false, error: err?.message ?? String(err) });
      }
    }

    const failed = results.filter((r) => !r.ok);
    if (failed.length) console.warn("[api/uw-snapshot] failures:", failed);
    console.log(`[api/uw-snapshot] updated ${results.filter((r) => r.ok).length}/${tickers.length}`);

    return res.status(200).json({
      ok: true,
      updated: results.filter((r) => r.ok).length,
      total: tickers.length,
      results,
    });
  } catch (err) {
    console.error("[api/uw-snapshot]", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

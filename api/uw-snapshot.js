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

async function resolveTickers(supabase, req) {
  const override = (req.query.tickers || "").trim();
  if (override) {
    return [...new Set(override.toUpperCase().split(",").map((t) => t.trim()).filter(Boolean))];
  }
  if (req.query.scope === "approved") {
    const { data } = await supabase.from("wheel_universe").select("ticker").eq("list_type", "approved");
    return [...new Set((data ?? []).map((r) => r.ticker))].sort();
  }
  // Default: distinct tickers from open positions (your active risk).
  const { data } = await supabase.from("positions").select("ticker");
  return [...new Set((data ?? []).map((r) => r.ticker).filter(Boolean))].sort();
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  if (!hasUwKey()) {
    // Soft no-op so the cron doesn't error before the key is configured.
    return res.status(200).json({ ok: true, skipped: "UW_API_KEY not configured", updated: 0 });
  }

  try {
    const supabase = getSupabase();
    const tickers  = await resolveTickers(supabase, req);
    const now      = new Date().toISOString();

    const results = [];
    for (const ticker of tickers) {
      try {
        const [greek, alerts] = await Promise.all([
          fetchGreekExposure(ticker),
          fetchFlowAlerts(ticker),
        ]);
        const row = {
          ticker,
          gamma_env:       gammaEnvFromGreek(greek),
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

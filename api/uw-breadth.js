/**
 * api/uw-breadth.js — Vercel serverless function (cron)
 *
 * GET /api/uw-breadth                 → census the S&P 500, write one `s5fi` row
 * GET /api/uw-breadth?dry=1           → compute and report, write nothing
 * GET /api/uw-breadth?tickers=AAPL,MU → scope to these (smoke test; implies dry)
 *
 * Replaces the S5FI reading that OpenClaw scraped off Finviz until it died on
 * 2026-07-01. Finviz Cloudflare-403s Vercel's datacenter IPs, so the number is
 * recomputed here from UW daily candles: % of S&P 500 members trading above
 * their own 50-day moving average.
 *
 * WRITES THE EXISTING `s5fi` TABLE, deliberately. Its shape (as_of/pct/above/
 * total) already is this reading, and api/macro.js's fetchS5fi + freshness gate
 * already read it. Swapping the *source* while keeping the *contract* means no
 * consumer changes and no threshold recalibration — the moment this cron writes,
 * the S5FI signal comes back on its own. /api/ingest-s5fi stays in place as the
 * residential-push path; nothing stops both writing.
 *
 * COST: ~510 UW calls per run (≈10 screener pages + one daily-candle call per
 * member), ~285s at the shared 550ms rate gate. That is +8.5% on top of the
 * ~6,000 calls/day the existing uw-* crons already spend, and UW Basic meters
 * per minute (120/min) rather than per day. maxDuration is 800 for retry
 * headroom — the gate, not the network, sets the floor.
 *
 * SCHEDULE: 21:00 UTC weekdays, one hour after the close during EDT, and ahead
 * of /api/snapshot at 21:30 which reads the composite. Note that under EST
 * (Nov–Mar) 21:00 UTC IS the closing bell; summarizeBreadth's session-alignment
 * guard catches unsettled candles and writes nothing rather than blending two
 * sessions, so the failure mode is a missing row, not a wrong one.
 *
 * In middleware BYPASS; self-authenticates. Soft no-op until UW_API_KEY is set.
 */

import { createClient } from "@supabase/supabase-js";

import { hasUwKey, fetchSp500Tickers, fetchDailyOhlc } from "./_lib/uwClient.js";
import { normalizeDailyBars } from "../src/lib/orb/bars.js";
import { evaluateTicker, summarizeBreadth, asOfForSession, SMA_PERIOD } from "./_lib/breadth.js";

// 70 daily bars to net 50 clean closes — absorbs holidays and any dropped rows.
const CANDLE_LOOKBACK = 70;

// The S&P 500 is 500-503 names. Materially fewer means the screener paged wrong
// or the filter changed, and a breadth percentage over a truncated membership is
// biased toward whatever the screener happened to return first.
const MIN_UNIVERSE = 450;

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

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

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });
  if (!hasUwKey()) return res.status(200).json({ ok: true, skipped: "UW_API_KEY not configured" });

  const scoped = typeof req.query?.tickers === "string" && req.query.tickers.trim()
    ? req.query.tickers.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean)
    : null;
  // A scoped run is a smoke test over a handful of names — never a universe.
  const dryRun = scoped != null || req.query?.dry === "1";

  try {
    const tickers = scoped ?? (await fetchSp500Tickers());

    if (!scoped && tickers.length < MIN_UNIVERSE) {
      console.error(`[api/uw-breadth] universe too small: ${tickers.length} < ${MIN_UNIVERSE} — refusing to compute`);
      return res.status(200).json({
        ok: false,
        error: `S&P 500 membership returned only ${tickers.length} tickers`,
        wrote: false,
      });
    }

    // Sequential, not parallel: uwClient's rate gate serializes to ~109 req/min
    // globally, so concurrency buys no throughput here and only makes a burst
    // against the shared gate more likely.
    const verdicts = [];
    const failures = [];
    for (const ticker of tickers) {
      try {
        const bars = normalizeDailyBars(await fetchDailyOhlc(ticker, CANDLE_LOOKBACK));
        verdicts.push(evaluateTicker(bars, SMA_PERIOD));
      } catch (err) {
        verdicts.push(null);
        failures.push(`${ticker}: ${err.message}`);
      }
    }

    const summary = summarizeBreadth(verdicts, { requested: tickers.length });

    if (!summary.ok) {
      console.error(`[api/uw-breadth] not writing — ${summary.reason}`, { failures: failures.length });
      return res.status(200).json({ ...summary, wrote: false, failures: failures.slice(0, 10) });
    }

    if (dryRun) {
      return res.status(200).json({ ...summary, wrote: false, dryRun: true, failures: failures.slice(0, 10) });
    }

    const supabase = getSupabase();
    const asOf = asOfForSession(summary.sessionDate);

    // Idempotent: a re-run for the same session must not append a second row.
    const { data: existing, error: readErr } = await supabase
      .from("s5fi").select("id").eq("as_of", asOf).limit(1);
    if (readErr) throw new Error(`s5fi read failed: ${readErr.message}`);
    if (existing?.length) {
      return res.status(200).json({ ...summary, wrote: false, reason: `session ${summary.sessionDate} already recorded` });
    }

    const { error: writeErr } = await supabase.from("s5fi").insert({
      as_of: asOf,
      pct: summary.pct,
      above: summary.above,
      total: summary.total,
    });
    if (writeErr) throw new Error(`s5fi write failed: ${writeErr.message}`);

    console.log(`[api/uw-breadth] ${summary.sessionDate}: ${summary.pct}% (${summary.above}/${summary.total}), ${failures.length} unresolved`);
    return res.status(200).json({ ...summary, wrote: true, asOf, failures: failures.slice(0, 10) });
  } catch (err) {
    console.error("[api/uw-breadth] failed:", err.message);
    return res.status(500).json({ ok: false, error: err.message, wrote: false });
  }
}

/**
 * api/uw-earnings-dates.js — Vercel serverless function (cron)
 *
 * GET /api/uw-earnings-dates              → next earnings date for the whole
 *                                            approved universe + held tickers
 * GET /api/uw-earnings-dates?tickers=MU   → just these (smoke test)
 *
 * Sources quotes.earnings_date / earnings_meta directly from Unusual Whales
 * (/earnings/{ticker}), replacing the Finnhub-via-OpenClaw push. OpenClaw only
 * existed because Vercel was network-blocked from Finnhub; UW we can hit
 * directly, so the residential-IP detour goes away and coverage extends to
 * every ticker UW knows.
 *
 * Writes the same shape the old ingest produced (earnings_date + earnings_meta
 * with hour/epsEstimate/source), so every existing consumer — Radar,
 * ticker-detail, monthly-review, intraday-snapshot, earnings-dates,
 * OpenPositions — keeps working unchanged. Upsert touches only the earnings_*
 * columns, leaving last/mid/iv from the quote jobs intact. A ticker with no
 * upcoming report is written earnings_date=NULL so stale past dates clear.
 *
 * Earnings dates move slowly → once daily. In middleware BYPASS;
 * self-authenticates. Soft no-op until UW_API_KEY is set.
 */

import { createClient } from "@supabase/supabase-js";
import { hasUwKey, fetchEarnings } from "./_lib/uwClient.js";

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

// UW report_time → the bmo/amc convention the app already displays.
function hourFromReportTime(t) {
  const s = String(t ?? "").toLowerCase();
  if (s.startsWith("pre"))  return "bmo"; // premarket → before market open
  if (s.startsWith("post")) return "amc"; // postmarket → after market close
  return null;
}

// The next earnings row at/after today, or null if none upcoming.
function upcomingEarningsRow(resp, todayIso) {
  const rows = resp?.data ?? resp ?? [];
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows
    .filter((r) => r?.report_date && String(r.report_date) >= todayIso)
    .sort((a, b) => String(a.report_date).localeCompare(String(b.report_date)))[0] ?? null;
}

// Build the quotes patch for one ticker. No upcoming report → clear the date.
function earningsPatch(resp, todayIso, now) {
  const row = upcomingEarningsRow(resp, todayIso);
  if (!row) {
    return {
      earnings_date:         null,
      earnings_meta:         { source: "unusualwhales", ingestedAt: now },
      earnings_refreshed_at: now,
    };
  }
  const meta = { source: "unusualwhales", ingestedAt: now };
  const hour = hourFromReportTime(row.report_time);
  if (hour) meta.hour = hour;
  const eps = parseFloat(row.street_mean_est);
  if (Number.isFinite(eps)) meta.epsEstimate = eps;
  // expected_move_perc is a decimal fraction (0.0486 = 4.86%) — keep as a percent.
  const em = parseFloat(row.expected_move_perc);
  if (Number.isFinite(em)) meta.expectedMovePct = +(em < 1 ? em * 100 : em).toFixed(2);

  return {
    earnings_date:         String(row.report_date),
    earnings_meta:         meta,
    earnings_refreshed_at: now,
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });
  if (!hasUwKey()) return res.status(200).json({ ok: true, skipped: "UW_API_KEY not configured", updated: 0 });

  try {
    const supabase = getSupabase();
    const today = new Date().toISOString().slice(0, 10);
    const now   = new Date().toISOString();

    const override = (req.query.tickers || "").trim();
    let tickers;
    if (override) {
      tickers = [...new Set(override.toUpperCase().split(",").map((t) => t.trim()).filter(Boolean))];
    } else {
      const [universe, positions] = await Promise.all([
        supabase.from("wheel_universe").select("ticker").eq("list_type", "approved"),
        supabase.from("positions").select("ticker"),
      ]);
      const set = new Set();
      (universe.data  ?? []).forEach((r) => r.ticker && set.add(r.ticker));
      (positions.data ?? []).forEach((r) => r.ticker && set.add(r.ticker));
      tickers = [...set].sort();
    }

    const results = [];
    for (const ticker of tickers) {
      try {
        const resp  = await fetchEarnings(ticker);
        const patch = earningsPatch(resp, today, now);
        const { error } = await supabase
          .from("quotes")
          .upsert({ symbol: ticker, instrument_type: "EQUITY", ...patch }, { onConflict: "symbol" });
        results.push({ ticker, ok: !error, error: error?.message, earnings_date: patch.earnings_date });
      } catch (err) {
        results.push({ ticker, ok: false, error: err?.message ?? String(err) });
      }
    }

    const failed = results.filter((r) => !r.ok);
    if (failed.length) console.warn("[api/uw-earnings-dates] failures:", failed);
    const dated = results.filter((r) => r.ok && r.earnings_date).length;
    console.log(`[api/uw-earnings-dates] updated ${results.filter((r) => r.ok).length}/${tickers.length} (${dated} with upcoming dates)`);

    return res.status(200).json({
      ok: true,
      updated: results.filter((r) => r.ok).length,
      with_dates: dated,
      total: tickers.length,
      results,
    });
  } catch (err) {
    console.error("[api/uw-earnings-dates]", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

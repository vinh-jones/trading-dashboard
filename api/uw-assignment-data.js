/**
 * api/uw-assignment-data.js — Vercel serverless function (cron)
 *
 * GET /api/uw-assignment-data              → short interest + earnings move for open positions
 * GET /api/uw-assignment-data?tickers=NVDA → just these (smoke test)
 *
 * Consumer 2 v2. Short interest and earnings expected-move change slowly and
 * only matter for positions you HOLD, so this is scoped to open-position
 * tickers (~20) and run a couple times a day — separate from the 55-ticker
 * intraday uw-snapshot so neither blows the function timeout.
 *
 * Uses .update() (not upsert) so it only touches short_interest_pct and
 * earnings_expected_move_pct, leaving the flow/gamma fields from uw-snapshot.
 * Soft no-op until UW_API_KEY is set. In middleware BYPASS; self-authenticates.
 */

import { createClient } from "@supabase/supabase-js";
import { hasUwKey, fetchShortInterest, fetchEarnings } from "./_lib/uwClient.js";

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

// Field on a short-interest row that holds short interest as a fraction of
// float, ordered most- to least- semantically precise. UW's interest-float
// rows expose this as `si_float...` (short interest ÷ float, a small decimal
// like 0.012 = 1.2%). NOT `percent_returned`, which is a securities-lending
// "shares returned" stat that runs in the double digits — wrong metric.
const SHORT_FLOAT_FIELDS = [
  "short_percent_of_float",
  "short_interest_percent_of_float",
  "si_float_perc",
  "si_float_returned",
  "si_float",
  "percent_of_float",
  "short_float_perc",
];

// Row date, newest first. UW uses market_date (or created_at) on these rows.
function shortRowDate(r) {
  return String(r?.market_date ?? r?.created_at ?? r?.date ?? "");
}

// Pick the first finite numeric value across a list of candidate keys.
function pickNum(row, keys) {
  for (const k of keys) {
    if (row && row[k] != null) {
      const v = parseFloat(row[k]);
      if (Number.isFinite(v)) return v;
    }
  }
  return null;
}

// Latest short interest as a percent of float. UW returns the ratio as a
// fraction (0.012 = 1.2%); if a field already comes through as a percent
// (>= 1) leave it. Realistic short floats top out well under 100%.
function latestShortFloatPct(resp) {
  const rows = resp?.data ?? resp ?? [];
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const latest = [...rows].sort((a, b) => shortRowDate(b).localeCompare(shortRowDate(a)))[0];
  const v = pickNum(latest, SHORT_FLOAT_FIELDS);
  if (v == null) return null;
  return +(v < 1 ? v * 100 : v).toFixed(2);
}

// Expected option-implied move % for the next upcoming earnings report.
// expected_move_perc may be a fraction (0.08) or a percent (8) — normalize.
function upcomingExpectedMovePct(resp, todayIso) {
  const rows = resp?.data ?? resp ?? [];
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const upcoming = rows
    .filter((r) => r?.report_date && String(r.report_date) >= todayIso && r.expected_move_perc != null)
    .sort((a, b) => String(a.report_date).localeCompare(String(b.report_date)))[0];
  if (!upcoming) return null;
  const v = parseFloat(upcoming.expected_move_perc);
  if (!Number.isFinite(v)) return null;
  return +(v < 1 ? v * 100 : v).toFixed(2);
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });
  if (!hasUwKey()) return res.status(200).json({ ok: true, skipped: "UW_API_KEY not configured", updated: 0 });

  try {
    const supabase = getSupabase();
    const today = new Date().toISOString().slice(0, 10);

    const override = (req.query.tickers || "").trim();
    let tickers;
    if (override) {
      tickers = [...new Set(override.toUpperCase().split(",").map((t) => t.trim()).filter(Boolean))];
    } else {
      const { data } = await supabase.from("positions").select("ticker");
      tickers = [...new Set((data ?? []).map((r) => r.ticker).filter(Boolean))].sort();
    }

    const results = [];
    // ?debug=1 — dump the raw UW response shape (field names + a couple rows)
    // so the parsers can be mapped exactly. Does not write.
    if (req.query.debug) {
      const trim = (resp) => {
        const rows = resp?.data ?? resp;
        if (Array.isArray(rows)) return { count: rows.length, keys: Object.keys(rows[0] ?? {}), sample: rows.slice(0, 2) };
        if (rows && typeof rows === "object") return { keys: Object.keys(rows), value: rows };
        return rows;
      };
      const debug = [];
      for (const ticker of tickers) {
        const [shortResp, earnResp] = await Promise.all([fetchShortInterest(ticker), fetchEarnings(ticker)]);
        debug.push({ ticker, short: trim(shortResp), earnings: trim(earnResp) });
      }
      return res.status(200).json({ ok: true, debug });
    }

    for (const ticker of tickers) {
      try {
        const [shortResp, earnResp] = await Promise.all([fetchShortInterest(ticker), fetchEarnings(ticker)]);
        const patch = {
          short_interest_pct:         latestShortFloatPct(shortResp),
          earnings_expected_move_pct: upcomingExpectedMovePct(earnResp, today),
        };
        const { error } = await supabase.from("uw_signals").update(patch).eq("ticker", ticker);
        results.push({ ticker, ok: !error, error: error?.message, ...patch });
      } catch (err) {
        results.push({ ticker, ok: false, error: err?.message ?? String(err) });
      }
    }

    const failed = results.filter((r) => !r.ok);
    if (failed.length) console.warn("[api/uw-assignment-data] failures:", failed);
    console.log(`[api/uw-assignment-data] updated ${results.filter((r) => r.ok).length}/${tickers.length}`);

    return res.status(200).json({ ok: true, updated: results.filter((r) => r.ok).length, total: tickers.length, results });
  } catch (err) {
    console.error("[api/uw-assignment-data]", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

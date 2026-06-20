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

// Latest short interest as a percent of float. short_float_perc is a decimal
// string (0.0082 = 0.82%).
function latestShortFloatPct(resp) {
  const rows = resp?.data ?? resp ?? [];
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const latest = [...rows].sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")))[0];
  const v = parseFloat(latest?.short_float_perc);
  return Number.isFinite(v) ? +(v * 100).toFixed(2) : null;
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
    for (const ticker of tickers) {
      try {
        const [shortResp, earnResp] = await Promise.all([fetchShortInterest(ticker), fetchEarnings(ticker)]);
        const patch = {
          short_interest_pct:         latestShortFloatPct(shortResp),
          earnings_expected_move_pct: upcomingExpectedMovePct(earnResp, today),
        };
        const { error } = await supabase.from("uw_signals").update(patch).eq("ticker", ticker);
        results.push({ ticker, ok: !error, error: error?.message });
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

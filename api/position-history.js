/**
 * GET /api/position-history?ticker=&type=&strike=&expiry=
 *
 * Returns one position's per-day capture data from daily_snapshots'
 * forecast_per_position: [{date, members:[{ticker,type,strike,expiry,
 * current_profit_pct,premium_at_open}]}] (members holds the single matching
 * row per day). Reuses buildCohortHistory with a one-tuple list. Auth covered
 * by middleware.js (matcher /api/:path*).
 */

import { createClient } from "@supabase/supabase-js";
import { buildCohortHistory } from "./_lib/cohortHistory.js";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const ticker = String(req.query.ticker ?? "").toUpperCase();
  const type   = String(req.query.type ?? "").toUpperCase();
  const strike = String(req.query.strike ?? "");
  const expiry = String(req.query.expiry ?? "");

  if (!/^[A-Z.]{1,8}$/.test(ticker) ||
      !["CSP", "CC"].includes(type) ||
      !/^\d+(\.\d+)?$/.test(strike) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
    res.status(400).json({ ok: false, error: "Invalid position parameters" });
    return;
  }

  try {
    const supabase = getSupabase();
    const { data: snaps, error } = await supabase
      .from("daily_snapshots")
      .select("snapshot_date, forecast_per_position")
      .not("forecast_per_position", "is", null)
      .order("snapshot_date", { ascending: true });
    if (error) throw new Error(error.message);

    const tuple = { ticker, type, strike: Number(strike), expiry };
    const data = buildCohortHistory(snaps ?? [], [tuple]);
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.status(200).json({ ok: true, data });
  } catch (err) {
    console.error("[api/position-history] Error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}

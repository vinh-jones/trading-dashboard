/**
 * GET /api/cohort-history?tag=cohort:<slug>
 *
 * Resolves the cohort's member tuples server-side (journal entries carrying
 * the tag) and returns per-day capture data from daily_snapshots'
 * forecast_per_position: [{date, members: [{ticker, type, strike, expiry,
 * current_profit_pct, premium_at_open}]}]. Auth: covered by middleware.js
 * (matcher /api/:path*) like every other endpoint.
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
  const tag = String(req.query.tag ?? "");
  if (!/^cohort:[a-z0-9-]+$/.test(tag)) {
    res.status(400).json({ ok: false, error: "Invalid cohort tag" });
    return;
  }

  try {
    const supabase = getSupabase();

    const { data: entries, error: entriesErr } = await supabase
      .from("journal_entries")
      .select("ticker, type, strike, expiry")
      .contains("tags", [tag]);
    if (entriesErr) throw new Error(entriesErr.message);

    const { data: snaps, error: snapsErr } = await supabase
      .from("daily_snapshots")
      .select("snapshot_date, forecast_per_position")
      .not("forecast_per_position", "is", null)
      .order("snapshot_date", { ascending: true });
    if (snapsErr) throw new Error(snapsErr.message);

    const data = buildCohortHistory(snaps ?? [], entries ?? []);
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.status(200).json({ ok: true, data });
  } catch (err) {
    console.error("[api/cohort-history] Error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * api/ingest-fedwatch.js — Vercel serverless function
 *
 * POST /api/ingest-fedwatch
 *
 * Accepts the FedWatch rate-probability snapshot scraped by OpenClaw from
 * rateprobability.com on a residential IP — its Cloudflare 403s Vercel's
 * datacenter IPs, so the app can't fetch it directly. /api/macro reads the
 * latest row from the `fedwatch` table (ORDER BY as_of DESC LIMIT 1) and runs
 * the rate-expectations math over the stored rows (so date-sensitive fields
 * stay fresh even on a day-old snapshot).
 *
 * Authentication: X-Ingest-Secret header must match MARKET_CONTEXT_INGEST_SECRET.
 *
 * POST body shape (pass rateprobability.com/api/latest through largely as-is):
 *   {
 *     asOf:        string (ISO timestamp)  — required
 *     midpoint:    number                  — required, current Fed funds midpoint (%), e.g. data.today.midpoint
 *     todayRows:   array                   — required, non-empty; data.today.rows
 *     weekAgoRows: array                   — optional; data.ago_1w.rows
 *   }
 *
 * Each row should carry: meeting_iso, num_moves, num_moves_is_cut,
 * implied_rate_post_meeting, prob_move_pct, prob_is_cut.
 */

import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL      || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const secret = process.env.MARKET_CONTEXT_INGEST_SECRET;
  if (!secret) {
    return res.status(500).json({ ok: false, error: "Server misconfiguration" });
  }
  if (req.headers["x-ingest-secret"] !== secret) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const body = req.body ?? {};
  const midpoint = Number(body.midpoint);
  if (!body.asOf || !Number.isFinite(midpoint)) {
    return res.status(400).json({ ok: false, error: "Invalid payload: missing asOf or numeric midpoint" });
  }
  if (!Array.isArray(body.todayRows) || body.todayRows.length === 0) {
    return res.status(400).json({ ok: false, error: "Invalid payload: todayRows must be a non-empty array" });
  }
  if (body.weekAgoRows != null && !Array.isArray(body.weekAgoRows)) {
    return res.status(400).json({ ok: false, error: "Invalid payload: weekAgoRows must be an array" });
  }

  try {
    const supabase = getSupabase();
    const { error } = await supabase.from("fedwatch").insert({
      as_of: body.asOf,
      midpoint,
      today_rows: body.todayRows,
      week_ago_rows: body.weekAgoRows ?? null,
    });
    if (error) throw new Error(error.message);

    console.log(`[api/ingest-fedwatch] inserted midpoint=${midpoint} rows=${body.todayRows.length} as_of=${body.asOf}`);
    return res.status(200).json({ ok: true, asOf: body.asOf, midpoint, rows: body.todayRows.length });
  } catch (err) {
    console.error("[api/ingest-fedwatch]", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * api/signal-log.js — Vercel serverless function
 *
 * POST /api/signal-log  { snapshots: [{ position_key, ticker, redeploy_state,
 *   overlay_state, assignment_level, hard_close, gex_env, flow_streak }, ...] }
 *
 * Decision-attribution log (finance review cross-cutting #3). The Open Positions
 * view posts what the signals recommended on each open CSP at the moment it was
 * viewed — the signal state at decision-viewing time. Upserted once per position
 * per day so re-opening the dashboard doesn't pile up rows. The monthly review
 * reads this back to show which signals actually diverged from what was done.
 *
 * Gated by the APP_SECRET middleware (logged-in user action; not in BYPASS), so
 * the SPA's app_auth cookie authenticates it.
 */

import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const snapshots = Array.isArray(req.body?.snapshots) ? req.body.snapshots : [];
    if (snapshots.length === 0) return res.status(200).json({ ok: true, logged: 0 });

    const today = new Date().toISOString().slice(0, 10);
    const rows = snapshots
      .filter((s) => s?.position_key)
      .map((s) => ({
        logged_date:      today,
        position_key:     String(s.position_key),
        ticker:           s.ticker ?? null,
        redeploy_state:   s.redeploy_state ?? null,
        overlay_state:    s.overlay_state ?? null,
        assignment_level: s.assignment_level ?? null,
        hard_close:       typeof s.hard_close === "boolean" ? s.hard_close : null,
        gex_env:          s.gex_env ?? null,
        flow_streak:      Number.isFinite(s.flow_streak) ? s.flow_streak : null,
      }));

    if (rows.length === 0) return res.status(200).json({ ok: true, logged: 0 });

    const supabase = getSupabase();
    const { error } = await supabase.from("signal_log").upsert(rows, { onConflict: "logged_date,position_key" });
    if (error) throw new Error(error.message);

    return res.status(200).json({ ok: true, logged: rows.length });
  } catch (err) {
    console.error("[api/signal-log]", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

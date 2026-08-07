/**
 * api/focus-context.js — Vercel serverless function
 *
 * GET /api/focus-context
 *
 * Returns, in a single round-trip:
 *   - `macroEvents`:   upcoming rows from `macro_events` (UW economic calendar)
 *   - `alertState`:    all currently-outstanding Focus Engine alerts that
 *                      have already been pushed (from `alert_state`). Used by
 *                      FocusTab to render a bell badge + "pushed at" tooltip
 *                      next to items that have an active notification in flight.
 *
 * Both sub-queries fail soft — a missing row / read error yields an empty
 * value rather than a 500. Nothing in this endpoint is critical path.
 */

import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  // macro_events is RLS-locked (no anon policy) — must use the service
  // role server-side. Anon fallback is for local dev only.
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const supabase = getSupabase();

    const [macroResult, alertStateResult] = await Promise.all([
      supabase
        .from("macro_events")
        .select("event_date, event_type, event_time, title, forecast, previous, refreshed_at")
        .gte("event_date", new Date().toISOString().slice(0, 10))
        .order("event_date", { ascending: true }),
      supabase
        .from("alert_state")
        .select("alert_id, first_fired_at, last_seen_at, title"),
    ]);

    if (macroResult.error) {
      console.warn("[api/focus-context] macro_events read failed:", macroResult.error.message);
    }
    const macroEvents      = macroResult.data ?? [];
    const macroRefreshedAt = macroEvents[0]?.refreshed_at ?? null;

    // alert_state is nice-to-have; log but don't fail the request on read error
    let alertState = [];
    if (alertStateResult.error) {
      console.warn("[api/focus-context] alert_state read failed:", alertStateResult.error.message);
    } else {
      alertState = alertStateResult.data ?? [];
    }

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.status(200).json({ ok: true, macroEvents, macroRefreshedAt, alertState });
  } catch (err) {
    console.error("[api/focus-context] Error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}

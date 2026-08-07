/**
 * api/uw-macro-events.js — Vercel serverless function (cron)
 *
 * GET /api/uw-macro-events        → refresh the upcoming macro window
 * GET /api/uw-macro-events?days=3 → narrower window (smoke test)
 *
 * Replaces market_context.macro_events, which died with OpenClaw. Writes the
 * six whitelisted headline releases (CPI/PPI/NFP/FOMC/PCE/RETAIL_SALES) into
 * macro_events for the Focus calendar and focusEngine's macro_overlap rule.
 *
 * DELETE-then-INSERT rather than upsert: UW's horizon is ~8 days, so passed
 * events must clear or the table accumulates history the calendar would have
 * to filter around forever.
 *
 * Macro dates move slowly → once daily. In middleware BYPASS;
 * self-authenticates. Soft no-op until UW_API_KEY is set.
 */

import { createClient } from "@supabase/supabase-js";
import { hasUwKey, fetchMarketEvents } from "./_lib/uwClient.js";
import { normalizeEvents } from "./_lib/macroEvents.js";

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
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });
  if (!hasUwKey()) return res.status(200).json({ ok: true, skipped: "UW_API_KEY not configured", written: 0 });

  try {
    const supabase = getSupabase();
    const now      = new Date().toISOString();
    const today    = now.slice(0, 10);
    const days     = Math.min(Math.max(parseInt(req.query.days, 10) || 21, 1), 60);
    const maxDate  = new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

    const resp = await fetchMarketEvents(today, maxDate);
    const rows = normalizeEvents(resp, now);

    // Replace the ENTIRE table, not just >= today. This table only ever holds
    // UW's forward window, so there is nothing worth keeping behind us.
    //
    // Deleting >= today instead would leave a permanent orphan every single
    // day: a row written today for today sits below tomorrow's floor and is
    // never revisited, so the table grows without bound — the exact thing this
    // replace-per-run is supposed to prevent. Consumers all filter >= today, so
    // the strays would be invisible while accumulating.
    //
    // The 1900 bound is a "match everything" filter: PostgREST refuses an
    // unfiltered DELETE, so a tautological predicate is the idiom.
    const { error: delErr } = await supabase
      .from("macro_events")
      .delete()
      .gte("event_date", "1900-01-01");
    if (delErr) throw new Error(`macro_events delete failed: ${delErr.message}`);

    if (rows.length) {
      const { error: insErr } = await supabase.from("macro_events").insert(rows);
      if (insErr) throw new Error(`macro_events insert failed: ${insErr.message}`);
    }

    const types = [...new Set(rows.map((r) => r.event_type))].sort();
    // An empty type list means the classifier stopped matching UW's names.
    if (!types.length) {
      console.warn("[api/uw-macro-events] no events classified — check UW event names against api/_lib/macroEvents.js");
    }
    console.log(`[api/uw-macro-events] wrote ${rows.length} rows through ${maxDate} (types: ${types.join(", ") || "none"})`);

    return res.status(200).json({ ok: true, written: rows.length, types, through: maxDate });
  } catch (err) {
    console.error("[api/uw-macro-events]", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

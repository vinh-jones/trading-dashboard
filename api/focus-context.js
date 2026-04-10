/**
 * api/focus-context.js — Vercel serverless function
 *
 * GET /api/focus-context
 *
 * Returns the latest market context row from Supabase (written by OpenClaw ETL).
 * Returns { ok: true, marketContext: null } if no rows exist yet.
 */

import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL      || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
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
    const { data, error } = await supabase
      .from("market_context")
      .select("*")
      .order("as_of", { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 = no rows found — not an error for us
      throw new Error(error.message);
    }

    if (!data) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.status(200).json({ ok: true, marketContext: null });
      return;
    }

    const marketContext = {
      asOf:        data.as_of,
      positions:   data.positions,
      macroEvents: data.macro_events,
    };

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.status(200).json({ ok: true, marketContext });
  } catch (err) {
    console.error("[api/focus-context] Error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}

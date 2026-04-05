/**
 * api/sync.js — Vercel serverless function
 * POST /api/sync
 *
 * Fetches all three Google Sheets tabs and writes to Supabase:
 *   - Upserts closed trades (append-only)
 *   - Replaces open positions entirely
 *   - Upserts today's account snapshot
 *
 * Called by the Sync Sheet button in production.
 */

import { createClient } from "@supabase/supabase-js";
import { syncFromSheets } from "../lib/syncSheets.js";

function getSupabase() {
  const url = process.env.SUPABASE_URL      || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const supabase = getSupabase();
    const { tradesCount, positionsCount } = await syncFromSheets(supabase);
    res.status(200).json({ ok: true, tradesCount, positionsCount });
  } catch (err) {
    console.error("[api/sync] Error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * api/delete-trade.js — Vercel serverless function
 *
 * DELETE /api/delete-trade?id=<uuid>
 *
 * Deletes a single trade from Supabase by its id.
 * Used by the calendar view to remove duplicate or incorrect trade entries.
 */

import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL      || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

export default async function handler(req, res) {
  if (req.method !== "DELETE") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const { id } = req.query;
  if (!id) {
    res.status(400).json({ ok: false, error: "Missing trade id" });
    return;
  }

  try {
    const supabase = getSupabase();
    const { error } = await supabase.from("trades").delete().eq("id", id);
    if (error) throw new Error(error.message);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[api/delete-trade] Error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}

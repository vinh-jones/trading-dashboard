// api/_lib/orbDb.js — Supabase access for orb_sessions.

import { createClient } from "@supabase/supabase-js";

export function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

export async function getSession(supabase, symbol, sessionDate) {
  const { data, error } = await supabase
    .from("orb_sessions")
    .select("*")
    .eq("symbol", symbol)
    .eq("session_date", sessionDate)
    .maybeSingle();
  if (error) throw new Error(`orb_sessions read failed: ${error.message}`);
  return data ?? null;
}

/** Upsert on the natural key so a double-fired cron cannot create two rows. */
export async function upsertSession(supabase, row) {
  const { data, error } = await supabase
    .from("orb_sessions")
    .upsert({ ...row, updated_at: new Date().toISOString() },
            { onConflict: "symbol,session_date" })
    .select()
    .single();
  if (error) throw new Error(`orb_sessions upsert failed: ${error.message}`);
  return data;
}

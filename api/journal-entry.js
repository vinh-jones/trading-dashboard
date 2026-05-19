/**
 * api/journal-entry.js — Vercel serverless function
 *
 * POST   /api/journal-entry        body: <entry payload>          → inserts, returns row
 * PATCH  /api/journal-entry        body: { id, fields }           → updates by id, returns row
 * DELETE /api/journal-entry?id=    → deletes by id
 *
 * journal_entries is RLS-locked to anon SELECT only. The browser must route
 * all writes through this service-key endpoint instead of the public bundle key.
 */

import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  // journal_entries is RLS-locked (anon SELECT only) — writes need the service
  // role server-side. Anon fallback is local dev only.
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

export default async function handler(req, res) {
  try {
    const supabase = getSupabase();

    if (req.method === "POST") {
      const payload = req.body;
      if (!payload || typeof payload !== "object") {
        res.status(400).json({ ok: false, error: "Missing entry payload" });
        return;
      }
      const { data, error } = await supabase
        .from("journal_entries")
        .insert(payload)
        .select()
        .single();
      if (error) throw new Error(error.message);
      res.status(200).json({ ok: true, data });
      return;
    }

    if (req.method === "PATCH") {
      const { id, fields } = req.body || {};
      if (!id || !fields || typeof fields !== "object") {
        res.status(400).json({ ok: false, error: "Missing id or fields" });
        return;
      }
      const { data, error } = await supabase
        .from("journal_entries")
        .update(fields)
        .eq("id", id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      res.status(200).json({ ok: true, data });
      return;
    }

    if (req.method === "DELETE") {
      const { id } = req.query;
      if (!id) {
        res.status(400).json({ ok: false, error: "Missing entry id" });
        return;
      }
      const { error } = await supabase.from("journal_entries").delete().eq("id", id);
      if (error) throw new Error(error.message);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err) {
    console.error("[api/journal-entry] Error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}

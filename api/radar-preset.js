/**
 * api/radar-preset.js — Vercel serverless function
 *
 * POST   /api/radar-preset   body: { name, filters }              → inserts (auto display_order), returns row
 * PATCH  /api/radar-preset   body: { id, name, filters }          → updates by id, returns row
 * DELETE /api/radar-preset?id=  → deletes by id
 *
 * radar_presets is RLS-locked to anon SELECT only. The browser must route all
 * writes through this service-key endpoint instead of the public bundle key.
 */

import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  // radar_presets is RLS-locked (anon SELECT only) — writes need the service
  // role server-side. Anon fallback is local dev only.
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

export default async function handler(req, res) {
  try {
    const supabase = getSupabase();

    if (req.method === "POST") {
      const { name, filters } = req.body || {};
      if (!name || !filters) {
        res.status(400).json({ ok: false, error: "Missing name or filters" });
        return;
      }
      const { data: existing } = await supabase
        .from("radar_presets")
        .select("display_order")
        .order("display_order", { ascending: false })
        .limit(1);
      const maxOrder = existing?.[0]?.display_order ?? 0;
      const { data, error } = await supabase
        .from("radar_presets")
        .insert({ name, filters, display_order: maxOrder + 1, updated_at: new Date().toISOString() })
        .select()
        .single();
      if (error) throw new Error(error.message);
      res.status(200).json({ ok: true, data });
      return;
    }

    if (req.method === "PATCH") {
      const { id, name, filters } = req.body || {};
      if (!id || !name || !filters) {
        res.status(400).json({ ok: false, error: "Missing id, name, or filters" });
        return;
      }
      const { data, error } = await supabase
        .from("radar_presets")
        .update({ name, filters, updated_at: new Date().toISOString() })
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
        res.status(400).json({ ok: false, error: "Missing preset id" });
        return;
      }
      const { error } = await supabase.from("radar_presets").delete().eq("id", id);
      if (error) throw new Error(error.message);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err) {
    console.error("[api/radar-preset] Error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}

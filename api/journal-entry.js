/**
 * api/journal-entry.js — Vercel serverless function
 *
 * GET    /api/journal-entry?...     → lists entries (filters below)
 * POST   /api/journal-entry        body: <entry payload>          → inserts, returns row
 * PATCH  /api/journal-entry        body: { id, fields }           → updates by id, returns row
 * DELETE /api/journal-entry?id=    → deletes by id
 *
 * journal_entries is RLS-locked (anon has no policy). The browser must route
 * ALL access — reads and writes — through this service-key endpoint instead of
 * the public bundle anon key. This endpoint is APP_SECRET-gated by middleware.js.
 *
 * GET filters (all optional): type (entry_type eq), ticker (eq),
 * tickers (comma list, IN), since (entry_date >=), tag (tags contains),
 * from/to (created_at >=/<=), hasTags=1 (tags not null), limit (N).
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

    if (req.method === "GET") {
      const { type, ticker, tickers, since, tag, from, to, hasTags, limit } = req.query;
      let q = supabase.from("journal_entries").select("*");
      if (type && type !== "all")     q = q.eq("entry_type", type);
      if (ticker && ticker !== "all") q = q.eq("ticker", ticker);
      if (tickers)                    q = q.in("ticker", String(tickers).split(",").filter(Boolean));
      if (since)                      q = q.gte("entry_date", since);
      if (tag)                        q = q.contains("tags", [tag]);
      if (from)                       q = q.gte("created_at", from);
      if (to)                         q = q.lte("created_at", to);
      if (hasTags === "1")            q = q.not("tags", "is", null);
      q = q.order("entry_date", { ascending: false }).order("created_at", { ascending: false });
      const n = parseInt(limit, 10);
      if (Number.isFinite(n) && n > 0) q = q.limit(n);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      res.status(200).json({ ok: true, data: data ?? [] });
      return;
    }

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

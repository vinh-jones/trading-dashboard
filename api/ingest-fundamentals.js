/**
 * api/ingest-fundamentals.js — Vercel serverless function
 *
 * POST /api/ingest-fundamentals
 *
 * Receives P/E + EPS fundamentals from OpenClaw (residential Mac) and upserts
 * into the fundamentals table. Auth via X-Ingest-Secret header.
 *
 * Body: { fundamentals: [{ ticker, pe_ttm, pe_annual, eps_ttm, eps_annual }] }
 */

import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL      || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const secret = process.env.MARKET_CONTEXT_INGEST_SECRET;
  if (!secret || req.headers["x-ingest-secret"] !== secret) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const { fundamentals } = req.body ?? {};
  if (!Array.isArray(fundamentals) || fundamentals.length === 0) {
    return res.status(400).json({ ok: false, error: "fundamentals array required" });
  }

  try {
    const supabase = getSupabase();
    const now = new Date().toISOString();

    const rows = fundamentals.map(f => ({
      ticker:       f.ticker,
      pe_ttm:       f.pe_ttm    ?? null,
      pe_annual:    f.pe_annual ?? null,
      eps_ttm:      f.eps_ttm   ?? null,
      eps_annual:   f.eps_annual ?? null,
      refreshed_at: now,
    }));

    const { error } = await supabase
      .from("fundamentals")
      .upsert(rows, { onConflict: "ticker" });

    if (error) throw error;

    console.log(`[api/ingest-fundamentals] Upserted ${rows.length} rows`);
    return res.status(200).json({ ok: true, count: rows.length });
  } catch (err) {
    console.error("[api/ingest-fundamentals]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * api/iv-tickers.js — Vercel serverless function
 *
 * GET /api/iv-tickers
 *
 * Returns the list of equity tickers that have assigned_shares positions.
 * Used by OpenClaw to know which symbols to fetch from Tastytrade market-metrics
 * before POSTing to /api/ingest-iv.
 *
 * Authentication: X-Ingest-Secret header must match MARKET_CONTEXT_INGEST_SECRET.
 */

import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL      || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const secret = process.env.MARKET_CONTEXT_INGEST_SECRET;
  if (!secret || req.headers["x-ingest-secret"] !== secret) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("positions")
      .select("ticker")
      .eq("position_type", "assigned_shares");

    if (error) throw new Error(error.message);

    const tickers = [...new Set((data ?? []).map(r => r.ticker))].sort();
    return res.status(200).json({ ok: true, tickers });
  } catch (err) {
    console.error("[api/iv-tickers]", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

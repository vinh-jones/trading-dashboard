/**
 * api/earnings-dates.js — Vercel serverless function
 *
 * GET /api/earnings-dates
 *
 * Returns upcoming earnings dates for the approved wheel universe + any
 * currently-held tickers, reading directly from quotes.earnings_date.
 * Populated daily by OpenClaw via POST /api/ingest-wheel-earnings (Finnhub).
 *
 * Response shape:
 *   { ok: true, earnings: [{ ticker, date, hour, confidence }], asOf }
 *   date:       YYYY-MM-DD, only upcoming (>= today)
 *   hour:       "bmo" | "amc" | null  (before/after market open)
 *   confidence: "high" | "medium" | "low" | null
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
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const supabase = getSupabase();
    const today    = new Date().toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from("quotes")
      .select("symbol, earnings_date, earnings_meta")
      .eq("instrument_type", "EQUITY")
      .not("earnings_date", "is", null)
      .gte("earnings_date", today)
      .order("earnings_date", { ascending: true });

    if (error) throw new Error(error.message);

    const earnings = (data || []).map(r => ({
      ticker:     r.symbol,
      date:       r.earnings_date,
      hour:       r.earnings_meta?.hour       ?? null,
      confidence: r.earnings_meta?.confidence ?? null,
    }));

    return res.status(200).json({ ok: true, earnings, asOf: new Date().toISOString() });
  } catch (err) {
    console.error("[api/earnings-dates]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

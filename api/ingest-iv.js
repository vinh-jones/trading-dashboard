/**
 * api/ingest-iv.js — Vercel serverless function
 *
 * GET  /api/ingest-iv  → returns approved ticker list (replaces /api/iv-tickers)
 * POST /api/ingest-iv  → accepts IV data from OpenClaw and writes to quotes table
 *
 * Tastytrade blocks datacenter IPs (Vercel/AWS), so OpenClaw fetches IV on a
 * residential IP, then POSTs it here to persist.
 *
 * Authentication: X-Ingest-Secret header must match MARKET_CONTEXT_INGEST_SECRET.
 *
 * POST body shape:
 *   {
 *     quotes: [
 *       {
 *         symbol:     "PLTR",
 *         iv:         0.728,
 *         iv_rank:    46.75,
 *         last:       108.40,   // optional — intraday stock price
 *         prev_close: 110.74,   // optional — yesterday's close, for Radar change %
 *       },
 *       ...
 *     ]
 *   }
 *
 * last and prev_close are optional for backward compat. When provided they
 * keep the Radar row's price + change % fresh at the ingest cadence (~15 min)
 * rather than waiting for /api/bb's 2h refresh.
 */

import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL      || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

function authCheck(req, res) {
  const secret = process.env.MARKET_CONTEXT_INGEST_SECRET;
  if (!secret) {
    res.status(500).json({ ok: false, error: "Server misconfiguration" });
    return false;
  }
  if (req.headers["x-ingest-secret"] !== secret) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return false;
  }
  return true;
}

export default async function handler(req, res) {
  if (!authCheck(req, res)) return;

  // ── GET: return approved ticker list ────────────────────────────────────────
  if (req.method === "GET") {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("wheel_universe")
        .select("ticker")
        .eq("list_type", "approved");

      if (error) throw new Error(error.message);

      const tickers = [...new Set((data ?? []).map(r => r.ticker))].sort();
      return res.status(200).json({ ok: true, tickers });
    } catch (err) {
      console.error("[api/ingest-iv GET]", err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  // ── POST: upsert IV data ────────────────────────────────────────────────────
  if (req.method === "POST") {
    const { quotes } = req.body ?? {};

    if (!Array.isArray(quotes) || !quotes.length) {
      return res.status(400).json({ ok: false, error: "Invalid payload: expected quotes array" });
    }

    try {
      const supabase = getSupabase();
      const now      = new Date().toISOString();

      const results = await Promise.all(
        quotes.map((q) => {
          const { symbol, iv, iv_rank, last, prev_close } = q ?? {};
          if (!symbol) return Promise.resolve({ symbol, ok: false, error: "missing symbol" });
          const patch = { refreshed_at: now };
          if (iv        !== undefined) patch.iv        = iv        ?? null;
          if (iv_rank   !== undefined) patch.iv_rank   = iv_rank   ?? null;
          if (last      !== undefined) patch.last      = last      ?? null;
          if (prev_close !== undefined) patch.prev_close = prev_close ?? null;
          return supabase
            .from("quotes")
            .update(patch)
            .eq("symbol", symbol)
            .then(({ error }) => ({ symbol, ok: !error, error: error?.message }));
        })
      );

      const failed = results.filter(r => !r.ok);
      if (failed.length) {
        console.warn("[api/ingest-iv] Some updates failed:", failed);
      }

      console.log(`[api/ingest-iv] Updated IV for: ${results.filter(r => r.ok).map(r => r.symbol).join(", ")}`);
      return res.status(200).json({ ok: true, updated: results });
    } catch (err) {
      console.error("[api/ingest-iv POST]", err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  return res.status(405).json({ ok: false, error: "Method not allowed" });
}

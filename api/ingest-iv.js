/**
 * api/ingest-iv.js — Vercel serverless function
 *
 * POST /api/ingest-iv
 *
 * Accepts IV data fetched by OpenClaw (running on a residential IP) from
 * Tastytrade's market-metrics endpoint and writes it to the quotes table.
 *
 * Tastytrade blocks datacenter IPs (Vercel/AWS), so the actual API call
 * is made by OpenClaw on the user's machine, then POSTed here to persist.
 *
 * Authentication: X-Ingest-Secret header must match MARKET_CONTEXT_INGEST_SECRET.
 *
 * Expected body shape:
 *   {
 *     quotes: [
 *       { symbol: "PLTR", iv: 0.728, iv_rank: 46.75 },
 *       ...
 *     ]
 *   }
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

  // Auth check — reuses the same ingest secret as market context
  const secret = process.env.MARKET_CONTEXT_INGEST_SECRET;
  if (!secret) {
    return res.status(500).json({ ok: false, error: "Server misconfiguration" });
  }
  if (req.headers["x-ingest-secret"] !== secret) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const { quotes } = req.body ?? {};

  if (!Array.isArray(quotes) || !quotes.length) {
    return res.status(400).json({ ok: false, error: "Invalid payload: expected quotes array" });
  }

  try {
    const supabase = getSupabase();
    const now      = new Date().toISOString();

    const results = await Promise.all(
      quotes.map(({ symbol, iv, iv_rank }) => {
        if (!symbol) return Promise.resolve({ symbol, ok: false, error: "missing symbol" });
        return supabase
          .from("quotes")
          .update({ iv: iv ?? null, iv_rank: iv_rank ?? null, refreshed_at: now })
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
    console.error("[api/ingest-iv] Error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

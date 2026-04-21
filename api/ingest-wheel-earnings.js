/**
 * api/ingest-wheel-earnings.js — Vercel serverless function
 *
 * GET  /api/ingest-wheel-earnings  → returns the ticker list OpenClaw should
 *                                    fetch earnings for (wheel_universe +
 *                                    currently-held tickers, deduped).
 *
 * POST /api/ingest-wheel-earnings  → accepts Finnhub-sourced earnings data from
 *                                    OpenClaw and writes to quotes.earnings_*.
 *
 * Finnhub has higher-quality earnings data than Yahoo quoteSummary (used by the
 * lazy /api/wheel-earnings fallback). It adds `hour` (bmo/amc), EPS estimate,
 * revenue estimate, and a confidence score. OpenClaw fetches this on residential
 * IP and POSTs here — same auth pattern as /api/ingest-iv.
 *
 * Authentication: X-Ingest-Secret header must match MARKET_CONTEXT_INGEST_SECRET.
 *
 * POST body shape:
 *   {
 *     earnings: [
 *       {
 *         ticker:           "PLTR",
 *         date:             "2026-05-05",          // YYYY-MM-DD, required
 *         hour:             "amc",                 // "bmo"|"amc"|"" — optional
 *         epsEstimate:      0.18,                  // optional
 *         revenueEstimate:  1200000000,            // optional
 *         confidence:       "high",                // "high"|"medium"|"low" — optional
 *       },
 *       ...
 *     ]
 *   }
 *
 * A missing earnings row for a ticker is treated as "no known earnings" and
 * sets earnings_date=NULL (so tickers whose last-known date has passed get
 * cleared). Pass { ticker, date: null } to explicitly clear.
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

  // ── GET: return ticker list OpenClaw should fetch ───────────────────────────
  if (req.method === "GET") {
    try {
      const supabase = getSupabase();

      const [universeResult, positionsResult] = await Promise.all([
        supabase.from("wheel_universe").select("ticker").eq("list_type", "approved"),
        supabase.from("positions").select("ticker"),
      ]);

      if (universeResult.error) throw new Error(`wheel_universe: ${universeResult.error.message}`);
      if (positionsResult.error) console.warn("[ingest-wheel-earnings GET] positions read failed:", positionsResult.error.message);

      const set = new Set();
      (universeResult.data   ?? []).forEach(r => r.ticker && set.add(r.ticker));
      (positionsResult.data ?? []).forEach(r => r.ticker && set.add(r.ticker));

      return res.status(200).json({ ok: true, tickers: [...set].sort() });
    } catch (err) {
      console.error("[ingest-wheel-earnings GET]", err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  // ── POST: upsert earnings rows ──────────────────────────────────────────────
  if (req.method === "POST") {
    const { earnings } = req.body ?? {};
    if (!Array.isArray(earnings)) {
      return res.status(400).json({ ok: false, error: "Invalid payload: expected earnings array" });
    }

    try {
      const supabase = getSupabase();
      const now      = new Date().toISOString();

      const rows = [];
      const rejected = [];

      for (const e of earnings) {
        if (!e?.ticker) { rejected.push({ e, reason: "missing ticker" }); continue; }

        // Date is optional (explicit null clears). If provided, must parse.
        let isoDate = null;
        if (e.date != null) {
          const d = new Date(e.date);
          if (isNaN(d.getTime())) { rejected.push({ ticker: e.ticker, reason: "invalid date" }); continue; }
          isoDate = d.toISOString().slice(0, 10);
        }

        const meta = {};
        if (e.hour != null)            meta.hour            = String(e.hour);
        if (e.epsEstimate != null)     meta.epsEstimate     = Number(e.epsEstimate);
        if (e.revenueEstimate != null) meta.revenueEstimate = Number(e.revenueEstimate);
        if (e.confidence != null)      meta.confidence      = String(e.confidence);
        meta.source = "finnhub";
        meta.ingestedAt = now;

        rows.push({
          symbol:                e.ticker,
          instrument_type:       "EQUITY",
          earnings_date:         isoDate,
          earnings_meta:         meta,
          earnings_refreshed_at: now,
        });
      }

      if (rows.length === 0) {
        return res.status(200).json({ ok: true, updated: 0, rejected });
      }

      const { error } = await supabase
        .from("quotes")
        .upsert(rows, { onConflict: "symbol" });

      if (error) throw new Error(error.message);

      console.log(`[ingest-wheel-earnings] Upserted ${rows.length} rows`);
      return res.status(200).json({ ok: true, updated: rows.length, rejected });
    } catch (err) {
      console.error("[ingest-wheel-earnings POST]", err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  return res.status(405).json({ ok: false, error: "Method not allowed" });
}

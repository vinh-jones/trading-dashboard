/**
 * api/ingest-s5fi.js — Vercel serverless function
 *
 * POST /api/ingest-s5fi
 *
 * Accepts the daily S5FI reading (% of S&P 500 above its 50-day MA) scraped
 * by OpenClaw from Finviz on a residential IP — Finviz's Cloudflare 403s
 * Vercel's datacenter IPs, so the app can't scrape it directly. /api/macro
 * reads the latest row from the `s5fi` table (ORDER BY as_of DESC LIMIT 1).
 *
 * Authentication: X-Ingest-Secret header must match MARKET_CONTEXT_INGEST_SECRET.
 *
 * POST body shape:
 *   {
 *     asOf:  string (ISO timestamp)  — required
 *     pct:   number (0-100)          — required
 *     above: number                  — optional, count above 50DMA
 *     total: number                  — optional, S&P 500 count
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

  const secret = process.env.MARKET_CONTEXT_INGEST_SECRET;
  if (!secret) {
    return res.status(500).json({ ok: false, error: "Server misconfiguration" });
  }
  if (req.headers["x-ingest-secret"] !== secret) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const body = req.body ?? {};
  const pct = Number(body.pct);
  if (!body.asOf || !Number.isFinite(pct)) {
    return res.status(400).json({ ok: false, error: "Invalid payload: missing asOf or numeric pct" });
  }
  if (pct < 0 || pct > 100) {
    return res.status(400).json({ ok: false, error: "Invalid payload: pct out of range 0-100" });
  }

  try {
    const supabase = getSupabase();
    const { error } = await supabase.from("s5fi").insert({
      as_of: body.asOf,
      pct,
      above: body.above != null ? Number(body.above) : null,
      total: body.total != null ? Number(body.total) : null,
    });
    if (error) throw new Error(error.message);

    console.log(`[api/ingest-s5fi] inserted pct=${pct} as_of=${body.asOf}`);
    return res.status(200).json({ ok: true, asOf: body.asOf, pct });
  } catch (err) {
    console.error("[api/ingest-s5fi]", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

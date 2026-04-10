/**
 * api/ingest-market-context.js — Vercel serverless function
 *
 * POST /api/ingest-market-context
 *
 * Accepts a market context JSON payload from OpenClaw and inserts it into
 * the market_context Supabase table.
 *
 * Authentication: X-Ingest-Secret header must match MARKET_CONTEXT_INGEST_SECRET env var.
 *
 * Expected body shape (OpenClaw output):
 *   {
 *     asOf: string (ISO timestamp),
 *     positions: [...],
 *     macroEvents: [...],
 *     source?: { ... }   // ignored, not stored
 *   }
 */

import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL      || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  // Auth check
  const secret = process.env.MARKET_CONTEXT_INGEST_SECRET;
  if (!secret) {
    console.error("[api/ingest-market-context] MARKET_CONTEXT_INGEST_SECRET not configured");
    res.status(500).json({ ok: false, error: "Server misconfiguration" });
    return;
  }
  if (req.headers["x-ingest-secret"] !== secret) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const body = req.body;

  // Basic validation
  if (!body?.asOf || !Array.isArray(body?.positions) || !Array.isArray(body?.macroEvents)) {
    res.status(400).json({ ok: false, error: "Invalid payload: missing asOf, positions, or macroEvents" });
    return;
  }

  try {
    const supabase = getSupabase();
    const { error } = await supabase.from("market_context").insert({
      as_of:        body.asOf,
      positions:    body.positions,
      macro_events: body.macroEvents,
    });

    if (error) throw new Error(error.message);

    console.log(`[api/ingest-market-context] Inserted context as_of=${body.asOf}`);
    res.status(200).json({ ok: true, asOf: body.asOf });
  } catch (err) {
    console.error("[api/ingest-market-context] Error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}

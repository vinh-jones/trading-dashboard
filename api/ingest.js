/**
 * api/ingest.js — Vercel serverless function
 *
 * POST /api/ingest
 *
 * Single ingest endpoint for all OpenClaw data. Replaces:
 *   - /api/ingest-market-context
 *   - /api/ingest-fundamentals
 *
 * Authentication: X-Ingest-Secret header must match MARKET_CONTEXT_INGEST_SECRET env var.
 *
 * Expected body shape:
 *   {
 *     asOf:         string (ISO timestamp)   — required
 *     positions:    array                    — required
 *     macroEvents:  array                    — required
 *     fundamentals: array (optional)         — [{ ticker, pe_ttm, pe_annual, eps_ttm, eps_annual }]
 *     source?:      object                   — ignored, not stored
 *   }
 *
 * Both market context and fundamentals are processed in parallel if both are present.
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

  if (!body.asOf || !Array.isArray(body.positions) || !Array.isArray(body.macroEvents)) {
    return res.status(400).json({ ok: false, error: "Invalid payload: missing asOf, positions, or macroEvents" });
  }

  try {
    const supabase = getSupabase();
    const now = new Date().toISOString();

    // ── Market context + fundamentals in parallel ──────────────────────────────
    const tasks = [];

    // Always: insert market context row
    tasks.push(
      supabase.from("market_context").insert({
        as_of:        body.asOf,
        positions:    body.positions,
        macro_events: body.macroEvents,
      }).then(({ error }) => {
        if (error) throw new Error(`market_context insert failed: ${error.message}`);
        console.log(`[api/ingest] market context inserted as_of=${body.asOf}`);
        return { type: "marketContext", asOf: body.asOf };
      })
    );

    // Optional: upsert fundamentals if included
    if (Array.isArray(body.fundamentals) && body.fundamentals.length > 0) {
      const rows = body.fundamentals.map(f => ({
        ticker:       f.ticker,
        pe_ttm:       f.pe_ttm    ?? null,
        pe_annual:    f.pe_annual ?? null,
        eps_ttm:      f.eps_ttm   ?? null,
        eps_annual:   f.eps_annual ?? null,
        refreshed_at: now,
      }));

      tasks.push(
        supabase.from("fundamentals").upsert(rows, { onConflict: "ticker" }).then(({ error }) => {
          if (error) throw new Error(`fundamentals upsert failed: ${error.message}`);
          console.log(`[api/ingest] fundamentals upserted: ${rows.length} rows`);
          return { type: "fundamentals", count: rows.length };
        })
      );
    }

    const results = await Promise.all(tasks);

    const response = { ok: true };
    for (const r of results) {
      if (r.type === "marketContext") response.asOf = r.asOf;
      if (r.type === "fundamentals")  response.fundamentalsCount = r.count;
    }

    return res.status(200).json(response);
  } catch (err) {
    console.error("[api/ingest]", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

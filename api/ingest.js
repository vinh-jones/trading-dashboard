/**
 * api/ingest.js — Vercel serverless function
 *
 * POST /api/ingest
 *
 * Fundamentals ingest. The market_context branch was removed on 2026-08-07 when
 * that table was deprecated — see
 * docs/superpowers/specs/2026-08-07-deprecate-market-context-design.md
 *
 * NOTE: the OpenClaw pusher that fed this endpoint is no longer running, so
 * `fundamentals` is itself frozen (last write 2026-07-01) and Radar's P/E plus
 * useRiskUnits' beta are stale. Re-sourcing it from UW is tracked in that
 * spec's out-of-scope section. The endpoint is kept, not deleted, so that work
 * has somewhere to land.
 *
 * Authentication: X-Ingest-Secret header must match MARKET_CONTEXT_INGEST_SECRET
 * env var. The env var keeps its historical name so no Vercel change is needed.
 *
 * Expected body shape:
 *   {
 *     fundamentals: array — [{ ticker, pe_ttm, pe_annual, eps_ttm, eps_annual, beta }]
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

  if (!Array.isArray(body.fundamentals)) {
    return res.status(400).json({ ok: false, error: "Invalid payload: missing fundamentals" });
  }

  try {
    const supabase = getSupabase();
    const now = new Date().toISOString();

    const tasks = [];

    if (body.fundamentals.length > 0) {
      // Base fundamentals — the generator emits these as full rows every run,
      // so overwriting them wholesale is fine.
      //
      // `beta` is deliberately NOT in this object. It's sourced separately and
      // may be missing for some tickers; if it rode this upsert, a null/omitted
      // beta would clobber a previously-good value (ON CONFLICT sets every
      // column in the payload). Beta is applied below, non-null only, so an
      // absent beta leaves any existing value untouched.
      const rows = body.fundamentals.map(f => ({
        ticker:       f.ticker,
        pe_ttm:       f.pe_ttm    ?? null,
        pe_annual:    f.pe_annual ?? null,
        eps_ttm:      f.eps_ttm   ?? null,
        eps_annual:   f.eps_annual ?? null,
        refreshed_at: now,
      }));

      // Only the rows that actually carry a finite beta. These get applied as a
      // second, beta-only upsert after the base rows exist — a pure update that
      // never writes null over a good value.
      const betaRows = body.fundamentals
        .filter(f => f.beta != null && Number.isFinite(Number(f.beta)))
        .map(f => ({ ticker: f.ticker, beta: Number(f.beta) }));

      tasks.push(
        supabase.from("fundamentals").upsert(rows, { onConflict: "ticker" }).then(async ({ error }) => {
          if (error) throw new Error(`fundamentals upsert failed: ${error.message}`);
          if (betaRows.length > 0) {
            const { error: betaErr } = await supabase
              .from("fundamentals")
              .upsert(betaRows, { onConflict: "ticker" });
            if (betaErr) throw new Error(`fundamentals beta upsert failed: ${betaErr.message}`);
          }
          console.log(`[api/ingest] fundamentals upserted: ${rows.length} rows (beta set: ${betaRows.length})`);
          return { type: "fundamentals", count: rows.length };
        })
      );
    }

    const results = await Promise.all(tasks);

    const response = { ok: true };
    for (const r of results) {
      if (r.type === "fundamentals") response.fundamentalsCount = r.count;
    }

    return res.status(200).json(response);
  } catch (err) {
    console.error("[api/ingest]", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * api/uw-iv.js — Vercel serverless function (cron)
 *
 * GET /api/uw-iv               → refresh iv / iv_rank / last / prev_close for the
 *                                 approved wheel universe + held tickers
 * GET /api/uw-iv?tickers=PLTR  → just these (smoke test)
 *
 * Sources the Radar IV + intraday price columns straight from Unusual Whales'
 * stock screener (/screener/stocks), replacing the Tastytrade-via-OpenClaw
 * /api/ingest-iv push. Tastytrade blocks datacenter IPs — the only reason
 * OpenClaw fetched IV on a residential IP — while UW answers Vercel directly, so
 * the detour goes away and one screener call (chunked) covers the whole universe.
 *
 * Writes the same quotes columns /api/ingest-iv did (iv, iv_rank, last,
 * prev_close, refreshed_at) via .update() so it never creates bare rows or
 * touches the earnings_* / bb fields other jobs own, and inserts iv_snapshots
 * for the IV-trend modifier (useIvTrends → entryScore ivTrendMod), mirroring the
 * old ingest. A ticker the screener omits is left untouched (last good value
 * kept), so a partial screen never blanks the board.
 *
 * /api/ingest-iv stays deployed as a dormant fallback (still accepts an OpenClaw
 * push) — nothing here removes it. Soft no-op until UW_API_KEY is set. In
 * middleware BYPASS; self-authenticates.
 */

import { createClient } from "@supabase/supabase-js";
import { hasUwKey, fetchStockScreener } from "./_lib/uwClient.js";
import { ivQuoteFromScreenerRow } from "../src/lib/uwNormalize.js";

const CHUNK_SIZE = 25; // keep each screener call well under any result cap

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

function authorized(req) {
  const auth   = req.headers["authorization"] || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const cron   = process.env.CRON_SECRET;
  const app    = process.env.APP_SECRET;
  if (cron && bearer === cron) return true;
  if (app && bearer === app) return true;
  const cookie = req.headers.cookie || "";
  const m = cookie.match(/(?:^|;\s*)app_auth=([^;]+)/);
  const cookieTok = m ? decodeURIComponent(m[1]) : null;
  return !!(app && cookieTok === app);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });
  if (!hasUwKey()) return res.status(200).json({ ok: true, skipped: "UW_API_KEY not configured", updated: 0 });

  try {
    const supabase = getSupabase();
    const now = new Date().toISOString();

    const override = (req.query.tickers || "").trim();
    let tickers;
    if (override) {
      tickers = [...new Set(override.toUpperCase().split(",").map((t) => t.trim()).filter(Boolean))];
    } else {
      const [universe, positions] = await Promise.all([
        supabase.from("wheel_universe").select("ticker").eq("list_type", "approved"),
        supabase.from("positions").select("ticker"),
      ]);
      const set = new Set();
      (universe.data  ?? []).forEach((r) => r.ticker && set.add(r.ticker));
      (positions.data ?? []).forEach((r) => r.ticker && set.add(r.ticker));
      tickers = [...set].sort();
    }

    if (tickers.length === 0) {
      return res.status(200).json({ ok: true, updated: 0, total: 0, results: [] });
    }

    // Pull the screener in chunks and key the quotes by ticker.
    const quoteByTicker = new Map();
    for (const group of chunk(tickers, CHUNK_SIZE)) {
      const rows = await fetchStockScreener(group);
      for (const row of rows ?? []) {
        const sym = row?.ticker;
        if (!sym) continue;
        const q = ivQuoteFromScreenerRow(row);
        if (q) quoteByTicker.set(sym, q);
      }
    }

    // Patch each ticker's quotes row (update-only — never inserts a bare row,
    // never touches columns other jobs own).
    const results = [];
    for (const ticker of tickers) {
      const q = quoteByTicker.get(ticker);
      if (!q) { results.push({ ticker, ok: false, error: "not in screener response" }); continue; }
      const patch = { refreshed_at: now };
      if (q.iv         != null) patch.iv         = q.iv;
      if (q.iv_rank    != null) patch.iv_rank    = q.iv_rank;
      if (q.last       != null) patch.last       = q.last;
      if (q.prev_close != null) patch.prev_close = q.prev_close;
      const { error } = await supabase.from("quotes").update(patch).eq("symbol", ticker);
      results.push({ ticker, ok: !error, error: error?.message });
    }

    // IV snapshots for the trend modifier — mirror /api/ingest-iv: prune >30d,
    // then insert one row per successfully-updated ticker that carried IV.
    const okSet = new Set(results.filter((r) => r.ok).map((r) => r.ticker));
    const snapshots = [];
    for (const ticker of okSet) {
      const q = quoteByTicker.get(ticker);
      if (q && (q.iv != null || q.iv_rank != null)) {
        snapshots.push({ ticker, iv: q.iv ?? null, iv_rank: q.iv_rank ?? null, captured_at: now });
      }
    }
    if (snapshots.length) {
      supabase.from("iv_snapshots")
        .delete()
        .lt("captured_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .then(() => {});
      const { error: snapErr } = await supabase.from("iv_snapshots").insert(snapshots);
      if (snapErr) console.warn("[api/uw-iv] snapshot insert failed:", snapErr.message);
    }

    const failed = results.filter((r) => !r.ok);
    if (failed.length) console.warn("[api/uw-iv] failures:", failed);
    console.log(`[api/uw-iv] updated ${okSet.size}/${tickers.length} (${snapshots.length} snapshots)`);

    return res.status(200).json({
      ok: true,
      updated: okSet.size,
      total: tickers.length,
      snapshots: snapshots.length,
      results,
    });
  } catch (err) {
    console.error("[api/uw-iv]", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

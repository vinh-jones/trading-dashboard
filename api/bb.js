/**
 * api/bb.js — Vercel serverless function
 *
 * GET /api/bb
 *
 * Fetches 20-day Bollinger Band data from Yahoo Finance for all approved
 * tickers and stores results in the quotes table. No market hours gate —
 * BB uses daily closes, valid to fetch any time.
 */

import { createClient } from "@supabase/supabase-js";

const STALE_MS = 2 * 60 * 60 * 1000; // 2 hours

// ── Supabase ──────────────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.SUPABASE_URL      || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

// ── Delay helper ──────────────────────────────────────────────────────────────

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Fetch + compute BB for a single ticker ────────────────────────────────────

async function fetchBB(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1mo`;

  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "application/json",
    },
  });

  if (!r.ok) {
    throw new Error(`Yahoo returned ${r.status} for ${ticker}`);
  }

  const data = await r.json();

  const closes    = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
  const meta      = data?.chart?.result?.[0]?.meta;
  const price     = meta?.regularMarketPrice;
  const prevClose = meta?.chartPreviousClose    ?? null;
  const ma50      = meta?.fiftyDayAverage       ?? null;
  const ma200     = meta?.twoHundredDayAverage  ?? null;

  if (!closes || price == null) {
    throw new Error(`Missing closes or price for ${ticker}`);
  }

  const validCloses = closes.filter(c => c !== null && c !== undefined);
  if (validCloses.length < 20) {
    throw new Error(`Only ${validCloses.length} valid closes for ${ticker} (need 20)`);
  }

  const last20   = validCloses.slice(-20);
  const sma20    = last20.reduce((a, b) => a + b, 0) / 20;
  const variance = last20.reduce((s, c) => s + Math.pow(c - sma20, 2), 0) / 20;
  const stdDev   = Math.sqrt(variance);
  const upper    = sma20 + 2 * stdDev;
  const lower    = sma20 - 2 * stdDev;
  const bbPosition = (price - lower) / (upper - lower);

  return {
    bb_position: bbPosition, bb_upper: upper, bb_lower: lower, bb_sma20: sma20,
    last: price, prev_close: prevClose, ma50, ma200,
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const supabase = getSupabase();

    // 1. Get approved tickers
    const { data: universeRows, error: universeError } = await supabase
      .from("wheel_universe")
      .select("ticker")
      .eq("list_type", "approved");

    if (universeError) throw new Error(`wheel_universe fetch failed: ${universeError.message}`);

    const tickers = (universeRows || []).map(r => r.ticker);

    if (!tickers.length) {
      return res.status(200).json({
        ok: true,
        refreshed: false,
        refreshedAt: null,
        tickers: [],
        errors: [],
      });
    }

    // 2. Staleness check — look at most recent bb_refreshed_at across all quotes
    const { data: latestRow } = await supabase
      .from("quotes")
      .select("bb_refreshed_at")
      .not("bb_refreshed_at", "is", null)
      .order("bb_refreshed_at", { ascending: false })
      .limit(1)
      .single();

    const lastRefresh = latestRow?.bb_refreshed_at ? new Date(latestRow.bb_refreshed_at) : null;
    const ageMs       = lastRefresh ? Date.now() - lastRefresh.getTime() : Infinity;

    if (ageMs < STALE_MS) {
      // Return current cached BB data
      const { data: cached, error: cacheError } = await supabase
        .from("quotes")
        .select("symbol, bb_position, bb_upper, bb_lower, bb_sma20, ma_50, ma_200")
        .not("bb_position", "is", null)
        .order("symbol");

      if (cacheError) throw new Error(`quotes fetch failed: ${cacheError.message}`);

      return res.status(200).json({
        ok: true,
        refreshed: false,
        refreshedAt: lastRefresh.toISOString(),
        tickers: (cached || []).map(r => ({
          ticker:      r.symbol,
          bb_position: r.bb_position,
          bb_upper:    r.bb_upper,
          bb_lower:    r.bb_lower,
          bb_sma20:    r.bb_sma20,
          ma_50:       r.ma_50,
          ma_200:      r.ma_200,
        })),
        errors: [],
      });
    }

    // 3. Fetch BB data from Yahoo Finance — sequential with 100ms delay
    const now     = new Date().toISOString();
    const results = [];
    const errors  = [];

    for (let i = 0; i < tickers.length; i++) {
      const ticker = tickers[i];
      if (i > 0) await delay(100);

      try {
        const bb = await fetchBB(ticker);
        results.push({ ticker, ...bb });
      } catch (err) {
        errors.push({ ticker, reason: err.message });
      }
    }

    // 4. Upsert BB + price columns — do NOT touch iv columns (owned by ingest-iv)
    if (results.length) {
      const upsertRows = results.map(r => ({
        symbol:          r.ticker,
        instrument_type: "EQUITY",
        bb_position:     r.bb_position,
        bb_upper:        r.bb_upper,
        bb_lower:        r.bb_lower,
        bb_sma20:        r.bb_sma20,
        bb_refreshed_at: now,
        last:            r.last       ?? null,
        prev_close:      r.prev_close ?? null,
        ma_50:           r.ma50       ?? null,
        ma_200:          r.ma200      ?? null,
        refreshed_at:    now,
      }));

      const { error: upsertError } = await supabase
        .from("quotes")
        .upsert(upsertRows, { onConflict: "symbol" });

      if (upsertError) throw new Error(`Supabase upsert failed: ${upsertError.message}`);
    }

    // 5. Return
    return res.status(200).json({
      ok:          true,
      refreshed:   true,
      refreshedAt: now,
      tickers:     results.map(r => ({
        ticker:      r.ticker,
        bb_position: r.bb_position,
        bb_upper:    r.bb_upper,
        bb_lower:    r.bb_lower,
        bb_sma20:    r.bb_sma20,
        ma_50:       r.ma50  ?? null,
        ma_200:      r.ma200 ?? null,
      })),
      errors,
    });
  } catch (err) {
    console.error("[api/bb]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

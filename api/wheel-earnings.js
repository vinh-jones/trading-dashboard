/**
 * api/wheel-earnings.js — Vercel serverless function
 *
 * GET /api/wheel-earnings
 *
 * Lazy-fetches next earnings report date for every ticker in
 * `wheel_universe` and writes it to `quotes.earnings_date`. Used by the
 * Radar EARN column + the "avoid earnings within Xd" filter.
 *
 * Data source: Yahoo Finance quoteSummary → calendarEvents.earnings.
 * Free, no auth. Matches the pattern in api/bb.js.
 *
 * Cache: 20h stale window. Earnings dates only change on scheduled events,
 * so once-a-day refresh is plenty.
 */

import { createClient } from "@supabase/supabase-js";

const STALE_MS = 20 * 60 * 60 * 1000;

function getSupabase() {
  const url = process.env.SUPABASE_URL      || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// Yahoo quoteSummary → calendarEvents.earnings.earningsDate[0] (epoch seconds)
async function fetchNextEarnings(ticker) {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=calendarEvents`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Yahoo ${ticker} returned ${res.status}`);
  const data = await res.json();
  const result = data?.quoteSummary?.result?.[0];
  const earningsDates = result?.calendarEvents?.earnings?.earningsDate;
  if (!Array.isArray(earningsDates) || earningsDates.length === 0) return null;

  // earningsDate is usually a list of {raw: epoch_seconds, fmt: "YYYY-MM-DD"}
  // but can also be raw numbers in older responses. Take the first upcoming one.
  const now = Date.now() / 1000;
  for (const d of earningsDates) {
    const raw = typeof d === "object" ? d.raw : d;
    if (typeof raw !== "number" || raw < now) continue;
    // Convert epoch seconds → YYYY-MM-DD in UTC
    return new Date(raw * 1000).toISOString().slice(0, 10);
  }
  // No upcoming date — return the most recent one so we still know the last report
  const last = earningsDates[earningsDates.length - 1];
  const rawLast = typeof last === "object" ? last.raw : last;
  return typeof rawLast === "number" ? new Date(rawLast * 1000).toISOString().slice(0, 10) : null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const supabase = getSupabase();

    // 1. Get approved wheel universe tickers
    const { data: universeRows, error: universeError } = await supabase
      .from("wheel_universe")
      .select("ticker")
      .eq("list_type", "approved");

    if (universeError) throw new Error(`wheel_universe fetch failed: ${universeError.message}`);

    const tickers = [...new Set((universeRows || []).map(r => r.ticker))].sort();
    if (!tickers.length) {
      return res.status(200).json({ ok: true, refreshed: false, refreshedAt: null, earnings: [], errors: [] });
    }

    // 2. Staleness check — most recent earnings_refreshed_at
    const { data: latestRow } = await supabase
      .from("quotes")
      .select("earnings_refreshed_at")
      .not("earnings_refreshed_at", "is", null)
      .order("earnings_refreshed_at", { ascending: false })
      .limit(1)
      .single();

    const lastRefresh = latestRow?.earnings_refreshed_at ? new Date(latestRow.earnings_refreshed_at) : null;
    const ageMs       = lastRefresh ? Date.now() - lastRefresh.getTime() : Infinity;

    if (ageMs < STALE_MS) {
      const { data: cached } = await supabase
        .from("quotes")
        .select("symbol, earnings_date")
        .in("symbol", tickers)
        .not("earnings_date", "is", null);

      return res.status(200).json({
        ok: true,
        refreshed: false,
        refreshedAt: lastRefresh.toISOString(),
        earnings: (cached || []).map(r => ({ ticker: r.symbol, date: r.earnings_date })),
        errors: [],
      });
    }

    // 3. Fetch earnings for each ticker sequentially (rate-limited)
    const now = new Date().toISOString();
    const results = [];
    const errors  = [];

    for (let i = 0; i < tickers.length; i++) {
      const ticker = tickers[i];
      if (i > 0) await delay(100);
      try {
        const date = await fetchNextEarnings(ticker);
        results.push({ ticker, date });
      } catch (err) {
        errors.push({ ticker, reason: err.message });
      }
    }

    // 4. Upsert earnings_date + refreshed_at on each ticker's row
    if (results.length) {
      const upsertRows = results.map(r => ({
        symbol:                r.ticker,
        instrument_type:       "EQUITY",
        earnings_date:         r.date,
        earnings_refreshed_at: now,
      }));
      const { error: upsertError } = await supabase
        .from("quotes")
        .upsert(upsertRows, { onConflict: "symbol" });
      if (upsertError) throw new Error(`Supabase upsert failed: ${upsertError.message}`);
    }

    return res.status(200).json({
      ok: true,
      refreshed: true,
      refreshedAt: now,
      earnings: results.map(r => ({ ticker: r.ticker, date: r.date })),
      errors,
    });
  } catch (err) {
    console.error("[api/wheel-earnings]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

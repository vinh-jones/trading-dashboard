import { createClient } from "@supabase/supabase-js";
import {
  detectLifespans,
  buildLifespan,
  computeCspBaseline,
} from "./_lib/lifespan.js";
import { reshapePositions } from "./_lib/reshapePositions.js";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const ticker = (req.query.ticker || "").toUpperCase();
  if (!ticker) {
    return res.status(400).json({ ok: false, error: "ticker query param is required" });
  }

  const today = new Date().toISOString().slice(0, 10);

  try {
    const supabase = getSupabase();

    const [baselineResult, tradesResult, positionsResult, quoteResult] = await Promise.all([
      supabase
        .from("trades")
        .select("id, premium_collected, capital_fronted, days_held, close_date")
        .eq("type", "CSP")
        .in("subtype", ["Close", "Roll Loss", "Assigned"])
        .gt("days_held", 0)
        .gt("capital_fronted", 0)
        .order("close_date", { ascending: false })
        .limit(60),
      supabase
        .from("trades")
        .select("*")
        .eq("ticker", ticker)
        .order("close_date", { ascending: true }),
      supabase
        .from("positions")
        .select("*")
        .eq("ticker", ticker),
      supabase
        .from("quotes")
        .select("symbol, last, mid, prev_close, earnings_date, refreshed_at, instrument_type")
        .eq("symbol", ticker)
        .eq("instrument_type", "EQUITY")
        .maybeSingle(),
    ]);

    if (baselineResult.error)  throw new Error(`baseline: ${baselineResult.error.message}`);
    if (tradesResult.error)    throw new Error(`trades: ${tradesResult.error.message}`);
    if (positionsResult.error) throw new Error(`positions: ${positionsResult.error.message}`);
    // quote may not exist; treat error as null quote (not fatal)
    const quote = quoteResult.error ? null : quoteResult.data;

    const cspBaseline = computeCspBaseline(baselineResult.data ?? []);
    const trades      = tradesResult.data ?? [];
    const reshaped    = reshapePositions(positionsResult.data ?? []);
    const openPositions = {
      csps:   reshaped.open_csps      ?? [],
      shares: reshaped.assigned_shares ?? [],
      leaps:  reshaped.open_leaps     ?? [],
    };

    // 5. Build lifespans (with full benchmarks + cc_history intact)
    const rawLifespans = detectLifespans(ticker, trades);
    const lifespans = rawLifespans.map((r) => {
      const built = buildLifespan(r, cspBaseline, today);
      const { _tradeIds, ...rest } = built;
      return rest;
    });

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Content-Type", "application/json");
    return res.status(200).json({
      ok: true,
      ticker,
      companyName: null,
      quote: quote ? {
        last:        quote.last,
        mid:         quote.mid,
        prev_close:  quote.prev_close,
        refreshedAt: quote.refreshed_at,
      } : null,
      earningsDate: quote?.earnings_date ?? null,
      openPositions,
      lifespans,
      trades,
      computedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[api/ticker-detail] Error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

// Reads per-ticker Unusual Whales signals into a Map keyed by ticker — same
// ergonomics as useQuotes. Until the UW ingestion has run, the table is empty
// and the Map is empty, so every consumer treats it as "no signal" (the
// entry-score gamma/flow modifiers become no-ops). Optional `tickers` scopes
// the query to the names you care about.
export function useUwSignals(tickers) {
  const [uwSignals, setUwSignals] = useState(() => new Map());
  const [loading, setLoading]     = useState(true);

  const key = Array.isArray(tickers) ? tickers.join(",") : (tickers ?? "");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        let query = supabase
          .from("uw_signals")
          .select("ticker, gamma_env, flow_sentiment, flow_ema, flow_streak, whale_put_sells, short_interest_pct, earnings_expected_move_pct, next_earnings_date, gex_env, gex_net_gamma, gex_support, gex_resistance, gex_air_pocket, gex_refreshed_at, refreshed_at");
        if (Array.isArray(tickers) && tickers.length) query = query.in("ticker", tickers);

        const { data, error } = await query;
        if (error) throw error;
        if (cancelled) return;

        const map = new Map();
        for (const row of data ?? []) map.set(row.ticker, row);
        setUwSignals(map);
      } catch (err) {
        // Non-fatal: missing table / empty data just means "no UW signal yet".
        console.warn("[useUwSignals]", err?.message ?? err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { uwSignals, loading };
}

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

export function useRadar() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    // Fire-and-forget BB + wheel-earnings refreshes — don't block on them, but
    // log failures so stale data isn't silently hidden during debugging. Both
    // endpoints are idempotent and return cached rows inside their stale window.
    fetch("/api/bb").catch(err => console.warn("[useRadar] BB refresh failed:", err));
    fetch("/api/wheel-earnings").catch(err => console.warn("[useRadar] wheel-earnings refresh failed:", err));

    async function fetchData() {
      try {
        // 1. Fetch approved wheel universe
        const { data: universe, error: universeErr } = await supabase
          .from("wheel_universe")
          .select("ticker, company, sector, price_category")
          .eq("list_type", "approved")
          .order("ticker");

        if (universeErr) throw universeErr;

        const approvedTickers = universe.map((u) => u.ticker);

        // 2. Fetch quotes + fundamentals in parallel
        const [
          { data: quotes,       error: quotesErr },
          { data: fundamentals, error: fundErr   },
        ] = await Promise.all([
          supabase
            .from("quotes")
            .select("symbol, last, prev_close, iv, iv_rank, bb_position, bb_upper, bb_lower, bb_sma20, bb_refreshed_at, earnings_date, earnings_meta, earnings_refreshed_at, ma_50, ma_200")
            .in("symbol", approvedTickers),
          supabase
            .from("fundamentals")
            .select("ticker, pe_ttm, pe_annual, eps_ttm")
            .in("ticker", approvedTickers),
        ]);

        if (quotesErr) throw quotesErr;
        if (fundErr) console.warn("[useRadar] fundamentals fetch failed:", fundErr.message);

        // 3. Build lookup maps
        const quotesMap = {};
        for (const q of quotes) {
          quotesMap[q.symbol] = q;
        }
        const fundMap = {};
        for (const f of (fundamentals || [])) {
          fundMap[f.ticker] = f;
        }

        // 4. Merge universe + quotes + fundamentals
        const merged = universe.map((u) => {
          const q = quotesMap[u.ticker] || {};
          const f = fundMap[u.ticker]   || {};
          return {
            ticker:                u.ticker,
            company:               u.company,
            sector:                u.sector,
            price_category:        u.price_category,
            last:                  q.last            ?? null,
            prev_close:            q.prev_close      ?? null,
            iv:                    q.iv              ?? null,
            iv_rank:               q.iv_rank         ?? null,
            bb_position:           q.bb_position     ?? null,
            bb_upper:              q.bb_upper        ?? null,
            bb_lower:              q.bb_lower        ?? null,
            bb_sma20:              q.bb_sma20        ?? null,
            bb_refreshed_at:       q.bb_refreshed_at ?? null,
            earnings_date:         q.earnings_date   ?? null,
            earnings_meta:         q.earnings_meta   ?? null,
            earnings_refreshed_at: q.earnings_refreshed_at ?? null,
            ma_50:                 q.ma_50           ?? null,
            ma_200:                q.ma_200          ?? null,
            pe_ttm:                f.pe_ttm           ?? null,
            pe_annual:             f.pe_annual        ?? null,
            eps_ttm:               f.eps_ttm          ?? null,
          };
        });

        setRows(merged);
      } catch (err) {
        setError(err?.message ?? String(err));
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  return { rows, loading, error };
}

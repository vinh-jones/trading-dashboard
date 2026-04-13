import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

export function useRadar() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    // Fire-and-forget BB refresh — don't block on it
    fetch("/api/bb").catch(() => {});

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

        // 2. Fetch quotes filtered to approved tickers
        const { data: quotes, error: quotesErr } = await supabase
          .from("quotes")
          .select("symbol, last, iv, iv_rank, bb_position, bb_upper, bb_lower, bb_sma20, bb_refreshed_at")
          .in("symbol", approvedTickers);

        if (quotesErr) throw quotesErr;

        // 3. Build quotes lookup map
        const quotesMap = {};
        for (const q of quotes) {
          quotesMap[q.symbol] = q;
        }

        // 4. Merge universe + quotes
        const merged = universe.map((u) => {
          const q = quotesMap[u.ticker] || {};
          return {
            ticker:          u.ticker,
            company:         u.company,
            sector:          u.sector,
            price_category:  u.price_category,
            last:            q.last            ?? null,
            iv:              q.iv              ?? null,
            iv_rank:         q.iv_rank         ?? null,
            bb_position:     q.bb_position     ?? null,
            bb_upper:        q.bb_upper        ?? null,
            bb_lower:        q.bb_lower        ?? null,
            bb_sma20:        q.bb_sma20        ?? null,
            bb_refreshed_at: q.bb_refreshed_at ?? null,
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

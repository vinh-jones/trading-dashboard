import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";

function computeIvTrend(rows) {
  // rows sorted desc by captured_at (newest first)
  if (rows.length < 3) {
    return rows.length > 0 ? { state: "insufficient", dataPoints: rows.length } : null;
  }

  const current       = rows[0].iv_rank;
  const oldest        = rows[rows.length - 1];
  const fiveDayChange = current - oldest.iv_rank;

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const dayOldRow = rows.find(r => new Date(r.captured_at) <= oneDayAgo);
  const oneDayChange = dayOldRow != null ? current - dayOldRow.iv_rank : null;

  const isSpike = oneDayChange != null && Math.abs(oneDayChange) >= 15;
  const r1 = v => Math.round(v * 10) / 10;

  const base = {
    fiveDayChange: r1(fiveDayChange),
    oneDayChange:  oneDayChange != null ? r1(oneDayChange) : null,
    dataPoints:    rows.length,
  };

  if (isSpike && fiveDayChange > 0)  return { ...base, state: "spiking",    label: "IV Spike ↑",  modifier: 0.85 };
  if (isSpike && fiveDayChange < 0)  return { ...base, state: "collapsing", label: "IV Crush ↓",  modifier: 0.90 };
  if (fiveDayChange >= 8)             return { ...base, state: "rising",     label: "IV Rising ↑", modifier: 1.10 };
  if (fiveDayChange <= -8)            return { ...base, state: "falling",    label: "IV Falling ↓",modifier: 0.90 };
  return                                     { ...base, state: "stable",     label: null,           modifier: 1.00 };
}

export function useIvTrends(tickers) {
  const [trendsByTicker, setTrends] = useState(() => new Map());
  const keyRef = useRef("");
  const key    = [...(tickers || [])].sort().join(",");

  useEffect(() => {
    if (!key) return;
    if (keyRef.current === key) return;
    keyRef.current = key;

    const since = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

    supabase
      .from("iv_snapshots")
      .select("ticker, iv_rank, captured_at")
      .in("ticker", tickers)
      .gte("captured_at", since)
      .order("captured_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          console.warn("[useIvTrends] query failed:", error.message);
          return;
        }
        const byTicker = {};
        for (const row of (data || [])) {
          if (!byTicker[row.ticker]) byTicker[row.ticker] = [];
          byTicker[row.ticker].push(row);
        }
        const map = new Map();
        for (const [ticker, rows] of Object.entries(byTicker)) {
          const trend = computeIvTrend(rows);
          if (trend) map.set(ticker, trend);
        }
        setTrends(map);
      });
  }, [key]);

  return trendsByTicker;
}

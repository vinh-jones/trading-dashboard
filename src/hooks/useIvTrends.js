import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { fetchIvTrends } from "../lib/ivTrend";

// Classification logic lives in src/lib/ivTrend.js so api/agent-scan.js can
// compute byte-identical scanner scores server-side. This hook is now just the
// React lifecycle wrapper around it.
export function useIvTrends(tickers) {
  const [trendsByTicker, setTrends] = useState(() => new Map());
  const keyRef = useRef("");
  const key    = [...(tickers || [])].sort().join(",");

  useEffect(() => {
    if (!key) return;
    if (keyRef.current === key) return;
    keyRef.current = key;

    fetchIvTrends(supabase, tickers).then(setTrends);
  }, [key]);

  return trendsByTicker;
}

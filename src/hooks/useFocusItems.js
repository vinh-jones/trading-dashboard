import { useEffect, useMemo, useState } from "react";
import marketContextDev from "../data/market-context.json";
import { useData } from "./useData";
import { useLiveVix } from "./useLiveVix";
import { useQuotes } from "./useQuotes";
import { useRollAnalysis } from "./useRollAnalysis";
import { generateFocusItems, categorizeFocusItems } from "../lib/focusEngine";

// One-shot pipeline. Call at App.jsx level and pass results down to consumers
// (FocusTab, PersistentHeader, ModeNav) so the fetch side-effects only happen once.
export function useFocusItems() {
  const { positions, account } = useData();
  const { vix: liveVix } = useLiveVix(account?.vix_current);
  const { quoteMap, refreshedAt: quotesRefreshedAt } = useQuotes();
  const { rollMap } = useRollAnalysis();

  const [marketContext, setMarketContext] = useState(null);
  const [mcLoading, setMcLoading]         = useState(true);
  const [notifiedMap, setNotifiedMap]     = useState(() => new Map());

  useEffect(() => {
    if (!import.meta.env.PROD) {
      setMarketContext(marketContextDev);
      setMcLoading(false);
      return;
    }
    fetch("/api/focus-context")
      .then(r => r.json())
      .then(data => {
        if (!data.ok) return;
        if (data.marketContext) setMarketContext(data.marketContext);
        if (Array.isArray(data.alertState)) {
          setNotifiedMap(new Map(data.alertState.map(a => [a.alert_id, { firstFiredAt: a.first_fired_at }])));
        }
      })
      .catch(err => console.warn("[useFocusItems] focus-context fetch failed:", err.message))
      .finally(() => setMcLoading(false));
  }, []);

  const items = useMemo(
    () => generateFocusItems(positions, account, marketContext, liveVix, quoteMap, rollMap),
    [positions, account, marketContext, liveVix, quoteMap, rollMap]
  );

  const categorized = useMemo(() => categorizeFocusItems(items), [items]);

  const p1Count = categorized.focus.length;

  return {
    items,
    categorized,
    p1Count,
    // Ambient data consumers may need
    quoteMap,
    quotesRefreshedAt,
    rollMap,
    liveVix,
    marketContext,
    mcLoading,
    notifiedMap,
  };
}

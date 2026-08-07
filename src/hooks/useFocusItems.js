import { useEffect, useMemo, useState } from "react";
import { useLiveVix } from "./useLiveVix";
import { useQuotes } from "./useQuotes";
import { useRollAnalysis } from "./useRollAnalysis";
import { useAssignedShareIncome } from "./useAssignedShareIncome";
import { generateFocusItems, categorizeFocusItems } from "../lib/focusEngine";

// One-shot pipeline. Call at App.jsx level and pass results down to consumers
// (FocusTab, PersistentHeader, ModeNav) so the fetch side-effects only happen once.
//
// NOTE: `positions` and `account` are passed as args rather than read from
// DataContext because this hook is called inside the component that *provides*
// DataContext — so useData() would return the default (null) value.
export function useFocusItems({ positions, account }) {
  const { vix: liveVix } = useLiveVix(account?.vix_current);
  const { quoteMap, refreshedAt: quotesRefreshedAt } = useQuotes();
  const { rollMap } = useRollAnalysis();
  const { data: assignedShareIncome } = useAssignedShareIncome();

  const [macroEvents, setMacroEvents]           = useState([]);
  const [macroRefreshedAt, setMacroRefreshedAt] = useState(null);
  const [mcLoading, setMcLoading]               = useState(true);
  const [notifiedMap, setNotifiedMap]     = useState(() => new Map());

  useEffect(() => {
    // No dev fixture: local Vite does not serve api/*, so this simply stays
    // empty locally and the macro calendar renders nothing. That is honest —
    // the old market-context.json fixture is exactly how stale data got
    // mistaken for live during development.
    fetch("/api/focus-context")
      .then(r => r.json())
      .then(data => {
        if (!data.ok) return;
        if (Array.isArray(data.macroEvents)) setMacroEvents(data.macroEvents);
        if (data.macroRefreshedAt) setMacroRefreshedAt(data.macroRefreshedAt);
        if (Array.isArray(data.alertState)) {
          setNotifiedMap(new Map(data.alertState.map(a => [a.alert_id, { firstFiredAt: a.first_fired_at }])));
        }
      })
      .catch(err => console.warn("[useFocusItems] focus-context fetch failed:", err.message))
      .finally(() => setMcLoading(false));
  }, []);

  const items = useMemo(
    () => generateFocusItems(positions, account, macroEvents, liveVix, quoteMap, rollMap, assignedShareIncome),
    [positions, account, macroEvents, liveVix, quoteMap, rollMap, assignedShareIncome]
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
    macroEvents,
    macroRefreshedAt,
    mcLoading,
    notifiedMap,
  };
}

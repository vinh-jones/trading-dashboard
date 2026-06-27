import { useState, useEffect, useMemo } from "react";
import { supabase } from "../lib/supabase";
import { useQuotes } from "./useQuotes";
import { computeRiskUnits } from "../lib/riskEngine";
import {
  getOpenCSPs, getOpenCCs, getOpenLEAPs, getAssignedShares, getOpenSpreads,
} from "../lib/positionSchema";

/**
 * useRiskUnits — assembles live inputs for the descriptive-only risk engine.
 *
 * Joins the open positions with live option greeks (useQuotes → quoteMap, keyed
 * by OCC symbol) and per-ticker beta (fundamentals table, the same source Radar
 * uses), then runs the pure riskEngine. Returns the engine output plus quote
 * freshness and loading/error state.
 */
function heldTickers(positions) {
  const set = new Set();
  for (const p of getOpenCSPs(positions))      if (p.ticker)  set.add(p.ticker);
  for (const c of getOpenCCs(positions))       if (c.ticker)  set.add(c.ticker);
  for (const l of getOpenLEAPs(positions))     if (l.ticker)  set.add(l.ticker);
  for (const s of getAssignedShares(positions))if (s.ticker)  set.add(s.ticker);
  for (const sp of getOpenSpreads(positions))  if (sp.ticker) set.add(sp.ticker);
  return [...set];
}

export function useRiskUnits(positions) {
  const { quoteMap, refreshedAt, loading: quotesLoading, error: quotesError } = useQuotes();
  const [betaMap, setBetaMap]         = useState({});
  const [betaLoading, setBetaLoading] = useState(true);
  const [betaError, setBetaError]     = useState(null);

  const tickers = useMemo(() => heldTickers(positions), [positions]);

  useEffect(() => {
    let cancelled = false;
    if (!tickers.length) { setBetaLoading(false); return; }
    setBetaLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("fundamentals").select("ticker, beta").in("ticker", tickers);
      if (cancelled) return;
      if (error) {
        // Beta is optional — a missing beta falls back to 1.0 (flagged in the UI).
        console.warn("[useRiskUnits] fundamentals beta fetch failed:", error.message);
        setBetaError(error.message);
      } else {
        const map = {};
        for (const f of (data || [])) map[f.ticker] = f.beta;
        setBetaMap(map);
      }
      setBetaLoading(false);
    })();
    return () => { cancelled = true; };
  }, [tickers]);

  const risk = useMemo(() => {
    if (quotesLoading || !positions) return null;
    const ctx = {
      getQuote: (sym) => quoteMap.get(sym),
      getBeta:  (tkr) => (betaMap[tkr] ?? null),
      todayIso: new Date().toISOString().slice(0, 10),
    };
    return computeRiskUnits(positions, ctx);
  }, [positions, quoteMap, betaMap, quotesLoading]);

  return {
    risk,
    refreshedAt,
    loading: quotesLoading || betaLoading,
    error:   quotesError || betaError,
  };
}

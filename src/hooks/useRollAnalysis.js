import { useState, useEffect, useCallback } from "react";

/**
 * useRollAnalysis() — loads roll analysis data from /api/roll-analysis.
 *
 * On mount: reads existing rows from the roll_analysis table (GET).
 * checkRolls(threshold): triggers a fresh fetch from Public.com (POST).
 *
 * Returns:
 *   rollMap         — { [ticker]: rollAnalysisRow } from last successful fetch
 *   rollLoading     — true while checkRolls() is in flight
 *   lastCheckedAt   — ISO string of the most recent fetched_at, or null
 *   isStale         — true when lastCheckedAt is > 2 hours ago
 *   checkRolls(n)   — async fn: triggers POST /api/roll-analysis?threshold=n
 *   relativeTime()  — formats lastCheckedAt as "X min ago" / "Xh ago" / "just now"
 */
export function useRollAnalysis() {
  const [rollMap,       setRollMap]       = useState({});
  const [rollLoading,   setRollLoading]   = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState(null);

  function buildMap(rows) {
    const map = {};
    let latest = null;
    for (const row of rows) {
      map[row.ticker] = row;
      if (!latest || row.fetched_at > latest) latest = row.fetched_at;
    }
    setRollMap(map);
    setLastCheckedAt(latest);
  }

  // Load existing data on mount
  useEffect(() => {
    if (!import.meta.env.PROD) return; // no data in dev
    fetch("/api/roll-analysis")
      .then(r => r.json())
      .then(data => { if (data.ok && data.rows?.length) buildMap(data.rows); })
      .catch(err => console.warn("[useRollAnalysis] load failed:", err.message));
  }, []);

  const checkRolls = useCallback(async (threshold) => {
    setRollLoading(true);
    try {
      const res  = await fetch(`/api/roll-analysis?threshold=${threshold}`, { method: "POST" });
      const data = await res.json();
      if (!data.ok) {
        console.warn("[useRollAnalysis] checkRolls error:", data.error);
        return;
      }
      if (data.rows?.length) {
        buildMap(data.rows);
      } else {
        // Fetch succeeded but no qualifying positions — clear map
        setRollMap({});
        setLastCheckedAt(new Date().toISOString());
      }
    } catch (err) {
      console.warn("[useRollAnalysis] checkRolls failed:", err.message);
    } finally {
      setRollLoading(false);
    }
  }, []);

  const isStale = lastCheckedAt
    ? Date.now() - new Date(lastCheckedAt).getTime() > 2 * 60 * 60 * 1000
    : false;

  function relativeTime() {
    if (!lastCheckedAt) return null;
    const mins = Math.round((Date.now() - new Date(lastCheckedAt).getTime()) / 60000);
    if (mins < 1)  return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ago`;
  }

  return { rollMap, rollLoading, lastCheckedAt, isStale, checkRolls, relativeTime };
}

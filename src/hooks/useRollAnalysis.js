import { useState, useEffect, useCallback, useRef } from "react";

/**
 * useRollAnalysis() — loads roll analysis data from /api/roll-analysis.
 *
 * On mount: reads existing rows from the roll_analysis table (GET).
 *   If data is already stale and it's currently market hours, auto-triggers
 *   a fresh check immediately.
 *
 * checkRolls(threshold): triggers a fresh fetch from Public.com (POST).
 *
 * Auto-check: polls every 5 minutes during market hours (Mon–Fri 9:30–16:00 ET)
 *   and re-checks whenever data is stale (> 2 hours old).
 *   Uses the most recently supplied threshold (defaults to 25).
 *
 * Returns:
 *   rollMap         — { [ticker]: rollAnalysisRow } from last successful fetch
 *   rollLoading     — true while checkRolls() is in flight
 *   lastCheckedAt   — ISO string of the most recent fetched_at, or null
 *   isStale         — true when lastCheckedAt is > 2 hours ago
 *   checkRolls(n)   — async fn: triggers POST /api/roll-analysis?threshold=n
 *   relativeTime()  — formats lastCheckedAt as "X min ago" / "Xh ago" / "just now"
 */

const STALE_MS         = 2 * 60 * 60 * 1000; // 2 hours
const AUTO_INTERVAL_MS = 5 * 60 * 1000;       // poll every 5 minutes

function isMarketHours() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday:  "short",
    hour:     "numeric",
    minute:   "2-digit",
    hour12:   false,
  }).formatToParts(new Date());
  const p    = Object.fromEntries(parts.map(x => [x.type, x.value]));
  const mins = parseInt(p.hour, 10) * 60 + parseInt(p.minute, 10);
  return !["Sat", "Sun"].includes(p.weekday) && mins >= 9 * 60 + 30 && mins < 16 * 60;
}

export function useRollAnalysis() {
  const [rollMap,       setRollMap]       = useState({});
  const [rollLoading,   setRollLoading]   = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState(null);

  // Tracks the most recently used threshold so auto-checks use the same value
  const lastThresholdRef = useRef(25);

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

  const checkRolls = useCallback(async (threshold) => {
    lastThresholdRef.current = threshold;
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

  // Load existing data on mount; auto-check immediately if already stale
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    fetch("/api/roll-analysis")
      .then(r => r.json())
      .then(data => {
        if (!data.ok || !data.rows?.length) return;
        buildMap(data.rows);
        // Check staleness directly from the response (state update is async)
        const latest = data.rows.reduce((l, r) => (!l || r.fetched_at > l ? r.fetched_at : l), null);
        const stale  = latest && Date.now() - new Date(latest).getTime() > STALE_MS;
        if (stale && isMarketHours()) checkRolls(lastThresholdRef.current);
      })
      .catch(err => console.warn("[useRollAnalysis] load failed:", err.message));
  }, [checkRolls]);

  // Callback ref — always captures current state without stale closure
  const autoCheckRef = useRef(null);
  autoCheckRef.current = () => {
    if (!lastCheckedAt || rollLoading) return;
    const stale = Date.now() - new Date(lastCheckedAt).getTime() > STALE_MS;
    if (stale && isMarketHours()) checkRolls(lastThresholdRef.current);
  };

  // 5-minute polling interval for ongoing auto-checks during the session
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const id = setInterval(() => autoCheckRef.current?.(), AUTO_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const isStale = lastCheckedAt
    ? Date.now() - new Date(lastCheckedAt).getTime() > STALE_MS
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

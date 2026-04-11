import { useState, useEffect } from "react";

/**
 * useQuotes() — fetches cached quotes from /api/quotes on mount.
 *
 * The server handles staleness + refresh logic automatically.
 * If the cache is >30min old and market is open, the server refreshes
 * before responding (adds ~1-2s latency on first load of the day).
 *
 * Returns:
 *   quotes      — flat array of { symbol, instrument_type, last, bid, ask, mid, refreshed_at }
 *   quoteMap    — Map<symbol, quote> for O(1) lookup
 *   refreshedAt — ISO string of last cache write, or null
 *   loading     — true while the initial fetch is in flight
 *   error       — error message string, or null
 */
export function useQuotes() {
  const [quotes,      setQuotes]      = useState([]);
  const [quoteMap,    setQuoteMap]    = useState(new Map());
  const [refreshedAt, setRefreshedAt] = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchQuotes() {
      try {
        const res  = await fetch("/api/quotes");
        const data = await res.json();

        if (cancelled) return;

        if (!data.ok) {
          setError(data.error || "Failed to load quotes");
          return;
        }

        const map = new Map(data.quotes.map(q => [q.symbol, q]));
        setQuotes(data.quotes);
        setQuoteMap(map);
        setRefreshedAt(data.refreshedAt);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchQuotes();
    return () => { cancelled = true; };
  }, []);

  return { quotes, quoteMap, refreshedAt, loading, error };
}

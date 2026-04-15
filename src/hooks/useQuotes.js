import { useState, useEffect } from "react";

/**
 * useQuotes() — fetches cached quotes from /api/quotes on mount.
 *
 * A Vercel cron refreshes the quote cache every 15 min during market hours,
 * so in the common case this is just a Supabase read (fast). The server also
 * has a lazy-refresh fallback: if the cache is >15 min old AND the market is
 * open, it refreshes before responding. That path only fires when the cron
 * has failed or hasn't run yet (e.g. first page load of the day before the
 * 8:30 AM ET cron tick, or preview deploys where crons don't run), and adds
 * ~1-2s latency.
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

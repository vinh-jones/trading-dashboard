import { useState, useEffect, useRef } from "react";

// Fetches /api/radar-sample once per mount for the given tickers.
// Returns { samplesByTicker, loading, error, fetchedAt }:
//   - samplesByTicker: Map<ticker, sample> (empty until load resolves)
//   - loading: true until the first response arrives
//   - error: string | null
//   - fetchedAt: ISO timestamp (the freshest fetched_at across samples,
//                for the freshness line)
//
// Intentionally does NOT refetch in-session — the 1-hour cache lives
// server-side; a second Radar visit triggers the endpoint again, which
// handles the cache decision.
export function useRadarSamples(tickers) {
  const [samplesByTicker, setSamples] = useState(() => new Map());
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [fetchedAt, setFetchedAt]     = useState(null);

  // Stable signature to avoid re-firing when the tickers array identity
  // changes but contents don't.
  const keyRef = useRef("");
  const key    = [...(tickers || [])].sort().join(",");

  useEffect(() => {
    if (!key) {
      setLoading(false);
      return;
    }
    if (keyRef.current === key) return;
    keyRef.current = key;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/radar-sample?tickers=${encodeURIComponent(key)}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (!data.ok) {
          setError(data.error || "fetch failed");
          setLoading(false);
          return;
        }
        const map = new Map((data.samples || []).map(s => [s.ticker, s]));
        setSamples(map);

        let latest = null;
        for (const s of (data.samples || [])) {
          if (s.fetched_at && (!latest || s.fetched_at > latest)) latest = s.fetched_at;
        }
        setFetchedAt(latest);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [key]);

  return { samplesByTicker, loading, error, fetchedAt };
}

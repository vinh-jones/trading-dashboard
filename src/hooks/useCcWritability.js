import { useEffect, useState } from "react";

/**
 * Latest covered-call writability payload from /api/cc-writability.
 * Cached server-side (1h TTL) and refreshed by the intraday alert cron —
 * see api/cc-writability.js. No auth required for the read.
 *
 * Returns: { data, loading, error, refresh }
 *  - data:    response payload, or null until the first load completes
 *  - refresh: re-fetches the cached endpoint; it cannot force an upstream
 *             chain pull (that needs CRON_SECRET)
 */
export function useCcWritability() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [tick,    setTick]    = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    fetch("/api/cc-writability")
      .then(r => r.json())
      .then(json => {
        if (!alive) return;
        if (!json.ok) throw new Error(json.error || "fetch failed");
        setData(json);
      })
      .catch(err => {
        if (!alive) return;
        setError(err.message || "fetch failed");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => { alive = false; };
  }, [tick]);

  return { data, loading, error, refresh: () => setTick(t => t + 1) };
}

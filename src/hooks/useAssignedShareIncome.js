import { useEffect, useState } from "react";

/**
 * Fetches the latest assigned-share income & health snapshot from
 * /api/assigned-share-income. Endpoint serves a cached value (1h TTL)
 * with no auth required — see api/assigned-share-income.js.
 *
 * Returns: { data, loading, error, refresh }
 *  - data:    the response payload, or null until first load completes
 *  - loading: true on first load and during manual refresh
 *  - error:   error message string, or null
 *  - refresh: () => void — re-fetches the cached endpoint (does not force
 *             upstream Public.com refresh; that requires CRON_SECRET)
 */
export function useAssignedShareIncome() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [tick,    setTick]    = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    fetch("/api/assigned-share-income")
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

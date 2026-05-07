import { useState, useEffect } from "react";

export function useTickerDetail(ticker) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    if (!ticker) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    const ctrl = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`/api/ticker-detail?ticker=${encodeURIComponent(ticker)}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((json) => {
        if (ctrl.signal.aborted) return;
        if (!json.ok) {
          setError(json.error || "Unknown error");
          setData(null);
        } else {
          setData(json);
        }
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setError(err.message);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });

    return () => ctrl.abort();
  }, [ticker]);

  return { data, loading, error };
}

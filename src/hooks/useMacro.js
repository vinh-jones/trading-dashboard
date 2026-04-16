import { useState, useEffect, useCallback } from "react";

export function useMacro() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const fetchMacro = useCallback(async () => {
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // 20s max
    try {
      const res = await fetch("/api/macro", { signal: controller.signal });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error || "Failed to load macro data");
      } else {
        setData(json);
      }
    } catch (err) {
      if (err.name === "AbortError") {
        setError("Macro signals timed out — one data source may be slow. Try refreshing.");
      } else {
        setError(err.message);
      }
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMacro(); }, [fetchMacro]);

  return { data, loading, error, refresh: fetchMacro };
}

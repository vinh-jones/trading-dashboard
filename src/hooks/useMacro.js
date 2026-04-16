import { useState, useEffect, useCallback } from "react";

export function useMacro() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const fetchMacro = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/macro");
      const json = await res.json();
      if (!json.ok) {
        setError(json.error || "Failed to load macro data");
      } else {
        setData(json);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMacro(); }, [fetchMacro]);

  return { data, loading, error, refresh: fetchMacro };
}

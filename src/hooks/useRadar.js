import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { fetchRadarRows } from "../lib/radarData";

// Queries + row merge live in src/lib/radarData.js so api/agent-scan.js builds
// identical rows server-side. This hook is the React lifecycle wrapper.
export function useRadar() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    // Fire-and-forget BB refresh — idempotent, returns cached rows inside stale window.
    fetch("/api/bb").catch(err => console.warn("[useRadar] BB refresh failed:", err));

    fetchRadarRows(supabase)
      .then(({ rows: merged }) => setRows(merged))
      .catch(err => setError(err?.message ?? String(err)))
      .finally(() => setLoading(false));
  }, []);

  return { rows, loading, error };
}

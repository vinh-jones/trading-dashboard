import { useEffect, useState } from "react";
import { supabase } from "./supabase";

// Module-level cache — vocabulary rarely changes, fetch once per session.
let _cache = null;
let _fetchPromise = null;

async function fetchVocabulary() {
  if (_cache) return _cache;
  if (_fetchPromise) return _fetchPromise;
  _fetchPromise = supabase
    .from("tag_vocabulary")
    .select("tag, category, description")
    .eq("deprecated", false)
    .order("category")
    .order("tag")
    .then(({ data, error }) => {
      if (error) throw error;
      _cache = data ?? [];
      _fetchPromise = null;
      return _cache;
    });
  return _fetchPromise;
}

export function useTagVocabulary() {
  const [vocabulary, setVocabulary] = useState(_cache ?? []);
  const [loading, setLoading] = useState(!_cache);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (_cache) { setVocabulary(_cache); setLoading(false); return; }
    setLoading(true);
    fetchVocabulary()
      .then(v => { setVocabulary(v); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  return { vocabulary, loading, error };
}

// ── Query helpers ─────────────────────────────────────────────────────────────

export async function getEntriesWithTag(tag, { from, to } = {}) {
  let query = supabase
    .from("journal_entries")
    .select("*")
    .contains("tags", [tag])
    .order("created_at", { ascending: false });
  if (from) query = query.gte("created_at", from);
  if (to)   query = query.lte("created_at", to);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function countEntriesByTag(tags, { from, to } = {}) {
  const counts = {};
  for (const tag of tags) {
    const entries = await getEntriesWithTag(tag, { from, to });
    counts[tag] = entries.length;
  }
  return counts;
}

export async function getTagUsageStats({ from, to } = {}) {
  const { data, error } = await supabase.rpc("tag_usage_stats", {
    from_date: from ?? null,
    to_date:   to   ?? null,
  });
  if (error) throw error;
  return data;
}

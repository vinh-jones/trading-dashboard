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

// ── Strategic-tag display for open positions ─────────────────────────────────

// Tags whose prefix is in this list are NOT shown on position rows.
// position-action: action history, redundant with the position record.
// framework:      process descriptors, not strategic state.
// drift:          private reflection, inappropriate to surface on a position display.
// Anything else — including ad-hoc user-coined prefixes (e.g. "structure:cost-basis-layer",
// "thesis:*", "strategy:*") — counts as strategic context and surfaces.
export const NON_STRATEGIC_TAG_PREFIXES = ["position-action", "framework", "drift"];

// Display ordering for known strategic prefixes; unknown prefixes sort after these.
export const STRATEGIC_TAG_PREFIXES = ["earnings-play", "signal", "macro"];

function tagPrefix(tag) {
  if (typeof tag !== "string") return "";
  const i = tag.indexOf(":");
  return i === -1 ? tag : tag.slice(0, i);
}

function isStrategic(tag) {
  return !NON_STRATEGIC_TAG_PREFIXES.includes(tagPrefix(tag));
}

export function positionKey(p) {
  if (p.type === "Shares") return `${p.ticker}|Shares`;
  return `${p.ticker}|${p.type}|${p.strike}|${p.expiry_date ?? p.expiry}`;
}

function entryKey(e) {
  if (e.type === "Shares") return `${e.ticker}|Shares`;
  return `${e.ticker}|${e.type}|${e.strike}|${e.expiry}`;
}

/**
 * Group strategic tags from journal entries by position key.
 *
 * @param {Array} entries  - Journal entries with {id, ticker, type, strike, expiry, tags, created_at}.
 * @param {Object} positions - {open_csps, open_leaps, assigned_shares} as held in app state.
 * @returns {Map<string, Array<{tag, entryId, createdAt}>>} - Position key → strategic tags. Deduped per position; for duplicate tags, the most recent entry id is retained.
 */
export function groupStrategicTagsByPosition(entries, positions) {
  // Build the set of valid position keys we want to surface tags for.
  const validKeys = new Set();
  (positions?.open_csps ?? []).forEach(p => validKeys.add(positionKey(p)));
  (positions?.open_leaps ?? []).forEach(p => validKeys.add(positionKey(p)));
  (positions?.assigned_shares ?? []).forEach(s => {
    validKeys.add(positionKey({ ticker: s.ticker, type: "Shares" }));
    if (s.active_cc) validKeys.add(positionKey({ ...s.active_cc, type: "CC" }));
  });

  // Walk entries newest-first; for each strategic tag, keep the first occurrence
  // (which is the most recent thanks to the sort).
  const sorted = [...entries].sort((a, b) => {
    const tcmp = String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
    if (tcmp !== 0) return tcmp;
    return String(b.id ?? "").localeCompare(String(a.id ?? ""));
  });

  const out = new Map(); // posKey → Map<tag, {tag, entryId, createdAt}>
  for (const e of sorted) {
    const key = entryKey(e);
    if (!validKeys.has(key)) continue;
    if (!Array.isArray(e.tags)) continue;
    for (const tag of e.tags) {
      if (!isStrategic(tag)) continue;
      let posBucket = out.get(key);
      if (!posBucket) { posBucket = new Map(); out.set(key, posBucket); }
      if (!posBucket.has(tag)) {
        posBucket.set(tag, { tag, entryId: e.id, createdAt: e.created_at });
      }
    }
  }

  // Materialize inner Maps to arrays.
  const result = new Map();
  for (const [k, bucket] of out) result.set(k, [...bucket.values()]);
  return result;
}

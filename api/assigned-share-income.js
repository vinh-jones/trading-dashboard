/**
 * api/assigned-share-income.js — Vercel serverless function
 *
 * GET /api/assigned-share-income
 *   - No auth required.
 *   - Reads cached result from app_cache (key: assigned_share_income_latest).
 *   - Serves the cache if fresh (< CACHE_TTL_MS), otherwise refreshes
 *     anonymously (read-only) IF the cache is stale or missing.
 *   - Returns the same shape regardless of refresh path.
 *
 * GET /api/assigned-share-income?refresh=1
 *   - Forces a refresh.
 *   - Requires Bearer ${CRON_SECRET}.
 *
 * Cache TTL: 1 hour. Refreshed automatically on stale-read OR explicitly
 * by the EOD snapshot cron.
 *
 * Used by:
 *   - src/components/AssignedShareIncome.jsx (anon read)
 *   - api/snapshot.js EOD cron (auth refresh — forthcoming)
 *   - manual spot-checks (auth refresh)
 */

import { createClient } from "@supabase/supabase-js";
import { computeAssignedShareIncome } from "./_lib/computeAssignedShareIncome.js";

const CACHE_KEY    = "assigned_share_income_latest";
const CACHE_TTL_MS = 60 * 60 * 1000;  // 1 hour

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set");
  return createClient(url, key);
}

async function readCache(supabase) {
  const { data } = await supabase
    .from("app_cache")
    .select("value, expires_at")
    .eq("key", CACHE_KEY)
    .single();
  if (!data?.value) return null;
  try {
    const parsed = typeof data.value === "string" ? JSON.parse(data.value) : data.value;
    return { payload: parsed, expiresAt: data.expires_at };
  } catch {
    return null;
  }
}

async function writeCache(supabase, payload) {
  const expiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString();
  await supabase.from("app_cache").upsert({
    key:        CACHE_KEY,
    value:      JSON.stringify(payload),
    expires_at: expiresAt,
  });
}

async function refreshAndPersist(supabase) {
  const todayISO = new Date().toISOString().slice(0, 10);
  const { data: positions, error } = await supabase.from("positions").select("*");
  if (error) throw new Error(`positions load failed: ${error.message}`);
  const result = await computeAssignedShareIncome({
    supabase,
    positions: positions ?? [],
    todayISO,
  });
  await writeCache(supabase, result);
  return result;
}

export default async function handler(req, res) {
  const wantsRefresh  = String(req.query?.refresh || "") === "1";
  const authHeader    = req.headers["authorization"];
  const isAuthorized  = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (wantsRefresh && !isAuthorized) {
    return res.status(401).json({ ok: false, error: "refresh requires auth" });
  }

  try {
    const supabase = getSupabase();

    // Auth+refresh: force a fresh compute and overwrite cache.
    if (wantsRefresh) {
      const fresh = await refreshAndPersist(supabase);
      return res.status(200).json({ ok: true, cached: false, ...fresh });
    }

    // Anon read path: serve fresh cache, else refresh-on-demand.
    const cached = await readCache(supabase);
    const isFresh = cached && new Date(cached.expiresAt).getTime() > Date.now();
    if (isFresh) {
      return res.status(200).json({ ok: true, cached: true, ...cached.payload });
    }

    // Cache stale or missing — refresh on this request. (Coalescing isn't
    // needed at v1's traffic; if multiple browsers race, they'll both
    // recompute and last writer wins. Acceptable for diagnostic data.)
    const fresh = await refreshAndPersist(supabase);
    return res.status(200).json({ ok: true, cached: false, ...fresh });
  } catch (err) {
    console.error("[api/assigned-share-income]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

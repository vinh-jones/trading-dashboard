/**
 * api/cc-writability.js — Vercel serverless function
 *
 * GET /api/cc-writability
 *   - No auth. Serves the cached payload written by the intraday alert cron
 *     (/api/alert-check) and the EOD snapshot.
 *
 * GET /api/cc-writability?refresh=1
 *   - Forces a recompute. Requires Bearer ${CRON_SECRET}.
 *
 * READ-MOSTLY BY DESIGN. AMBER is a dashboard-only state (spec §2.4), so the
 * UI needs this payload on every load — but a recompute pulls option chains,
 * and browsers must not be able to trigger that at will. The anon path serves
 * the cache and, when it is stale, recomputes once rather than serving numbers
 * that predate the session. The alert cron refreshes it every 30 minutes during
 * market hours, so a stale read outside those hours is the normal case and the
 * `stale` flag says so.
 *
 * Nothing in this path can place an order (acceptance 13). It reads Supabase,
 * reads market data, and returns JSON.
 */

import { createClient } from "@supabase/supabase-js";
import { computeCcWritability, writeCcWritabilityShadowLog } from "./_lib/computeCcWritability.js";

const CACHE_KEY    = "cc_writability_latest";
const CACHE_TTL_MS = 60 * 60 * 1000;

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
    .maybeSingle();
  if (!data?.value) return null;
  try {
    return {
      payload:   typeof data.value === "string" ? JSON.parse(data.value) : data.value,
      expiresAt: data.expires_at,
    };
  } catch {
    return null;
  }
}

async function refreshAndPersist(supabase, { log }) {
  const todayISO = new Date().toISOString().slice(0, 10);
  const { data: positions, error } = await supabase.from("positions").select("*");
  if (error) throw new Error(`positions load failed: ${error.message}`);

  const result = await computeCcWritability({ supabase, positions: positions ?? [], todayISO });

  await supabase.from("app_cache").upsert({
    key:        CACHE_KEY,
    value:      JSON.stringify(result),
    expires_at: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
  });

  // Only the authorized refresh writes a shadow-log row. A browser hitting a
  // cold cache must not be able to inflate the §8.2 row count, which is meant
  // to be one row per in-scope ticker per scheduled evaluation.
  if (log) await writeCcWritabilityShadowLog({ supabase, payload: result, todayISO });

  return result;
}

export default async function handler(req, res) {
  const wantsRefresh = String(req.query?.refresh || "") === "1";
  const isAuthorized = req.headers["authorization"] === `Bearer ${process.env.CRON_SECRET}`;

  if (wantsRefresh && !isAuthorized) {
    return res.status(401).json({ ok: false, error: "refresh requires auth" });
  }

  try {
    const supabase = getSupabase();

    if (wantsRefresh) {
      const fresh = await refreshAndPersist(supabase, { log: true });
      return res.status(200).json({ ok: true, cached: false, ...fresh });
    }

    const cached = await readCache(supabase);
    if (cached && new Date(cached.expiresAt).getTime() > Date.now()) {
      return res.status(200).json({ ok: true, cached: true, stale: false, ...cached.payload });
    }

    try {
      const fresh = await refreshAndPersist(supabase, { log: false });
      return res.status(200).json({ ok: true, cached: false, stale: false, ...fresh });
    } catch (refreshErr) {
      // Upstream market data is down. A stale payload with an honest flag beats
      // an empty panel — the UI dims it and shows the timestamp.
      if (cached) {
        console.warn("[api/cc-writability] refresh failed, serving stale:", refreshErr.message);
        return res.status(200).json({ ok: true, cached: true, stale: true, ...cached.payload });
      }
      throw refreshErr;
    }
  } catch (err) {
    console.error("[api/cc-writability]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

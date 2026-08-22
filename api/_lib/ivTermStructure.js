/**
 * api/_lib/ivTermStructure.js
 *
 * Per-expiry ATM IV for a ticker, cached daily in `app_cache`.
 *
 * WHY THIS EXISTS: the CC-writability alert (docs/spec_cc_writability_alert_v1.md)
 * runs every 30 minutes and must not pull an option chain per ticker per run.
 * The cheap screen still needs a DIFFERENT IV for every rung — §2.2a of the spec
 * is the receipt: one stored 30d IV priced IREN's 7d rung at 31.4% when the
 * chain said 76.1%. So the modeled path reads this curve, never a scalar.
 *
 * Refreshed at most once per trading day per ticker (UW publishes one ATM IV
 * per listed expiry off the last close), which is also what the spec prescribes
 * when per-expiry IV is not already available.
 */

import { fetchIvTermStructure, hasUwKey } from "./uwClient.js";

const CACHE_PREFIX = "iv_term_structure:";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function cacheKey(ticker) {
  return `${CACHE_PREFIX}${ticker}`;
}

// UW returns decimals for `volatility`; be tolerant of a percent-scaled row
// rather than silently pricing a 105% IV as 1.05 basis points of vol.
function normalizeVol(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 5 ? n / 100 : n;
}

function normalizeRows(raw) {
  const rows = Array.isArray(raw) ? raw : (raw?.data ?? []);
  return rows
    .map(r => ({
      expiry:     r?.expiry ?? r?.expiration ?? r?.date_expiration ?? null,
      volatility: normalizeVol(r?.volatility ?? r?.implied_volatility ?? r?.iv),
    }))
    .filter(r => r.expiry && r.volatility != null)
    .sort((a, b) => (a.expiry < b.expiry ? -1 : 1));
}

/**
 * Read the cached curve, refreshing from UW when it is stale or absent.
 * Fails soft: a UW outage returns null (the caller then prices from the chain
 * or reports the rung unpriced) rather than throwing into the alert path.
 */
export async function loadIvTermStructure(supabase, ticker, { todayISO } = {}) {
  const key = cacheKey(ticker);

  try {
    const { data } = await supabase
      .from("app_cache")
      .select("value, expires_at")
      .eq("key", key)
      .maybeSingle();

    if (data?.value && data.expires_at && new Date(data.expires_at).getTime() > Date.now()) {
      const parsed = typeof data.value === "string" ? JSON.parse(data.value) : data.value;
      if (parsed?.rows?.length) return parsed;
    }
  } catch (err) {
    console.warn(`[ivTermStructure] cache read failed for ${ticker}:`, err.message);
  }

  if (!hasUwKey()) return null;

  let rows;
  try {
    rows = normalizeRows(await fetchIvTermStructure(ticker));
  } catch (err) {
    console.warn(`[ivTermStructure] UW fetch failed for ${ticker}:`, err.message);
    return null;
  }
  if (!rows.length) return null;

  const payload = { ticker, rows, fetched_at: new Date().toISOString(), as_of: todayISO ?? null };
  try {
    await supabase.from("app_cache").upsert({
      key,
      value:      JSON.stringify(payload),
      expires_at: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
    });
  } catch (err) {
    console.warn(`[ivTermStructure] cache write failed for ${ticker}:`, err.message);
  }
  return payload;
}

/**
 * IV for one expiry off the curve.
 *
 * Exact expiry match wins. Otherwise interpolate in TOTAL VARIANCE against
 * DTE — the arbitrage-free way to move between listed tenors, and the only one
 * that keeps an event's variance where it belongs instead of smearing it across
 * the term. Outside the curve's range, clamp to the nearest end rather than
 * extrapolating a vol surface we have no evidence for.
 */
export function ivForExpiry(curve, expiry, dte, todayISO) {
  const rows = curve?.rows ?? [];
  if (!rows.length || dte == null || dte <= 0) return null;

  const exact = rows.find(r => r.expiry === expiry);
  if (exact) return exact.volatility;

  const base = todayISO ? new Date(`${todayISO}T00:00:00Z`).getTime() : Date.now();
  const withDte = rows
    .map(r => ({
      ...r,
      dte: Math.round((new Date(`${r.expiry}T00:00:00Z`).getTime() - base) / 86_400_000),
    }))
    .filter(r => Number.isFinite(r.dte) && r.dte > 0)
    .sort((a, b) => a.dte - b.dte);

  if (!withDte.length) return null;
  if (dte <= withDte[0].dte)                    return withDte[0].volatility;
  if (dte >= withDte[withDte.length - 1].dte)   return withDte[withDte.length - 1].volatility;

  let lo = withDte[0];
  let hi = withDte[withDte.length - 1];
  for (let i = 0; i < withDte.length - 1; i++) {
    if (withDte[i].dte <= dte && withDte[i + 1].dte >= dte) {
      lo = withDte[i];
      hi = withDte[i + 1];
      break;
    }
  }
  if (hi.dte === lo.dte) return lo.volatility;

  const varLo = lo.volatility * lo.volatility * lo.dte;
  const varHi = hi.volatility * hi.volatility * hi.dte;
  const w     = (dte - lo.dte) / (hi.dte - lo.dte);
  const varAt = varLo + w * (varHi - varLo);
  if (!(varAt > 0)) return null;
  return Math.sqrt(varAt / dte);
}

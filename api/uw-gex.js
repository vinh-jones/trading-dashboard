/**
 * api/uw-gex.js — Vercel serverless function (cron)
 *
 * GET /api/uw-gex              → GEX strike walls for the approved universe + held
 * GET /api/uw-gex?tickers=NVDA → just these (smoke test)
 * GET /api/uw-gex?tickers=NVDA&debug=1 → dump raw by-strike shapes (no write)
 *
 * Consumer 3. Pulls the per-strike dealer-gamma profile from UW, reduces it to
 * the few numbers that drive a CSP decision (net-gamma environment + the
 * positive-gamma support/resistance walls — see src/lib/gexLevels.js), and
 * writes them onto the ticker's uw_signals row. Uses .update() so it only
 * touches the gex_* fields, leaving flow/gamma/short/earnings intact.
 *
 * The exact UW by-strike field names aren't locked yet, so the normalizer is
 * tolerant (candidate field lists) and ?debug=1 probes both candidate endpoints
 * to confirm the live shape. In middleware BYPASS; self-authenticates. Soft
 * no-op until UW_API_KEY is set.
 */

import { createClient } from "@supabase/supabase-js";
import { hasUwKey, fetchGreekExposureByStrike, fetchSpotExposuresByStrike, fetchMaxPain } from "./_lib/uwClient.js";
import { computeGexLevels } from "../src/lib/gexLevels.js";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

function authorized(req) {
  const auth   = req.headers["authorization"] || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const cron   = process.env.CRON_SECRET;
  const app    = process.env.APP_SECRET;
  if (cron && bearer === cron) return true;
  if (app && bearer === app) return true;
  const cookie = req.headers.cookie || "";
  const m = cookie.match(/(?:^|;\s*)app_auth=([^;]+)/);
  const cookieTok = m ? decodeURIComponent(m[1]) : null;
  return !!(app && cookieTok === app);
}

function pickNum(row, keys) {
  for (const k of keys) {
    if (row && row[k] != null) {
      const v = parseFloat(row[k]);
      if (Number.isFinite(v)) return v;
    }
  }
  return null;
}

const STRIKE_FIELDS = ["strike", "strike_price"];

// Net signed dealer gamma at a strike. UW's /greek-exposure/strike gives
// call_gex + put_gex (put_gex already signed negative — same convention as
// gammaEnvFromGreek), so net = call_gex + put_gex. Falls back to the
// spot-exposures *_gamma_oi split, then to a single net field, for resilience.
function netGammaAtStrike(r) {
  const callGex = pickNum(r, ["call_gex"]);
  const putGex  = pickNum(r, ["put_gex"]);
  if (callGex != null || putGex != null) return (callGex ?? 0) + (putGex ?? 0);
  const callOi = pickNum(r, ["call_gamma_oi", "call_gamma"]);
  const putOi  = pickNum(r, ["put_gamma_oi", "put_gamma"]);
  if (callOi != null || putOi != null) return (callOi ?? 0) + (putOi ?? 0);
  return pickNum(r, ["gamma_per_one_percent_move_oi", "net_gamma", "gamma_oi", "gamma_notional", "gamma"]);
}

// Normalize UW's by-strike rows into [{ strike, gamma }]. The response carries
// one row per strike per `date`; keep only the latest date's full ladder.
function normalizeStrikeRows(resp) {
  const rows = resp?.data ?? resp ?? [];
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const latestDate = rows.reduce((m, r) => {
    const d = String(r?.date ?? "");
    return d > m ? d : m;
  }, "");
  const ladder = latestDate ? rows.filter((r) => String(r?.date ?? "") === latestDate) : rows;
  return ladder
    .map((r) => ({ strike: pickNum(r, STRIKE_FIELDS), gamma: netGammaAtStrike(r) }))
    .filter((r) => r.strike != null && r.gamma != null);
}

// /greek-exposure/strike is the clean per-strike ladder (call_gex/put_gex);
// fall back to spot-exposures/strike only if it returns nothing.
async function fetchStrikeProfile(ticker) {
  let rows = normalizeStrikeRows(await fetchGreekExposureByStrike(ticker));
  if (rows.length === 0) rows = normalizeStrikeRows(await fetchSpotExposuresByStrike(ticker));
  return rows;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });
  if (!hasUwKey()) return res.status(200).json({ ok: true, skipped: "UW_API_KEY not configured", updated: 0 });

  try {
    const supabase = getSupabase();
    const now = new Date().toISOString();

    const override = (req.query.tickers || "").trim();
    let tickers;
    if (override) {
      tickers = [...new Set(override.toUpperCase().split(",").map((t) => t.trim()).filter(Boolean))];
    } else {
      const [universe, positions] = await Promise.all([
        supabase.from("wheel_universe").select("ticker").eq("list_type", "approved"),
        supabase.from("positions").select("ticker"),
      ]);
      const set = new Set();
      (universe.data  ?? []).forEach((r) => r.ticker && set.add(r.ticker));
      (positions.data ?? []).forEach((r) => r.ticker && set.add(r.ticker));
      tickers = [...set].sort();
    }

    // ?debug=1 — probe both candidate endpoints so the normalizer can be mapped
    // exactly. Does not write.
    if (req.query.debug) {
      const trim = (resp) => {
        const rows = resp?.data ?? resp;
        if (Array.isArray(rows)) return { count: rows.length, keys: Object.keys(rows[0] ?? {}), sample: rows.slice(0, 2) };
        if (rows && typeof rows === "object") return { keys: Object.keys(rows), value: rows };
        return rows;
      };
      const probe = async (fn, ticker) => {
        try { return trim(await fn(ticker)); } catch (e) { return { error: e?.message ?? String(e) }; }
      };
      const debug = [];
      for (const ticker of tickers) {
        debug.push({
          ticker,
          greek_strike: await probe(fetchGreekExposureByStrike, ticker),
          spot_strike:  await probe(fetchSpotExposuresByStrike, ticker),
          max_pain:     await probe(fetchMaxPain, ticker),
        });
      }
      return res.status(200).json({ ok: true, debug });
    }

    // Spot prices for the wall placement (above/below current price).
    const { data: quoteRows } = await supabase.from("quotes").select("symbol, mid, last").in("symbol", tickers);
    const spotByTicker = new Map();
    for (const q of quoteRows ?? []) spotByTicker.set(q.symbol, q.mid ?? q.last ?? null);

    // Prior env for the hysteresis band (so a name near its gamma flip holds
    // its label instead of flip-flopping day to day).
    const { data: priorRows } = await supabase.from("uw_signals").select("ticker, gex_env").in("ticker", tickers);
    const prevEnvByTicker = new Map((priorRows ?? []).map((r) => [r.ticker, r.gex_env]));

    const results = [];
    for (const ticker of tickers) {
      try {
        const rows   = await fetchStrikeProfile(ticker);
        const levels = computeGexLevels({ rows, spot: spotByTicker.get(ticker), prevEnv: prevEnvByTicker.get(ticker) ?? null });
        const patch = {
          gex_env:          levels.env,
          gex_net_gamma:    levels.netGamma,
          gex_support:      levels.support,
          gex_resistance:   levels.resistance,
          gex_air_pocket:   levels.airPocket,
          gex_refreshed_at: now,
        };
        const { error } = await supabase.from("uw_signals").update(patch).eq("ticker", ticker);
        results.push({ ticker, ok: !error, error: error?.message, ...patch });
      } catch (err) {
        results.push({ ticker, ok: false, error: err?.message ?? String(err) });
      }
    }

    const failed = results.filter((r) => !r.ok);
    if (failed.length) console.warn("[api/uw-gex] failures:", failed);
    const withLevels = results.filter((r) => r.ok && r.gex_env).length;
    console.log(`[api/uw-gex] updated ${results.filter((r) => r.ok).length}/${tickers.length} (${withLevels} with GEX levels)`);

    return res.status(200).json({
      ok: true,
      updated: results.filter((r) => r.ok).length,
      with_levels: withLevels,
      total: tickers.length,
      results,
    });
  } catch (err) {
    console.error("[api/uw-gex]", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

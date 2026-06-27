/**
 * api/spike-gatea.js — TEMPORARY debug endpoint for the Risk-Unit v2 spike.
 *
 * Gate A: does Public.com return live, sane delta + iv for a real held LEAP?
 * Hits the SAME auth + greeks + quotes endpoints api/quotes.js uses (reusing the
 * cached Supabase token), for two gate-specified LEAPs and their underlyings.
 * Greeks are market-data-by-OSI (not position-dependent), so this works even
 * though the connected account holds no positions.
 *
 *   GET /api/spike-gatea?secret=<MARKET_CONTEXT_INGEST_SECRET>
 *
 * Returns diagnostic JSON: delta/iv/spot per LEAP, HTTP statuses, and raw error
 * bodies if any call failed. DELETE this file once the spike is closed.
 */

import { createClient } from "@supabase/supabase-js";

const PUBLIC_COM_BASE = "https://api.public.com";
const ACCOUNT_ID      = process.env.PUBLIC_COM_ACCOUNT_ID;
const TOKEN_BUFFER_MS = 5 * 60 * 1000;

// OSI symbols built with the repo's buildOccSymbol() convention (no root pad),
// matching what api/quotes.js sends to Public.com.
const TARGETS = [
  { label: "CLS $360C 2027-08-20",  osi: "CLS270820C00360000",  underlying: "CLS",  expectDelta: [0.55, 0.90], expectIv: [0.40, 1.10] },
  { label: "SOFI $15C 2028-01-21",  osi: "SOFI280121C00015000", underlying: "SOFI", expectDelta: [0.60, 0.97], expectIv: [0.35, 1.00] },
];

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

// Reuse the 24h token the dashboard already caches in app_cache; mint a fresh
// short-lived one only if there isn't a valid cached token.
async function getToken(supabase) {
  const { data: cached } = await supabase
    .from("app_cache").select("value, expires_at").eq("key", "public_com_token").single();
  if (cached?.value && new Date(cached.expires_at).getTime() - TOKEN_BUFFER_MS > Date.now()) {
    return cached.value;
  }
  const secret = process.env.PUBLIC_COM_SECRET;
  if (!secret) throw new Error("No valid cached token and PUBLIC_COM_SECRET not set");
  const res = await fetch(`${PUBLIC_COM_BASE}/userapiauthservice/personal/access-tokens`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, validityInMinutes: 30 }),
  });
  if (!res.ok) throw new Error(`Public.com auth failed (${res.status}): ${await res.text()}`);
  return (await res.json()).accessToken;
}

async function fetchGreeks(token, osiSymbols) {
  const params = osiSymbols.map(s => `osiSymbols=${encodeURIComponent(s)}`).join("&");
  const res = await fetch(
    `${PUBLIC_COM_BASE}/userapigateway/option-details/${ACCOUNT_ID}/greeks?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return { status: res.status, body: res.ok ? await res.json() : await res.text() };
}

async function fetchQuotes(token, instruments) {
  const res = await fetch(
    `${PUBLIC_COM_BASE}/userapigateway/marketdata/${ACCOUNT_ID}/quotes`,
    { method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ instruments }) },
  );
  return { status: res.status, body: res.ok ? await res.json() : await res.text() };
}

const inRange = (v, [lo, hi]) => v != null && v >= lo && v <= hi;

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "GET only" });

  // Guard so this debug route isn't openly callable (skipped only if no secret
  // is configured in the env at all).
  const guard = process.env.MARKET_CONTEXT_INGEST_SECRET;
  if (guard && req.query.secret !== guard) {
    return res.status(403).json({ ok: false, error: "forbidden — pass ?secret=<MARKET_CONTEXT_INGEST_SECRET>" });
  }

  try {
    if (!ACCOUNT_ID) throw new Error("PUBLIC_COM_ACCOUNT_ID not set");
    const supabase = getSupabase();
    const token = await getToken(supabase);

    const greeksResp = await fetchGreeks(token, TARGETS.map(t => t.osi));
    const underlyings = [...new Set(TARGETS.map(t => t.underlying))];
    const equityResp = await fetchQuotes(token, underlyings.map(s => ({ symbol: s, type: "EQUITY" })));

    const greeksBySym = {};
    if (greeksResp.status === 200) {
      for (const g of (greeksResp.body.greeks || [])) greeksBySym[g.symbol] = g.greeks || {};
    }
    const spotBySym = {};
    if (equityResp.status === 200) {
      for (const q of (equityResp.body.quotes || [])) {
        if (q.outcome === "SUCCESS") spotBySym[q.instrument?.symbol] = q.last;
      }
    }

    const results = TARGETS.map(t => {
      const g = greeksBySym[t.osi] || {};
      const delta = g.delta != null ? Number(g.delta) : null;
      const iv    = g.impliedVolatility != null ? Number(g.impliedVolatility) : null;
      const spot  = spotBySym[t.underlying] != null ? Number(spotBySym[t.underlying]) : null;
      return {
        label: t.label, osi: t.osi, underlying: t.underlying,
        delta, iv, spot,
        deltaNonNull: delta != null, deltaSane: inRange(delta, t.expectDelta),
        ivNonNull: iv != null,       ivSane: inRange(iv, t.expectIv),
        spotPresent: spot != null,
        rawGreeks: g,               // shows whether Public also returns gamma/vega/theta
      };
    });

    const pass = results.every(r => r.deltaNonNull && r.ivNonNull && r.spotPresent);

    return res.status(200).json({
      ok: true,
      gateA: pass ? "PASS" : "FAIL",
      verdict: pass
        ? "Both LEAPs returned non-null delta + iv + spot — Gate A passes."
        : "Missing delta/iv/spot on at least one leg — see results + errors below. STOP; do not build on nulls.",
      greeksHttpStatus: greeksResp.status,
      equityHttpStatus: equityResp.status,
      results,
      greeksError: greeksResp.status !== 200 ? greeksResp.body : undefined,
      equityError: equityResp.status !== 200 ? equityResp.body : undefined,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

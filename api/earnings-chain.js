/**
 * api/earnings-chain.js — Vercel serverless function
 *
 * GET /api/earnings-chain?ticker=PLTR&expiry=2026-05-01
 *
 * Returns the put chain for a single ticker+expiry, filtered to ±25% of spot,
 * with delta + IV attached from the greeks endpoint. Feeds the Earnings Play
 * Tool's four-path strike selection.
 *
 * Response shape:
 *   {
 *     ok: true,
 *     ticker, expiry,
 *     spot,
 *     atmStrike,
 *     atmIV,
 *     strikes: [{ strike, delta, iv, bid, ask, mid, osi }],
 *     fetchedAt,
 *     cached: boolean
 *   }
 *
 * Cache: 30 minutes keyed in app_cache under "earnings_chain:TICKER:EXPIRY".
 * Data source: Public.com option-chain + option-details/greeks (same pattern
 * as api/radar-sample.js).
 */
import { createClient } from "@supabase/supabase-js";

const PUBLIC_COM_BASE        = "https://api.public.com";
const ACCOUNT_ID             = process.env.PUBLIC_COM_ACCOUNT_ID;
const TOKEN_VALIDITY_MINUTES = 1440;
const TOKEN_BUFFER_MS        = 5 * 60 * 1000;
const CACHE_TTL_MS           = 30 * 60 * 1000;
const STRIKE_BAND_PCT        = 0.25;
const MAX_GREEKS_SYMBOLS     = 40;

function getSupabase() {
  const url = process.env.SUPABASE_URL      || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

async function getPublicAccessToken(supabase) {
  const { data: cached } = await supabase
    .from("app_cache")
    .select("value, expires_at")
    .eq("key", "public_com_token")
    .single();

  if (cached?.value && new Date(cached.expires_at).getTime() - TOKEN_BUFFER_MS > Date.now()) {
    return cached.value;
  }
  const secret = process.env.PUBLIC_COM_SECRET;
  if (!secret) throw new Error("PUBLIC_COM_SECRET not set");

  const res = await fetch(`${PUBLIC_COM_BASE}/userapiauthservice/personal/access-tokens`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ secret, validityInMinutes: TOKEN_VALIDITY_MINUTES }),
  });
  if (!res.ok) throw new Error(`Public.com auth failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  if (!data.accessToken) throw new Error("Public.com auth: no accessToken in response");

  const expiresAt = new Date(Date.now() + TOKEN_VALIDITY_MINUTES * 60 * 1000).toISOString();
  await supabase.from("app_cache").upsert({ key: "public_com_token", value: data.accessToken, expires_at: expiresAt });
  return data.accessToken;
}

async function fetchChain(token, symbol, expirationDate) {
  const url = `${PUBLIC_COM_BASE}/userapigateway/marketdata/${ACCOUNT_ID}/option-chain`;
  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body:    JSON.stringify({ instrument: { symbol, type: "EQUITY" }, expirationDate }),
  });
  if (!res.ok) throw new Error(`chain ${symbol} ${expirationDate} failed ${res.status}`);
  const data = await res.json();
  return { puts: data.puts || [], calls: data.calls || [] };
}

async function fetchGreeks(token, osiSymbols) {
  if (!osiSymbols.length) return [];
  const params = osiSymbols.map(s => `osiSymbols=${encodeURIComponent(s)}`).join("&");
  const url = `${PUBLIC_COM_BASE}/userapigateway/option-details/${ACCOUNT_ID}/greeks?${params}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`greeks failed ${res.status}`);
  const data = await res.json();
  return data.greeks || [];
}

async function fetchStockQuote(token, ticker) {
  const res = await fetch(
    `${PUBLIC_COM_BASE}/userapigateway/marketdata/${ACCOUNT_ID}/quotes`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body:    JSON.stringify({ instruments: [{ symbol: ticker, type: "EQUITY" }] }),
    }
  );
  if (!res.ok) throw new Error(`stock quote failed ${res.status}`);
  const data = await res.json();
  const q = (data.quotes || [])[0];
  const bid = q?.bid != null ? parseFloat(q.bid) : null;
  const ask = q?.ask != null ? parseFloat(q.ask) : null;
  const last = q?.last != null ? parseFloat(q.last) : null;
  if (bid != null && ask != null) return (bid + ask) / 2;
  return last;
}

function strikeFromOCC(occSymbol) {
  return parseInt(occSymbol.slice(-8), 10) / 1000;
}

function computeMid(bid, ask) {
  const b = bid != null ? Number(bid) : null;
  const a = ask != null ? Number(ask) : null;
  if (b != null && a != null) return Math.round(((b + a) / 2) * 100) / 100;
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const ticker = (req.query.ticker || "").toString().trim().toUpperCase();
  const expiry = (req.query.expiry || "").toString().trim();
  if (!ticker || !expiry) {
    return res.status(400).json({ ok: false, error: "ticker_and_expiry_required" });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
    return res.status(400).json({ ok: false, error: "expiry_must_be_yyyy_mm_dd" });
  }

  const supabase = getSupabase();
  const cacheKey = `earnings_chain:${ticker}:${expiry}`;

  const { data: cachedRow } = await supabase
    .from("app_cache")
    .select("value, expires_at")
    .eq("key", cacheKey)
    .single();

  if (cachedRow?.value && new Date(cachedRow.expires_at).getTime() > Date.now()) {
    try {
      const parsed = typeof cachedRow.value === "string" ? JSON.parse(cachedRow.value) : cachedRow.value;
      return res.status(200).json({ ...parsed, cached: true });
    } catch (_) { /* fall through to refetch */ }
  }

  try {
    const token = await getPublicAccessToken(supabase);
    const spot  = await fetchStockQuote(token, ticker);
    if (spot == null) throw new Error(`no spot price for ${ticker}`);

    const { puts } = await fetchChain(token, ticker, expiry);
    if (!puts.length) {
      return res.status(200).json({
        ok: true, ticker, expiry, spot, atmStrike: null, atmIV: null, strikes: [],
        fetchedAt: new Date().toISOString(), cached: false, note: "no_puts",
      });
    }

    const minStrike = spot * (1 - STRIKE_BAND_PCT);
    const maxStrike = spot * (1 + STRIKE_BAND_PCT);

    const inBand = puts
      .map(row => ({
        osi:    row.instrument?.symbol,
        strike: row.instrument?.symbol ? strikeFromOCC(row.instrument.symbol) : null,
        bid:    row.bid != null ? Number(row.bid) : null,
        ask:    row.ask != null ? Number(row.ask) : null,
      }))
      .filter(r => r.osi && r.strike != null && r.strike >= minStrike && r.strike <= maxStrike)
      .sort((a, b) => a.strike - b.strike);

    // Pick greeks symbols — center around spot, cap length
    let greeksSymbols = inBand.map(r => r.osi);
    if (greeksSymbols.length > MAX_GREEKS_SYMBOLS) {
      const spotIdx = inBand.reduce((closest, r, i) =>
        Math.abs(r.strike - spot) < Math.abs(inBand[closest].strike - spot) ? i : closest, 0);
      const half = Math.floor(MAX_GREEKS_SYMBOLS / 2);
      const start = Math.max(0, Math.min(inBand.length - MAX_GREEKS_SYMBOLS, spotIdx - half));
      greeksSymbols = inBand.slice(start, start + MAX_GREEKS_SYMBOLS).map(r => r.osi);
    }

    const greekRows = await fetchGreeks(token, greeksSymbols);
    const greekBy = {};
    for (const g of greekRows) {
      greekBy[g.symbol] = {
        delta: g.greeks?.delta != null ? Math.abs(Number(g.greeks.delta)) : null,
        iv:    g.greeks?.impliedVolatility != null ? Number(g.greeks.impliedVolatility) : null,
      };
    }

    const strikes = inBand.map(r => ({
      strike: r.strike,
      bid:    r.bid,
      ask:    r.ask,
      mid:    computeMid(r.bid, r.ask),
      delta:  greekBy[r.osi]?.delta ?? null,
      iv:     greekBy[r.osi]?.iv    ?? null,
      osi:    r.osi,
    }));

    // ATM = strike nearest spot with valid IV
    const withIV = strikes.filter(s => s.iv != null);
    const atm = (withIV.length ? withIV : strikes).reduce((closest, s) =>
      Math.abs(s.strike - spot) < Math.abs(closest.strike - spot) ? s : closest, (withIV[0] || strikes[0]));

    const payload = {
      ok:        true,
      ticker,
      expiry,
      spot:      Math.round(spot * 100) / 100,
      atmStrike: atm?.strike ?? null,
      atmIV:     atm?.iv     ?? null,
      strikes,
      fetchedAt: new Date().toISOString(),
      cached:    false,
    };

    const expiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString();
    await supabase.from("app_cache").upsert({
      key:        cacheKey,
      value:      JSON.stringify(payload),
      expires_at: expiresAt,
    });

    return res.status(200).json(payload);
  } catch (err) {
    console.error("[api/earnings-chain]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

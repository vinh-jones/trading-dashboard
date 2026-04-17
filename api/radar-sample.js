/**
 * api/radar-sample.js — Vercel serverless function
 *
 * GET /api/radar-sample?tickers=KTOS,EQT,GLW,…
 *
 * Returns the closest 30δ / 30DTE CSP sample per ticker for the Radar tab.
 * Caching model:
 *   - Rows newer than 1 hour → returned directly (cache hit).
 *   - Stale rows AND market is open (regular session) → refetch from
 *     Public.com, upsert, return.
 *   - Stale rows AND market is closed → return stale (best available).
 *
 * Public.com API shape (confirmed via MCP discovery 2026-04-17):
 *   GET  option-details/{ACCOUNT_ID}/expirations?symbol=AAPL
 *        → { baseSymbol, expirations: ["YYYY-MM-DD", ...] }
 *   GET  option-details/{ACCOUNT_ID}/chain?symbol=AAPL&expiration=YYYY-MM-DD
 *        → { baseSymbol, calls: [...], puts: [...] }
 *        Each put row: { instrument: { symbol (OCC), type }, bid, ask, last, ... }
 *        Strike is encoded in OCC symbol (last 8 chars / 1000). No delta in chain.
 *   GET  option-details/{ACCOUNT_ID}/greeks?osiSymbols=…
 *        → { greeks: [{ symbol, greeks: { delta, impliedVolatility, ... } }] }
 *        delta is negative for puts (e.g. "-0.2700"); take Math.abs for comparison.
 *
 * See docs/superpowers/specs/2026-04-17-layer-7-radar-capital-sampling-design.md
 */

import { createClient } from "@supabase/supabase-js";
import { isMarketOpen } from "./_marketHours.js";
import {
  pickSampleExpiry,
  pickSampleStrike,
  computeCollateral,
} from "./_radar-sampling.js";

const PUBLIC_COM_BASE = "https://api.public.com";
const ACCOUNT_ID      = process.env.PUBLIC_COM_ACCOUNT_ID;

const CACHE_TTL_MS      = 60 * 60 * 1000; // 1 hour
const CONCURRENCY_LIMIT = 8;

// Max put strikes to send to the greeks endpoint per ticker.
// We only need the ~25–35δ range; capping avoids large query strings.
const MAX_GREEKS_SYMBOLS = 20;

// ── Supabase ──────────────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.SUPABASE_URL      || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

// ── Public.com token (reuses the same app_cache row quotes.js uses) ──────────

const TOKEN_VALIDITY_MINUTES = 1440;
const TOKEN_BUFFER_MS        = 5 * 60 * 1000;

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

// ── Public.com option-chain fetchers ──────────────────────────────────────────

async function fetchExpirations(token, symbol) {
  const url = `${PUBLIC_COM_BASE}/userapigateway/option-details/${ACCOUNT_ID}/expirations?symbol=${encodeURIComponent(symbol)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`expirations ${symbol} failed ${res.status}: ${url}`);
  const data = await res.json();
  // Confirmed shape: { baseSymbol, expirations: ["YYYY-MM-DD", ...] }
  return data.expirations || [];
}

async function fetchChain(token, symbol, expirationDate) {
  const url = `${PUBLIC_COM_BASE}/userapigateway/option-details/${ACCOUNT_ID}/chain?symbol=${encodeURIComponent(symbol)}&expiration=${expirationDate}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`chain ${symbol} ${expirationDate} failed ${res.status}: ${url}`);
  const data = await res.json();
  // Confirmed shape: { baseSymbol, calls: [...], puts: [...] }
  // Puts are pre-separated — no need to filter by type.
  return data.puts || [];
}

async function fetchGreeks(token, osiSymbols) {
  if (!osiSymbols.length) return [];
  const params = osiSymbols.map(s => `osiSymbols=${encodeURIComponent(s)}`).join("&");
  const url = `${PUBLIC_COM_BASE}/userapigateway/option-details/${ACCOUNT_ID}/greeks?${params}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`greeks failed ${res.status}: ${url}`);
  const data = await res.json();
  // Confirmed shape: { greeks: [{ symbol, greeks: { delta, impliedVolatility, ... } }] }
  return data.greeks || [];
}

// ── Strike extraction from OCC symbol ─────────────────────────────────────────
// OCC format: AAPL260515P00200000 — last 8 chars are strike * 1000 (zero-padded to 8 digits).
// e.g. "00200000" → 200000 / 1000 = 200.000

function strikeFromOCC(occSymbol) {
  const raw = occSymbol.slice(-8);
  return parseInt(raw, 10) / 1000;
}

// ── Per-ticker sampler ────────────────────────────────────────────────────────

async function sampleOneTicker(token, ticker, todayISO) {
  const expirations = await fetchExpirations(token, ticker);
  const chosenExpiry = pickSampleExpiry(expirations, todayISO);

  if (!chosenExpiry) {
    return {
      ticker,
      status:      "no_expiry",
      fetched_at:  new Date().toISOString(),
      expiry_date: null,
      dte:         null,
      strike:      null,
      delta:       null,
      mid:         null,
      iv:          null,
      collateral:  null,
    };
  }

  const dte = Math.round(
    (new Date(chosenExpiry + "T00:00:00Z") - new Date(todayISO + "T00:00:00Z"))
    / (24 * 60 * 60 * 1000)
  );

  // Fetch the put chain — each row has instrument.symbol (OCC), bid, ask, last
  const putRows = await fetchChain(token, ticker, chosenExpiry);

  if (!putRows.length) {
    return {
      ticker,
      status:      "no_puts",
      fetched_at:  new Date().toISOString(),
      expiry_date: chosenExpiry,
      dte,
      strike:      null,
      delta:       null,
      mid:         null,
      iv:          null,
      collateral:  null,
    };
  }

  // Build a map from OCC symbol → chain row for fast lookup
  const chainBySymbol = {};
  for (const row of putRows) {
    chainBySymbol[row.instrument.symbol] = row;
  }

  // The chain doesn't include greeks — fetch them separately.
  // Limit to MAX_GREEKS_SYMBOLS symbols (trimming deep OTM / deep ITM ends)
  // by sorting strikes and taking the middle band.
  const allSymbols = putRows.map(r => r.instrument.symbol);
  const symbolsForGreeks = trimToMiddleBand(allSymbols, MAX_GREEKS_SYMBOLS);

  const greekRows = await fetchGreeks(token, symbolsForGreeks);

  // Build { strike, delta, _occSymbol } entries for pickSampleStrike
  // delta from Public.com is negative for puts (e.g. "-0.2700") — use abs value
  const strikesWithDeltas = greekRows
    .filter(g => g.greeks?.delta != null)
    .map(g => ({
      strike:     strikeFromOCC(g.symbol),
      delta:      Math.abs(Number(g.greeks.delta)),
      _occSymbol: g.symbol,
    }));

  const picked = pickSampleStrike(strikesWithDeltas);

  if (!picked) {
    return {
      ticker,
      status:      "no_suitable_strike",
      fetched_at:  new Date().toISOString(),
      expiry_date: chosenExpiry,
      dte,
      strike:      null,
      delta:       null,
      mid:         null,
      iv:          null,
      collateral:  null,
    };
  }

  // Recover the OCC symbol for the picked strike to get IV + mid
  const pickedEntry = strikesWithDeltas.find(s => s.strike === picked.strike);
  const pickedOCC   = pickedEntry?._occSymbol;
  const greekRow    = greekRows.find(g => g.symbol === pickedOCC);
  const chainRow    = pickedOCC ? chainBySymbol[pickedOCC] : null;

  const iv  = greekRow?.greeks?.impliedVolatility != null
    ? Number(greekRow.greeks.impliedVolatility)
    : null;

  const mid = chainRow
    ? computeMid(chainRow.bid, chainRow.ask)
    : null;

  return {
    ticker,
    status:      "ok",
    fetched_at:  new Date().toISOString(),
    expiry_date: chosenExpiry,
    dte,
    strike:      picked.strike,
    delta:       picked.delta,
    mid,
    iv,
    collateral:  computeCollateral(picked.strike),
  };
}

// Keep the middle N symbols from a sorted list (trims deep OTM / deep ITM).
function trimToMiddleBand(symbols, n) {
  if (symbols.length <= n) return symbols;
  const start = Math.floor((symbols.length - n) / 2);
  return symbols.slice(start, start + n);
}

function computeMid(bid, ask) {
  const b = bid != null ? Number(bid) : null;
  const a = ask != null ? Number(ask) : null;
  if (b != null && a != null) return (b + a) / 2;
  return null;
}

// ── Concurrency-limited fan-out ───────────────────────────────────────────────

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = await fn(items[i]);
      } catch (err) {
        results[i] = { _workerError: err, _item: items[i] };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const tickersRaw = (req.query.tickers || "").toString();
  const tickers = tickersRaw
    .split(",")
    .map(t => t.trim().toUpperCase())
    .filter(Boolean);

  if (tickers.length === 0) {
    return res.status(400).json({ ok: false, error: "tickers_required" });
  }

  const supabase = getSupabase();

  const { data: existing, error: readErr } = await supabase
    .from("radar_option_samples")
    .select("*")
    .in("ticker", tickers);

  if (readErr) {
    return res.status(500).json({ ok: false, error: `read_failed: ${readErr.message}` });
  }

  const existingByTicker = Object.fromEntries((existing || []).map(r => [r.ticker, r]));
  const now = Date.now();
  const fresh = [];
  const staleTickers = [];

  // Treat fetch_failed rows as stale regardless of age — we want to retry
  // them on the next call during market hours instead of serving a stale
  // error for the full 1-hour cache window.
  for (const t of tickers) {
    const row = existingByTicker[t];
    const isFresh  = row && new Date(row.fetched_at).getTime() > now - CACHE_TTL_MS;
    const isFailed = row && row.status === "fetch_failed";
    if (isFresh && !isFailed) {
      fresh.push(row);
    } else {
      staleTickers.push(t);
    }
  }

  if (staleTickers.length === 0) {
    return res.status(200).json({ ok: true, cached: true, samples: fresh });
  }

  // Market closed → return stale cache as best-available (don't refetch)
  if (!isMarketOpen()) {
    const stale = staleTickers.map(t => existingByTicker[t]).filter(Boolean);
    return res.status(200).json({ ok: true, cached: true, samples: [...fresh, ...stale] });
  }

  // Market open → refetch stale tickers from Public.com
  let token;
  try {
    token = await getPublicAccessToken(supabase);
  } catch (err) {
    return res.status(502).json({ ok: false, error: "public_com_unavailable", detail: err.message });
  }

  const todayISO = new Date().toISOString().slice(0, 10);

  const rawResults = await mapWithConcurrency(staleTickers, CONCURRENCY_LIMIT, async (ticker) => {
    try {
      return await sampleOneTicker(token, ticker, todayISO);
    } catch (err) {
      console.error(`[radar-sample] ${ticker} failed:`, err.message);
      return { ticker, status: "fetch_failed", fetched_at: new Date().toISOString() };
    }
  });

  // Normalize any worker-level errors (shouldn't happen — sampleOneTicker catches internally)
  const fetchedRows = rawResults.map(r =>
    r._workerError
      ? { ticker: r._item, status: "fetch_failed", fetched_at: new Date().toISOString() }
      : r
  );

  const { error: writeErr } = await supabase
    .from("radar_option_samples")
    .upsert(fetchedRows, { onConflict: "ticker" });

  if (writeErr) {
    console.error("[radar-sample] upsert failed:", writeErr.message);
  }

  return res.status(200).json({
    ok:      true,
    cached:  false,
    samples: [...fresh, ...fetchedRows],
  });
}

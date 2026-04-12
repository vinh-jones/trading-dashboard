/**
 * api/quotes.js — Vercel serverless function
 *
 * GET /api/quotes
 *
 * Returns cached quotes for all open positions (equities + options).
 * If the cache is stale (>30min) AND market is currently open, triggers
 * a refresh from Public.com before returning.
 *
 * No cron needed — lazy refresh on page load.
 */

import { createClient } from "@supabase/supabase-js";

const PUBLIC_COM_BASE = "https://api.public.com";
const ACCOUNT_ID      = process.env.PUBLIC_COM_ACCOUNT_ID;
const STALE_MS        = 30 * 60 * 1000; // 30 minutes

// ── Supabase ──────────────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.SUPABASE_URL      || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

// ── Market hours (ET) ─────────────────────────────────────────────────────────

function isMarketOpen() {
  const et   = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day  = et.getDay();                               // 0=Sun, 6=Sat
  const time = et.getHours() + et.getMinutes() / 60;
  return day >= 1 && day <= 5 && time >= 9.5 && time <= 16;
}

// ── OCC symbol builder ────────────────────────────────────────────────────────

function buildOccSymbol(ticker, expiryIso, isCall, strike) {
  // expiryIso: "2026-05-01" → "260501"
  const [y, m, d] = expiryIso.split("-");
  const expiry    = y.slice(2) + m + d;
  const side      = isCall ? "C" : "P";
  // strike: 315 → "00315000", 12.50 → "00012500"
  const strikePadded = String(Math.round(parseFloat(strike) * 1000)).padStart(8, "0");
  return `${ticker}${expiry}${side}${strikePadded}`;
}

// ── Public.com auth (token cached in Supabase, valid 24h) ────────────────────

const TOKEN_VALIDITY_MINUTES = 1440; // 24 hours
const TOKEN_BUFFER_MS        = 5 * 60 * 1000; // refresh 5min before expiry

async function getPublicAccessToken(supabase) {
  // Check for a cached, still-valid token
  const { data: cached } = await supabase
    .from("app_cache")
    .select("value, expires_at")
    .eq("key", "public_com_token")
    .single();

  if (cached?.value && new Date(cached.expires_at).getTime() - TOKEN_BUFFER_MS > Date.now()) {
    return cached.value;
  }

  // Fetch a new token from Public.com
  const secret = process.env.PUBLIC_COM_SECRET;
  if (!secret) throw new Error("PUBLIC_COM_SECRET not set");

  const res = await fetch(`${PUBLIC_COM_BASE}/userapiauthservice/personal/access-tokens`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ secret, validityInMinutes: TOKEN_VALIDITY_MINUTES }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Public.com auth failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  if (!data.accessToken) throw new Error("Public.com auth: no accessToken in response");

  // Cache it
  const expiresAt = new Date(Date.now() + TOKEN_VALIDITY_MINUTES * 60 * 1000).toISOString();
  await supabase
    .from("app_cache")
    .upsert({ key: "public_com_token", value: data.accessToken, expires_at: expiresAt });

  return data.accessToken;
}

// ── Fetch quotes from Public.com ──────────────────────────────────────────────

async function fetchPublicQuotes(token, instruments) {
  if (!ACCOUNT_ID) throw new Error("PUBLIC_COM_ACCOUNT_ID env var not set");
  const res = await fetch(
    `${PUBLIC_COM_BASE}/userapigateway/marketdata/${ACCOUNT_ID}/quotes`,
    {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ instruments }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Public.com quotes failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.quotes || [];
}

// ── Build instrument list from positions ──────────────────────────────────────

function buildInstruments(rows) {
  const equitySymbols = new Set();
  const optionInstruments = [];

  for (const row of rows) {
    const { ticker, type, strike, expiry_date, position_type } = row;

    // Always fetch the underlying equity price
    equitySymbols.add(ticker);

    // Build OCC symbol for options
    if (!strike || !expiry_date) continue;

    let isCall;
    if (type === "CC")    isCall = true;
    if (type === "CSP")   isCall = false;
    if (type === "LEAPS") isCall = true;   // user confirmed LEAPs are always calls

    if (isCall === undefined) continue;    // Shares or unknown — skip

    const symbol = buildOccSymbol(ticker, expiry_date, isCall, strike);
    optionInstruments.push({ symbol, type: "OPTION" });
  }

  const equityInstruments = [...equitySymbols].map(s => ({ symbol: s, type: "EQUITY" }));
  return { equityInstruments, optionInstruments };
}

// ── IV helpers ────────────────────────────────────────────────────────────────

// Find the expiry closest to 30 DTE within the 25–35 day window.
// Falls back to nearest expiry with ≥14 DTE if nothing is in window.
function findTargetExpiry(expirations, todayMs) {
  let best = null, bestDist = Infinity;
  let fallback = null, fallbackDist = Infinity;

  for (const expStr of expirations) {
    const dte = Math.round((new Date(expStr + "T00:00:00") - todayMs) / 86_400_000);
    if (dte >= 25 && dte <= 35) {
      const d = Math.abs(dte - 30);
      if (d < bestDist) { bestDist = d; best = expStr; }
    } else if (dte >= 14) {
      const d = Math.abs(dte - 30);
      if (d < fallbackDist) { fallbackDist = d; fallback = expStr; }
    }
  }
  return best ?? fallback;
}

// Extract ATM symbol (call or put) from a chain leg whose strike is closest to stockPrice.
// OCC strike is the last 8 chars of the symbol, in thousandths (e.g. 00130000 = $130).
function findATMSymbol(options, stockPrice) {
  if (!options?.length) return null;
  let best = null, bestDist = Infinity;
  for (const opt of options) {
    const sym = opt.instrument?.symbol;
    if (!sym || opt.outcome !== "SUCCESS") continue;
    const m = sym.match(/[CP](\d{8})$/);
    if (!m) continue;
    const strike = parseInt(m[1], 10) / 1000;
    const dist   = Math.abs(strike - stockPrice);
    if (dist < bestDist) { bestDist = dist; best = sym; }
  }
  return best;
}

// ── IV refresh (uncovered tickers only) ──────────────────────────────────────

async function refreshIV(supabase, token, equityQuoteRows) {
  // 1. Which tickers have uncovered shares?
  const { data: uncoveredRows } = await supabase
    .from("positions")
    .select("ticker")
    .eq("position_type", "assigned_shares")
    .eq("has_active_cc", false);

  if (!uncoveredRows?.length) return; // all covered — nothing to do

  const tickers = [...new Set(uncoveredRows.map(r => r.ticker))];

  // 2. Build stock price map from already-fetched equity quotes
  const priceMap = {};
  for (const q of equityQuoteRows) {
    if (q.instrument?.type !== "EQUITY" || q.outcome !== "SUCCESS") continue;
    const bid = q.bid != null ? parseFloat(q.bid) : null;
    const ask = q.ask != null ? parseFloat(q.ask) : null;
    priceMap[q.instrument.symbol] =
      bid != null && ask != null ? (bid + ask) / 2 : parseFloat(q.last ?? 0);
  }

  const todayMs  = Date.now();
  const authHdr  = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  // 3. Expirations for all uncovered tickers in parallel
  const expiryResults = await Promise.all(
    tickers.map(async ticker => {
      try {
        const res = await fetch(
          `${PUBLIC_COM_BASE}/userapigateway/marketdata/${ACCOUNT_ID}/option-expirations`,
          { method: "POST", headers: authHdr,
            body: JSON.stringify({ instrument: { symbol: ticker, type: "EQUITY" } }) }
        );
        if (!res.ok) return { ticker, expiry: null };
        const data = await res.json();
        return { ticker, expiry: findTargetExpiry(data.expirations ?? [], todayMs) };
      } catch { return { ticker, expiry: null }; }
    })
  );

  // 4. Option chains for tickers with a valid expiry, in parallel
  const atmSymbols = await Promise.all(
    expiryResults
      .filter(r => r.expiry && priceMap[r.ticker] != null)
      .map(async ({ ticker, expiry }) => {
        try {
          const res = await fetch(
            `${PUBLIC_COM_BASE}/userapigateway/marketdata/${ACCOUNT_ID}/option-chain`,
            { method: "POST", headers: authHdr,
              body: JSON.stringify({
                instrument:     { symbol: ticker, type: "EQUITY" },
                expirationDate: expiry,
              }) }
          );
          if (!res.ok) return null;
          const data  = await res.json();
          const price = priceMap[ticker];
          return {
            ticker,
            call: findATMSymbol(data.calls, price),
            put:  findATMSymbol(data.puts,  price),
          };
        } catch { return null; }
      })
  );

  // 5. One batched greeks GET for all ATM symbols
  const validATM   = atmSymbols.filter(Boolean);
  const osiSymbols = validATM.flatMap(r => [r.call, r.put].filter(Boolean));
  if (!osiSymbols.length) return;

  let greeksMap = {};
  try {
    const qs  = osiSymbols.map(s => `osiSymbols=${encodeURIComponent(s)}`).join("&");
    const res = await fetch(
      `${PUBLIC_COM_BASE}/userapigateway/option-details/${ACCOUNT_ID}/greeks?${qs}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (res.ok) {
      const data = await res.json();
      for (const g of data.greeks ?? []) {
        if (g.greeks?.impliedVolatility != null)
          greeksMap[g.symbol] = parseFloat(g.greeks.impliedVolatility);
      }
    }
  } catch { /* greeks fetch failed — skip silently */ }

  if (!Object.keys(greeksMap).length) return;

  // 6. Average call + put IV per ticker → UPDATE equity quote row
  const now = new Date().toISOString();
  await Promise.all(
    validATM.map(({ ticker, call, put }) => {
      const callIV = call ? greeksMap[call] : null;
      const putIV  = put  ? greeksMap[put]  : null;
      const iv     = callIV != null && putIV != null
        ? Math.round(((callIV + putIV) / 2) * 10000) / 10000
        : callIV ?? putIV;
      if (iv == null) return Promise.resolve();
      return supabase
        .from("quotes")
        .update({ iv, refreshed_at: now })
        .eq("symbol", ticker);
    })
  );
}

// ── Refresh: fetch from Public.com + upsert into Supabase ────────────────────

async function refreshQuotes(supabase) {
  // 1. Load open positions
  const { data: rows, error } = await supabase
    .from("positions")
    .select("ticker, type, strike, expiry_date, position_type");

  if (error) throw new Error(`Supabase positions fetch failed: ${error.message}`);
  if (!rows?.length) return [];

  const { equityInstruments, optionInstruments } = buildInstruments(rows);

  // 2. Authenticate (uses cached 24h token, fetches new one only if expired)
  const token = await getPublicAccessToken(supabase);

  // 3. Fetch in two batches (equities + options have different instrument types)
  const [equityQuotes, optionQuotes] = await Promise.all([
    equityInstruments.length ? fetchPublicQuotes(token, equityInstruments) : [],
    optionInstruments.length ? fetchPublicQuotes(token, optionInstruments) : [],
  ]);

  const allQuotes = [...equityQuotes, ...optionQuotes];

  // 4. Upsert into quotes table
  const now = new Date().toISOString();
  const upsertRows = allQuotes
    .filter(q => q.outcome === "SUCCESS")
    .map(q => {
      const bid  = q.bid  != null ? parseFloat(q.bid)  : null;
      const ask  = q.ask  != null ? parseFloat(q.ask)  : null;
      const mid  = bid != null && ask != null ? Math.round((bid + ask) / 2 * 100) / 100 : null;
      return {
        symbol:          q.instrument.symbol,
        instrument_type: q.instrument.type,
        last:            q.last  != null ? parseFloat(q.last) : null,
        bid,
        ask,
        mid,
        delta:           null,
        iv:              null,
        refreshed_at:    now,
      };
    });

  if (upsertRows.length) {
    const { error: upsertError } = await supabase
      .from("quotes")
      .upsert(upsertRows, { onConflict: "symbol" });

    if (upsertError) throw new Error(`Supabase upsert failed: ${upsertError.message}`);
  }

  // 5. IV for uncovered tickers (runs after upsert so equity rows exist)
  // Errors are non-fatal — IV is best-effort; Rule 5 degrades gracefully without it.
  try {
    await refreshIV(supabase, token, [...equityQuotes, ...optionQuotes]);
  } catch (err) {
    console.warn("[api/quotes] IV refresh failed (non-fatal):", err.message);
  }

  return upsertRows;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const supabase = getSupabase();

    // Check cache freshness
    const { data: latest } = await supabase
      .from("quotes")
      .select("refreshed_at")
      .order("refreshed_at", { ascending: false })
      .limit(1)
      .single();

    const lastRefresh  = latest?.refreshed_at ? new Date(latest.refreshed_at) : null;
    const ageMs        = lastRefresh ? Date.now() - lastRefresh.getTime() : Infinity;

    // ?force=1 bypasses market hours + staleness checks (requires X-Ingest-Secret)
    const forceRequested = req.query.force === "1";
    const forceSecret    = process.env.MARKET_CONTEXT_INGEST_SECRET;
    const forceAuthed    = forceSecret && req.headers["x-ingest-secret"] === forceSecret;
    const forced         = forceRequested && forceAuthed;

    const needsRefresh = forced || (ageMs > STALE_MS && isMarketOpen());

    if (needsRefresh) {
      await refreshQuotes(supabase);
    }

    // Return all cached quotes
    const { data: quotes, error } = await supabase
      .from("quotes")
      .select("*")
      .order("symbol");

    if (error) throw error;

    return res.status(200).json({
      ok:          true,
      quotes:      quotes || [],
      refreshedAt: lastRefresh?.toISOString() ?? null,
      refreshed:   needsRefresh,
      forced:      forced,
    });
  } catch (err) {
    console.error("[api/quotes]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

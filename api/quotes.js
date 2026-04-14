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
import { buildOccSymbol } from "./_lib/occ.js";

const PUBLIC_COM_BASE  = "https://api.public.com";
const ACCOUNT_ID       = process.env.PUBLIC_COM_ACCOUNT_ID;
const STALE_MS         = 30 * 60 * 1000; // 30 minutes

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

// ── Fetch option Greeks from Public.com ───────────────────────────────────────

async function fetchOptionGreeks(token, osiSymbols) {
  if (!ACCOUNT_ID || !osiSymbols.length) return [];
  const params = osiSymbols.map(s => `osiSymbols=${encodeURIComponent(s)}`).join("&");
  const res = await fetch(
    `${PUBLIC_COM_BASE}/userapigateway/option-details/${ACCOUNT_ID}/greeks?${params}`,
    { headers: { "Authorization": `Bearer ${token}` } }
  );

  if (!res.ok) {
    console.warn(`[api/quotes] greeks fetch failed (${res.status}), skipping`);
    return [];
  }

  const data = await res.json();
  return data.greeks || [];
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
        refreshed_at:    now,
      };
    });

  if (upsertRows.length) {
    const { error: upsertError } = await supabase
      .from("quotes")
      .upsert(upsertRows, { onConflict: "symbol" });

    if (upsertError) throw new Error(`Supabase upsert failed: ${upsertError.message}`);
  }

  // 5. Fetch per-strike IV + delta from Public.com option greeks
  const optionSymbols = optionInstruments.map(i => i.symbol);
  if (optionSymbols.length) {
    const greeks = await fetchOptionGreeks(token, optionSymbols);
    if (greeks.length) {
      const greeksUpdates = greeks
        .filter(g => g.greeks?.impliedVolatility != null)
        .map(g => ({
          symbol:          g.symbol,
          instrument_type: "OPTION",
          iv:              parseFloat(g.greeks.impliedVolatility),
          delta:           g.greeks.delta != null ? parseFloat(g.greeks.delta) : null,
          refreshed_at:    now,
        }));

      if (greeksUpdates.length) {
        const { error: greeksError } = await supabase
          .from("quotes")
          .upsert(greeksUpdates, { onConflict: "symbol", ignoreDuplicates: false });

        if (greeksError) console.warn("[api/quotes] greeks upsert failed:", greeksError.message);
        else console.log(`[api/quotes] Updated greeks for ${greeksUpdates.length} options`);
      }
    }
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

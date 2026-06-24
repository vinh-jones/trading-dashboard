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
import { CASH_SETTLED_INDICES } from "../lib/spreadMath.js";
import { sendOpsAlert } from "./_lib/notify.js";
import { isMarketOpenExtended as isMarketOpen } from "./_marketHours.js";

const PUBLIC_COM_BASE  = "https://api.public.com";
const ACCOUNT_ID       = process.env.PUBLIC_COM_ACCOUNT_ID;
const STALE_MS         = 15 * 60 * 1000; // 15 minutes — matches the intraday cron cadence

// ── Supabase ──────────────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.SUPABASE_URL      || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
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

async function fetchPublicQuotes(token, instruments, attempt = 1) {
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
    const err  = Object.assign(new Error(`Public.com quotes failed (${res.status}): ${text}`), {
      status: res.status,
      body:   text,
    });

    // Retry on 429 with exponential backoff (2s, 4s)
    if (res.status === 429 && attempt < 3) {
      await new Promise(r => setTimeout(r, attempt * 2000));
      return fetchPublicQuotes(token, instruments, attempt + 1);
    }

    throw err;
  }

  const data = await res.json();
  return data.quotes || [];
}

// ── Build instrument list from positions ──────────────────────────────────────

export function buildInstruments(rows, extraEquityTickers = []) {
  const equitySymbols = new Set();
  const indexSymbols  = new Set();
  const optionSymbols = new Set();

  // Equity tickers with no position row of their own (e.g. a strategy-basket
  // shares lot whose CSP was assigned and synced away) still need a live mark.
  for (const t of extraEquityTickers) if (t) equitySymbols.add(t);

  // Underlying mark — cash-settled index roots (XSP/SPX/NDX/…) only quote as
  // INDEX on Public.com (EQUITY returns UNKNOWN), so route them there or the
  // cushion-to-breakeven column stays dark for index spreads.
  const addUnderlying = (t) => CASH_SETTLED_INDICES.has(t) ? indexSymbols.add(t) : equitySymbols.add(t);

  for (const row of rows) {
    const { ticker, type, strike, expiry_date, position_type } = row;

    // Always fetch the underlying price (index or equity)
    addUnderlying(ticker);

    // Vertical spreads carry a second leg in `row.lots` — quote both legs.
    // Handled before the strike/expiry guard so the long leg isn't dropped.
    if (type === "Spread") {
      const longStrike = row.lots?.long_strike;
      const right = row.lots?.right;
      if (expiry_date && right && strike != null) {
        const isCall = right === "call";
        optionSymbols.add(buildOccSymbol(ticker, expiry_date, isCall, strike));       // short leg
        if (longStrike != null) optionSymbols.add(buildOccSymbol(ticker, expiry_date, isCall, longStrike)); // long leg
      }
      continue;
    }

    // Build OCC symbol for options
    if (!strike || !expiry_date) continue;

    let isCall;
    if (type === "CC")    isCall = true;
    if (type === "CSP")   isCall = false;
    if (type === "LEAPS") isCall = true;   // user confirmed LEAPs are always calls

    if (isCall === undefined) continue;    // Shares or unknown — skip

    optionSymbols.add(buildOccSymbol(ticker, expiry_date, isCall, strike));
  }

  const equityInstruments = [...equitySymbols].map(s => ({ symbol: s, type: "EQUITY" }));
  const indexInstruments  = [...indexSymbols].map(s => ({ symbol: s, type: "INDEX" }));
  const optionInstruments = [...optionSymbols].map(s => ({ symbol: s, type: "OPTION" }));
  return { equityInstruments, indexInstruments, optionInstruments };
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
    // Surface the status so the caller can fire an ops alert on throttle / auth issues
    return { greeks: [], status: res.status };
  }

  const data = await res.json();
  return { greeks: data.greeks || [], status: 200 };
}

// ── Ops alerting ──────────────────────────────────────────────────────────────
// Fires a one-per-day Pushover push when Public.com returns 429/403/401.
// These are the status codes that matter operationally:
//   429 — rate-limited (Public's "Throttles" per their API Program Agreement)
//   403 — forbidden (account/app-level block, possible ToS issue)
//   401 — auth failure (cached token revoked or secret changed)
// Other errors (500s, network) tend to be transient — we let them surface in
// Vercel logs without paging the user.
async function maybeAlertOnPublicComError(supabase, err, endpoint) {
  const status = err?.status;
  if (status !== 429 && status !== 403 && status !== 401) return;

  const today = new Date().toISOString().slice(0, 10);
  const titleMap = {
    429: "Public.com rate-limited",
    403: "Public.com access forbidden",
    401: "Public.com auth failed",
  };
  const title = titleMap[status];
  const message = `${endpoint} call returned ${status}. Check Vercel logs + Public.com API status.`;

  await sendOpsAlert({
    supabase,
    alertId: `public-com-${status}-${endpoint}`,
    title,
    message,
    today,
    priority: 1,
  });
}

// ── Refresh: fetch from Public.com + upsert into Supabase ────────────────────

async function refreshQuotes(supabase) {
  // 1. Load open positions
  const { data: rows, error } = await supabase
    .from("positions")
    .select("ticker, type, strike, expiry_date, position_type, lots");

  if (error) throw new Error(`Supabase positions fetch failed: ${error.message}`);

  // Also mark strategy-tagged shares lots declared in journal entries. These can
  // exist without any open position row (after a CSP is assigned and synced
  // closed), so the basket needs their underlying equity quote to mark the lot.
  const { data: shareEntries } = await supabase
    .from("journal_entries")
    .select("ticker, tags")
    .eq("type", "Shares")
    .not("tags", "is", null);
  const declaredShareTickers = (shareEntries ?? [])
    .filter(e => (e.tags ?? []).some(t => t.startsWith("strategy:")))
    .map(e => e.ticker)
    .filter(Boolean);

  if (!rows?.length && !declaredShareTickers.length) return [];

  const { equityInstruments, indexInstruments, optionInstruments } = buildInstruments(rows ?? [], declaredShareTickers);

  // 2. Authenticate (uses cached 24h token, fetches new one only if expired)
  const token = await getPublicAccessToken(supabase);

  // 3. Fetch in two sequential batches — serialized to avoid bursting Public.com's rate limit
  let equityQuotes = [];
  let indexQuotes  = [];
  let optionQuotes = [];
  try {
    if (equityInstruments.length) equityQuotes = await fetchPublicQuotes(token, equityInstruments);
    if (indexInstruments.length)  indexQuotes  = await fetchPublicQuotes(token, indexInstruments);
    if (optionInstruments.length) optionQuotes = await fetchPublicQuotes(token, optionInstruments);
  } catch (err) {
    await maybeAlertOnPublicComError(supabase, err, "quotes");
    throw err;
  }

  const allQuotes = [...equityQuotes, ...indexQuotes, ...optionQuotes];

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
    const { greeks, status: greeksStatus } = await fetchOptionGreeks(token, optionSymbols);
    if (greeksStatus === 429 || greeksStatus === 403 || greeksStatus === 401) {
      await maybeAlertOnPublicComError(
        supabase,
        Object.assign(new Error(`Public.com greeks failed (${greeksStatus})`), { status: greeksStatus }),
        "greeks",
      );
    }
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

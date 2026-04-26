/**
 * api/_lib/publicCom.js — Public.com Brokerage API helpers (backend)
 *
 * Shared option-chain fetchers used by income/health calcs and other
 * server-side pipelines. Token caching reuses the same `app_cache` row
 * (`public_com_token`) that api/quotes.js, api/earnings-chain.js, and
 * api/radar-sample.js share.
 *
 * Returns BOTH calls and puts from fetchChain — earnings-chain.js and
 * radar-sample.js fetch only puts; this module is the canonical place
 * to use when you need calls (CC selection) or both sides.
 */

const PUBLIC_COM_BASE        = "https://api.public.com";
const ACCOUNT_ID             = process.env.PUBLIC_COM_ACCOUNT_ID;
const TOKEN_VALIDITY_MINUTES = 1440;
const TOKEN_BUFFER_MS        = 5 * 60 * 1000;

export async function getPublicAccessToken(supabase) {
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
  await supabase.from("app_cache").upsert({
    key: "public_com_token", value: data.accessToken, expires_at: expiresAt,
  });
  return data.accessToken;
}

export async function fetchStockQuote(token, ticker) {
  const url = `${PUBLIC_COM_BASE}/userapigateway/marketdata/${ACCOUNT_ID}/quotes`;
  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body:    JSON.stringify({ instruments: [{ symbol: ticker, type: "EQUITY" }] }),
  });
  if (!res.ok) throw new Error(`stock quote ${ticker} failed ${res.status}`);
  const data = await res.json();
  const q = (data.quotes || [])[0];
  const bid  = q?.bid  != null ? parseFloat(q.bid)  : null;
  const ask  = q?.ask  != null ? parseFloat(q.ask)  : null;
  const last = q?.last != null ? parseFloat(q.last) : null;
  if (bid != null && ask != null) return (bid + ask) / 2;
  return last;
}

export async function fetchExpirations(token, symbol) {
  const url = `${PUBLIC_COM_BASE}/userapigateway/marketdata/${ACCOUNT_ID}/option-expirations`;
  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body:    JSON.stringify({ instrument: { symbol, type: "EQUITY" } }),
  });
  if (!res.ok) throw new Error(`expirations ${symbol} failed ${res.status}`);
  const data = await res.json();
  return data.expirations || [];
}

export async function fetchChain(token, symbol, expirationDate) {
  const url = `${PUBLIC_COM_BASE}/userapigateway/marketdata/${ACCOUNT_ID}/option-chain`;
  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body:    JSON.stringify({ instrument: { symbol, type: "EQUITY" }, expirationDate }),
  });
  if (!res.ok) throw new Error(`chain ${symbol} ${expirationDate} failed ${res.status}`);
  const data = await res.json();
  return { calls: data.calls || [], puts: data.puts || [] };
}

export async function fetchGreeks(token, osiSymbols) {
  if (!osiSymbols.length) return [];
  const params = osiSymbols.map(s => `osiSymbols=${encodeURIComponent(s)}`).join("&");
  const url = `${PUBLIC_COM_BASE}/userapigateway/option-details/${ACCOUNT_ID}/greeks?${params}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`greeks failed ${res.status}`);
  const data = await res.json();
  return data.greeks || [];
}

export function strikeFromOCC(occSymbol) {
  return parseInt(occSymbol.slice(-8), 10) / 1000;
}

export function computeMid(bid, ask) {
  const b = bid != null ? Number(bid) : null;
  const a = ask != null ? Number(ask) : null;
  if (b != null && a != null) return Math.round(((b + a) / 2) * 100) / 100;
  return null;
}

/**
 * Pick the expiration closest to a target DTE from a sorted ISO-date list.
 * Returns { expiry, dte } or null if no expirations available.
 */
export function pickExpiryByDte(expirations, targetDte, todayISO) {
  if (!expirations?.length) return null;
  const today = new Date(todayISO + "T00:00:00Z").getTime();
  const candidates = expirations
    .map(e => ({
      expiry: e,
      dte: Math.round((new Date(e + "T00:00:00Z").getTime() - today) / 86_400_000),
    }))
    .filter(c => c.dte > 0);
  if (!candidates.length) return null;
  candidates.sort((a, b) => Math.abs(a.dte - targetDte) - Math.abs(b.dte - targetDte));
  return candidates[0];
}

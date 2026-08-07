/**
 * api/_lib/uwClient.js — Unusual Whales REST adapter.
 *
 * Pure fetch + shape: returns parsed arrays; normalization lives in
 * src/lib/uwNormalize.js. Reads UW_API_KEY from env (Bearer auth).
 *
 * Rate limit: API Basic allows 120 req/min. A shared gate spaces requests
 * (default 550ms ≈ 109/min) so a single ingestion run can't burst past it.
 *
 * Docs: https://api.unusualwhales.com/docs
 *   GET /api/stock/{ticker}/greek-exposure
 *   GET /api/stock/{ticker}/flow-alerts
 *   GET /api/stock/{ticker}/flow-per-strike
 */

import { adaptDailyCandles, adaptIntradayCandles } from "./uwCandles.js";

const UW_BASE = "https://api.unusualwhales.com/api";
const MIN_INTERVAL_MS = Number(process.env.UW_MIN_INTERVAL_MS) || 550;

let _nextSlot = 0;
// Resolves after enough time has elapsed to keep the global request rate under
// the limit. Sequential awaiters each reserve the next slot.
function rateGate() {
  const now = Date.now();
  const wait = Math.max(0, _nextSlot - now);
  _nextSlot = Math.max(now, _nextSlot) + MIN_INTERVAL_MS;
  return wait === 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, wait));
}

export function hasUwKey() {
  return !!process.env.UW_API_KEY;
}

function uwHeaders() {
  const key = process.env.UW_API_KEY;
  if (!key) throw new Error("UW_API_KEY not configured");
  return { Authorization: `Bearer ${key}`, Accept: "application/json" };
}

async function uwGet(path, { retries = 3 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await rateGate();
    try {
      const res = await fetch(`${UW_BASE}${path}`, { headers: uwHeaders() });
      if (res.status === 429 || res.status >= 500) throw new Error(`UW ${res.status} (retryable) for ${path}`);
      if (!res.ok) throw new Error(`UW ${res.status} for ${path}`);
      const json = await res.json();
      // UW wraps payloads as { data: [...] } or { result: [...] }.
      return json?.data ?? json?.result ?? json;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw lastErr;
}

// Greek exposure by ticker — daily history; the latest row drives gamma env.
export function fetchGreekExposure(ticker) {
  return uwGet(`/stock/${encodeURIComponent(ticker)}/greek-exposure`);
}

// Greek exposure broken down by strike — the per-strike dealer-gamma profile
// that drives the GEX strike walls (Consumer 3).
export function fetchGreekExposureByStrike(ticker) {
  return uwGet(`/stock/${encodeURIComponent(ticker)}/greek-exposure/strike`);
}

// Spot gamma/delta exposure by strike — alternate GEX-by-strike shape; probed
// alongside greek-exposure/strike until the live response shape is confirmed.
export function fetchSpotExposuresByStrike(ticker) {
  return uwGet(`/stock/${encodeURIComponent(ticker)}/spot-exposures/strike`);
}

// Max pain by expiry — the pin level where the most option value expires
// worthless. Endpoint shape not yet confirmed; probed via uw-gex ?debug=1.
export function fetchMaxPain(ticker) {
  return uwGet(`/stock/${encodeURIComponent(ticker)}/max-pain`);
}

// Flow alerts for a ticker (puts + calls, all sides) at or above minPremium.
export function fetchFlowAlerts(ticker, { minPremium = 50000, limit = 50 } = {}) {
  const qs = new URLSearchParams({ min_premium: String(minPremium), limit: String(limit) });
  return uwGet(`/stock/${encodeURIComponent(ticker)}/flow-alerts?${qs}`);
}

// Flow per strike — the FULL options tape for the last trading day, aggregated
// by strike (call/put bid- and ask-side premium per strike). Drives the
// full-tape conviction reading (flow_tape) via flowTapeFromTape. uwGet unwraps
// `{ data: [...] }` to the rows array.
export function fetchFlowPerStrike(ticker) {
  return uwGet(`/stock/${encodeURIComponent(ticker)}/flow-per-strike`);
}

// Short interest + float (slow-changing). Latest row has short_float_perc as a
// decimal string (0.0082 = 0.82% of float).
export function fetchShortInterest(ticker) {
  return uwGet(`/shorts/${encodeURIComponent(ticker)}/interest-float`);
}

// Earnings by ticker — historical + upcoming rows carry expected_move_perc
// (the option-implied move) for the report.
export function fetchEarnings(ticker) {
  return uwGet(`/earnings/${encodeURIComponent(ticker)}`);
}

// Stock screener — one row per ticker carrying iv30d, iv_rank, volatility,
// close, prev_close, next_earnings_date, etc. Pass a ticker list (comma-joined)
// to scope the screen to specific names; the endpoint returns only those rows.
// Drives the Radar IV/price refresh (api/uw-iv.js), replacing the
// Tastytrade-via-OpenClaw /api/ingest-iv push. uwGet unwraps `{ result: [...] }`
// (screener) or `{ data: [...] }` to the rows array.
export function fetchStockScreener(tickers) {
  const list = Array.isArray(tickers) ? tickers.filter(Boolean) : [];
  const qs = list.length ? `?ticker=${encodeURIComponent(list.join(","))}` : "";
  return uwGet(`/screener/stocks${qs}`);
}

// Economic calendar — upcoming US macro releases. UW only publishes ~8 days
// forward; a wider max_date returns nothing extra, it does not error.
export function fetchMarketEvents(minDate, maxDate) {
  const qs = minDate && maxDate
    ? `?min_date=${encodeURIComponent(minDate)}&max_date=${encodeURIComponent(maxDate)}`
    : "";
  return uwGet(`/market/economic-calendar${qs}`);
}

// GET /stock/{ticker}/ohlc/{candle_size} — no `market_time` query param exists
// on this endpoint (do not add one). Results are capped at 2500 elements, and
// a response for a given end_date may include 1-2 hours of the following
// UTC day due to rollover.
//
// uwGet already unwraps `{ data: [...] }` / `{ result: [...] }`, so both
// fetchers below resolve directly to the raw candle array (or whatever bare
// value UW returns when neither wrapper key is present) — callers do NOT
// need to read `.data` off the result.

// Bare (unadapted) fetches, exported so callers with a debug affordance can
// inspect exactly what UW sent on the wire — e.g. api/orb-open.js's
// `?debug=1` path, which is how we confirm the real REST field names instead
// of guessing again.

export function fetchDailyOhlcRaw(ticker, limit = 150) {
  return uwGet(`/stock/${encodeURIComponent(ticker)}/ohlc/1d?limit=${limit}`);
}

export function fetchIntradayOhlcRaw(ticker, sessionDate, { candleSize = "5m", limit = 500 } = {}) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (sessionDate) q.set("date", sessionDate);
  return uwGet(`/stock/${encodeURIComponent(ticker)}/ohlc/${candleSize}?${q}`);
}

/**
 * Daily OHLC for the ATR warm-up. Returns the internal shape
 * ({date,o,h,l,c,vol}) — adaptDailyCandles (uwCandles.js) converts the raw
 * REST candle (open/high/low/close/date-or-start_time) at the wire boundary
 * before this resolves, so callers pass the result straight into
 * normalizeDailyBars (NOT normalizeBars, which requires `start` and would
 * silently drop every row).
 */
export async function fetchDailyOhlc(ticker, limit = 150) {
  const raw = await fetchDailyOhlcRaw(ticker, limit);
  return adaptDailyCandles(raw);
}

/**
 * 5-minute OHLC for one session. Returns the internal shape
 * ({start,end,o,h,l,c,vol,market}) — adaptIntradayCandles (uwCandles.js)
 * converts the raw REST candle (open/high/low/close/start_time/market_time)
 * at the wire boundary before this resolves. There is no regular-session
 * query parameter, so the response can include extended-hours bars —
 * normalizeBars filters them out via the `market` field.
 */
export async function fetchIntradayOhlc(ticker, sessionDate, opts = {}) {
  const raw = await fetchIntradayOhlcRaw(ticker, sessionDate, opts);
  return adaptIntradayCandles(raw);
}

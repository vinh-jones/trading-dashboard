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

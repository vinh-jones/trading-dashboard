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

// Flow alerts for a ticker (puts + calls, all sides) at or above minPremium.
export function fetchFlowAlerts(ticker, { minPremium = 50000, limit = 50 } = {}) {
  const qs = new URLSearchParams({ min_premium: String(minPremium), limit: String(limit) });
  return uwGet(`/stock/${encodeURIComponent(ticker)}/flow-alerts?${qs}`);
}

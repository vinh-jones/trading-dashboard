/**
 * api/vix.js — Vercel serverless function
 *
 * GET /api/vix
 *
 * Proxies the Yahoo Finance volatility-index endpoints server-side to avoid
 * CORS issues. Returns { vix, vxn }, either of which may be null on failure.
 *
 * VXN (Nasdaq-100 vol) rides along with VIX because the two are read side by
 * side while Ryan's VXN framework is under evaluation. The `vix` key keeps its
 * original shape and meaning — VXN is additive, never a substitute.
 */

// Yahoo Finance requires a browser-like User-Agent to avoid 429s
const YAHOO_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Accept": "application/json",
};

async function fetchIndex(symbol) {
  const r = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`,
    { headers: YAHOO_HEADERS }
  );
  if (!r.ok) throw new Error(`Yahoo returned ${r.status}`);
  const data = await r.json();
  return data?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ vix: null, vxn: null, error: "Method not allowed" });
    return;
  }

  // Settled, not all — a VXN outage must never take the VIX reading down with
  // it, since VIX is the one with decision authority.
  const [vixResult, vxnResult] = await Promise.allSettled([
    fetchIndex("%5EVIX"),
    fetchIndex("%5EVXN"),
  ]);

  const vix = vixResult.status === "fulfilled" ? vixResult.value : null;
  const vxn = vxnResult.status === "fulfilled" ? vxnResult.value : null;

  const errors = [];
  if (vixResult.status === "rejected") errors.push(`vix: ${vixResult.reason?.message}`);
  if (vxnResult.status === "rejected") errors.push(`vxn: ${vxnResult.reason?.message}`);

  // Cache for 5 minutes at the CDN edge — neither index moves faster than that
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=60");
  res.status(200).json({
    vix,
    vxn,
    ...(errors.length ? { error: errors.join("; ") } : {}),
  });
}

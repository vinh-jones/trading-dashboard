/**
 * api/vix.js — Vercel serverless function
 *
 * GET /api/vix
 *
 * Proxies the Yahoo Finance VIX endpoint server-side to avoid CORS issues.
 * Returns { vix: <number> } or { vix: null } on failure.
 */

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ vix: null, error: "Method not allowed" });
    return;
  }

  try {
    const r = await fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=1d",
      {
        headers: {
          // Yahoo Finance requires a browser-like User-Agent to avoid 429s
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "application/json",
        },
      }
    );

    if (!r.ok) {
      res.status(200).json({ vix: null, error: `Yahoo returned ${r.status}` });
      return;
    }

    const data  = await r.json();
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;

    // Cache for 5 minutes at the CDN edge — VIX doesn't move faster than that
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=60");
    res.status(200).json({ vix: price });
  } catch (err) {
    // Fail silently — caller will use fallback value
    res.status(200).json({ vix: null, error: err.message });
  }
}

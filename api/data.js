/**
 * api/data.js — Vercel serverless function
 *
 * GET /api/data
 *
 * Fetches all three Google Sheets tabs at request time and returns the
 * parsed JSON. This runs server-side so there are no CORS issues.
 *
 * The response does NOT include free_cash_est / vix_current — those are
 * manual fields stored only in the client's local JSON. The React app
 * merges the live data into existing state, so manual fields are preserved.
 */

import { fetchSheetData } from "../lib/parseSheets.js";

export default async function handler(req, res) {
  // Only allow GET
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const { trades, positions, account } = await fetchSheetData();

    // Allow the CDN / browser to cache for up to 60 seconds
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    res.setHeader("Content-Type", "application/json");

    res.status(200).json({ ok: true, trades, positions, account });
  } catch (err) {
    console.error("[api/data] Error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * api/_lib/occ.js — OCC option symbol builder (backend copy)
 *
 * This is the canonical backend version. A mirror exists in src/lib/trading.js
 * for the frontend (Vite can't import from api/ without build config changes,
 * and api/ can't import from src/ in Vercel's serverless bundling).
 *
 * Vercel treats _-prefixed directories as non-endpoint "private" modules, so
 * this file won't be exposed as an API route.
 */

export function buildOccSymbol(ticker, expiryIso, isCall, strike) {
  const [y, m, d] = expiryIso.split("-");
  const expiry = y.slice(2) + m + d;
  const side = isCall ? "C" : "P";
  const strikePadded = String(Math.round(parseFloat(strike) * 1000)).padStart(8, "0");
  return `${ticker}${expiry}${side}${strikePadded}`;
}

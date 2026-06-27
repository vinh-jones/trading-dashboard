// Black-Scholes option Greeks — the sensitivities Public.com does NOT return
// (gamma, vega, theta) plus the risk-neutral assignment probability (N(d2)).
//
// Pricing (bsCallPrice/bsPutPrice), the d1/d2 form, RISK_FREE_RATE and normCDF
// already live in ./blackScholes.js + ./normal.js and are validated/tested.
// This module reuses that exact machinery and only adds the partials, so a sign
// or units bug here cannot silently diverge from the rest of the app's option
// math — the one failure mode that would make a risk readout confidently wrong.
//
// Conventions (match blackScholes.js):
//   S  spot · K strike · T years (dte/365) · iv decimal (0.20 = 20%) · r decimal
//   right: "call" | "put"
//   vega  is per +1 IV POINT      (dPrice/dσ ÷ 100)
//   theta is per CALENDAR DAY     (annual ÷ 365)
// All functions are null-safe and never return NaN: degenerate inputs (expiry
// day T≤0, missing/zero IV) collapse to zero sensitivities so a single bad leg
// cannot poison a portfolio aggregate.

import { normCDF, normPDF } from "./normal.js";
import { RISK_FREE_RATE } from "./blackScholes.js";

function d1d2(S, K, T, iv, r) {
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (iv * iv) / 2) * T) / (iv * sqrtT);
  const d2 = d1 - iv * sqrtT;
  return { d1, d2, sqrtT };
}

/**
 * Per-share Black-Scholes Greeks for one option leg.
 * @returns {{delta, gamma, vega, theta, d1, d2}|null} null if a core input is missing.
 */
export function bsGreeks({ S, K, T, iv, r = RISK_FREE_RATE, right }) {
  if (S == null || K == null || T == null || iv == null) return null;
  // Degenerate cases → zero sensitivities (never NaN). d1/d2 undefined here.
  if (T <= 0 || iv <= 0 || S <= 0 || K <= 0) {
    return { delta: 0, gamma: 0, vega: 0, theta: 0, d1: null, d2: null };
  }

  const isCall = right === "call";
  const { d1, d2, sqrtT } = d1d2(S, K, T, iv, r);
  const pdf = normPDF(d1);

  const delta = isCall ? normCDF(d1) : normCDF(d1) - 1;     // put delta = N(d1) − 1
  const gamma = pdf / (S * iv * sqrtT);                     // identical both rights
  const vega  = (S * pdf * sqrtT) / 100;                    // per +1 IV point

  const annualTheta = isCall
    ? -(S * pdf * iv) / (2 * sqrtT) - r * K * Math.exp(-r * T) * normCDF(d2)
    : -(S * pdf * iv) / (2 * sqrtT) + r * K * Math.exp(-r * T) * normCDF(-d2);
  const theta = annualTheta / 365;                         // per calendar day

  return { delta, gamma, vega, theta, d1, d2 };
}

/**
 * Risk-neutral probability the option finishes in-the-money — i.e. the
 * assignment probability for short premium (CSP/CC). N(d2) for calls,
 * N(−d2) for puts.
 *
 * This is the research-grounded upgrade over using raw delta as the ITM proxy:
 *   • CALL: delta = N(d1) > N(d2)  → raw delta OVERstates ITM odds.
 *   • PUT:  |delta| = N(−d1) < N(−d2) → raw delta UNDERstates ITM odds.
 * The gap widens with IV and time-to-expiry, so it matters most for long-dated
 * / high-IV legs (LEAPS, high-beta names). For a short put (CSP) specifically,
 * raw delta makes assignment look *less* likely than it is.
 *
 * @returns {number|null}
 */
export function assignmentProb({ S, K, T, iv, r = RISK_FREE_RATE, right }) {
  if (S == null || K == null || T == null || iv == null) return null;
  if (T <= 0) return (right === "call" ? S > K : S < K) ? 1 : 0; // settled
  if (iv <= 0 || S <= 0 || K <= 0) return null;
  const { d2 } = d1d2(S, K, T, iv, r);
  return right === "call" ? normCDF(d2) : normCDF(-d2);
}

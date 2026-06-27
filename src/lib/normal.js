// Standard normal distribution helpers.
//
// Extracted so both the Black-Scholes option pricer and the decision-framing
// recovery gauge share one implementation rather than duplicating the
// Abramowitz & Stegun approximation.

/**
 * Cumulative standard normal distribution (Abramowitz & Stegun 7.1.26).
 * Accurate to ~1e-7.
 * @param {number} x
 * @returns {number} Phi(x)
 */
export function normCDF(x) {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;

  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

/**
 * Standard normal probability density φ(x) = e^(−x²/2) / √(2π).
 * Exact (closed form, not an approximation) — used by the option-Greek
 * partials (gamma/vega/theta) in ./greeks.js.
 * @param {number} x
 * @returns {number} φ(x)
 */
export function normPDF(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

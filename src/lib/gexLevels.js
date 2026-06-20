// Consumer 3 — GEX / strike walls.
//
// Reduces a ticker's per-strike dealer-gamma profile to the few numbers that
// drive a CSP decision (Ryan's framing):
//   - environment from the NET gamma sign: positive = market-makers stabilize
//     (buy dips / sell rips → CSP-friendly), negative = they amplify moves
//     (choppy/fast → caution).
//   - the dominant positive-gamma "walls": the one above spot acts as
//     resistance (a ceiling), the one below spot as a support floor. A CSP
//     whose strike sits at/below a strong support wall is defended by dealer
//     hedging; a strike with no wall beneath it is more exposed.
//
// Pure + null-safe: no rows / no spot → all-null ("no GEX signal"), exactly
// like the other UW libs. The cron normalizes UW's raw by-strike response into
// `[{ strike, gamma }]` (gamma = signed net dealer gamma at that strike), so
// this stays shape-independent and testable.

// Net gamma ratio in [-1, 1] above/below this magnitude flips the label;
// inside the band it's "neutral" (avoids flip-flop near zero).
const ENV_DEADBAND = 0.05;

export function computeGexLevels({ rows, spot } = {}) {
  const clean = (Array.isArray(rows) ? rows : [])
    .map((r) => ({ strike: Number(r?.strike), gamma: Number(r?.gamma) }))
    .filter((r) => Number.isFinite(r.strike) && Number.isFinite(r.gamma));

  const spotNum = Number(spot);
  if (clean.length === 0 || !Number.isFinite(spotNum) || spotNum <= 0) {
    return { env: null, netGamma: null, gammaRatio: null, support: null, resistance: null };
  }

  const netGamma = clean.reduce((s, r) => s + r.gamma, 0);
  const totalAbs = clean.reduce((s, r) => s + Math.abs(r.gamma), 0);
  const gammaRatio = totalAbs > 0 ? +(netGamma / totalAbs).toFixed(4) : 0;

  const env = gammaRatio > ENV_DEADBAND ? "stabilized"
    : gammaRatio < -ENV_DEADBAND ? "choppy"
    : "neutral";

  // Dominant positive-gamma wall on each side of spot (the hedging wall traders
  // mean — largest concentration, not merely nearest).
  const wall = (predicate) => {
    let best = null;
    for (const r of clean) {
      if (r.gamma > 0 && predicate(r.strike) && (best == null || r.gamma > best.gamma)) best = r;
    }
    return best ? best.strike : null;
  };

  const support    = wall((k) => k < spotNum);
  const resistance = wall((k) => k > spotNum);

  return { env, netGamma: +netGamma.toFixed(2), gammaRatio, support, resistance };
}

// How a CSP strike sits relative to the gamma support wall. The defended case
// is a strike at/below a positive-gamma wall — the wall acts as a floor above
// it. Pure helper for the strike annotation.
export function classifyStrikeVsSupport(strike, support) {
  if (strike == null || support == null) return null;
  const k = Number(strike);
  const s = Number(support);
  if (!Number.isFinite(k) || !Number.isFinite(s)) return null;
  if (k <= s) return "below_wall";   // wall sits above the strike → defended floor
  return "above_wall";               // strike is above the wall → less protected
}

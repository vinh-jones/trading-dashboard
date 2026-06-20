// Consumer 3 — GEX / strike walls.
//
// Reduces a ticker's per-strike dealer-gamma profile to the few numbers that
// drive a CSP decision (Ryan's framing):
//   - environment from the NET gamma sign: positive = market-makers stabilize
//     (buy dips / sell rips → CSP-friendly), negative = they amplify moves
//     (choppy/fast → caution). Default posture: sell CSPs in positive-gamma
//     names.
//   - the gamma "walls" around spot: the dominant positive-gamma bar ABOVE spot
//     acts as resistance (a ceiling), the dominant negative-gamma bar BELOW spot
//     marks support / an acceleration zone.
//
// Net gamma at a strike = call_gex + put_gex (UW signs put_gex negative, same
// convention as gammaEnvFromGreek). Pure + null-safe: no rows / no spot →
// all-null ("no GEX signal"). The cron normalizes UW's raw by-strike response
// into `[{ strike, gamma }]`, so this stays shape-independent and testable.

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

  // Resistance = dominant positive-gamma bar above spot (a ceiling).
  // Support    = dominant negative-gamma bar below spot (acceleration/floor).
  let resistance = null, resGamma = -Infinity;
  let support = null, supGamma = Infinity;
  for (const r of clean) {
    if (r.strike > spotNum && r.gamma > resGamma) { resGamma = r.gamma; resistance = r.strike; }
    if (r.strike < spotNum && r.gamma < supGamma) { supGamma = r.gamma; support = r.strike; }
  }
  if (!(resGamma > 0)) resistance = null; // no genuine positive-gamma wall above
  if (!(supGamma < 0)) support = null;    // no genuine negative-gamma wall below

  return { env, netGamma: +netGamma.toFixed(2), gammaRatio, support, resistance };
}

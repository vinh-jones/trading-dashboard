// Consumer 3 — GEX / strike walls.
//
// Reduces a ticker's per-strike dealer-gamma profile to the few numbers that
// drive a CSP decision:
//   - environment from the NET gamma sign: positive = market-makers stabilize
//     (buy dips / sell rips → CSP-friendly), negative = they amplify moves
//     (choppy/fast → caution). Default posture: sell CSPs in positive-gamma
//     names.
//   - the gamma walls around spot, split into THREE distinct levels because
//     they mean different things for strike placement (per finance review):
//       • resistance  — dominant positive-gamma bar ABOVE spot (a ceiling).
//       • support     — dominant positive-gamma bar BELOW spot. THIS is genuine
//         dynamic support: dealers are long gamma here and buy dips, so a CSP
//         strike at/below it is defended.
//       • airPocket   — dominant negative-gamma bar BELOW spot. NOT support —
//         the opposite: dealers are short gamma and sell into weakness, so a
//         break here ACCELERATES. A strike sitting in it is exposed. Avoid.
//
// Net gamma at a strike = call_gex + put_gex (UW signs put_gex negative, same
// convention as gammaEnvFromGreek). Pure + null-safe: no rows / no spot →
// all-null ("no GEX signal"). The cron normalizes UW's raw by-strike response
// into `[{ strike, gamma }]`, so this stays shape-independent and testable.

// Environment hysteresis (per finance review): flipping INTO stabilized/choppy
// requires clearing the wider ENTER band, but the state then HOLDS until the
// ratio retreats inside the narrower EXIT band. This stops names sitting near
// their gamma flip (ratio oscillating around zero) from flip-flopping the
// label day to day. prevEnv is the last persisted env for the ticker.
const ENV_ENTER = 0.10;
const ENV_EXIT  = 0.05;

function classifyEnv(ratio, prevEnv) {
  if (prevEnv === "stabilized") {
    if (ratio > ENV_EXIT) return "stabilized";
    if (ratio < -ENV_ENTER) return "choppy";
    return "neutral";
  }
  if (prevEnv === "choppy") {
    if (ratio < -ENV_EXIT) return "choppy";
    if (ratio > ENV_ENTER) return "stabilized";
    return "neutral";
  }
  // From neutral / cold start — must clear the wider entry band.
  if (ratio > ENV_ENTER) return "stabilized";
  if (ratio < -ENV_ENTER) return "choppy";
  return "neutral";
}

function toNum(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function computeGexLevels({ rows, spot, prevEnv = null } = {}) {
  const clean = (Array.isArray(rows) ? rows : [])
    .map((r) => ({ strike: Number(r?.strike), gamma: Number(r?.gamma) }))
    .filter((r) => Number.isFinite(r.strike) && Number.isFinite(r.gamma));

  const spotNum = Number(spot);
  if (clean.length === 0 || !Number.isFinite(spotNum) || spotNum <= 0) {
    return { env: null, netGamma: null, gammaRatio: null, support: null, resistance: null, airPocket: null };
  }

  const netGamma = clean.reduce((s, r) => s + r.gamma, 0);
  const totalAbs = clean.reduce((s, r) => s + Math.abs(r.gamma), 0);
  const gammaRatio = totalAbs > 0 ? +(netGamma / totalAbs).toFixed(4) : 0;

  const env = classifyEnv(gammaRatio, prevEnv);

  // resistance — dominant positive-gamma bar above spot (a ceiling).
  // support    — dominant positive-gamma bar below spot (a defended floor).
  // airPocket  — dominant negative-gamma bar below spot (acceleration; avoid).
  let resistance = null, resGamma = -Infinity;
  let support = null, supGamma = -Infinity;
  let airPocket = null, apGamma = Infinity;
  for (const r of clean) {
    if (r.strike > spotNum && r.gamma > resGamma) { resGamma = r.gamma; resistance = r.strike; }
    if (r.strike < spotNum && r.gamma > supGamma) { supGamma = r.gamma; support = r.strike; }
    if (r.strike < spotNum && r.gamma < apGamma)  { apGamma = r.gamma; airPocket = r.strike; }
  }
  if (!(resGamma > 0)) resistance = null; // no genuine positive-gamma wall above
  if (!(supGamma > 0)) support = null;    // no genuine positive-gamma shelf below
  if (!(apGamma < 0))  airPocket = null;  // no genuine negative-gamma pocket below

  return { env, netGamma: +netGamma.toFixed(2), gammaRatio, support, resistance, airPocket };
}

// Plain-language read of where a CSP strike sits relative to the gamma walls.
// Danger-first: a strike at/below the negative-gamma air pocket is the dominant
// risk read (a break accelerates into it); otherwise a strike at/below a
// positive-gamma shelf is defended; otherwise neutral. Pure + null-safe.
export function describeStrikeVsGex({ strike, support, airPocket } = {}) {
  const k = toNum(strike);
  if (k == null) return null;
  const sh = toNum(support);
  const ap = toNum(airPocket);

  if (ap != null && k <= ap) {
    return { tone: "exposed", level: ap,
      text: `Strike sits in the negative-gamma air pocket (~$${ap}) — a breakdown here tends to accelerate, not stall.` };
  }
  if (sh != null && k <= sh) {
    return { tone: "defended", level: sh,
      text: `Strike sits at/below the positive-gamma shelf (~$${sh}) — dealers tend to buy dips here, cushioning the strike.` };
  }
  return { tone: "neutral", level: null,
    text: `Strike sits above the nearest gamma walls — no strong dealer support or acceleration at this level.` };
}

// Plain-language read of the max-pain pin relative to a short-put strike. For a
// put seller, a pin ABOVE the strike is a tailwind (the expiry magnet sits where
// the put is OTM); a pin exactly AT the strike is borderline (the magnet pulls
// price to at-the-money — no cushion); a pin BELOW the strike pulls toward
// assignment. Strike comes from the DB as a string, so coerce both. The `at`
// case is distinct on purpose: `maxPain >= strike` used to fold a pin AT the
// strike into the favorable bucket, which over-states the cushion. Pure + null-safe.
export function describeMaxPainVsStrike({ maxPain, strike } = {}) {
  const mp = toNum(maxPain);
  const k  = toNum(strike);
  if (mp == null || k == null) return null;
  if (mp > k) return { tone: "above",
    text: `Pin ($${mp}) sits above your strike — the expiry magnet favors your put expiring OTM.` };
  if (mp === k) return { tone: "at",
    text: `Pin ($${mp}) sits right at your strike — the magnet pulls toward at-the-money, so no cushion.` };
  return { tone: "below",
    text: `Pin ($${mp}) sits below your strike — the expiry magnet pulls toward assignment territory.` };
}

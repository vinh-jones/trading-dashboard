// strategyConfig.js — single source of truth for strategy tuning knobs.
//
// Anything a human might want to tune without reading code lives here:
// earnings path deltas, profit-take tiers, conviction thresholds, etc.
// Call sites import from this module instead of inlining magic numbers.

// ── Earnings path rules ──────────────────────────────────────────────────────
// Four documented wheel CSP patterns. Delta targets are per Ryan's spec;
// price targets name a bucket resolved in resolveEarningsPriceTarget below.
export const EARNINGS_PATHS = {
  A: { targetDelta: 0.17, priceTarget: "lowerBound",       priceConstraint: "below" },
  B: { targetDelta: 0.16, priceTarget: "lowerBoundMinus5", priceConstraint: "below" },
  C: { targetDelta: 0.23, priceTarget: "lowerBound",       priceConstraint: "near"  },
  D: { targetDelta: 0.27, priceTarget: "aggressiveTarget", priceConstraint: "above" },
};

// lowerBoundMinus5: 5% below the market-maker implied lower bound.
// aggressiveTarget: 30% of the way from lower bound back up to spot.
export const EARNINGS_PRICE_TARGET_PARAMS = {
  lowerBoundMinus5Fraction: 0.95,
  aggressiveTargetRatio:    0.30,
};

export function resolveEarningsPriceTarget(name, spot, lowerBound) {
  switch (name) {
    case "lowerBound":       return lowerBound;
    case "lowerBoundMinus5": return lowerBound * EARNINGS_PRICE_TARGET_PARAMS.lowerBoundMinus5Fraction;
    case "aggressiveTarget": return lowerBound + (spot - lowerBound) * EARNINGS_PRICE_TARGET_PARAMS.aggressiveTargetRatio;
    default:                 return null;
  }
}

// Scoring weights for selectStrikeForPath — delta dominance is the spec.
export const EARNINGS_PATH_SCORING = {
  deltaWeight:       10,   // delta distance × 10
  constraintPenalty: 0.5,  // strike on wrong side of lower bound
};

// ── Profit-take tiers ────────────────────────────────────────────────────────
// Ryan's 60/60 framework: target take-profit % is a function of how much of
// original DTE remains. Higher remaining DTE → take smaller profit early.
//
// Tiers are sorted descending by minDtePct. targetProfitPctForDtePct walks
// the list and returns the first tier whose threshold is met; the last tier
// acts as the default floor.
export const PROFIT_TIERS = [
  { minDtePct: 80, targetProfitPct: 50 },
  { minDtePct: 40, targetProfitPct: 60 },
  { minDtePct: 0,  targetProfitPct: 80 },
];

// ── Conviction scoring thresholds ────────────────────────────────────────────
// Used by scoreConvictionFactors to bucket each input into Low / Standard / High.
export const CONVICTION_THRESHOLDS = {
  bbPositionLow:      0.20,  // ≤ this → high-conviction (at/below lower band)
  bbPositionHigh:     0.80,  // ≥ this → low-conviction  (near upper band)
  concentrationLow:   0.05,  // < this → underweight, room to add
  concentrationHigh:  0.10,  // > this → at/above 10% target
  winRateHigh:        0.70,  // ≥ this → high-conviction familiarity signal
  winRateLow:         0.40,  // < this → low-conviction familiarity signal
  ivRankElevated:     70,    // ≥ this → "elevated" label
  ivRankModerate:     40,    // ≥ this → "moderate" label
  familiarityWeight:  0.3,   // familiarity counts for 0.3 of a vote
};

// ── Deployment gate ──────────────────────────────────────────────────────────
// Room-to-deploy (free cash % above VIX-band floor) below this → "tight".
export const DEPLOYMENT_GATE_TIGHT_THRESHOLD = 0.05;

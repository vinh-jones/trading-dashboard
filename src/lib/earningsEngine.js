import { getVixBand } from "./vixBand.js";
import {
  EARNINGS_PATHS,
  EARNINGS_PATH_SCORING,
  resolveEarningsPriceTarget,
  CONVICTION_THRESHOLDS,
  DEPLOYMENT_GATE_TIGHT_THRESHOLD,
} from "./strategyConfig.js";

/**
 * earningsEngine.js — pure helpers for the Earnings Play Tool.
 *
 * Four documented wheel CSP patterns around an earnings event:
 *
 *   A — Avoid       pre-earnings Friday, below lower bound, 15–20Δ
 *                   (skip the event, play the setup)
 *   B — Defensive   earnings-week, 3–8% below lower bound, 13–19Δ
 *                   (premium without likely assignment)
 *   C — Standard    earnings-week, AT lower bound, 20–25Δ
 *                   (happy to be assigned at the expected discount)
 *   D — Aggressive  earnings-week, ABOVE lower bound (inside EM), 25–30Δ
 *                   (high-conviction bullish, closer to current price)
 *
 * The conviction picker (Low/Standard/High) does NOT shift deltas — paths
 * are fixed by the spec. Conviction controls which two paths the UI surfaces
 * prominently. See buildEarningsPaths() + CONVICTION_PROMINENCE below.
 */

// ── Expected move ────────────────────────────────────────────────────────────
// EM = S · IV · sqrt(T/365), using the earnings-week ATM IV.
export function computeExpectedMove(spot, iv, dte) {
  if (spot == null || iv == null || dte == null || dte <= 0) return null;
  return spot * iv * Math.sqrt(dte / 365);
}

// ── Date helpers ─────────────────────────────────────────────────────────────
export function daysBetween(fromIso, toIso) {
  const a = new Date(fromIso + "T00:00:00Z").getTime();
  const b = new Date(toIso   + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86400000);
}

export function getUpcomingFridays(fromIso, days = 70) {
  const out = [];
  const from  = new Date(fromIso + "T00:00:00Z");
  const until = new Date(from.getTime() + days * 86400000);
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + 1);
  while (d <= until) {
    if (d.getUTCDay() === 5) {
      const iso = d.toISOString().slice(0, 10);
      out.push({ expiry: iso, dte: Math.round((d - from) / 86400000) });
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function pickPreEarningsExpiry(fridays, earningsIso) {
  const eDate = new Date(earningsIso + "T00:00:00Z").getTime();
  let best = null;
  for (const f of fridays) {
    const fDate = new Date(f.expiry + "T00:00:00Z").getTime();
    if (fDate < eDate) best = f;
  }
  return best;
}

export function pickEarningsWeekExpiry(fridays, earningsIso) {
  const eDate = new Date(earningsIso + "T00:00:00Z").getTime();
  for (const f of fridays) {
    const fDate = new Date(f.expiry + "T00:00:00Z").getTime();
    if (fDate >= eDate) return f;
  }
  return null;
}

// ── Strike selection ─────────────────────────────────────────────────────────
// Path deltas, price targets, and scoring weights are tuned in strategyConfig.

export function selectStrikeForPath(pathKey, spot, lowerBound, strikes) {
  const valid = (strikes || []).filter(s => s.delta != null && s.strike != null);
  if (!valid.length || lowerBound == null) return null;

  const rule = EARNINGS_PATHS[pathKey];
  if (!rule) return null;

  const targetPrice = resolveEarningsPriceTarget(rule.priceTarget, spot, lowerBound);
  const { deltaWeight, constraintPenalty } = EARNINGS_PATH_SCORING;

  const scored = valid.map(s => {
    const deltaDist = Math.abs(s.delta - rule.targetDelta);
    const priceDist = Math.abs(s.strike - targetPrice) / spot;
    let penalty = 0;
    if (rule.priceConstraint === "below" && s.strike > lowerBound) penalty = constraintPenalty;
    if (rule.priceConstraint === "above" && s.strike < lowerBound) penalty = constraintPenalty;
    return { s, score: deltaDist * deltaWeight + priceDist + penalty };
  });
  scored.sort((a, b) => a.score - b.score);
  return scored[0].s;
}

// ── Portfolio baseline ────────────────────────────────────────────────────────
// Computes overall CSP stats across ALL closed trades for comparison baseline.
export function computePortfolioBaseline(trades) {
  const csps = (trades || []).filter(t => t.type === "CSP" && t.closeDate);
  if (!csps.length) return { avgRoi: null, winRate: null, count: 0 };
  const wins   = csps.filter(t => (t.roi ?? 0) > 0);
  const avgRoi = csps.reduce((s, t) => s + (t.roi ?? 0), 0) / csps.length;
  return { avgRoi, winRate: wins.length / csps.length, count: csps.length };
}

// ── Ticker familiarity ────────────────────────────────────────────────────────
// Returns per-ticker history stats vs. portfolio baseline.
export function computeFamiliarity(ticker, trades, portfolioBaseline) {
  if (!ticker || !trades?.length) return null;
  const csps = trades.filter(t => t.ticker === ticker && t.type === "CSP" && t.closeDate);
  if (!csps.length) return { lifetimeCsps: 0, assignments: 0, winRate: null, avgRoi: null, relativeRoi: null, lastTrade: null, best: null, worst: null };

  const wins       = csps.filter(t => (t.roi ?? 0) > 0);
  const avgRoi     = csps.reduce((s, t) => s + (t.roi ?? 0), 0) / csps.length;
  const assignments = csps.filter(t => t.subtype === "Assigned").length;
  const sorted     = [...csps].sort((a, b) => b.closeDate - a.closeDate);
  const byRoi      = [...csps].sort((a, b) => (b.roi ?? 0) - (a.roi ?? 0));

  return {
    lifetimeCsps: csps.length,
    assignments,
    winRate:     wins.length / csps.length,
    avgRoi,
    relativeRoi: portfolioBaseline?.avgRoi != null ? avgRoi - portfolioBaseline.avgRoi : null,
    lastTrade:   sorted[0] ?? null,
    best:        byRoi[0]  ?? null,
    worst:       byRoi[byRoi.length - 1] ?? null,
  };
}

// ── Deployment gate ───────────────────────────────────────────────────────────
// Returns gate status for entering a new earnings CSP given current deployment.
export function computeDeploymentGate(vix, freeCashPct, accountValue) {
  const band = getVixBand(vix);
  if (!band) return { vix, band: null, floorPct: null, freeCashPct, roomToDeploy: null, marginPct: null, status: "unknown" };

  const floorPct      = band.floorPct;
  const roomToDeploy  = freeCashPct != null ? freeCashPct - floorPct : null;
  const marginPct     = accountValue && roomToDeploy != null ? roomToDeploy * accountValue : null;

  let status;
  if (roomToDeploy == null) status = "unknown";
  else if (roomToDeploy <= 0) status = "at-floor";
  else if (roomToDeploy < DEPLOYMENT_GATE_TIGHT_THRESHOLD) status = "tight";
  else status = "open";

  return { vix, band, floorPct, freeCashPct, roomToDeploy, marginPct, status };
}

// ── Conviction-factor signal aggregator ──────────────────────────────────────
// Returns { factors: [...], suggested: "LOW" | "STANDARD" | "HIGH" | ... }
// Inputs are optional — missing signals are simply skipped.
export function scoreConvictionFactors({ bbPosition, ivRank, concentration, recentEarnings, familiarity }) {
  const factors = [];
  let lowCount = 0, highCount = 0, standardCount = 0;

  if (bbPosition != null) {
    if (bbPosition < CONVICTION_THRESHOLDS.bbPositionLow) {
      factors.push({ label: "BB Position", value: `${bbPosition.toFixed(2)} (at/below lower band)`, suggests: "High" });
      highCount++;
    } else if (bbPosition > CONVICTION_THRESHOLDS.bbPositionHigh) {
      factors.push({ label: "BB Position", value: `${bbPosition.toFixed(2)} (near upper band)`, suggests: "Low" });
      lowCount++;
    } else {
      factors.push({ label: "BB Position", value: `${bbPosition.toFixed(2)} (mid-range)`, suggests: "Standard" });
      standardCount++;
    }
  }

  if (recentEarnings) {
    const { beatEPS, beatRevenue } = recentEarnings;
    if (beatEPS && beatRevenue) {
      factors.push({ label: "Last earnings", value: "Beat EPS + revenue", suggests: "Standard or High" });
      highCount++;
    } else if (beatEPS || beatRevenue) {
      factors.push({ label: "Last earnings", value: "Mixed result", suggests: "Standard" });
      standardCount++;
    } else {
      factors.push({ label: "Last earnings", value: "Missed EPS + revenue", suggests: "Low" });
      lowCount++;
    }
  }

  if (concentration != null) {
    const pct = concentration * 100;
    if (concentration < CONVICTION_THRESHOLDS.concentrationLow) {
      factors.push({ label: "Concentration", value: `${pct.toFixed(1)}% (underweight)`, suggests: "Standard or High" });
      highCount++;
    } else if (concentration > CONVICTION_THRESHOLDS.concentrationHigh) {
      factors.push({ label: "Concentration", value: `${pct.toFixed(1)}% (at/above 10% target)`, suggests: "Low" });
      lowCount++;
    } else {
      factors.push({ label: "Concentration", value: `${pct.toFixed(1)}% (within target)`, suggests: "Standard" });
      standardCount++;
    }
  }

  if (familiarity != null && familiarity.lifetimeCsps > 0) {
    const { winRate, avgRoi, relativeRoi, lifetimeCsps, assignments } = familiarity;
    const winPct  = winRate != null ? `${Math.round(winRate * 100)}% win` : "";
    const relStr  = relativeRoi != null ? ` · ${relativeRoi >= 0 ? "+" : ""}${relativeRoi.toFixed(1)} pp vs avg` : "";
    const asgStr  = assignments > 0 ? ` · ${assignments} assigned` : "";
    const value   = `${lifetimeCsps} prior CSPs · ${winPct}${relStr}${asgStr}`;
    const w = CONVICTION_THRESHOLDS.familiarityWeight;
    if (winRate != null && winRate >= CONVICTION_THRESHOLDS.winRateHigh) {
      factors.push({ label: "Familiarity", value, suggests: "Standard or High" });
      highCount += w;
    } else if (winRate != null && winRate < CONVICTION_THRESHOLDS.winRateLow) {
      factors.push({ label: "Familiarity", value, suggests: "Low" });
      lowCount += w;
    } else {
      factors.push({ label: "Familiarity", value, suggests: "Standard" });
      standardCount += w;
    }
  } else if (familiarity != null && familiarity.lifetimeCsps === 0) {
    factors.push({ label: "Familiarity", value: "No prior CSPs on this ticker", suggests: "No history" });
  }

  if (ivRank != null) {
    const ctx = ivRank >= CONVICTION_THRESHOLDS.ivRankElevated
      ? "elevated"
      : ivRank >= CONVICTION_THRESHOLDS.ivRankModerate
      ? "moderate"
      : "low";
    factors.push({
      label: "IV Rank", value: `${Math.round(ivRank)} (${ctx})`,
      suggests: "Rich premium context — applies to any path",
    });
  }

  let suggested;
  if (highCount > lowCount && highCount >= standardCount)      suggested = "STANDARD with room for HIGH";
  else if (lowCount > highCount && lowCount >= standardCount)  suggested = "LOW with room for STANDARD";
  else                                                         suggested = "STANDARD";

  return { factors, suggested, lowCount, standardCount, highCount };
}

// ── Path metadata (static, for rendering) ────────────────────────────────────
// Narrative shape: setup condition → mechanic (strike + delta) → real-behavior
// anchor via the representative quote on the card.
export const PATH_META = {
  A: {
    label:       "Avoid Earnings",
    tagline:     "Skip the event entirely",
    description: "Use this structure when the ticker's setup looks favorable but there's no strong view on the event itself — a fading name, an upper-band chart, or a position already at allocation target. The expiry is shortened to close before the report, collecting theta without taking any event risk. Strike sits at or below the implied lower bound at 15–20Δ — a normal wheel entry that simply dodges the binary.",
    evidence: [
      { trade: "CDE Feb 13",  quote: "I went a bit shorter on expiration to avoid earnings" },
      { trade: "TSM Apr 17",  quote: "Will avoid earnings and free up cash" },
      { trade: "COHR $260p",  quote: "Avoiding earnings" },
    ],
  },
  B: {
    label:       "Defensive",
    tagline:     "Outside expected move",
    description: "Use this structure when the name looks good long-term but you don't want to underwrite the binary move. The strike is placed 3–8% below the market-maker implied lower bound, giving a cushion beyond the expected move in exchange for reduced premium. It's the \"collect IV without inviting assignment\" pattern — typical when IV rank is elevated but conviction on the event outcome is moderate.",
    evidence: [
      { trade: "GLW $136p at 13Δ",  quote: "Solid company. I'm outside of the expected move, but I don't mind getting assigned at these levels" },
      { trade: "LRCX $240p at 16Δ", quote: "Went right outside the expected move for a fun earnings play" },
      { trade: "STX",               quote: "Take the expected move… go below that. Maybe I'd go to 97 and 1/2" },
    ],
  },
  C: {
    label:       "Standard",
    tagline:     "At expected lower bound",
    description: "This path places the strike exactly at the market-maker implied lower bound — the level the options market is pricing as a 1σ downside by expiration. Use it when within allocation limits on a name you want to own long-term and are actively willing to accept assignment at that discount. Delta sits in the 20–25 range, where most documented earnings-week CSPs cluster.",
    evidence: [
      { trade: "WDC $320p at 20Δ", quote: "20 delta. This put completes my 10% allocation. Happy to get assigned here" },
      { trade: "CLS $275p at 21Δ", quote: "Wanted more delta exposure for CLS earnings as I really like the company" },
      { trade: "AA $62p at 15Δ",   quote: "Went out two weeks for more premium which allowed me to get further away from the stock" },
    ],
  },
  D: {
    label:       "Aggressive",
    tagline:     "Inside expected move",
    description: "The strike is placed above the expected lower bound — closer to current price — which means the trade accepts real assignment risk in exchange for materially higher premium. Reserve this for names where you're underweight, the chart is compressed (at or below the lower Bollinger Band), and there's a specific bullish thesis on the event outcome. Delta runs 25–30+, meaningfully above standard wheel entries.",
    evidence: [
      { trade: "COHR $300p at 24Δ", quote: "Really aggressive on my strike price here as the stock looks really strong" },
      { trade: "CLS $310p at 26Δ",  quote: "That is why I'm going aggressive on these for earnings" },
      { trade: "NVDA $175p at 27Δ", quote: "Maintaining position in NVDA after strong earnings" },
    ],
  },
};

// ── Prominence: which 2 paths are surfaced prominently per conviction ────────
export const CONVICTION_PROMINENCE = {
  low:      ["A", "B"],
  standard: ["B", "C"],
  high:     ["C", "D"],
};

// ── Main: build the four paths + expected move summary ──────────────────────
// Inputs:
//   ticker, earningsIso, todayIso, spot
//   chainByExpiry: { [expiryIso]: { atmIV, strikes: [...] } }
//     Must include both the pre-earnings Friday (for Path A) and the
//     earnings-week Friday (for Paths B/C/D).
// pathCExpiryOverride: "post" | null — when "post", Path C uses the Friday
// AFTER earningsFriday (post-earnings expiry) instead of earnings-week Friday.
export function buildEarningsPaths({ ticker, earningsIso, todayIso, spot, chainByExpiry = {}, pathCExpiryOverride = null }) {
  const fridays = getUpcomingFridays(todayIso, 70);
  const earningsFriday = pickEarningsWeekExpiry(fridays, earningsIso);
  const preFriday      = pickPreEarningsExpiry(fridays, earningsIso);

  const postFriday = (() => {
    if (!earningsFriday) return null;
    const idx = fridays.findIndex(f => f.expiry === earningsFriday.expiry);
    return idx >= 0 && idx + 1 < fridays.length ? fridays[idx + 1] : null;
  })();

  const earningsWeekChain = earningsFriday ? chainByExpiry[earningsFriday.expiry] : null;
  const preChain          = preFriday      ? chainByExpiry[preFriday.expiry]      : null;

  const atmIV = earningsWeekChain?.atmIV ?? null;
  const dteToEarnings = daysBetween(todayIso, earningsIso);
  const em = computeExpectedMove(spot, atmIV, Math.max(dteToEarnings, 1));
  const emPct      = em != null && spot ? (em / spot) * 100 : null;
  const lowerBound = em != null && spot ? spot - em : null;
  const upperBound = em != null && spot ? spot + em : null;

  const buildLeg = (pathKey, friday, chain) => {
    if (!friday || !chain || !chain.strikes?.length || lowerBound == null) return null;
    const pick = selectStrikeForPath(pathKey, spot, lowerBound, chain.strikes);
    if (!pick) return null;
    const premium       = pick.mid != null ? pick.mid * 100 : null;
    const collateral    = pick.strike * 100;
    const roi           = premium != null && collateral ? (premium / collateral) * 100 : null;
    const pctBelowSpot  = spot ? ((spot - pick.strike) / spot) * 100 : null;
    const strikeVsLower = pick.strike - lowerBound;
    return {
      expiry: friday.expiry, dte: friday.dte,
      strike: pick.strike, delta: pick.delta, iv: pick.iv,
      bid: pick.bid, ask: pick.ask, mid: pick.mid, osi: pick.osi,
      premium, collateral, roi,
      pctBelowSpot, strikeVsLower,
    };
  };

  const pathCFriday = pathCExpiryOverride === "post" && postFriday ? postFriday : earningsFriday;
  const pathCChain  = pathCFriday ? chainByExpiry[pathCFriday.expiry] ?? null : null;

  const paths = {};
  for (const key of ["A", "B", "C", "D"]) {
    const friday = key === "A" ? preFriday : key === "C" ? pathCFriday : earningsFriday;
    const chain  = key === "A" ? preChain  : key === "C" ? pathCChain  : earningsWeekChain;
    const leg    = buildLeg(key, friday, chain);
    paths[key] = { key, ...PATH_META[key], ...(leg || {}), available: !!leg };
  }

  return {
    ticker, earningsIso, todayIso, spot,
    expectedMove: {
      emDollars: em, emPct, atmIV,
      dteToEarnings, lowerBound, upperBound,
      earningsWeekExpiry: earningsFriday?.expiry ?? null,
      postEarningsExpiry: postFriday?.expiry     ?? null,
      preExpiry:          preFriday?.expiry      ?? null,
    },
    paths,
  };
}

// ── Concentration math (reusable across Radar + Earnings tool) ───────────────
// Returns the current ticker's share of account value in [0,1].
export function computeTickerConcentration(ticker, positions, accountValue) {
  if (!ticker || !positions || !accountValue) return null;
  let exposure = 0;
  for (const p of positions.open_csps || []) {
    if (p.ticker === ticker) exposure += (p.strike || 0) * (p.contracts || 1) * 100;
  }
  for (const s of positions.assigned_shares || []) {
    if (s.ticker === ticker) {
      exposure += s.cost_basis_total || 0;
      for (const l of s.open_leaps || []) exposure += l.entry_cost || 0;
    }
  }
  for (const l of positions.open_leaps || []) {
    if (l.ticker === ticker) exposure += l.entry_cost || 0;
  }
  return exposure / accountValue;
}

// Projected concentration if the CSP were assigned (strike × 100 added).
export function projectedConcentration(currentConcentration, strike, accountValue) {
  if (currentConcentration == null || !strike || !accountValue) return null;
  return currentConcentration + (strike * 100) / accountValue;
}

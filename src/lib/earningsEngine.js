/**
 * earningsEngine.js
 *
 * Pure helpers for the Earnings Play Tool. No React, no fetch — all inputs
 * come in, all outputs go out. Callers are responsible for hitting
 * /api/earnings-chain and assembling chains by expiry.
 *
 * Four paths (Ryan Hildreth CSP patterns around an earnings event):
 *   A — Avoid            : skip entirely (informational)
 *   B — Defensive        : pre-earnings expiry, low delta, captures decay w/o event
 *   C — Standard         : post-earnings expiry 30–45 DTE, standard delta
 *   D — Aggressive       : earnings-week expiry, higher delta, harvest IV crush
 *
 * The conviction selector shifts the delta band (safer vs spicier).
 */

// ── Expected move ────────────────────────────────────────────────────────────
// EM = S * IV * sqrt(DTE / 365). Use the earnings-week ATM IV.
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

// Pre-earnings: nearest Friday strictly before earningsDate
export function pickPreEarningsExpiry(fridays, earningsIso) {
  const eDate = new Date(earningsIso + "T00:00:00Z").getTime();
  let best = null;
  for (const f of fridays) {
    const fDate = new Date(f.expiry + "T00:00:00Z").getTime();
    if (fDate < eDate) best = f;
  }
  return best;
}

// Earnings-week: nearest Friday on/after earnings date
export function pickEarningsWeekExpiry(fridays, earningsIso) {
  const eDate = new Date(earningsIso + "T00:00:00Z").getTime();
  for (const f of fridays) {
    const fDate = new Date(f.expiry + "T00:00:00Z").getTime();
    if (fDate >= eDate) return f;
  }
  return null;
}

// Post-earnings standard: first Friday that's >= earnings+7 AND within targetDTE band
export function pickPostEarningsExpiry(fridays, earningsIso, targetDTE = 35) {
  const eDate = new Date(earningsIso + "T00:00:00Z").getTime();
  const eligible = fridays.filter(f => {
    const fDate = new Date(f.expiry + "T00:00:00Z").getTime();
    return fDate >= eDate + 7 * 86400000;
  });
  if (!eligible.length) return null;
  let best = eligible[0], bestDiff = Math.abs(eligible[0].dte - targetDTE);
  for (const f of eligible) {
    const diff = Math.abs(f.dte - targetDTE);
    if (diff < bestDiff) { best = f; bestDiff = diff; }
  }
  return best;
}

// ── Strike selection ─────────────────────────────────────────────────────────
// Pick the strike whose |delta| is closest to targetDelta. Ties go lower.
export function selectStrikeByDelta(strikes, targetDelta) {
  const withDelta = strikes.filter(s => s.delta != null);
  if (!withDelta.length) return null;
  let best = withDelta[0];
  let bestDiff = Math.abs(best.delta - targetDelta);
  for (const s of withDelta) {
    const diff = Math.abs(s.delta - targetDelta);
    if (diff < bestDiff || (diff === bestDiff && s.strike < best.strike)) {
      best = s; bestDiff = diff;
    }
  }
  return best;
}

// ── Conviction delta bands ───────────────────────────────────────────────────
// Shift the three usable deltas (B/C/D) up or down based on conviction.
export const CONVICTION_DELTAS = {
  low:      { defensive: 0.10, standard: 0.15, aggressive: 0.20 },
  standard: { defensive: 0.15, standard: 0.20, aggressive: 0.25 },
  high:     { defensive: 0.20, standard: 0.25, aggressive: 0.30 },
};

// ── Conviction-factor signals (for the UI's conviction-factor panel) ─────────
// All factors return 1 point each; total 0–5. The UI decides how to bucket
// into low/standard/high.
export function scoreConvictionFactors({
  ivRank,         // 0..1
  bbPct,          // 0..1 (position within BBands)
  sectorBias,     // -1..1 (positive = tailwind)
  recentBeat,     // boolean
  guidanceRaised, // boolean
}) {
  let score = 0;
  const factors = [];
  if (ivRank != null && ivRank >= 0.5) { score++; factors.push({ label: "IV rank ≥ 50", on: true }); }
  else                                  factors.push({ label: "IV rank ≥ 50", on: false });
  if (bbPct != null && bbPct <= 0.35)  { score++; factors.push({ label: "Price near lower band", on: true }); }
  else                                  factors.push({ label: "Price near lower band", on: false });
  if (sectorBias != null && sectorBias > 0) { score++; factors.push({ label: "Sector tailwind", on: true }); }
  else                                       factors.push({ label: "Sector tailwind", on: false });
  if (recentBeat)     { score++; factors.push({ label: "Recent earnings beat", on: true }); }
  else                 factors.push({ label: "Recent earnings beat", on: false });
  if (guidanceRaised) { score++; factors.push({ label: "Guidance raised", on: true }); }
  else                 factors.push({ label: "Guidance raised", on: false });

  let bucket = "standard";
  if (score <= 1) bucket = "low";
  else if (score >= 4) bucket = "high";
  return { score, bucket, factors };
}

// ── Main: build the four paths ───────────────────────────────────────────────
// Inputs:
//   ticker, earningsIso, todayIso
//   conviction: "low" | "standard" | "high"
//   chainByExpiry: { [expiryIso]: { atmIV, strikes: [{ strike, delta, iv, bid, ask, mid }] } }
// Output:
//   {
//     expectedMove: { emDollars, emPct, atmIV, dteToEarnings, earningsWeekExpiry },
//     paths: { A, B, C, D }  each with { label, expiry, dte, strike, delta, mid, premium, pctBelow, reason }
//   }
export function buildEarningsPaths({
  ticker,
  earningsIso,
  todayIso,
  spot,
  conviction = "standard",
  chainByExpiry = {},
}) {
  const fridays = getUpcomingFridays(todayIso, 70);
  const earningsFriday = pickEarningsWeekExpiry(fridays, earningsIso);
  const preFriday      = pickPreEarningsExpiry(fridays, earningsIso);
  const postFriday     = pickPostEarningsExpiry(fridays, earningsIso, 35);

  // Expected move from earnings-week ATM IV (most informative)
  const earningsWeekChain = earningsFriday ? chainByExpiry[earningsFriday.expiry] : null;
  const atmIV = earningsWeekChain?.atmIV ?? null;
  const dteToEarnings = daysBetween(todayIso, earningsIso);
  const em = computeExpectedMove(spot, atmIV, Math.max(dteToEarnings, 1));
  const emPct = em != null && spot ? (em / spot) * 100 : null;

  const deltas = CONVICTION_DELTAS[conviction] || CONVICTION_DELTAS.standard;

  const buildLeg = (friday, targetDelta, labelForReason) => {
    if (!friday) return null;
    const chain = chainByExpiry[friday.expiry];
    if (!chain || !chain.strikes?.length) return null;
    const pick = selectStrikeByDelta(chain.strikes, targetDelta);
    if (!pick) return null;
    const premium = pick.mid != null ? pick.mid * 100 : null; // per contract
    const pctBelow = spot ? ((spot - pick.strike) / spot) * 100 : null;
    return {
      expiry:   friday.expiry,
      dte:      friday.dte,
      strike:   pick.strike,
      delta:    pick.delta,
      iv:       pick.iv,
      bid:      pick.bid,
      ask:      pick.ask,
      mid:      pick.mid,
      premium,
      pctBelow,
      osi:      pick.osi,
      targetDelta,
      reason:   labelForReason,
    };
  };

  const A = {
    label:  "Avoid",
    tagline:"Skip the event",
    reason: `Earnings in ${dteToEarnings}d. IV rank or thesis too thin to underwrite a binary move.`,
    expiry: null, dte: null, strike: null, delta: null, premium: null, pctBelow: null,
  };

  const Bleg = buildLeg(preFriday, deltas.defensive,
    `Pre-earnings expiry — captures theta decay, closes before the event (${conviction} conviction: ${(deltas.defensive * 100).toFixed(0)}Δ)`);
  const B = Bleg ? { label: "Defensive", tagline: "Pre-earnings decay", ...Bleg } : null;

  const Cleg = buildLeg(postFriday, deltas.standard,
    `Post-earnings ~30–45 DTE — standard premium once event risk is past (${conviction}: ${(deltas.standard * 100).toFixed(0)}Δ)`);
  const C = Cleg ? { label: "Standard", tagline: "Post-earnings standard", ...Cleg } : null;

  const Dleg = buildLeg(earningsFriday, deltas.aggressive,
    `Earnings-week expiry — harvest IV crush, accept assignment risk (${conviction}: ${(deltas.aggressive * 100).toFixed(0)}Δ)`);
  const D = Dleg ? { label: "Aggressive", tagline: "IV crush harvest", ...Dleg } : null;

  return {
    ticker,
    earningsIso,
    todayIso,
    conviction,
    expectedMove: {
      emDollars:         em,
      emPct,
      atmIV,
      dteToEarnings,
      earningsWeekExpiry: earningsFriday?.expiry ?? null,
      preExpiry:          preFriday?.expiry      ?? null,
      postExpiry:         postFriday?.expiry     ?? null,
    },
    paths: { A, B, C, D },
  };
}

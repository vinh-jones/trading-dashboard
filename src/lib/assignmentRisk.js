// Consumer 2 — assignment-risk early warning for open CSPs.
//
// The existing cushion system is price-based: it warns once the stock has
// already moved toward your strike. This layers the LEADING indicators that
// fire earlier — earnings before expiry (Ryan's headline), bearish institutional
// flow, and a choppy gamma regime — together with the cushion, into one
// escalation level + the list of reasons. Pure; all inputs already available.

import { entryEarningsRisk } from "./entryScore.js";

const SEV_RANK = { high: 3, med: 2, low: 1 };
const DAY_MS = 86400000;

function calendarDays(fromISO, toISO) {
  if (!fromISO || !toISO) return null;
  return Math.round((Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / DAY_MS);
}

export const ASSIGNMENT_RISK_DEFAULTS = {
  EARNINGS_SOON_DAYS: 14,    // earnings within this window before expiry = high severity
  BEARISH_FLOW: -0.2,
  CHOPPY_GAMMA: -0.10,
  HIGH_SHORT_INTEREST: 20,   // % of float — crowded/fragile
};

export function computeAssignmentRisk(args = {}, config = ASSIGNMENT_RISK_DEFAULTS) {
  const { earningsDate, expiry, today, flowSentiment, gammaEnv, cushionState,
          shortInterestPct, expectedMovePct, spot, strike } = args;
  const cfg = { ...ASSIGNMENT_RISK_DEFAULTS, ...config };
  const todayIso = today ?? new Date().toISOString().slice(0, 10);

  const factors = [];

  // Earnings before expiry — gap risk inside the trade's life. If we know the
  // option-implied expected move, refine: is the strike inside the expected
  // downside move (exposed) or outside it (Ryan's preferred setup)?
  const er = entryEarningsRisk({ earningsDateIso: earningsDate, expiryIso: expiry, todayIso });
  const daysToEarnings = er.earningsBeforeExpiry ? calendarDays(todayIso, earningsDate) : null;
  if (er.earningsBeforeExpiry) {
    const soon = daysToEarnings != null && daysToEarnings <= cfg.EARNINGS_SOON_DAYS;
    const whenStr = daysToEarnings != null ? `in ${daysToEarnings}d` : "before expiry";

    let insideMove = null;
    if (expectedMovePct != null && spot > 0 && strike > 0) {
      const expectedDown = spot * (1 - expectedMovePct / 100);
      insideMove = strike >= expectedDown; // strike within the expected downside
    }

    let severity, label;
    if (insideMove === true) {
      severity = "high";
      label = `Earnings ${whenStr} · strike inside expected ±${expectedMovePct.toFixed(0)}% move`;
    } else if (insideMove === false) {
      severity = "low";
      label = `Earnings ${whenStr} · strike outside expected ±${expectedMovePct.toFixed(0)}% move`;
    } else {
      severity = soon ? "high" : "med";
      label = `Earnings ${whenStr}, before expiry`;
    }
    factors.push({ key: "earnings", severity, label });
  }

  // Price cushion (the existing, lagging signal) — folded in for one view.
  if (cushionState === "assignment_risk") {
    factors.push({ key: "cushion", severity: "high", label: "Price at/through your strike" });
  } else if (cushionState === "approaching") {
    factors.push({ key: "cushion", severity: "med", label: "Price approaching your strike" });
  }

  // Bearish institutional flow — leads price.
  if (flowSentiment != null && flowSentiment <= cfg.BEARISH_FLOW) {
    factors.push({ key: "flow", severity: "med", label: "Institutional flow bearish" });
  }

  // Choppy gamma regime — fast/volatile, higher gap risk.
  if (gammaEnv != null && gammaEnv <= cfg.CHOPPY_GAMMA) {
    factors.push({ key: "gamma", severity: "low", label: "Choppy gamma (fast moves)" });
  }

  // High short interest — only counts as assignment risk when bearish flow is
  // ALSO present (per finance review). High SI alone cuts both ways for a
  // put-seller: it's squeeze fuel (stock pops, your put wins) as often as
  // fragility. Requiring bearish flow to co-occur isolates the case where the
  // fragility is actually realizing rather than flagging every crowded short.
  const bearishFlowForShort = flowSentiment != null && flowSentiment <= cfg.BEARISH_FLOW;
  if (shortInterestPct != null && shortInterestPct >= cfg.HIGH_SHORT_INTEREST && bearishFlowForShort) {
    factors.push({ key: "short", severity: "med", label: `High short interest (${shortInterestPct.toFixed(0)}% of float) into bearish flow` });
  }

  factors.sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]);

  const hasHigh = factors.some((f) => f.severity === "high");
  const level = hasHigh ? "high"
    : factors.length >= 2 ? "elevated"
    : factors.length === 1 ? "watch"
    : "none";

  return { level, factors, earnings_before_expiry: er.earningsBeforeExpiry, days_to_earnings: daysToEarnings };
}

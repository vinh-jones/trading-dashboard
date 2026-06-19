// Per-CSP "redeploy" signal — the complement to holdYield's risk-shedding lens.
// Asks: is this position's leftover premium still decaying fast enough to be
// worth holding, or would the same capital earn more in a FRESH CSP?
//
//   ratio = (remaining premium / remaining days) ÷ (full premium / full DTE)
//         = (1 − %premium kept) ÷ (1 − %time elapsed)
//
// A fresh trade collects premium at an even pace, so the ratio compares the
// leftover's velocity to a brand-new position's. ratio < 1 means the leftover
// pays slower than starting over; below CLOSE_THRESHOLD it pays so much slower
// that closing and redeploying the capital wins even after the bid/ask + idle-
// cash drag of churning. Underwater positions (mark above entry) are a roll /
// assignment decision, not a redeploy one, and are flagged separately.

import { shortOptionGlPct } from "./positionMetrics.js";

export const REDEPLOY_DEFAULTS = {
  CLOSE_THRESHOLD: 0.5, // leftover worth < half a fresh trade → close & redeploy
  WATCH_THRESHOLD: 0.8, // approaching the line → keep an eye on the mark
};

const DAY_MS = 86400000;
function calendarDays(fromISO, toISO) {
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  return Math.round((b - a) / DAY_MS);
}

/**
 * @param {object} args
 * @param {number} args.premiumCollected - GROSS premium at open (positions row)
 * @param {number|null} args.optionMid   - current option mid from quoteMap
 * @param {number} args.contracts
 * @param {number} args.daysToExpiry     - days remaining (calcDTE)
 * @param {string} args.openDate         - ISO yyyy-mm-dd
 * @param {string} args.today            - ISO yyyy-mm-dd
 * @param {object} [config]
 * @returns {object} redeploy result, or { skipped: reason }
 */
export function computeRedeploySignal(args, config = REDEPLOY_DEFAULTS) {
  const { premiumCollected, optionMid, contracts, daysToExpiry, openDate, today } = args;
  const { CLOSE_THRESHOLD, WATCH_THRESHOLD } = { ...REDEPLOY_DEFAULTS, ...config };

  const glPct = shortOptionGlPct({ premiumCollected, optionMid, contracts });
  if (glPct == null) return { skipped: "missing_mark" };

  const daysRemaining = daysToExpiry;
  const daysHeld      = calendarDays(openDate, today);
  const originalDte   = daysHeld + daysRemaining;
  if (!(originalDte > 0) || daysRemaining <= 0) return { skipped: "expired" };

  const keptPct      = glPct / 100;                 // fraction of premium captured
  const fracTimeLeft = daysRemaining / originalDte; // 1 − %time elapsed
  const ratio        = (1 - keptPct) / fracTimeLeft;

  // Buy-back mark that trips the close line at today's DTE: solving
  // ratio = CLOSE_THRESHOLD for the current mark gives entry × CLOSE × fracTimeLeft.
  const entryPerShare = premiumCollected / (100 * contracts);
  const triggerMark   = CLOSE_THRESHOLD * entryPerShare * fracTimeLeft;

  let state;
  if (keptPct <= 0)                 state = "underwater";
  else if (ratio < CLOSE_THRESHOLD) state = "redeploy";
  else if (ratio < WATCH_THRESHOLD) state = "watch";
  else                              state = "hold";

  return {
    ratio,
    kept_pct:       keptPct,
    frac_time_left: fracTimeLeft,
    days_remaining: daysRemaining,
    trigger_mark:   triggerMark,
    current_mark:   optionMid,
    redeploy_state: state,
  };
}

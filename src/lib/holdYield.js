// Per-CSP "hold yield" signal — "am I still being paid my normal rate to carry
// this assignment risk?" Compares a green CSP's forward yield against the
// trader's trailing typical CSP ENTRY yield (the benchmark from api/data.js).
// Risk-shedding framing, never redeploy. See
// docs/superpowers/specs/SPEC_HOLD_YIELD_SIGNAL_V2.md.

import { shortOptionGlPct } from "./positionMetrics.js";

export const HOLD_YIELD_DEFAULTS = {
  DTE_FLOOR_ABS: 7,
  DTE_FRAC: 0.33,
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
 * @param {number|null} args.optionMid    - current option mid from quoteMap
 * @param {number} args.contracts
 * @param {number} args.capitalFronted    - strike*100*contracts
 * @param {number} args.daysToExpiry      - days remaining
 * @param {string} args.openDate          - ISO yyyy-mm-dd
 * @param {string} args.today             - ISO yyyy-mm-dd
 * @param {string} args.cushionState      - "safe" | "approaching" | "assignment_risk"
 * @param {number|null} args.benchmark    - avg_csp_entry_yield_ann
 * @param {object} [config]
 * @returns {object} hold_yield result, or { skipped: reason }
 */
export function computeHoldYield(args, config = HOLD_YIELD_DEFAULTS) {
  const {
    premiumCollected, optionMid, contracts, capitalFronted,
    daysToExpiry, openDate, today, cushionState, benchmark,
  } = args;
  const { DTE_FLOOR_ABS, DTE_FRAC } = { ...HOLD_YIELD_DEFAULTS, ...config };

  const glPct = shortOptionGlPct({ premiumCollected, optionMid, contracts });
  if (glPct == null) return { skipped: "missing_mid" };

  const profitPct = glPct / 100;
  if (profitPct <= 0) return { skipped: "underwater" };

  const capital = capitalFronted;
  const daysHeld = calendarDays(openDate, today);
  const daysRemaining = daysToExpiry;
  const originalDte = daysHeld + daysRemaining;
  const dteFraction = originalDte > 0 ? daysRemaining / originalDte : 0;

  const clampedProfit = Math.min(profitPct, 1);
  const premiumRemaining = premiumCollected * (1 - clampedProfit);
  const premiumCaptured = premiumCollected * clampedProfit;

  const forwardYieldAnn = (premiumRemaining / capital) / Math.max(daysRemaining, 1) * 365;
  const realizedYieldAnn = daysHeld > 0
    ? (premiumCaptured / capital) / daysHeld * 365
    : null;

  const gatePassed = daysRemaining >= DTE_FLOOR_ABS && dteFraction >= DTE_FRAC;
  const ratio = benchmark != null && benchmark !== 0 ? forwardYieldAnn / benchmark : null;

  // State resolution order: nothing-left → no-benchmark → late-cycle → ratio bands.
  let state;
  if (profitPct >= 1) {
    state = "fully_captured";
  } else if (benchmark == null) {
    state = "no_benchmark";
  } else if (!gatePassed) {
    state = "late_cycle_let_ride";
  } else if (ratio >= 1.0) {
    state = "fairly_paid";
  } else if (ratio >= 0.5) {
    state = "below_average";
  } else {
    state = "underpaid_to_hold";
  }

  let priority = "none";
  if (state === "underpaid_to_hold") {
    priority = (cushionState === "assignment_risk" || cushionState === "approaching")
      ? "HIGH" : "LOW";
  }

  return {
    capital,
    forward_yield_ann: state === "fully_captured" ? 0 : forwardYieldAnn,
    realized_yield_ann: realizedYieldAnn,
    avg_csp_entry_yield_ann: benchmark,
    ratio: state === "fully_captured" ? 0 : ratio,
    days_remaining: daysRemaining,
    dte_fraction_remaining: dteFraction,
    gate_passed: gatePassed,
    hold_yield_state: state,
    priority,
  };
}

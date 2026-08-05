// src/lib/orb/openingRange.js
//
// The source strategy uses a 15-minute chart. We assemble the opening candle
// from the 09:30, 09:35 and 09:40 ET bars: high = max of the three highs, low =
// min of the three lows, open = first bar's open, close = third bar's close.
//
// This is NOT because the provider lacks 15-minute bars. Unusual Whales serves
// `15m` natively, and on 2026-08-04 its native bar matched this assembly in
// every field (o 708.21, h 713.48, l 707.59, c 712.5195, vol 5,546,830).
//
// We assemble anyway for self-consistency. Pattern detection runs on 5-minute
// bars and tests each close against these box edges. Sourcing the box from a
// separate 15m series would make that comparison depend on two aggregations
// agreeing at a boundary, and a one-cent disagreement would silently corrupt
// the exact decision that fires an alert. One series, consistent by
// construction.
//
// Consequence: the expected values in the buildBox test are the provider's own
// native 15m numbers, so that test cross-checks our assembly against UW's
// aggregation. Do not "tidy" those constants.

import { etMinutes, etDate } from "./bars.js";

const OPEN_MIN = 9 * 60 + 30;             // 09:30 ET
const EXPECTED = [OPEN_MIN, OPEN_MIN + 5, OPEN_MIN + 10];

/**
 * @param {Array} bars ascending 5-minute bars for one session
 * @returns {{high,low,range,open,close,color}|null}
 */
export function buildBox(bars) {
  if (!Array.isArray(bars) || bars.length < 3) return null;

  // Select by exact ET minute rather than array position. sliceSession only
  // filters by calendar date, not session hours, so a provider that leaks
  // pre-market bars (04:00/04:05/04:10 ET) would sort ahead of the open and
  // a positional slice(0,3) would silently grab those instead. A lookup by
  // minute is equally strict about which three bars qualify — still fails
  // closed if any of the three is missing — but is immune to leading junk
  // anywhere in the array.
  const opening = EXPECTED.map((want) => bars.find((b) => etMinutes(b.start) === want));
  if (opening.some((b) => !b)) return null;

  // The three bars must come from the same session. Positional slicing used
  // to make this implicit; the minute lookup does not, and this function is
  // about to be trusted by several more modules — don't take it on faith.
  const days = new Set(opening.map((b) => etDate(b.start)));
  if (days.size !== 1) return null;

  const high  = Math.max(...opening.map((b) => b.h));
  const low   = Math.min(...opening.map((b) => b.l));
  const open  = opening[0].o;
  const close = opening[2].c;

  return {
    high,
    low,
    range: high - low,
    open,
    close,
    // Tie-break: an exactly-flat candle counts as green. Arbitrary but it must
    // be deterministic, because it decides which direction we fade.
    color: close >= open ? "green" : "red",
  };
}

/**
 * Gate 3. Always returns the continuous ratio so the threshold stays
 * recalibratable from the log — `qualified` is a view on the number, not a
 * replacement for it.
 *
 * Note `qualified` tests against greyBandLowPct (22%), not atrThresholdPct
 * (25%): the source calls 25% a strong signal but 22-23% still usable, so the
 * grey band passes WITH A FLAG rather than failing. This is deliberate.
 */
export function evaluateLiquidity(range, atr, params) {
  if (!Number.isFinite(range) || !Number.isFinite(atr) || atr <= 0) {
    // All four fields null, not just the numeric ones: this verdict gets
    // persisted to a DB column, and `greyBand: false` would read as
    // "evaluated, not grey" when the truth is "not evaluated at all".
    return { rangeAtrPct: null, threshold: null, qualified: null, greyBand: null };
  }
  const rangeAtrPct = range / atr;
  const qualified = rangeAtrPct >= params.greyBandLowPct;
  return {
    rangeAtrPct,
    threshold: atr * params.atrThresholdPct,
    qualified,
    // Reuse `qualified` rather than re-deriving the same >= comparison.
    greyBand: qualified && rangeAtrPct < params.atrThresholdPct,
  };
}

/** Gate 4. Green opening candle -> fade it above the box, and vice versa. */
export function seekDirection(color) {
  return color === "green" ? "bearish" : "bullish";
}

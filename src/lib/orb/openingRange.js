// src/lib/orb/openingRange.js
//
// The source strategy uses a 15-minute chart. Most REST bar APIs top out at
// 5-minute granularity, so the opening candle is assembled from the 09:30,
// 09:35 and 09:40 ET bars. This is exact, not an approximation: the 15-minute
// high is the max of the three highs, the low the min of the three lows, the
// open the first bar's open and the close the third bar's close.

import { etMinutes } from "./bars.js";

const OPEN_MIN = 9 * 60 + 30;             // 09:30 ET
const EXPECTED = [OPEN_MIN, OPEN_MIN + 5, OPEN_MIN + 10];

/**
 * @param {Array} bars ascending 5-minute bars for one session
 * @returns {{high,low,range,open,close,color}|null}
 */
export function buildBox(bars) {
  if (!Array.isArray(bars) || bars.length < 3) return null;
  const first3 = bars.slice(0, 3);

  // Guard against a provider that pads pre-market or drops the opening bar.
  const mins = first3.map((b) => etMinutes(b.start));
  if (mins.some((m, i) => m !== EXPECTED[i])) return null;

  const high  = Math.max(...first3.map((b) => b.h));
  const low   = Math.min(...first3.map((b) => b.l));
  const open  = first3[0].o;
  const close = first3[2].c;

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
    return { rangeAtrPct: null, threshold: null, qualified: null, greyBand: false };
  }
  const rangeAtrPct = range / atr;
  return {
    rangeAtrPct,
    threshold: atr * params.atrThresholdPct,
    qualified: rangeAtrPct >= params.greyBandLowPct,
    greyBand:  rangeAtrPct >= params.greyBandLowPct && rangeAtrPct < params.atrThresholdPct,
  };
}

/** Gate 4. Green opening candle -> fade it above the box, and vice versa. */
export function seekDirection(color) {
  return color === "green" ? "bearish" : "bullish";
}

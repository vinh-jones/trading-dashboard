// src/lib/orb/patterns.js
//
// The source describes these patterns visually; the numeric definitions here
// are a formalization, and every threshold lives in ORB_PARAMS so the stored
// row records which parameterization produced a match.
//
// The engulf tolerance is not cosmetic. On 2026-08-04 QQQ, the 09:55 bar's open
// sat $0.005 under the prior close — a strict comparison finds nothing, a
// one-cent tolerance finds a bearish engulfing. On an index ETF with tight
// 5-minute bars, strict and tolerant are different strategies.
//
// `prevWeak` is advisory, not a filter. `passesGuards` only validates the
// signal bar's anatomy — `prev` is never checked — so an engulfing can match
// against a prior bar that is doji-shaped, or whose body is smaller than
// engulfTolerance (in which case the tolerance band dominates the comparison
// rather than the body being engulfed). Semantically, engulfing a doji
// overwhelms nothing. A hard filter was considered and rejected: it would
// erase these matches from the log forever, and the flag/gate split already
// exists for the liquidity gate (detect always, gate the alert). Detection
// stays unchanged; it is the caller's job to decide whether prevWeak should
// suppress the alert.

export function anatomy(bar) {
  const range   = bar.h - bar.l;
  const body    = Math.abs(bar.c - bar.o);
  const bodyTop = Math.max(bar.o, bar.c);
  const bodyBot = Math.min(bar.o, bar.c);
  return {
    range, body, bodyTop, bodyBot,
    upperWick: bar.h - bodyTop,
    lowerWick: bodyBot - bar.l,
    green: bar.c > bar.o,
    red:   bar.c < bar.o,
  };
}

function passesGuards(a, atr, params) {
  if (!(a.range > 0)) return false;
  if (a.body < params.minBodyPctOfRange * a.range) return false;          // doji
  if (!Number.isFinite(atr) || atr <= 0) return false;                    // ATR required
  if (a.range < params.minRangePctOfAtr * atr) return false;              // noise
  return true;
}

function isHammer(a, bar, params) {
  const zoneFloor = bar.l + (1 - params.hammerBodyZone) * a.range;
  return a.bodyBot >= zoneFloor &&
         a.lowerWick >= params.hammerWickRatio * a.body &&
         a.upperWick <= params.hammerOppWickRatio * a.body;
}

function isInvertedHammer(a, bar, params) {
  const zoneCeil = bar.l + params.hammerBodyZone * a.range;
  return a.bodyTop <= zoneCeil &&
         a.upperWick >= params.hammerWickRatio * a.body &&
         a.lowerWick <= params.hammerOppWickRatio * a.body;
}

function isBullishEngulfing(bar, prev, params) {
  if (!prev) return false;
  const a = anatomy(bar), p = anatomy(prev);
  const tol = params.engulfTolerance;
  return a.green && p.red &&
         bar.o <= prev.c + tol &&
         bar.c >= prev.o - tol;
}

function isBearishEngulfing(bar, prev, params) {
  if (!prev) return false;
  const a = anatomy(bar), p = anatomy(prev);
  const tol = params.engulfTolerance;
  return a.red && p.green &&
         bar.o >= prev.c - tol &&
         bar.c <= prev.o + tol;
}

/**
 * Whether the prior bar is too weak to be meaningfully engulfed: doji-shaped
 * (body under minBodyPctOfRange of its own range), or so small in absolute
 * terms that the engulf tolerance's slack band exceeds the body being
 * compared. Reuses existing params — no new magic numbers.
 */
function prevIsWeak(prev, params) {
  if (!prev) return false;
  const p = anatomy(prev);
  if (!(p.range > 0)) return true;
  if (p.body < params.minBodyPctOfRange * p.range) return true;  // doji-shaped
  if (p.body < params.engulfTolerance) return true;              // slack exceeds the body
  return false;
}

/**
 * @param {number} atr - required; a non-finite or non-positive value rejects
 *   the bar outright rather than skipping the noise guard. The only path
 *   that reaches this function with a bad ATR is a caller bug, and firing an
 *   alert on a weaker set of guards is worse than firing nothing.
 * @returns {{pattern:string, side:"long"|"short", prevWeak:boolean}|null}
 */
export function detectPattern(bar, prev, atr, params) {
  const a = anatomy(bar);
  if (!passesGuards(a, atr, params)) return null;

  // Engulfing is checked first: it is the stronger two-bar signal, and a bar
  // can satisfy both definitions.
  if (isBearishEngulfing(bar, prev, params)) return { pattern: "bearish_engulfing", side: "short", prevWeak: prevIsWeak(prev, params) };
  if (isBullishEngulfing(bar, prev, params)) return { pattern: "bullish_engulfing", side: "long",  prevWeak: prevIsWeak(prev, params) };
  if (isInvertedHammer(a, bar, params))      return { pattern: "inverted_hammer",   side: "short", prevWeak: false };
  if (isHammer(a, bar, params))              return { pattern: "hammer",            side: "long",  prevWeak: false };
  return null;
}

/**
 * Spec open question, resolved as (c): the close must sit outside the box.
 * Only the signal candle is tested — for an engulfing, the engulfed bar may sit
 * inside the range. A close exactly on the edge counts as inside.
 * @returns {"close_above"|"close_below"|null} which rule fired
 */
export function isOutsideBox(bar, box, direction, params) {
  if (params.outsideRule !== "close") {
    throw new Error(`unsupported outsideRule: ${params.outsideRule}`);
  }
  if (direction === "bearish") return bar.c > box.high ? "close_above" : null;
  if (direction === "bullish") return bar.c < box.low  ? "close_below" : null;
  throw new Error(`unsupported direction: ${direction}`);
}

/** A bearish setup only accepts short patterns, and vice versa. */
export function matchesDirection(side, direction) {
  return (direction === "bearish" && side === "short") ||
         (direction === "bullish" && side === "long");
}

// src/lib/orb/outcome.js
//
// Replays post-signal bars to decide what actually happened. 5-minute bars
// cannot reveal intra-bar ordering: when one bar's range spans both the stop
// and a target, which came first is unknowable. The resolver takes the
// conservative reading (stop) and sets `ambiguous` so those sessions stay
// separable in any later hit-rate count.

/**
 * @param {{side:"long"|"short",entry:number,stop:number,t1:number,t2:number}} sig
 * @param {Array<{h:number,l:number}>} bars at/after the signal bar, ascending
 * @returns {{outcome:"t2"|"t1"|"stop"|"none", ambiguous:boolean, barsToFill:number|null}}
 */
export function resolveOutcome(sig, bars) {
  const long = sig.side === "long";
  const hitsEntry = (b) => (long ? b.h >= sig.entry : b.l <= sig.entry);
  const hitsStop  = (b) => (long ? b.l <= sig.stop  : b.h >= sig.stop);
  const hitsT1    = (b) => (long ? b.h >= sig.t1    : b.l <= sig.t1);
  const hitsT2    = (b) => (long ? b.h >= sig.t2    : b.l <= sig.t2);

  let filled = false, barsToFill = null, best = "none", ambiguous = false;

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (!filled) {
      if (!hitsEntry(b)) continue;
      filled = true;
      barsToFill = i;
    }
    const stopped = hitsStop(b), t2 = hitsT2(b), t1 = hitsT1(b);
    if (stopped && (t1 || t2)) {
      // Both touched inside one bar — order unknowable from 5-minute data.
      return { outcome: "stop", ambiguous: true, barsToFill };
    }
    if (stopped) return { outcome: "stop", ambiguous, barsToFill };
    if (t2)      return { outcome: "t2",   ambiguous, barsToFill };
    if (t1)      best = "t1";   // keep going; t2 may still print
  }
  return { outcome: filled ? best : "none", ambiguous, barsToFill };
}

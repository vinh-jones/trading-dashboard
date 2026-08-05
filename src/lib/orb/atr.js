// src/lib/orb/atr.js
//
// Wilder's ATR. Seeded with the simple mean of the first `period` true ranges,
// then smoothed forward — this is what "default settings" means on a charting
// platform. Feed it a long warm-up (ORB_PARAMS.atrWarmupBars) or the value will
// not match what the user sees on their chart.
//
// CRITICAL: `bars` must NOT include the in-progress session. Today's opening
// range would otherwise feed the ATR that gates today's opening range. It is
// the caller's job (Task 8) to strip today's partial daily bar before calling
// wilderAtr — this module has no way to detect that on its own.

/**
 * @param {{h:number,l:number}} bar only h/l are used, not a full OHLC bar
 * @param {number|null} prevClose may be null (falls back to high-low)
 */
export function trueRange(bar, prevClose) {
  const hl = bar.h - bar.l;
  if (prevClose == null || !Number.isFinite(prevClose)) return hl;
  return Math.max(hl, Math.abs(bar.h - prevClose), Math.abs(bar.l - prevClose));
}

/**
 * @param {Array<{h:number,l:number,c:number}>} bars oldest-first daily bars
 * @param {number} period
 * @returns {number|null} ATR, or null if there is not enough history
 */
export function wilderAtr(bars, period) {
  if (!Number.isInteger(period) || period <= 0) return null;
  if (!Array.isArray(bars) || bars.length < period + 1) return null;

  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    trs.push(trueRange(bars[i], bars[i - 1].c));
  }
  if (trs.length < period) return null;

  let atr = trs.slice(0, period).reduce((s, t) => s + t, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

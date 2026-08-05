// src/lib/orb/signal.js
//
// Entry/stop per the source's table. Targets are the two box edges: T1 is the
// edge nearest the entry, T2 the far one.
//
// Both R:R ratios are returned deliberately. The source quotes a single
// flattering number (its NVDA example is 2.7) but that is T2 alone — the same
// trade's T1 ratio is 0.32, because T1 is only "price re-enters the range".
// Recording one without the other makes every setup look better than it is.

export function buildSignal(match, bar, prev, box) {
  let entry, stop;

  switch (match.pattern) {
    case "hammer":
      entry = bar.h; stop = bar.l; break;
    case "inverted_hammer":
      entry = bar.l; stop = bar.h; break;
    case "bullish_engulfing":
      if (!prev) return null;
      entry = prev.h; stop = bar.l; break;
    case "bearish_engulfing":
      if (!prev) return null;
      entry = prev.l; stop = bar.h; break;
    default:
      return null;
  }

  const long = match.side === "long";

  // Coherence guard: a long must stop out below entry, a short above.
  if (long  && !(stop < entry)) return null;
  if (!long && !(stop > entry)) return null;

  // A long sets up below the box, so the near edge is the box low; a short
  // sets up above it, so the near edge is the box high.
  const t1 = long ? box.low  : box.high;
  const t2 = long ? box.high : box.low;

  const risk = Math.abs(entry - stop);
  if (!(risk > 0)) return null;

  // The signal bar's CLOSE is outside the box, but its high (long) or low
  // (short) can poke back past the near edge — so T1 is sometimes already
  // behind the entry. Report that rather than showing a flattering rrT1 for a
  // target met at the moment of entry. The setup stays valid; T2 is real.
  const t1Ahead = long ? t1 > entry : t1 < entry;

  return {
    entry, stop, t1, t2, risk, t1Ahead,
    rrT1: Math.abs(t1 - entry) / risk,
    rrT2: Math.abs(t2 - entry) / risk,
  };
}

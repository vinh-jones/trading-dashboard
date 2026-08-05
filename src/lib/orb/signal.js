// src/lib/orb/signal.js
//
// Entry/stop per the source's table. Targets are the two box edges: T1 is the
// edge nearest the entry, T2 the far one.
//
// Both R:R ratios are returned deliberately. The source quotes a single
// flattering number (its NVDA example is 2.7) but that is T2 alone — the same
// trade's T1 ratio is 0.32, because T1 is only "price re-enters the range".
// Recording one without the other makes every setup look better than it is.
//
// Contract: buildSignal either returns a signal object, returns null (the
// setup is structurally incoherent — see the coherence guards below), or
// throws (an unrecognized `match.pattern`, i.e. a caller bug).

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
      // Same class of caller bug as patterns.js throwing on an unrecognized
      // `direction`/`outsideRule`: an unknown pattern is a code bug (someone
      // added a 5th pattern to detectPattern and forgot this switch), not a
      // "no signal today" outcome. Returning null here would be silently
      // indistinguishable from "no pattern found" — exactly the failure mode
      // this module exists to eliminate. Throw loud instead.
      throw new Error(`buildSignal: unrecognized pattern "${match.pattern}"`);
  }

  const long = match.side === "long";

  // Coherence guards. Two invariants, both structural, neither about how
  // "good" the setup is. Do not delete either as dead code:
  //   1. A long must stop out below entry, a short above. This is a LIVE
  //      production path, not just defense against a hand-built match. It
  //      fires on real detectPattern output whenever the PRIOR bar's body is
  //      smaller than `engulfTolerance` (0.01): passesGuards' doji guard only
  //      validates the CURRENT (signal) bar's anatomy — `prev` is never
  //      checked at all. A near-doji prev collapses entry (prev.h for a
  //      bullish engulfing, prev.l for bearish) to nearly a single point, and
  //      the signal bar's wick can land on the wrong side of it. Concretely:
  //        prev = { o: 100.005, h: 100.005, l: 99.99,   c: 100.000 } // red, body 0.005 < tol 0.01
  //        bar  = { o: 100.008, h: 100.03,  l: 100.007, c: 100.02  } // green
  //      detectPattern returns bullish_engulfing/long; entry = prev.h =
  //      100.005, stop = bar.l = 100.007 — stop sits ABOVE entry, incoherent
  //      for a long. Both bars are physically valid OHLC; this is not a
  //      contrived input.
  //   2. Entry can't sit on the FAR side of the entire box — that's not a
  //      breakout setup at all, it's nonsense (e.g. a "long" whose entry is
  //      already above box.high). This does NOT reject an entry that's
  //      merely inside the box (high poked back through the near edge);
  //      that's the degenerate-but-valid case t1Ahead exists to report, and
  //      T2 is still a real target for it. Only the far-side case is rejected.
  if (long  && !(stop < entry)) return null;
  if (!long && !(stop > entry)) return null;
  if (long  && entry > box.high) return null;
  if (!long && entry < box.low)  return null;

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

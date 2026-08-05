// api/__tests__/orbOutcome.test.js
//
// resolveOutcome is pure bar-replay math — no I/O, no mocks needed. Every
// fixture below is a minimal {h,l} bar sequence hand-checked against the
// long/short hit predicates in src/lib/orb/outcome.js.

import { describe, it, expect } from "vitest";
import { resolveOutcome } from "../../src/lib/orb/outcome.js";

const LONG = { side: "long", entry: 100, stop: 95, t1: 105, t2: 110 };
const SHORT = { side: "short", entry: 100, stop: 105, t1: 95, t2: 90 };

describe("resolveOutcome — long side", () => {
  it("never reaches entry -> none, ambiguous false, barsToFill null", () => {
    const bars = [{ h: 99, l: 97 }, { h: 98, l: 96 }];
    expect(resolveOutcome(LONG, bars)).toEqual({ outcome: "none", ambiguous: false, barsToFill: null });
  });

  it("empty bars array -> none", () => {
    expect(resolveOutcome(LONG, [])).toEqual({ outcome: "none", ambiguous: false, barsToFill: null });
  });

  it("T1 hit and no stop -> t1", () => {
    const bars = [
      { h: 101, l: 99 },  // fills entry (h >= 100), index 0
      { h: 106, l: 100 }, // hits t1 (h >= 105), not stop, not t2
    ];
    expect(resolveOutcome(LONG, bars)).toEqual({ outcome: "t1", ambiguous: false, barsToFill: 0 });
  });

  it("T2 reached -> t2", () => {
    const bars = [
      { h: 101, l: 99 },  // fills entry, index 0
      { h: 111, l: 106 }, // hits t2 (h >= 110)
    ];
    expect(resolveOutcome(LONG, bars)).toEqual({ outcome: "t2", ambiguous: false, barsToFill: 0 });
  });

  it("stop hit first (separate bar from any target) -> stop, ambiguous false", () => {
    const bars = [
      { h: 101, l: 99 }, // fills entry, index 0
      { h: 102, l: 94 }, // hits stop (l <= 95), no target touched
    ];
    expect(resolveOutcome(LONG, bars)).toEqual({ outcome: "stop", ambiguous: false, barsToFill: 0 });
  });

  it("one bar spans both stop and a target -> stop, ambiguous true", () => {
    // Same bar fills entry (h >= 100), hits stop (l <= 95) AND t1 (h >= 105).
    const bars = [{ h: 106, l: 94 }];
    expect(resolveOutcome(LONG, bars)).toEqual({ outcome: "stop", ambiguous: true, barsToFill: 0 });
  });

  it("barsToFill records the correct index when entry fills late", () => {
    const bars = [
      { h: 98, l: 96 },   // no fill
      { h: 99, l: 97 },   // no fill
      { h: 101, l: 99 },  // fills entry, index 2
      { h: 106, l: 100 }, // hits t1
    ];
    const r = resolveOutcome(LONG, bars);
    expect(r.barsToFill).toBe(2);
    expect(r.outcome).toBe("t1");
  });

  it("T1 hit then T2 later prints t2, not t1", () => {
    const bars = [
      { h: 101, l: 99 },  // fills entry
      { h: 106, l: 100 }, // hits t1 only
      { h: 111, l: 106 }, // hits t2
    ];
    expect(resolveOutcome(LONG, bars)).toEqual({ outcome: "t2", ambiguous: false, barsToFill: 0 });
  });
});

describe("resolveOutcome — short side (mirror)", () => {
  it("never reaches entry -> none", () => {
    const bars = [{ h: 103, l: 101 }, { h: 104, l: 102 }];
    expect(resolveOutcome(SHORT, bars)).toEqual({ outcome: "none", ambiguous: false, barsToFill: null });
  });

  it("T1 hit and no stop -> t1", () => {
    const bars = [
      { h: 101, l: 99 }, // fills entry (l <= 100), index 0
      { h: 100, l: 94 }, // hits t1 (l <= 95), not stop (h < 105), not t2
    ];
    expect(resolveOutcome(SHORT, bars)).toEqual({ outcome: "t1", ambiguous: false, barsToFill: 0 });
  });

  it("T2 reached -> t2", () => {
    const bars = [
      { h: 101, l: 99 }, // fills entry, index 0
      { h: 100, l: 89 }, // hits t2 (l <= 90)
    ];
    expect(resolveOutcome(SHORT, bars)).toEqual({ outcome: "t2", ambiguous: false, barsToFill: 0 });
  });

  it("stop hit first (separate bar from any target) -> stop, ambiguous false", () => {
    const bars = [
      { h: 101, l: 99 },  // fills entry, index 0
      { h: 106, l: 100 }, // hits stop (h >= 105), no target touched
    ];
    expect(resolveOutcome(SHORT, bars)).toEqual({ outcome: "stop", ambiguous: false, barsToFill: 0 });
  });

  it("one bar spans both stop and a target -> stop, ambiguous true", () => {
    // Same bar fills entry (l <= 100), hits stop (h >= 105) AND t1 (l <= 95).
    const bars = [{ h: 106, l: 94 }];
    expect(resolveOutcome(SHORT, bars)).toEqual({ outcome: "stop", ambiguous: true, barsToFill: 0 });
  });

  it("barsToFill records the correct index when entry fills late", () => {
    const bars = [
      { h: 103, l: 101 }, // no fill
      { h: 102, l: 100.5 }, // no fill (l > 100)
      { h: 101, l: 99 },  // fills entry, index 2
      { h: 100, l: 94 },  // hits t1
    ];
    const r = resolveOutcome(SHORT, bars);
    expect(r.barsToFill).toBe(2);
    expect(r.outcome).toBe("t1");
  });
});

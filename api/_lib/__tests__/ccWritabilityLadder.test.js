import { describe, it, expect } from "vitest";
import { pickLadderExpiries } from "../computeCcWritability.js";
import { DTE_LADDER } from "../../../src/lib/ccWritability.js";

/**
 * Ladder expiry selection — "nearest listed expiry to each of 7/14/21/28/35/45/60".
 *
 * The fixture is IREN's real listed expiries around the 2026-08-21 close. Two
 * of the seven targets have no exact listing: 45 lands on 10/02 (42d) and 60 on
 * 10/16 (56d), which is exactly the mapping the spec's §7 table shows. The
 * 10/09 weekly is in the input deliberately — it is the near-miss that a naive
 * "next expiry after target" rule would wrongly pick for 60.
 */
const IREN_EXPIRIES = [
  "2026-08-28", "2026-09-04", "2026-09-11", "2026-09-18",
  "2026-09-25", "2026-10-02", "2026-10-09", "2026-10-16",
  "2026-11-20", "2026-12-18",
];

describe("ladder expiry selection", () => {
  it("reproduces the §7 rung set from IREN's real expiry list", () => {
    const ladder = pickLadderExpiries(IREN_EXPIRIES, "2026-08-21");
    expect(ladder.map(r => r.expiry)).toEqual([
      "2026-08-28", "2026-09-04", "2026-09-11", "2026-09-18",
      "2026-09-25", "2026-10-02", "2026-10-16",
    ]);
    expect(ladder.map(r => r.dte)).toEqual([7, 14, 21, 28, 35, 42, 56]);
    expect(ladder.map(r => r.target_dte)).toEqual(DTE_LADDER);
  });

  it("never double-counts one contract when targets collide", () => {
    // A name with only monthlies: several targets map onto the same expiry.
    const monthliesOnly = ["2026-09-18", "2026-10-16", "2026-11-20"];
    const ladder = pickLadderExpiries(monthliesOnly, "2026-08-21");
    const expiries = ladder.map(r => r.expiry);
    expect(new Set(expiries).size).toBe(expiries.length);
    expect(expiries.length).toBeLessThanOrEqual(monthliesOnly.length);
  });

  it("drops expiries that have already passed", () => {
    const ladder = pickLadderExpiries(["2026-08-14", "2026-08-28"], "2026-08-21");
    expect(ladder.every(r => r.dte > 0)).toBe(true);
    expect(ladder.map(r => r.expiry)).not.toContain("2026-08-14");
  });

  it("returns nothing when there is nothing listed ahead", () => {
    expect(pickLadderExpiries([], "2026-08-21")).toEqual([]);
    expect(pickLadderExpiries(["2026-08-14"], "2026-08-21")).toEqual([]);
  });
});

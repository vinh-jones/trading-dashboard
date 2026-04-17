import { describe, it, expect } from "vitest";
import {
  pickSampleExpiry,
  pickSampleStrike,
  computeCollateral,
} from "../../../api/_radar-sampling.js";

describe("pickSampleExpiry", () => {
  const today = "2026-04-17";

  it("returns null when the list is empty", () => {
    expect(pickSampleExpiry([], today)).toBeNull();
  });

  it("returns exact 30-DTE match when present", () => {
    const expiries = ["2026-05-01", "2026-05-17", "2026-05-29"];
    expect(pickSampleExpiry(expiries, today)).toBe("2026-05-17");
  });

  it("returns the closest expiry within 21–45 DTE", () => {
    const expiries = ["2026-05-12", "2026-05-27"];
    expect(pickSampleExpiry(expiries, today)).toBe("2026-05-12");
  });

  it("returns null when no expiry is within 21–45 DTE", () => {
    const expiries = ["2026-04-20", "2026-06-15"];
    expect(pickSampleExpiry(expiries, today)).toBeNull();
  });

  it("prefers the lower DTE on a tie", () => {
    const expiries = ["2026-05-15", "2026-05-19"];
    expect(pickSampleExpiry(expiries, today)).toBe("2026-05-15");
  });

  it("ignores invalid date strings", () => {
    const expiries = ["not-a-date", "2026-05-17"];
    expect(pickSampleExpiry(expiries, today)).toBe("2026-05-17");
  });
});

describe("pickSampleStrike", () => {
  it("returns null when the list is empty", () => {
    expect(pickSampleStrike([])).toBeNull();
  });

  it("returns the strike with delta closest to 0.30 within the window", () => {
    const strikes = [
      { strike: 70, delta: 0.20 },
      { strike: 72, delta: 0.28 },
      { strike: 74, delta: 0.35 },
      { strike: 76, delta: 0.45 },
    ];
    expect(pickSampleStrike(strikes)).toEqual({ strike: 72, delta: 0.28 });
  });

  it("returns null when no strike is in the 0.25–0.35 window", () => {
    const strikes = [
      { strike: 50, delta: 0.10 },
      { strike: 90, delta: 0.50 },
    ];
    expect(pickSampleStrike(strikes)).toBeNull();
  });

  it("prefers the lower delta on a tie (29 over 31)", () => {
    const strikes = [
      { strike: 75, delta: 0.29 },
      { strike: 72, delta: 0.31 },
    ];
    expect(pickSampleStrike(strikes)).toEqual({ strike: 75, delta: 0.29 });
  });

  it("skips entries missing delta", () => {
    const strikes = [
      { strike: 70, delta: null },
      { strike: 72, delta: undefined },
      { strike: 74, delta: 0.28 },
    ];
    expect(pickSampleStrike(strikes)).toEqual({ strike: 74, delta: 0.28 });
  });

  it("accepts puts with positive-magnitude delta", () => {
    const strikes = [{ strike: 72, delta: 0.28 }];
    expect(pickSampleStrike(strikes)).toEqual({ strike: 72, delta: 0.28 });
  });
});

describe("computeCollateral", () => {
  it("returns strike * 100 for a single contract", () => {
    expect(computeCollateral(72)).toBe(7200);
    expect(computeCollateral(300)).toBe(30000);
  });

  it("returns null for missing or invalid strike", () => {
    expect(computeCollateral(null)).toBeNull();
    expect(computeCollateral(undefined)).toBeNull();
    expect(computeCollateral("not a number")).toBeNull();
  });
});

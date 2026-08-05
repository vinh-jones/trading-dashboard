import { describe, it, expect } from "vitest";
import { isTradingDay, NYSE_HOLIDAYS } from "../../src/lib/orb/calendar.js";

describe("isTradingDay", () => {
  it("accepts an ordinary weekday", () => {
    expect(isTradingDay("2026-08-04")).toBe(true);   // Tuesday
  });

  it("rejects weekends", () => {
    expect(isTradingDay("2026-08-08")).toBe(false);  // Saturday
    expect(isTradingDay("2026-08-09")).toBe(false);  // Sunday
  });

  it("rejects observed holidays", () => {
    expect(isTradingDay("2026-07-03")).toBe(false);  // Jul 4 falls Sat, observed Fri
    expect(isTradingDay("2026-11-26")).toBe(false);  // Thanksgiving
    expect(isTradingDay("2026-04-03")).toBe(false);  // Good Friday
  });

  it("covers 2026 and 2027", () => {
    expect(NYSE_HOLIDAYS.has("2027-12-24")).toBe(true);   // Dec 25 falls Sat
    expect(NYSE_HOLIDAYS.has("2027-07-05")).toBe(true);   // Jul 4 falls Sun
  });

  it("is not fooled by the caller's local timezone", () => {
    // The date string is an ET calendar date. Parsing it as local midnight in a
    // negative-offset zone would roll it back a day and flip the weekday.
    expect(isTradingDay("2026-08-10")).toBe(true);   // Monday
    expect(isTradingDay("2026-08-16")).toBe(false);  // Sunday
  });
});

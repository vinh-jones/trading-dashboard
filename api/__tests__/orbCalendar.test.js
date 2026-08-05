import { describe, it, expect } from "vitest";
import {
  isTradingDay,
  NYSE_HOLIDAYS,
  todayET,
  nowMinutesET,
  isBoxWindow,
  isScanWindow,
  isAfterClose,
  BOX_COMPLETE_MIN,
  WINDOW_END_MIN,
} from "../../src/lib/orb/calendar.js";

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

describe("nowMinutesET", () => {
  it("reflects EDT (UTC-4) after spring-forward", () => {
    // 2026 DST starts Sun Mar 8. Mar 9 is already EDT.
    expect(nowMinutesET(new Date("2026-03-09T13:45:00Z"))).toBe(585); // 09:45 ET
  });

  it("reflects EST (UTC-5) for the same UTC minute in winter", () => {
    // This pair is the whole justification for scheduling the crons wide (to
    // cover both offsets) and gating on ET wall-clock in the handler instead
    // of the cron expression: the identical UTC instant lands an hour earlier
    // in ET outside DST. If this ever breaks, the system runs at the wrong
    // hour for half the year.
    expect(nowMinutesET(new Date("2026-01-05T13:45:00Z"))).toBe(525); // 08:45 ET
  });
});

describe("todayET", () => {
  it("rolls back to the previous ET calendar day late in the UTC evening", () => {
    // 02:00 UTC on Aug 5 is still 22:00 ET on Aug 4 (EDT). Getting this wrong
    // would write a handler's output to the wrong session row overnight.
    expect(todayET(new Date("2026-08-05T02:00:00Z"))).toBe("2026-08-04");
  });
});

describe("isBoxWindow", () => {
  it("is closed one minute before the window opens", () => {
    expect(isBoxWindow(BOX_COMPLETE_MIN - 1)).toBe(false); // 09:44
  });
  it("is open on the first minute inside", () => {
    expect(isBoxWindow(BOX_COMPLETE_MIN)).toBe(true); // 09:45
  });
  it("is open on the last minute inside", () => {
    expect(isBoxWindow(BOX_COMPLETE_MIN + 14)).toBe(true); // 09:59
  });
  it("is closed one minute after the window closes", () => {
    expect(isBoxWindow(BOX_COMPLETE_MIN + 15)).toBe(false); // 10:00
  });
});

describe("isScanWindow", () => {
  it("is closed one minute before the window opens", () => {
    expect(isScanWindow(BOX_COMPLETE_MIN + 4)).toBe(false); // 09:49
  });
  it("is open on the first minute inside", () => {
    expect(isScanWindow(BOX_COMPLETE_MIN + 5)).toBe(true); // 09:50
  });
  it("is open on the last minute inside", () => {
    expect(isScanWindow(WINDOW_END_MIN + 10)).toBe(true); // 11:10
  });
  it("is closed one minute after the window closes", () => {
    expect(isScanWindow(WINDOW_END_MIN + 11)).toBe(false); // 11:11
  });
});

describe("isAfterClose", () => {
  it("is false one minute before the close", () => {
    expect(isAfterClose(16 * 60 - 1)).toBe(false); // 15:59
  });
  it("is true on the first minute after the close", () => {
    expect(isAfterClose(16 * 60)).toBe(true); // 16:00
  });
});

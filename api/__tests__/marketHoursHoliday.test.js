import { describe, it, expect, afterEach, vi } from "vitest";
import { isMarketOpen, isMarketOpenExtended } from "../_marketHours.js";

// 13:35 UTC = 09:35 EDT — the exact cron slot that fired the CDE covered-call
// alert on Labor Day 2026. The date is the whole point of each case; the clock
// is held at a time that is unambiguously inside the regular session.
function atET(iso) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

afterEach(() => vi.useRealTimers());

describe("isMarketOpen", () => {
  it("stays shut on a weekday NYSE holiday", () => {
    atET("2026-09-07T13:35:00Z");   // Labor Day, a Monday
    expect(isMarketOpen()).toBe(false);
    expect(isMarketOpenExtended()).toBe(false);
  });

  it("stays shut on Thanksgiving and Good Friday", () => {
    atET("2026-11-26T15:00:00Z");
    expect(isMarketOpen()).toBe(false);
    atET("2026-04-03T15:00:00Z");
    expect(isMarketOpen()).toBe(false);
  });

  it("opens on the ordinary weekday either side of the holiday", () => {
    atET("2026-09-04T13:35:00Z");   // Friday before Labor Day
    expect(isMarketOpen()).toBe(true);
    atET("2026-09-08T13:35:00Z");   // Tuesday after
    expect(isMarketOpen()).toBe(true);
  });

  it("still rejects weekends", () => {
    atET("2026-09-05T13:35:00Z");   // Saturday
    expect(isMarketOpen()).toBe(false);
  });

  it("holds the session bounds on a trading day", () => {
    atET("2026-09-08T13:29:00Z");   // 09:29 ET — one minute early
    expect(isMarketOpen()).toBe(false);
    expect(isMarketOpenExtended()).toBe(true);   // extended opens 08:30 ET
    atET("2026-09-08T20:01:00Z");   // 16:01 ET — just past the bell
    expect(isMarketOpen()).toBe(false);
    expect(isMarketOpenExtended()).toBe(true);   // extended runs to 16:15 ET
    atET("2026-09-08T20:16:00Z");   // 16:16 ET
    expect(isMarketOpenExtended()).toBe(false);
  });

  it("tracks ET across the DST boundary, not a fixed UTC offset", () => {
    // 14:35 UTC is 09:35 EST in January but 10:35 EDT in September.
    atET("2026-01-05T14:35:00Z");   // Monday, EST
    expect(isMarketOpen()).toBe(true);
    atET("2026-01-05T13:35:00Z");   // 08:35 EST — pre-market
    expect(isMarketOpen()).toBe(false);
  });
});

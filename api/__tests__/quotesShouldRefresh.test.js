import { describe, it, expect } from "vitest";
import { shouldRefresh, STALE_MS } from "../quotes.js";

const MIN = 60 * 1000;

describe("shouldRefresh — refreshes on every 15-min cron cycle", () => {
  // The cron fires every 15 min, but refreshQuotes() stamps quotes_refreshed_at
  // a few seconds-to-a-minute AFTER the cron boundary (network latency). So at
  // the next boundary the age is a hair under 15 min. A 15-min threshold would
  // skip that cycle, stretching the effective cadence to ~30 min. The threshold
  // must sit comfortably below 15 min so a ~14-min-old mark still triggers.
  it("refreshes a 14-min-old mark during market hours", () => {
    expect(shouldRefresh(14 * MIN, { marketOpen: true })).toBe(true);
  });

  it("leaves headroom below the 15-min cron interval", () => {
    expect(STALE_MS).toBeLessThan(15 * MIN);
  });

  it("does not refresh a still-fresh 12-min-old mark", () => {
    expect(shouldRefresh(12 * MIN, { marketOpen: true })).toBe(false);
  });

  it("never refreshes while the market is closed, unless forced", () => {
    expect(shouldRefresh(60 * MIN, { marketOpen: false })).toBe(false);
    expect(shouldRefresh(60 * MIN, { marketOpen: false, forced: true })).toBe(true);
  });
});

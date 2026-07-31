import { describe, it, expect } from "vitest";
import { buildRecognitionLedger } from "../incomeRecognition.js";

// Minimal closed-trade factory. Dates are ISO; premium is net realized dollars.
export function trade(over = {}) {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    ticker: "TEST",
    type: "CSP",
    subtype: "Expired",
    strike: 100,
    contracts: 1,
    open_date: "2026-02-01",
    close_date: "2026-02-20",
    premium_collected: 0,
    description: null,
    ...over,
  };
}

const monthRow = (ledger, month) => ledger.months.find((m) => m.month === month);

describe("buildRecognitionLedger — booked basis", () => {
  it("buckets closed trades into their close_date month", () => {
    const ledger = buildRecognitionLedger([
      trade({ close_date: "2026-02-10", premium_collected: 300 }),
      trade({ close_date: "2026-02-25", premium_collected: 200 }),
      trade({ close_date: "2026-03-04", premium_collected: 150 }),
    ]);
    expect(monthRow(ledger, "2026-02").booked).toBe(500);
    expect(monthRow(ledger, "2026-03").booked).toBe(150);
  });

  it("returns months in ascending order with no gaps skipped", () => {
    const ledger = buildRecognitionLedger([
      trade({ close_date: "2026-03-04", premium_collected: 150 }),
      trade({ close_date: "2026-02-10", premium_collected: 300 }),
    ]);
    expect(ledger.months.map((m) => m.month)).toEqual(["2026-02", "2026-03"]);
  });

  it("ignores trades with no close_date", () => {
    const ledger = buildRecognitionLedger([
      trade({ close_date: null, premium_collected: 999 }),
      trade({ close_date: "2026-02-10", premium_collected: 300 }),
    ]);
    expect(ledger.cumulativeBooked).toBe(300);
  });

  it("distributable equals booked when nothing was assigned", () => {
    const ledger = buildRecognitionLedger([
      trade({ close_date: "2026-02-10", premium_collected: 300 }),
      trade({ type: "CC", subtype: "Close", close_date: "2026-02-14", premium_collected: -80 }),
    ]);
    expect(monthRow(ledger, "2026-02").distributable).toBe(220);
    expect(monthRow(ledger, "2026-02").delta).toBe(0);
    expect(ledger.outstandingDeferred).toBe(0);
  });

  it("returns an empty ledger for no trades", () => {
    const ledger = buildRecognitionLedger([]);
    expect(ledger.months).toEqual([]);
    expect(ledger.cumulativeBooked).toBe(0);
    expect(ledger.cumulativeDistributable).toBe(0);
    expect(ledger.outstandingDeferred).toBe(0);
    expect(ledger.openChains).toEqual([]);
  });
});

// A CSP assigned on `date` for `contracts` contracts, collecting `premium`.
const assign = (over) =>
  trade({ type: "CSP", subtype: "Assigned", ...over });

// A share disposal of `contracts` SHARES on `date`, realizing `premium` P&L.
const sell = (over) =>
  trade({ type: "Shares", subtype: "Sold", ...over });

describe("buildRecognitionLedger — deferral and release", () => {
  it("defers premium while the shares are still held", () => {
    const ledger = buildRecognitionLedger([
      assign({ id: "a1", close_date: "2026-06-19", contracts: 1, strike: 100, premium_collected: 400 }),
    ]);
    expect(monthRow(ledger, "2026-06").booked).toBe(400);
    expect(monthRow(ledger, "2026-06").distributable).toBe(0);
    expect(monthRow(ledger, "2026-06").deferredAdded).toBe(400);
    expect(ledger.outstandingDeferred).toBe(400);
  });

  it("nets to zero change when assignment and disposal share a month", () => {
    const ledger = buildRecognitionLedger([
      assign({ id: "a1", close_date: "2026-06-05", contracts: 1, strike: 100, premium_collected: 400 }),
      sell({ id: "s1", close_date: "2026-06-26", contracts: 100, premium_collected: 250 }),
    ]);
    const june = monthRow(ledger, "2026-06");
    expect(june.booked).toBe(650);
    expect(june.distributable).toBe(650);
    expect(june.delta).toBe(0);
    expect(ledger.outstandingDeferred).toBe(0);
  });

  it("moves premium from the assignment month to the disposal month", () => {
    const ledger = buildRecognitionLedger([
      assign({ id: "a1", close_date: "2026-05-15", contracts: 1, strike: 100, premium_collected: 400 }),
      sell({ id: "s1", close_date: "2026-07-10", contracts: 100, premium_collected: 250 }),
    ]);
    expect(monthRow(ledger, "2026-05").booked).toBe(400);
    expect(monthRow(ledger, "2026-05").distributable).toBe(0);
    expect(monthRow(ledger, "2026-07").booked).toBe(250);
    expect(monthRow(ledger, "2026-07").distributable).toBe(650);
    expect(monthRow(ledger, "2026-07").deferredReleased).toBe(400);
    expect(ledger.outstandingDeferred).toBe(0);
  });

  it("carries outstandingAtMonthEnd across the gap months", () => {
    const ledger = buildRecognitionLedger([
      assign({ id: "a1", close_date: "2026-05-15", contracts: 1, strike: 100, premium_collected: 400 }),
      trade({ id: "x", close_date: "2026-06-10", premium_collected: 100 }),
      sell({ id: "s1", close_date: "2026-07-10", contracts: 100, premium_collected: 250 }),
    ]);
    expect(monthRow(ledger, "2026-05").outstandingAtMonthEnd).toBe(400);
    expect(monthRow(ledger, "2026-06").outstandingAtMonthEnd).toBe(400);
    expect(monthRow(ledger, "2026-07").outstandingAtMonthEnd).toBe(0);
  });

  it("keeps chains on different tickers independent", () => {
    const ledger = buildRecognitionLedger([
      assign({ id: "a1", ticker: "AAA", close_date: "2026-05-15", contracts: 1, strike: 100, premium_collected: 400 }),
      assign({ id: "a2", ticker: "BBB", close_date: "2026-05-16", contracts: 1, strike: 50, premium_collected: 200 }),
      sell({ id: "s1", ticker: "AAA", close_date: "2026-06-10", contracts: 100, premium_collected: 90 }),
    ]);
    expect(monthRow(ledger, "2026-06").deferredReleased).toBe(400);
    expect(ledger.outstandingDeferred).toBe(200);
  });
});

import { describe, it, expect } from "vitest";
import { buildRecognitionLedger } from "../incomeRecognition.js";

const round2 = (n) => +n.toFixed(2);

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

describe("buildRecognitionLedger — partial disposals and edge cases", () => {
  it("releases pro-rata on a partial disposal of a blended pool", () => {
    // 3 assignments → 300 shares, $1,300 pooled. Sell 100 → release 1/3.
    const ledger = buildRecognitionLedger([
      assign({ id: "a1", close_date: "2026-04-10", contracts: 1, strike: 100, premium_collected: 400 }),
      assign({ id: "a2", close_date: "2026-04-17", contracts: 1, strike: 95,  premium_collected: 600 }),
      assign({ id: "a3", close_date: "2026-04-24", contracts: 1, strike: 90,  premium_collected: 300 }),
      sell({ id: "s1", close_date: "2026-05-08", contracts: 100, premium_collected: 120 }),
    ]);
    expect(monthRow(ledger, "2026-04").deferredAdded).toBe(1300);
    expect(monthRow(ledger, "2026-05").deferredReleased).toBeCloseTo(433.33, 2);
    expect(ledger.outstandingDeferred).toBeCloseTo(866.67, 2);
  });

  it("uses the running denominator when an assignment follows a disposal", () => {
    // Assign 100 sh / $400. Sell 50 → release $200, leaving 50 sh / $200.
    // Assign 100 more / $600 → 150 sh / $800. Sell 150 → release the rest.
    const ledger = buildRecognitionLedger([
      assign({ id: "a1", close_date: "2026-03-06", contracts: 1, strike: 100, premium_collected: 400 }),
      sell({ id: "s1", close_date: "2026-04-06", contracts: 50, premium_collected: 60 }),
      assign({ id: "a2", close_date: "2026-05-06", contracts: 1, strike: 90, premium_collected: 600 }),
      sell({ id: "s2", close_date: "2026-06-06", contracts: 150, premium_collected: 210 }),
    ]);
    expect(monthRow(ledger, "2026-04").deferredReleased).toBe(200);
    expect(monthRow(ledger, "2026-06").deferredReleased).toBe(800);
    expect(ledger.outstandingDeferred).toBe(0);
  });

  it("gives the closing disposal the rounding residual so releases sum exactly", () => {
    // $100 across 300 shares does not divide evenly into thirds.
    const ledger = buildRecognitionLedger([
      assign({ id: "a1", close_date: "2026-03-06", contracts: 3, strike: 10, premium_collected: 100 }),
      sell({ id: "s1", close_date: "2026-04-06", contracts: 100, premium_collected: 5 }),
      sell({ id: "s2", close_date: "2026-05-06", contracts: 100, premium_collected: 5 }),
      sell({ id: "s3", close_date: "2026-06-06", contracts: 100, premium_collected: 5 }),
    ]);
    const released = ledger.months.reduce((s, m) => s + m.deferredReleased, 0);
    expect(round2(released)).toBe(100);
    expect(ledger.outstandingDeferred).toBe(0);
  });

  it("lets a direct share purchase dilute the pool without adding premium", () => {
    // CSP assign 100 sh / $400, then buy 100 sh outright booking $50 of P&L.
    // Selling 100 of the 200 releases half the pool — and never the $50.
    const ledger = buildRecognitionLedger([
      assign({ id: "a1", close_date: "2026-03-06", contracts: 1, strike: 100, premium_collected: 400 }),
      trade({ id: "d1", type: "Shares", subtype: "Assigned", close_date: "2026-03-20", contracts: 100, strike: 95, premium_collected: 50 }),
      sell({ id: "s1", close_date: "2026-04-06", contracts: 100, premium_collected: 70 }),
    ]);
    expect(monthRow(ledger, "2026-04").deferredReleased).toBe(200);
    expect(ledger.outstandingDeferred).toBe(200);
  });

  it("defers a negative assignment premium the same way", () => {
    const ledger = buildRecognitionLedger([
      assign({ id: "a1", close_date: "2026-03-06", contracts: 1, strike: 100, premium_collected: -150 }),
      sell({ id: "s1", close_date: "2026-05-06", contracts: 100, premium_collected: 90 }),
    ]);
    expect(monthRow(ledger, "2026-03").distributable).toBe(0);
    expect(monthRow(ledger, "2026-05").distributable).toBe(-60);
    expect(ledger.outstandingDeferred).toBe(0);
  });

  it("holds the invariant across a mixed book", () => {
    const ledger = buildRecognitionLedger([
      assign({ id: "a1", ticker: "AAA", close_date: "2026-03-06", contracts: 2, strike: 100, premium_collected: 700 }),
      trade({ id: "e1", ticker: "AAA", subtype: "Expired", close_date: "2026-03-14", premium_collected: 220 }),
      sell({ id: "s1", ticker: "AAA", close_date: "2026-04-17", contracts: 100, premium_collected: 130 }),
      assign({ id: "a2", ticker: "BBB", close_date: "2026-04-02", contracts: 1, strike: 40, premium_collected: 310 }),
      trade({ id: "c1", ticker: "BBB", type: "CC", subtype: "Close", close_date: "2026-05-09", premium_collected: -75 }),
      trade({ id: "e2", ticker: "CCC", subtype: "Expired", close_date: "2026-05-22", premium_collected: 180 }),
    ]);
    expect(round2(ledger.cumulativeBooked - ledger.cumulativeDistributable))
      .toBe(ledger.outstandingDeferred);
    const chainSum = ledger.openChains.reduce((s, c) => s + c.deferredRemaining, 0);
    expect(round2(chainSum)).toBe(ledger.outstandingDeferred);
  });
});

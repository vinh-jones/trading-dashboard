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

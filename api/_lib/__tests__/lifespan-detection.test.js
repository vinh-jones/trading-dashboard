import { describe, it, expect } from "vitest";
import { detectLifespans, DATA_QUALITY_THRESHOLD } from "../lifespan.js";

// Tests the data-quality-threshold carry-over rule:
// pre-cutoff trades are processed for tickers the user CURRENTLY HOLDS,
// and ignored for tickers with no current holdings.

const cspAssigned = (date, contracts, strike, premium = 100) => ({
  id: `csp-${date}`,
  type: "CSP",
  subtype: "Assigned",
  open_date: date,
  close_date: date,
  contracts,
  strike,
  premium_collected: premium,
});

const sharesSold = (date, contracts, premium = 0) => ({
  id: `ss-${date}`,
  type: "Shares",
  subtype: "Sold",
  open_date: date,
  close_date: date,
  contracts,
  premium_collected: premium,
});

const cc = (date, contracts, strike, premium = 50) => ({
  id: `cc-${date}`,
  type: "CC",
  subtype: "Close",
  open_date: date,
  close_date: date,
  contracts,
  strike,
  premium_collected: premium,
});

describe("detectLifespans — carry-over for currently-held positions", () => {
  it("includes pre-cutoff CSP Assigned for ticker with shares still held", () => {
    // HOOD-shaped: pre-cutoff assignment Nov 21 + post-cutoff Jan 16, both still held
    const trades = [
      cspAssigned("2025-11-21", 3, 121, 927),  // pre-cutoff
      cspAssigned("2026-01-16", 4, 130, 2880), // post-cutoff
    ];
    const lifespans = detectLifespans("HOOD", trades);
    expect(lifespans).toHaveLength(1);
    const l = lifespans[0];
    expect(l.assignment_events).toHaveLength(2);
    expect(l.assignment_events[0].date).toBe("2025-11-21");
    expect(l.assignment_events[0].shares_added).toBe(300);
    expect(l.assignment_events[1].date).toBe("2026-01-16");
    expect(l.assignment_events[1].shares_added).toBe(400);
    expect(l.exit_event).toBeNull();
  });

  it("ignores pre-cutoff CSP Assigned for ticker with currently_held = 0", () => {
    // Pre-cutoff shares were sold pre-cutoff (so currentlyHeld = 0). The
    // pre-cutoff assignment must NOT carry over — existing cutoff behavior
    // is preserved for closed-out positions.
    const trades = [
      cspAssigned("2025-11-21", 3, 52, 774),    // pre-cutoff
      sharesSold("2025-12-15", 300, -10000),    // pre-cutoff disposal of those 300 shares
      cspAssigned("2026-02-20", 10, 52, 3460),  // post-cutoff lifespan starts here
      {
        id: "cc-may-assigned", type: "CC", subtype: "Assigned",
        open_date: "2026-04-29", close_date: "2026-05-08",
        contracts: 10, strike: 52, premium_collected: 1200,
      },
    ];
    // currentlyHeld = +300 - 300 + 1000 - 1000 = 0 → cutoff applies → pre-cutoff
    // trades filtered → only the Feb 20 → May 8 lifespan remains.
    const lifespans = detectLifespans("IREN", trades);
    expect(lifespans).toHaveLength(1);
    expect(lifespans[0].assignment_events).toHaveLength(1);
    expect(lifespans[0].assignment_events[0].date).toBe("2026-02-20");
    expect(lifespans[0].exit_event).not.toBeNull();
    expect(lifespans[0].exit_event.exit_type).toBe("called_away");
  });

  it("NULL contracts on Shares Sold do not reduce held-shares count (treated as P&L adjustment)", () => {
    // HIMS-shaped: pre-cutoff assignment + post-cutoff Shares Sold with NULL contracts.
    // The NULL row is a P&L adjustment, not a real share sale, so currentlyHeld stays 800.
    // Pre-cutoff assignment must therefore carry over.
    const trades = [
      cspAssigned("2025-11-21", 8, 38, 1064),
      {
        id: "ss-feb", type: "Shares", subtype: "Sold",
        open_date: "2026-02-09", close_date: "2026-02-09",
        contracts: null, premium_collected: -16928,
      },
    ];
    const lifespans = detectLifespans("HIMS", trades);
    expect(lifespans).toHaveLength(1);
    const l = lifespans[0];
    expect(l.assignment_events).toHaveLength(1);
    expect(l.assignment_events[0].shares_added).toBe(800);
    // The NULL-contracts Shares Sold becomes a partial_disposition with shares: 0.
    expect(l.partial_dispositions).toHaveLength(1);
    expect(l.partial_dispositions[0].shares).toBe(0);
    expect(l.partial_dispositions[0].disposal_pnl).toBe(-16928);
    expect(l.exit_event).toBeNull();
  });

  it("does not change behavior for tickers with all post-cutoff history", () => {
    // Pure 2026 CRDO-style cycle, untouched by the rule
    const trades = [
      cspAssigned("2026-02-13", 4, 135, 2604),
      cspAssigned("2026-02-20", 2, 135, 1892),
      sharesSold("2026-04-20", 600, 19950),
    ];
    const lifespans = detectLifespans("CRDO", trades);
    expect(lifespans).toHaveLength(1);
    expect(lifespans[0].assignment_events).toHaveLength(2);
    expect(lifespans[0].exit_event).not.toBeNull();
  });

  it("DATA_QUALITY_THRESHOLD constant is unchanged at 2026-01-01", () => {
    // Pinning the constant: the carry-over rule changes filter behavior, but
    // the threshold itself stays put. If this fails, someone moved the cutoff.
    expect(DATA_QUALITY_THRESHOLD).toBe("2026-01-01");
  });
});

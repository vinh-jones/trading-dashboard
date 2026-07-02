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

describe("detectLifespans — CC-Assigned paired with same-day Shares Sold", () => {
  const sharesSoldLot = (date, openDate, contracts, premium, description) => ({
    id: `ss-${date}-${openDate}`,
    type: "Shares", subtype: "Sold",
    open_date: openDate, close_date: date,
    contracts, premium_collected: premium, description,
  });
  const ccAssigned = (date, contracts, strike, premium) => ({
    id: `cca-${date}`, type: "CC", subtype: "Assigned",
    open_date: "2026-06-10", close_date: date,
    contracts, strike, premium_collected: premium,
  });

  it("keeps the CC premium but lets the Shares Sold row drive disposal + P&L", () => {
    // The user logs BOTH a CC Assigned (records the assignment premium) and a
    // per-lot Shares Sold (authoritative for shares + realized appreciation).
    const trades = [
      cspAssigned("2026-01-16", 4, 130, 2880),          // +400
      ccAssigned("2026-07-02", 4, 135, 500),            // premium-only
      sharesSoldLot("2026-07-02", "2026-01-16", 400, 2000, "Shares ($130, 400)"),
    ];
    const [l, ...rest] = detectLifespans("TEST", trades);
    expect(rest).toHaveLength(0);
    expect(l.exit_event).not.toBeNull();
    expect(l.exit_event.exit_type).toBe("called_away");
    expect(l.exit_event.exit_price).toBe(135);          // the CC strike
    expect(l.exit_event.shares_disposed).toBe(400);
    expect(l.exit_event.share_disposal_pnl).toBe(2000); // from Shares Sold, not (strike-basis)
    // CC Assigned premium is retained in cc_history:
    expect(l.cc_history.some((c) => c.id === "cca-2026-07-02")).toBe(true);
  });

  it("a standalone CC Assigned (no same-day Shares Sold) still removes shares and closes", () => {
    const trades = [
      cspAssigned("2026-02-20", 10, 52, 3460),          // +1000
      ccAssigned("2026-05-08", 10, 52, 1200),           // no same-day Shares Sold
    ];
    const [l] = detectLifespans("TEST", trades);
    expect(l.exit_event).not.toBeNull();
    expect(l.exit_event.exit_type).toBe("called_away");
    expect(l.exit_event.shares_disposed).toBe(1000);
  });
});

describe("detectLifespans — cross-cutoff carry + description-count disposal", () => {
  it("carries a pre-cutoff lot held ACROSS the cutoff and closes on in-window disposal", () => {
    // HOOD-shaped: Nov 21 2025 lot held across 2026-01-01, disposed Jul 2 2026.
    // currentlyHeld = 0 (fully closed), but heldAtCutoff = 300 → must carry.
    const trades = [
      cspAssigned("2025-11-21", 3, 121, 900),           // pre-cutoff +300
      cspAssigned("2026-01-16", 4, 130, 2880),          // +400
      {
        id: "ss1", type: "Shares", subtype: "Sold",
        open_date: "2025-11-21", close_date: "2026-07-02",
        contracts: 300, premium_collected: -3300, description: "Shares ($121, 300)",
      },
      {
        id: "ss2", type: "Shares", subtype: "Sold",
        open_date: "2026-01-16", close_date: "2026-07-02",
        contracts: 400, premium_collected: -8000, description: "Shares ($130, 400)",
      },
    ];
    const [l, ...rest] = detectLifespans("HOOD", trades);
    expect(rest).toHaveLength(0);
    expect(l.assignment_events).toHaveLength(2);
    expect(l.assignment_events[0].date).toBe("2025-11-21");
    expect(l.assignment_events.reduce((s, e) => s + e.shares_added, 0)).toBe(700);
    expect(l.exit_event).not.toBeNull();
    expect(l.exit_event.date).toBe("2026-07-02");
  });

  it("resolves share count from the description when the contracts column is NULL", () => {
    // IREN-shaped: pre-cutoff 500 held across the cutoff, sold in-window via a
    // row whose count lives only in the description ("Shares (500, $52)").
    const trades = [
      cspAssigned("2025-11-21", 5, 52, 1370),           // +500 held across cutoff
      {
        id: "ss", type: "Shares", subtype: "Sold",
        open_date: "2025-11-21", close_date: "2026-01-29",
        contracts: null, premium_collected: 4548, description: "Shares (500, $52)",
      },
    ];
    const [l] = detectLifespans("IREN", trades);
    expect(l.exit_event).not.toBeNull();                // 500 in, 500 out → closes
    expect(l.exit_event.shares_disposed).toBe(500);
  });

  it("a count-less adjustment row ('Shares ($38)') still moves zero shares", () => {
    // Guards the NULL-contracts P&L-adjustment rule: no count in the
    // description ⇒ 0 shares ⇒ position stays open.
    const trades = [
      cspAssigned("2025-11-21", 8, 38, 1064),           // +800 still held
      {
        id: "ss", type: "Shares", subtype: "Sold",
        open_date: "2025-11-21", close_date: "2026-02-09",
        contracts: null, premium_collected: -16928, description: "Shares ($38)",
      },
    ];
    const [l] = detectLifespans("HIMS", trades);
    expect(l.exit_event).toBeNull();
    expect(l.partial_dispositions).toHaveLength(1);
    expect(l.partial_dispositions[0].shares).toBe(0);
  });
});

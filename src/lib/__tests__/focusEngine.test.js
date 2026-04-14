import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateFocusItems, categorizeFocusItems } from "../focusEngine";

// Fixture factories — tiny helpers so tests stay readable.
const emptyPositions = () => ({
  open_csps:       [],
  assigned_shares: [],
});

const csp = (overrides = {}) => ({
  ticker:            "AAPL",
  type:              "CSP",
  strike:            180,
  expiry_date:       "2026-04-24",
  open_date:         "2026-04-01",
  contracts:         1,
  premium_collected: 120,
  ...overrides,
});

const cc = (overrides = {}) => ({
  ticker:            "AAPL",
  type:              "CC",
  strike:            190,
  expiry_date:       "2026-04-24",
  open_date:         "2026-04-01",
  contracts:         1,
  premium_collected: 100,
  ...overrides,
});

const assignedShares = (overrides = {}) => ({
  ticker:           "AAPL",
  cost_basis_total: 18000,
  positions:        [{ description: "(100, $180)", fronted: 18000 }],
  active_cc:        null,
  ...overrides,
});

describe("generateFocusItems", () => {
  beforeEach(() => {
    // Freeze clock to 2026-04-14 (Tue) for deterministic DTE math
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 14, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty array when positions are null", () => {
    expect(generateFocusItems(null, {}, null, null)).toEqual([]);
  });

  it("returns empty array for empty portfolio and no account alerts", () => {
    const items = generateFocusItems(emptyPositions(), {}, null, null);
    expect(items).toEqual([]);
  });

  it("fires cash_below_floor when free cash is under the VIX band floor", () => {
    const account = {
      vix_current:        18,      // band 15–20 → floor 20%, ceiling 25%
      free_cash_pct_est:  0.05,    // 5% — well below 20% floor
    };
    const items = generateFocusItems(emptyPositions(), account, null, null);
    const rule = items.find(i => i.rule === "cash_below_floor");
    expect(rule).toBeDefined();
    expect(rule.priority).toBe("P1");
    expect(rule.title).toContain("5%");
    expect(rule.title).toContain("20%");
  });

  it("does not fire cash_below_floor when cash is within band", () => {
    const account = { vix_current: 18, free_cash_pct_est: 0.22 };
    const items = generateFocusItems(emptyPositions(), account, null, null);
    expect(items.find(i => i.rule === "cash_below_floor")).toBeUndefined();
  });

  it("uses liveVix override when provided", () => {
    // At VIX 18 (band 15-20, floor 20%), 12% cash is below-floor → fires.
    // Override liveVix=25 (band 20-25, floor 10%): 12% is above floor → no fire.
    const account = { vix_current: 18, free_cash_pct_est: 0.12 };
    const itemsSnapshot = generateFocusItems(emptyPositions(), account, null, null);
    expect(itemsSnapshot.find(i => i.rule === "cash_below_floor")).toBeDefined();

    const itemsOverride = generateFocusItems(emptyPositions(), account, null, 25);
    expect(itemsOverride.find(i => i.rule === "cash_below_floor")).toBeUndefined();
  });

  it("fires expiring_soon for a CSP that expires within 5 days", () => {
    const positions = {
      open_csps:       [csp({ expiry_date: "2026-04-16" })], // 2d out
      assigned_shares: [],
    };
    const items = generateFocusItems(positions, {}, null, null);
    const rule = items.find(i => i.rule === "expiring_soon");
    expect(rule).toBeDefined();
    expect(rule.priority).toBe("P1"); // ≤2 days → P1
    expect(rule.ticker).toBe("AAPL");
  });

  it("does not fire expiring_soon when DTE > 5", () => {
    const positions = {
      open_csps:       [csp({ expiry_date: "2026-05-01" })], // ~17d
      assigned_shares: [],
    };
    const items = generateFocusItems(positions, {}, null, null);
    expect(items.find(i => i.rule === "expiring_soon")).toBeUndefined();
  });

  it("fires uncovered_shares for assigned shares with no active CC", () => {
    const positions = {
      open_csps:       [],
      assigned_shares: [assignedShares({ active_cc: null })],
    };
    const items = generateFocusItems(positions, {}, null, null);
    const rule = items.find(i => i.rule === "uncovered_shares");
    expect(rule).toBeDefined();
    expect(rule.priority).toBe("P1");
    expect(rule.title).toContain("AAPL");
    expect(rule.title).toContain("100"); // share count surfaced in title
  });

  it("does NOT fire uncovered_shares when an active CC exists", () => {
    const positions = {
      open_csps:       [],
      assigned_shares: [assignedShares({ active_cc: cc() })],
    };
    const items = generateFocusItems(positions, {}, null, null);
    expect(items.find(i => i.rule === "uncovered_shares")).toBeUndefined();
  });

  it("handles the '($price, count)' lot format for share count", () => {
    // Regression — older regex only matched '(count, $price)' format
    const positions = {
      open_csps:       [],
      assigned_shares: [assignedShares({
        positions: [{ description: "($180, 300)", fronted: 54000 }],
        active_cc: null,
      })],
    };
    const items = generateFocusItems(positions, {}, null, null);
    const rule = items.find(i => i.rule === "uncovered_shares");
    expect(rule).toBeDefined();
    expect(rule.title).toContain("300");
  });

  it("fires expiry_cluster when 3+ options share an expiry date", () => {
    const positions = {
      open_csps: [
        csp({ ticker: "AAPL", expiry_date: "2026-05-15" }),
        csp({ ticker: "MSFT", expiry_date: "2026-05-15" }),
        csp({ ticker: "GOOG", expiry_date: "2026-05-15" }),
      ],
      assigned_shares: [],
    };
    const items = generateFocusItems(positions, {}, null, null);
    const rule = items.find(i => i.rule === "expiry_cluster");
    expect(rule).toBeDefined();
    expect(rule.priority).toBe("P3");
  });

  it("does not fire expiry_cluster with only 2 shared expiries", () => {
    const positions = {
      open_csps: [
        csp({ ticker: "AAPL", expiry_date: "2026-05-15" }),
        csp({ ticker: "MSFT", expiry_date: "2026-05-15" }),
      ],
      assigned_shares: [],
    };
    const items = generateFocusItems(positions, {}, null, null);
    expect(items.find(i => i.rule === "expiry_cluster")).toBeUndefined();
  });

  it("sorts by priority (P1 < P2 < P3)", () => {
    const account = { vix_current: 18, free_cash_pct_est: 0.05 }; // P1
    const positions = {
      open_csps: [
        csp({ ticker: "A", expiry_date: "2026-05-15" }),
        csp({ ticker: "B", expiry_date: "2026-05-15" }),
        csp({ ticker: "C", expiry_date: "2026-05-15" }),
      ],
      assigned_shares: [],
    };
    const items = generateFocusItems(positions, account, null, null);
    const priorities = items.map(i => i.priority);
    // P1 (cash_below_floor) should come before P3 (expiry_cluster)
    expect(priorities.indexOf("P1")).toBeLessThan(priorities.indexOf("P3"));
  });
});

describe("categorizeFocusItems", () => {
  it("splits items into focus / watching / info by priority", () => {
    const items = [
      { priority: "P1", rule: "a" },
      { priority: "P2", rule: "b" },
      { priority: "P3", rule: "c" },
      { priority: "P1", rule: "d" },
    ];
    const grouped = categorizeFocusItems(items);
    expect(grouped.focus).toHaveLength(2);
    expect(grouped.watching).toHaveLength(1);
    expect(grouped.info).toHaveLength(1);
  });
});

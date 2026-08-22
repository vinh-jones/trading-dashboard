import { describe, it, expect } from "vitest";
import { generateFocusItems, NOTIFY_RULES } from "../focusEngine.js";

/**
 * The focus-engine side of the CC-writability alert. All of the judgement lives
 * upstream in api/_lib/computeCcWritability.js; these tests pin the contract
 * between the two — specifically that the rule NEVER re-derives push-worthiness
 * and never fires on a payload that has already been marked unpushable.
 */

const EMPTY_POSITIONS = { assigned_shares: [], open_csps: [], open_leaps: [], open_spreads: [] };

function payload(overrides = {}) {
  return {
    per_position: [{
      ticker: "IREN",
      tier: "RED",
      pushable: true,
      push_rung: 28,
      push_copy: "IREN writable — 28d, $50 $1,744 @ 56.8% ann · or $60 $684 @ Δ0.15 keeping $8,000 upside",
      iv_rank: 27.6,
      bb_position: 0.31,
      rungs: [{
        target_dte: 28, expiry: "2026-09-18", dte: 28, strike: 50,
        premium: 1744, ror_annualized: 56.8, delta: 0.32, illiquid: false, suppressed: false,
      }],
      ...overrides,
    }],
  };
}

function itemsFor(cc) {
  return generateFocusItems(EMPTY_POSITIONS, {}, [], null, new Map(), {}, null, cc)
    .filter(i => i.rule === "cc_writable");
}

describe("cc_writable focus rule", () => {
  it("is push-worthy", () => {
    expect(NOTIFY_RULES.cc_writable).toBe(true);
  });

  it("emits one P1 item per pushable RED ticker, keyed on the ticker alone", () => {
    const items = itemsFor(payload());
    expect(items).toHaveLength(1);
    // §4.3: one alert per ticker per crossing. A rung-keyed id would re-fire
    // every time another rung crossed the bar while already RED.
    expect(items[0].id).toBe("cc-writable-IREN");
    expect(items[0].priority).toBe("P1");
    expect(items[0].title).toBe("IREN writable — 28d $50, $1,744, 56.8% ann");
    expect(items[0].detail).toContain("keeping $8,000 upside");
    expect(items[0].detail).toContain("IV rank 28");
    expect(items[0].detail).toContain("bb 0.31");
  });

  it("stays silent when the payload says not pushable", () => {
    // Earnings suppression, the re-arm window, a modeled-only price and an
    // order placed today all arrive as pushable:false. None may fire.
    expect(itemsFor(payload({ pushable: false, push_blocked_reason: "earnings_suppressed" }))).toHaveLength(0);
    expect(itemsFor(payload({ pushable: false, push_blocked_reason: "rearm_window" }))).toHaveLength(0);
    expect(itemsFor(payload({ pushable: false, push_blocked_reason: "modeled_only" }))).toHaveLength(0);
    expect(itemsFor(payload({ pushable: false, push_blocked_reason: "order_placed_today" }))).toHaveLength(0);
  });

  it("stays silent on AMBER — dashboard state only", () => {
    expect(itemsFor(payload({ tier: "AMBER", pushable: false }))).toHaveLength(0);
  });

  it("does nothing at all when the payload is missing", () => {
    expect(itemsFor(null)).toHaveLength(0);
    expect(itemsFor({})).toHaveLength(0);
  });

  it("ranks the richest rate first within P1", () => {
    const two = {
      per_position: [
        { ...payload().per_position[0], ticker: "SLOW",
          rungs: [{ target_dte: 28, expiry: "2026-09-18", dte: 28, strike: 50, premium: 900, ror_annualized: 31.0 }] },
        { ...payload().per_position[0], ticker: "RICH",
          rungs: [{ target_dte: 7, expiry: "2026-08-28", dte: 7, strike: 50, premium: 584, ror_annualized: 76.1 }],
          push_rung: 7 },
      ],
    };
    expect(itemsFor(two).map(i => i.ticker)).toEqual(["RICH", "SLOW"]);
  });
});

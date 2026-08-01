import { describe, it, expect } from "vitest";
import { reclassifyAssignedCsps } from "../parseSheets.js";

// A CSP whose Action cell was left on "Buy to Close" after it actually assigned
// reports twice wrong: its premium realizes as income instead of deferring into
// the share basis, and the lot it created gets synthesized as a direct purchase.
// reclassifyAssignedCsps recovers the classification from the share lot, which
// is the ground truth for whether shares were actually put to him.
//
// Real cases this pins: COHR $350 x1 on 2026-07-17 ($2,310) and CCJ $113 x1 on
// 2026-05-29 ($347), both sitting against a still-open lot at the same price.

const csp = (o) => ({ ticker: "COHR", type: "CSP", subtype: "Close", strike: 350, contracts: 1,
  close_date: "2026-07-17", premium_collected: 2310, exit_cost: 0, ...o });

describe("reclassifyAssignedCsps", () => {
  it("reclassifies a never-bought-back CSP that has a matching open lot", () => {
    const { trades, repaired } = reclassifyAssignedCsps(
      [csp()],
      { COHR: [{ description: "Shares (100, $350)", open_date: "2026-07-17" }] },
      [],
    );
    expect(trades[0].subtype).toBe("Assigned");
    expect(repaired).toHaveLength(1);
  });

  it("leaves a genuine buy-to-close alone even when a lot matches", () => {
    const { trades, repaired } = reclassifyAssignedCsps(
      [csp({ exit_cost: 4.2 })],
      { COHR: [{ description: "Shares (100, $350)", open_date: "2026-07-17" }] },
      [],
    );
    expect(trades[0].subtype).toBe("Close");
    expect(repaired).toHaveLength(0);
  });

  it("tolerates settlement drift but not an unrelated later purchase", () => {
    const near = reclassifyAssignedCsps([csp()],
      { COHR: [{ description: "Shares (100, $350)", open_date: "2026-07-19" }] }, []);
    expect(near.trades[0].subtype).toBe("Assigned");

    const far = reclassifyAssignedCsps([csp()],
      { COHR: [{ description: "Shares (100, $350)", open_date: "2026-09-02" }] }, []);
    expect(far.trades[0].subtype).toBe("Close");
  });

  it("requires the contract count to match the lot's share count", () => {
    // 1 contract = 100 shares; a 400-share lot at the same price is not this put.
    const { trades } = reclassifyAssignedCsps([csp()],
      { COHR: [{ description: "Shares (400, $350)", open_date: "2026-07-17" }] }, []);
    expect(trades[0].subtype).toBe("Close");
  });

  it("leaves HOOD's averaged-price lot untouched — neither price nor count line up", () => {
    const { trades, repaired } = reclassifyAssignedCsps(
      [
        { ticker: "HOOD", type: "CSP", subtype: "Close", strike: 74, contracts: 3, close_date: "2026-05-11", exit_cost: 0 },
        { ticker: "HOOD", type: "CSP", subtype: "Close", strike: 79, contracts: 4, close_date: "2026-05-11", exit_cost: 0 },
      ],
      { HOOD: [{ description: "Shares (400, $80.21)", open_date: "2026-05-11" }] },
      [],
    );
    expect(trades.every(t => t.subtype === "Close")).toBe(true);
    expect(repaired).toHaveLength(0);
  });

  it("matches against a lot that has already been sold", () => {
    const { trades } = reclassifyAssignedCsps([csp()], {},
      [{ ticker: "COHR", type: "Shares", subtype: "Sold",
         description: "Shares (100, $350)", open_date: "2026-07-17", close_date: "2026-07-25" }]);
    expect(trades[0].subtype).toBe("Assigned");
  });

  it("does not touch rows that are already Assigned, or non-CSP rows", () => {
    const { trades, repaired } = reclassifyAssignedCsps(
      [csp({ subtype: "Assigned" }), csp({ type: "CC", subtype: "Close" })],
      { COHR: [{ description: "Shares (100, $350)", open_date: "2026-07-17" }] },
      [],
    );
    expect(trades[0].subtype).toBe("Assigned");
    expect(trades[1].subtype).toBe("Close");
    expect(repaired).toHaveLength(0);
  });

  it("skips rows missing the fields the match depends on", () => {
    const { repaired } = reclassifyAssignedCsps(
      [csp({ strike: null }), csp({ contracts: null }), csp({ close_date: null })],
      { COHR: [{ description: "Shares (100, $350)", open_date: "2026-07-17" }] },
      [],
    );
    expect(repaired).toHaveLength(0);
  });
});

import { describe, it, expect } from "vitest";
import { buildCohortHistory } from "../cohortHistory.js";

const tuple = { ticker: "CCJ", type: "CSP", strike: 107, expiry: "2026-06-26" };
const snapRow = (date, members) => ({ snapshot_date: date, forecast_per_position: members });
const pp = (over = {}) => ({
  ticker: "CCJ", type: "csp", strike: 107, expiry: "2026-06-26",
  current_profit_pct: 0.3, premium_at_open: 500, ...over,
});

describe("buildCohortHistory", () => {
  it("filters each day's per-position array to member tuples, case-insensitive type", () => {
    const out = buildCohortHistory(
      [snapRow("2026-06-01", [pp(), pp({ ticker: "ZZZ" })])],
      [tuple],
    );
    expect(out).toEqual([
      { date: "2026-06-01", members: [{ ticker: "CCJ", type: "csp", strike: 107, expiry: "2026-06-26", current_profit_pct: 0.3, premium_at_open: 500 }] },
    ]);
  });

  it("drops days with no matching members and tolerates null/garbage arrays", () => {
    const out = buildCohortHistory(
      [snapRow("2026-06-01", null), snapRow("2026-06-02", [pp({ ticker: "ZZZ" })]), snapRow("2026-06-03", [pp()])],
      [tuple],
    );
    expect(out.map(d => d.date)).toEqual(["2026-06-03"]);
  });

  it("matches strike loosely (string vs number) and returns [] for no members", () => {
    const out = buildCohortHistory([snapRow("2026-06-01", [pp({ strike: "107" })])], [tuple]);
    expect(out).toHaveLength(1);
    expect(buildCohortHistory([snapRow("2026-06-01", [pp()])], [])).toEqual([]);
  });

  it("excludes rows with a different expiry", () => {
    const out = buildCohortHistory([snapRow("2026-06-01", [pp({ expiry: "2026-07-03" })])], [tuple]);
    expect(out).toEqual([]);
  });

  it("projects missing capture fields as null", () => {
    const out = buildCohortHistory(
      [snapRow("2026-06-01", [pp({ current_profit_pct: undefined, premium_at_open: undefined })])],
      [tuple],
    );
    expect(out[0].members[0]).toMatchObject({ current_profit_pct: null, premium_at_open: null });
  });
});

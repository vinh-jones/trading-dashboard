import { describe, it, expect } from "vitest";
import { buildBreakdownRows } from "../breakdown.js";

const names = (arr) => arr.map(([t, premium, trades]) => ({ ticker: t, premium, trades }));

describe("buildBreakdownRows", () => {
  it("sorts rows by premium descending", () => {
    const { rows } = buildBreakdownRows(
      names([["A", 100, 1], ["B", 300, 2], ["C", 200, 1]]),
      { key: "ticker", countKey: "trades" }
    );
    expect(rows.map((r) => r.label)).toEqual(["B", "C", "A"]);
    expect(rows.every((r) => r.isOther === false)).toBe(true);
  });

  it("computes share % that sums to ~100 when all positive", () => {
    const { rows, total } = buildBreakdownRows(
      names([["A", 250, 1], ["B", 250, 1], ["C", 500, 1]]),
      { key: "ticker", countKey: "trades" }
    );
    expect(total).toBe(1000);
    expect(rows.find((r) => r.label === "C").share).toBeCloseTo(50, 5);
    expect(rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(100, 5);
  });

  it("suppresses share (null) when |total| is below the floor", () => {
    const { rows } = buildBreakdownRows(
      names([["A", 500, 1], ["B", -500, 1]]),
      { key: "ticker", countKey: "trades", minTotalForShare: 1 }
    );
    expect(rows.every((r) => r.share === null)).toBe(true);
  });

  it("caps at N and rolls the rest into a single Other row pinned last", () => {
    const list = names(Array.from({ length: 13 }, (_, i) => [`T${i}`, 1300 - i * 100, 1]));
    const { rows } = buildBreakdownRows(list, { key: "ticker", countKey: "trades", cap: 10 });
    expect(rows).toHaveLength(11);
    const other = rows[rows.length - 1];
    expect(other.isOther).toBe(true);
    expect(other.id).toBe(null);
    expect(other.label).toBe("Other");
    expect(other.groups).toBe(3);
    // Other premium == sum of the 3 smallest (T10=300, T11=200, T12=100)
    expect(other.premium).toBe(600);
    expect(other.count).toBe(3);
  });

  it("keeps a large loss visible instead of hiding it in Other (magnitude cut)", () => {
    // 10 tiny gains + one big loss => 11 groups, cap 10.
    const list = names([
      ...Array.from({ length: 10 }, (_, i) => [`G${i}`, 10 + i, 1]),
      ["BIGLOSS", -5000, 1],
    ]);
    const { rows } = buildBreakdownRows(list, { key: "ticker", countKey: "trades", cap: 10 });
    const labels = rows.map((r) => r.label);
    expect(labels).toContain("BIGLOSS");           // survived the cut
    const other = rows.find((r) => r.isOther);
    expect(other).toBeTruthy();                    // a tiny gain got rolled up instead
    expect(other.premium).toBeGreaterThan(0);
  });

  it("never rolls up when cap is Infinity (type mode)", () => {
    const list = [
      { type: "CSP", premium: 400, count: 5 },
      { type: "CC", premium: 300, count: 3 },
      { type: "LEAPS", premium: 200, count: 2 },
    ];
    const { rows } = buildBreakdownRows(list, { key: "type", countKey: "count" });
    expect(rows.some((r) => r.isOther)).toBe(false);
    expect(rows).toHaveLength(3);
  });

  it("reports maxAbs from the largest magnitude row", () => {
    const { maxAbs } = buildBreakdownRows(
      names([["A", 100, 1], ["B", -900, 1]]),
      { key: "ticker", countKey: "trades" }
    );
    expect(maxAbs).toBe(900);
  });
});

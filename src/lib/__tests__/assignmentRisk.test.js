import { describe, it, expect } from "vitest";
import { computeAssignmentRisk } from "../assignmentRisk";

const base = { expiry: "2026-07-17", today: "2026-07-01" };

describe("computeAssignmentRisk", () => {
  it("none when nothing is wrong", () => {
    const r = computeAssignmentRisk({ ...base, flowSentiment: 0.3, gammaEnv: 0.2, cushionState: "safe" });
    expect(r.level).toBe("none");
    expect(r.factors).toEqual([]);
  });

  it("earnings soon (≤14d) before expiry = high", () => {
    const r = computeAssignmentRisk({ ...base, earningsDate: "2026-07-09" }); // 8d out
    expect(r.earnings_before_expiry).toBe(true);
    expect(r.days_to_earnings).toBe(8);
    expect(r.level).toBe("high");
    expect(r.factors[0].key).toBe("earnings");
    expect(r.factors[0].severity).toBe("high");
  });

  it("earnings before expiry but >14d = med severity → watch", () => {
    const r = computeAssignmentRisk({ ...base, earningsDate: "2026-07-16" }); // 15d out
    expect(r.factors[0].severity).toBe("med");
    expect(r.level).toBe("watch");
  });

  it("earnings after expiry is ignored", () => {
    const r = computeAssignmentRisk({ ...base, earningsDate: "2026-07-25" });
    expect(r.earnings_before_expiry).toBe(false);
    expect(r.factors).toEqual([]);
  });

  it("bearish flow + choppy gamma stack to elevated", () => {
    const r = computeAssignmentRisk({ ...base, flowSentiment: -0.3, gammaEnv: -0.2, cushionState: "safe" });
    expect(r.factors.map((f) => f.key)).toEqual(["flow", "gamma"]); // sorted med, low
    expect(r.level).toBe("elevated");
  });

  it("a single bearish-flow factor is just watch", () => {
    const r = computeAssignmentRisk({ ...base, flowSentiment: -0.3, gammaEnv: 0.1 });
    expect(r.level).toBe("watch");
  });

  it("cushion breach is high on its own", () => {
    const r = computeAssignmentRisk({ ...base, cushionState: "assignment_risk" });
    expect(r.level).toBe("high");
  });

  it("sorts factors by severity (high first)", () => {
    const r = computeAssignmentRisk({
      ...base, earningsDate: "2026-07-05", flowSentiment: -0.3, gammaEnv: -0.2, cushionState: "approaching",
    });
    expect(r.factors[0].severity).toBe("high"); // earnings (4d)
    expect(r.factors.map((f) => f.severity)).toEqual(["high", "med", "med", "low"]);
    expect(r.level).toBe("high");
  });

  it("respects null flow/gamma (no UW data yet)", () => {
    const r = computeAssignmentRisk({ ...base, flowSentiment: null, gammaEnv: null, cushionState: "safe" });
    expect(r.level).toBe("none");
  });

  it("earnings: strike inside the expected move → high", () => {
    // spot 100, ±8% → downside 92; strike 95 is inside → exposed
    const r = computeAssignmentRisk({ ...base, earningsDate: "2026-07-09", expectedMovePct: 8, spot: 100, strike: 95 });
    expect(r.factors[0].severity).toBe("high");
    expect(r.factors[0].label).toMatch(/inside expected ±8% move/);
    expect(r.level).toBe("high");
  });

  it("earnings: strike outside the expected move → low (Ryan's setup)", () => {
    // spot 100, ±8% → downside 92; strike 88 is below it → outside
    const r = computeAssignmentRisk({ ...base, earningsDate: "2026-07-09", expectedMovePct: 8, spot: 100, strike: 88 });
    expect(r.factors[0].severity).toBe("low");
    expect(r.factors[0].label).toMatch(/outside expected ±8% move/);
    expect(r.level).toBe("watch");
  });

  it("earnings without expected-move data falls back to day-based severity", () => {
    const r = computeAssignmentRisk({ ...base, earningsDate: "2026-07-09" }); // 8d, no em
    expect(r.factors[0].severity).toBe("high");
    expect(r.factors[0].label).toMatch(/before expiry/);
  });

  it("high short interest adds a med factor", () => {
    const r = computeAssignmentRisk({ ...base, shortInterestPct: 25, cushionState: "safe" });
    expect(r.factors.find((f) => f.key === "short")?.severity).toBe("med");
    expect(r.factors.find((f) => f.key === "short")?.label).toMatch(/25% of float/);
    expect(r.level).toBe("watch");
  });

  it("low short interest adds nothing", () => {
    const r = computeAssignmentRisk({ ...base, shortInterestPct: 4 });
    expect(r.factors.find((f) => f.key === "short")).toBeUndefined();
  });
});

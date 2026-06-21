import { describe, it, expect } from "vitest";
import { updateFlowState, flowConfirmation, flowDir } from "../flowSmoothing";

describe("flowDir", () => {
  it("classifies by threshold", () => {
    expect(flowDir(0.3)).toBe(1);
    expect(flowDir(-0.3)).toBe(-1);
    expect(flowDir(0.1)).toBe(0);
    expect(flowDir(null)).toBe(0);
  });
});

describe("updateFlowState — intraday EMA", () => {
  it("seeds the EMA on the first reading of a day", () => {
    const s = updateFlowState({ raw: 0.5, today: "2026-06-22", prevEma: null, prevDay: null, prevStreak: 0 });
    expect(s.flow_ema).toBe(0.5);
    expect(s.flow_day).toBe("2026-06-22");
    expect(s.flow_streak).toBe(0); // cold start: no prior day to finalize
  });

  it("blends within the same day (newest weighted by alpha)", () => {
    const s = updateFlowState({ raw: 0.0, today: "2026-06-22", prevEma: 0.5, prevDay: "2026-06-22", prevStreak: 0 });
    expect(s.flow_ema).toBeCloseTo(0.35, 5); // 0.3*0 + 0.7*0.5
    expect(s.flow_day).toBe("2026-06-22");
  });

  it("carries state forward when raw is null (no flow data this run)", () => {
    const s = updateFlowState({ raw: null, today: "2026-06-22", prevEma: 0.4, prevDay: "2026-06-22", prevStreak: 2 });
    expect(s).toEqual({ flow_ema: 0.4, flow_day: "2026-06-22", flow_streak: 2 });
  });
});

describe("updateFlowState — daily streak", () => {
  it("finalizes yesterday's bullish EMA into the streak on a new day", () => {
    const s = updateFlowState({ raw: 0.3, today: "2026-06-23", prevEma: 0.4, prevDay: "2026-06-22", prevStreak: 1 });
    expect(s.flow_streak).toBe(2); // prior +1, yesterday bullish → +1
    expect(s.flow_ema).toBe(0.3);  // reseeded for the new day
    expect(s.flow_day).toBe("2026-06-23");
  });

  it("flips the streak when yesterday closed the other way", () => {
    const s = updateFlowState({ raw: -0.3, today: "2026-06-23", prevEma: -0.4, prevDay: "2026-06-22", prevStreak: 2 });
    expect(s.flow_streak).toBe(-1); // bullish streak broken by a bearish close
  });

  it("a neutral close resets the streak to 0", () => {
    const s = updateFlowState({ raw: 0.3, today: "2026-06-23", prevEma: 0.05, prevDay: "2026-06-22", prevStreak: 3 });
    expect(s.flow_streak).toBe(0);
  });
});

describe("flowConfirmation — EMA + streak must agree", () => {
  it("confirms bullish only with both EMA in-direction and streak ≥ N", () => {
    expect(flowConfirmation({ flowEma: 0.4, flowStreak: 2 }).bullish).toBe(true);
    expect(flowConfirmation({ flowEma: 0.4, flowStreak: 1 }).bullish).toBe(false); // streak too short
    expect(flowConfirmation({ flowEma: 0.1, flowStreak: 3 }).bullish).toBe(false); // EMA not bullish
  });

  it("confirms bearish symmetrically", () => {
    expect(flowConfirmation({ flowEma: -0.4, flowStreak: -2 }).bearish).toBe(true);
    expect(flowConfirmation({ flowEma: -0.4, flowStreak: -1 }).bearish).toBe(false);
  });

  it("null-safe (no flow data yet → not confirmed)", () => {
    expect(flowConfirmation({ flowEma: null, flowStreak: 0 })).toEqual({ bullish: false, bearish: false });
    expect(flowConfirmation({})).toEqual({ bullish: false, bearish: false });
  });
});

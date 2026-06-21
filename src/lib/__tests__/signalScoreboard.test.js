import { describe, it, expect } from "vitest";
import { computeScoreboard } from "../signalScoreboard";

describe("computeScoreboard", () => {
  it("is null-safe / empty", () => {
    const s = computeScoreboard([]);
    expect(s.position_days).toBe(0);
    expect(s.distinct_positions).toBe(0);
    expect(s.counts.rule_close).toBe(0);
    expect(s.held_past_rule_days).toBe(0);
  });

  it("counts distinct positions per notable state and risk level", () => {
    const rows = [
      { logged_date: "2026-06-21", position_key: "A", overlay_state: "let_it_ride", assignment_level: "none" },
      { logged_date: "2026-06-21", position_key: "B", overlay_state: "shed",        assignment_level: "elevated" },
      { logged_date: "2026-06-22", position_key: "B", overlay_state: "shed",        assignment_level: "high" },
    ];
    const s = computeScoreboard(rows);
    expect(s.position_days).toBe(3);
    expect(s.distinct_positions).toBe(2);
    expect(s.counts.let_it_ride).toBe(1);
    expect(s.counts.shed).toBe(1);           // B counted once though it fired twice
    expect(s.counts.risk_elevated).toBe(1);
    expect(s.counts.risk_high).toBe(1);
  });

  it("measures days held past rule_close (the drift metric)", () => {
    const rows = [
      // Position C: rule_close fires day 1, still logged days 2-3 → held 2 days past.
      { logged_date: "2026-06-20", position_key: "C", overlay_state: "rule_close" },
      { logged_date: "2026-06-21", position_key: "C", overlay_state: "rule_close" },
      { logged_date: "2026-06-22", position_key: "C", overlay_state: "watch" },
      // Position D: rule_close only on its last logged day → 0 held past (acted).
      { logged_date: "2026-06-22", position_key: "D", overlay_state: "rule_close" },
    ];
    const s = computeScoreboard(rows);
    expect(s.rule_close_positions).toBe(2);
    expect(s.held_past_rule_days).toBe(2); // C contributes 2, D contributes 0
  });
});

import { describe, it, expect } from "vitest";
import { groupByWeek, weekLabel } from "../journalGrouping";

describe("groupByWeek", () => {
  it("returns empty array for empty input", () => {
    expect(groupByWeek([])).toEqual([]);
  });

  it("groups a single entry into one week with one day", () => {
    const entries = [{ id: 1, entry_date: "2026-04-17" }];
    const result = groupByWeek(entries);
    expect(result).toHaveLength(1);
    expect(result[0].days).toHaveLength(1);
    expect(result[0].days[0].date).toBe("2026-04-17");
    expect(result[0].days[0].entries).toHaveLength(1);
  });

  it("groups entries from the same day under one day bucket", () => {
    const entries = [
      { id: 1, entry_date: "2026-04-17" },
      { id: 2, entry_date: "2026-04-17" },
    ];
    const result = groupByWeek(entries);
    expect(result[0].days).toHaveLength(1);
    expect(result[0].days[0].entries).toHaveLength(2);
  });

  it("splits across weeks at Sunday boundary", () => {
    // Apr 12 2026 is a Sunday (start of a new week).
    // Apr 11 2026 is a Saturday (end of previous week).
    const entries = [
      { id: 1, entry_date: "2026-04-12" },  // new week
      { id: 2, entry_date: "2026-04-11" },  // previous week
    ];
    const result = groupByWeek(entries);
    expect(result).toHaveLength(2);
  });

  it("sorts weeks newest-first and days within a week newest-first", () => {
    const entries = [
      { id: 1, entry_date: "2026-04-10" },  // older week
      { id: 2, entry_date: "2026-04-17" },  // newer week (Fri)
      { id: 3, entry_date: "2026-04-15" },  // newer week (Wed)
    ];
    const result = groupByWeek(entries);
    expect(result).toHaveLength(2);
    expect(result[0].days[0].date).toBe("2026-04-17");
    expect(result[0].days[1].date).toBe("2026-04-15");
    expect(result[1].days[0].date).toBe("2026-04-10");
  });

  it("reports weekStart (Sunday) and weekEnd (Saturday) for each group", () => {
    const entries = [{ id: 1, entry_date: "2026-04-17" }];  // Friday
    const result = groupByWeek(entries);
    expect(result[0].weekStart).toBe("2026-04-12");
    expect(result[0].weekEnd).toBe("2026-04-18");
  });

  it("preserves entry order within a day (as passed in)", () => {
    const entries = [
      { id: "a", entry_date: "2026-04-17" },
      { id: "b", entry_date: "2026-04-17" },
      { id: "c", entry_date: "2026-04-17" },
    ];
    const result = groupByWeek(entries);
    expect(result[0].days[0].entries.map(e => e.id)).toEqual(["a", "b", "c"]);
  });
});

describe("weekLabel", () => {
  it("returns 'This Week' when today is inside the week", () => {
    expect(weekLabel("2026-04-12", "2026-04-17")).toBe("This Week");
  });

  it("returns 'Last Week' for the preceding week", () => {
    expect(weekLabel("2026-04-05", "2026-04-17")).toBe("Last Week");
  });

  it("returns '2 weeks ago' for two-weeks-back", () => {
    expect(weekLabel("2026-03-29", "2026-04-17")).toBe("2 weeks ago");
  });

  it("returns 'Week of MMM DD' for three-or-more weeks back", () => {
    expect(weekLabel("2026-03-22", "2026-04-17")).toBe("Week of Mar 22");
  });
});

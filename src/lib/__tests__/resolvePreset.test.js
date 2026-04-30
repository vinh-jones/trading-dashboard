import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolvePreset } from "../resolvePreset";

// Pin system clock to 2026-04-30 noon for deterministic results
const FIXED = new Date("2026-04-30T12:00:00");

describe("resolvePreset", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ytd: start is Jan 1 of current year, end is end of today", () => {
    const [start, end] = resolvePreset("ytd", null);
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(0);   // January
    expect(start.getDate()).toBe(1);
    expect(start.getHours()).toBe(0);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
  });

  it("1m: start is 30 days before today at midnight", () => {
    const [start, end] = resolvePreset("1m", null);
    const expected = new Date("2026-03-31T00:00:00");
    expect(start.getFullYear()).toBe(expected.getFullYear());
    expect(start.getMonth()).toBe(expected.getMonth());
    expect(start.getDate()).toBe(expected.getDate());
    expect(start.getHours()).toBe(0);
    expect(end.getHours()).toBe(23);
  });

  it("3m: start is 90 days before today at midnight", () => {
    const [start] = resolvePreset("3m", null);
    const expected = new Date(FIXED);
    expected.setDate(expected.getDate() - 90);
    expect(start.getDate()).toBe(expected.getDate());
    expect(start.getMonth()).toBe(expected.getMonth());
    expect(start.getHours()).toBe(0);
  });

  it("1y: start is one year before today at midnight", () => {
    const [start] = resolvePreset("1y", null);
    expect(start.getFullYear()).toBe(2025);
    expect(start.getMonth()).toBe(3); // April
    expect(start.getDate()).toBe(30);
    expect(start.getHours()).toBe(0);
  });

  it("all: start is Unix epoch", () => {
    const [start] = resolvePreset("all", null);
    expect(start.getTime()).toBe(0);
  });

  it("custom: uses customRange.start as-is, sets end to 23:59:59 of customRange.end", () => {
    const customRange = {
      start: new Date("2026-01-15T00:00:00"),
      end:   new Date("2026-03-31T00:00:00"),
    };
    const [start, end] = resolvePreset("custom", customRange);
    expect(start.getTime()).toBe(customRange.start.getTime());
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(2);   // March
    expect(end.getDate()).toBe(31);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
  });

  it("custom with null customRange falls back to ytd behavior", () => {
    const [start] = resolvePreset("custom", null);
    expect(start.getMonth()).toBe(0);
    expect(start.getDate()).toBe(1);
  });

  it("unknown preset falls back to ytd behavior", () => {
    const [start] = resolvePreset("bogus", null);
    expect(start.getMonth()).toBe(0);
    expect(start.getDate()).toBe(1);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  parseLocalDate,
  parseThousands,
  parseShareCount,
  buildOccSymbol,
  calcDTE,
  allocColor,
  computeEodMetadata,
} from "../trading";
import { theme } from "../theme";

describe("parseLocalDate", () => {
  it("returns null for null/undefined", () => {
    expect(parseLocalDate(null)).toBeNull();
    expect(parseLocalDate(undefined)).toBeNull();
  });

  it("parses a YYYY-MM-DD string to a Date at local noon", () => {
    const d = parseLocalDate("2026-04-14");
    expect(d).toBeInstanceOf(Date);
    expect(d.getHours()).toBe(12); // local noon — not midnight UTC
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3);  // April = month index 3
    expect(d.getDate()).toBe(14);
  });
});

describe("parseThousands", () => {
  it("returns 0 for null/undefined/empty", () => {
    expect(parseThousands(null)).toBe(0);
    expect(parseThousands(undefined)).toBe(0);
    expect(parseThousands("")).toBe(0);
  });

  it("parses plain integers", () => {
    expect(parseThousands("100")).toBe(100);
    expect(parseThousands("0")).toBe(0);
  });

  it("parses comma-separated integers", () => {
    expect(parseThousands("1,234")).toBe(1234);
    expect(parseThousands("1,000,000")).toBe(1000000);
  });

  it("handles negative numbers", () => {
    expect(parseThousands("-1,234")).toBe(-1234);
  });

  it("returns 0 when no digits are present", () => {
    expect(parseThousands("abc")).toBe(0);
  });
});

describe("parseShareCount", () => {
  it("returns 0 for null/empty", () => {
    expect(parseShareCount(null)).toBe(0);
    expect(parseShareCount("")).toBe(0);
  });

  it("parses '(100, $530)' format — count before price", () => {
    expect(parseShareCount("(100, $530)")).toBe(100);
  });

  it("parses '($121, 300)' format — price before count", () => {
    expect(parseShareCount("($121, 300)")).toBe(300);
  });

  it("handles thousands separators in share count", () => {
    expect(parseShareCount("(1,500, $100)")).toBe(1500);
  });

  it("ignores decimals inside dollar amounts", () => {
    expect(parseShareCount("($12.50, 400)")).toBe(400);
  });
});

describe("buildOccSymbol", () => {
  it("builds a canonical OCC symbol for a put", () => {
    expect(buildOccSymbol("AAPL", "2026-05-01", false, 180)).toBe("AAPL260501P00180000");
  });

  it("builds a canonical OCC symbol for a call", () => {
    expect(buildOccSymbol("AAPL", "2026-05-01", true, 180)).toBe("AAPL260501C00180000");
  });

  it("handles fractional strikes (e.g. 12.50)", () => {
    expect(buildOccSymbol("XYZ", "2026-12-19", false, 12.5)).toBe("XYZ261219P00012500");
  });

  it("left-pads small strikes", () => {
    expect(buildOccSymbol("F", "2026-06-19", true, 15)).toBe("F260619C00015000");
  });
});

describe("calcDTE", () => {
  beforeEach(() => {
    // Freeze clock to 2026-04-14 noon local for deterministic math
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 14, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null for null input", () => {
    expect(calcDTE(null)).toBeNull();
    expect(calcDTE(undefined)).toBeNull();
  });

  it("returns 0 for today", () => {
    expect(calcDTE("2026-04-14")).toBe(0);
  });

  it("returns positive days for a future expiry", () => {
    expect(calcDTE("2026-04-21")).toBe(7);
  });

  it("clamps past expiries to 0 (never negative)", () => {
    expect(calcDTE("2026-04-01")).toBe(0);
  });
});

describe("allocColor", () => {
  it("returns red at/above 15% allocation (hard ceiling)", () => {
    expect(allocColor(0.15)).toBe(theme.red);
    expect(allocColor(0.25)).toBe(theme.red);
  });

  it("returns amber between 10% and 15%", () => {
    expect(allocColor(0.10)).toBe(theme.amber);
    expect(allocColor(0.149)).toBe(theme.amber);
  });

  it("returns muted below 10%", () => {
    expect(allocColor(0.05)).toBe(theme.text.muted);
    expect(allocColor(0)).toBe(theme.text.muted);
  });
});

describe("computeEodMetadata", () => {
  it("computes floor status 'within' when cash is inside the band", () => {
    // VIX 18 → band 15–20: floor 0.20, ceiling 0.25
    const m = computeEodMetadata({
      freeCashPct: 22, vix: 18,
      pipelineTotal: 5000, mtdRealized: 12000,
      activity: null, cspSnapshot: null,
    });
    expect(m.floor_status).toBe("within");
    expect(m.floor_delta).toBeNull();
    expect(m.floor_band_low).toBe(20);
    expect(m.floor_band_high).toBe(25);
  });

  it("computes floor status 'below' when cash is under the floor", () => {
    const m = computeEodMetadata({
      freeCashPct: 10, vix: 18,
      pipelineTotal: null, mtdRealized: null,
      activity: null, cspSnapshot: null,
    });
    expect(m.floor_status).toBe("below");
    expect(m.floor_delta).toBeCloseTo(0.10, 3); // 0.20 - 0.10
  });

  it("computes floor status 'above' when cash is over the ceiling", () => {
    const m = computeEodMetadata({
      freeCashPct: 40, vix: 18,
      pipelineTotal: null, mtdRealized: null,
      activity: null, cspSnapshot: null,
    });
    expect(m.floor_status).toBe("above");
    expect(m.floor_delta).toBeCloseTo(0.15, 3); // 0.40 - 0.25
  });

  it("returns null floor_status when VIX is missing", () => {
    const m = computeEodMetadata({
      freeCashPct: 20, vix: null,
      pipelineTotal: null, mtdRealized: null,
      activity: null, cspSnapshot: null,
    });
    expect(m.floor_status).toBeNull();
    expect(m.floor_band_low).toBeNull();
  });

  it("computes pipeline_est as 60% of pipeline_total", () => {
    const m = computeEodMetadata({
      freeCashPct: 22, vix: 18,
      pipelineTotal: 10000, mtdRealized: null,
      activity: null, cspSnapshot: null,
    });
    expect(m.pipeline_total).toBe(10000);
    expect(m.pipeline_est).toBe(6000);
  });

  it("defaults activity to empty arrays", () => {
    const m = computeEodMetadata({
      freeCashPct: null, vix: null,
      pipelineTotal: null, mtdRealized: null,
      activity: null, cspSnapshot: null,
    });
    expect(m.activity).toEqual({ closed: [], opened: [] });
    expect(m.csp_snapshot).toEqual([]);
  });
});

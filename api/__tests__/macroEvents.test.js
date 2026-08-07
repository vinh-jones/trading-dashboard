import { describe, it, expect } from "vitest";
import { classifyEvent, normalizeEvents, MACRO_EVENT_TYPES } from "../_lib/macroEvents.js";
import fixture from "../_lib/__fixtures__/uw-economic-calendar.json";

describe("classifyEvent", () => {
  it("matches the headline print for each confirmed type", () => {
    expect(classifyEvent("Consumer price index")).toBe("CPI");
    expect(classifyEvent("Producer price index")).toBe("PPI");
    expect(classifyEvent("U.S. employment report")).toBe("NFP");
    expect(classifyEvent("U.S. retail sales")).toBe("RETAIL_SALES");
  });

  it("rejects the core/YoY/MoM variants UW emits alongside the headline", () => {
    // UW returns four CPI rows for one release. Only the headline may survive,
    // or the calendar shows the same event four times.
    expect(classifyEvent("Core CPI")).toBeNull();
    expect(classifyEvent("CPI year over year")).toBeNull();
    expect(classifyEvent("Core CPI year over year")).toBeNull();
    expect(classifyEvent("Core PPI")).toBeNull();
    expect(classifyEvent("PPI year over year")).toBeNull();
    expect(classifyEvent("Retail sales minus autos")).toBeNull();
  });

  it("rejects unrelated low-signal releases", () => {
    expect(classifyEvent("Wholesale inventories")).toBeNull();
    expect(classifyEvent("NFIB optimism index")).toBeNull();
    expect(classifyEvent("Business inventories")).toBeNull();
    expect(classifyEvent("Initial jobless claims")).toBeNull();
  });

  it("is case- and whitespace-insensitive", () => {
    expect(classifyEvent("  CONSUMER PRICE INDEX  ")).toBe("CPI");
  });

  it("returns null for junk input", () => {
    expect(classifyEvent(null)).toBeNull();
    expect(classifyEvent("")).toBeNull();
    expect(classifyEvent(123)).toBeNull();
  });

  it("matches the speculative PCE and FOMC spellings", () => {
    // UW had neither event in the captured window, so these names are unverified
    // against real data — that risk is accepted. What IS testable is that the
    // alternations we wrote actually work.
    expect(classifyEvent("PCE index")).toBe("PCE");
    expect(classifyEvent("Personal consumption expenditures")).toBe("PCE");
    expect(classifyEvent("Personal consumption expenditure price index")).toBe("PCE");
    expect(classifyEvent("FOMC announcement")).toBe("FOMC");
    expect(classifyEvent("FOMC rate decision")).toBe("FOMC");
    expect(classifyEvent("Fed interest-rate decision")).toBe("FOMC");
    expect(classifyEvent("Fed interest rate decision")).toBe("FOMC");
  });

  it("rejects near-misses of the speculative spellings", () => {
    expect(classifyEvent("Core PCE")).toBeNull();
    expect(classifyEvent("FOMC minutes")).toBeNull();
    expect(classifyEvent("FOMC meeting begins")).toBeNull();
  });
});

describe("normalizeEvents", () => {
  const now = "2026-08-07T12:00:00.000Z";

  it("keeps only whitelisted headline events", () => {
    const rows = normalizeEvents([
      { time: "2026-08-12T12:30:00Z", event: "Consumer price index", prev: "-0.4%", forecast: "0.2%" },
      { time: "2026-08-12T12:30:00Z", event: "Core CPI",             prev: "0.0%",  forecast: null },
      { time: "2026-08-11T10:00:00Z", event: "NFIB optimism index",  prev: null,    forecast: null },
    ], now);

    expect(rows).toEqual([{
      event_date:   "2026-08-12",
      event_type:   "CPI",
      event_time:   "2026-08-12T12:30:00Z",
      title:        "Consumer price index",
      forecast:     "0.2%",
      previous:     "-0.4%",
      refreshed_at: now,
    }]);
  });

  it("dates events by New York calendar day, not UTC", () => {
    // 2026-08-13T00:30:00Z is 8:30pm ET on 08-12. Market logic is ET.
    const [row] = normalizeEvents(
      [{ time: "2026-08-13T00:30:00Z", event: "U.S. retail sales" }],
      now,
    );
    expect(row.event_date).toBe("2026-08-12");
  });

  it("keeps the earliest row when one type appears twice on a date", () => {
    // The table PK is (event_date, event_type); emitting both would fail the insert.
    const rows = normalizeEvents([
      { time: "2026-08-12T18:00:00Z", event: "Consumer price index", prev: "b" },
      { time: "2026-08-12T12:30:00Z", event: "Consumer price index", prev: "a" },
    ], now);
    expect(rows).toHaveLength(1);
    expect(rows[0].previous).toBe("a");
  });

  it("coerces forecast and previous to strings or null", () => {
    const [row] = normalizeEvents(
      [{ time: "2026-08-12T12:30:00Z", event: "Consumer price index", prev: 330.21, forecast: undefined }],
      now,
    );
    expect(row.previous).toBe("330.21");
    expect(row.forecast).toBeNull();
  });

  it("skips rows with no usable timestamp rather than writing a null date", () => {
    expect(normalizeEvents([{ time: null, event: "Consumer price index" }], now)).toEqual([]);
  });

  it("returns [] for junk input", () => {
    expect(normalizeEvents(null, now)).toEqual([]);
    expect(normalizeEvents({}, now)).toEqual([]);
  });

  it("exposes exactly the six whitelisted types", () => {
    expect([...MACRO_EVENT_TYPES].sort()).toEqual(
      ["CPI", "FOMC", "NFP", "PCE", "PPI", "RETAIL_SALES"],
    );
  });
});

describe("against the captured UW fixture", () => {
  const rows = normalizeEvents(fixture, "2026-08-07T12:00:00.000Z");

  it("classifies exactly the four headline events in the captured window", () => {
    // Frozen fixture — pinning the exact result is deliberate. A weaker
    // "length > 0" check only fires when every type vanishes at once, so a
    // single UW rename would slip through silently.
    expect(rows.map(r => `${r.event_date}|${r.event_type}`)).toEqual([
      "2026-08-07|NFP",
      "2026-08-12|CPI",
      "2026-08-13|PPI",
      "2026-08-14|RETAIL_SALES",
    ]);
  });

  it("emits only whitelisted types", () => {
    for (const r of rows) expect(MACRO_EVENT_TYPES).toContain(r.event_type);
  });

  it("emits at most one row per (date, type)", () => {
    const keys = rows.map(r => `${r.event_date}|${r.event_type}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("emits a well-formed date for every row", () => {
    for (const r of rows) expect(r.event_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

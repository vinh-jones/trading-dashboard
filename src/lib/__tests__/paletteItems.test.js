import { describe, it, expect } from "vitest";
import { buildPaletteItems, filterPaletteItems } from "../paletteItems";

describe("buildPaletteItems", () => {
  it("returns pinned actions first when no positions", () => {
    const out = buildPaletteItems({ positions: null });
    expect(out.every(it => it.pinned)).toBe(true);
    expect(out.map(it => it.action)).toEqual(expect.arrayContaining([
      "open_journal", "new_eod_entry", "open_radar", "open_macro",
    ]));
  });

  it("emits one item per open CSP", () => {
    const positions = {
      open_csps:  [{ ticker: "NVDA", strike: 485, expiry_date: "2026-05-01" }],
      open_leaps: [], assigned_shares: [], open_spreads: [],
    };
    const out = buildPaletteItems({ positions });
    const csp = out.find(it => it.kind === "position" && it.payload?.ticker === "NVDA");
    expect(csp).toBeTruthy();
    expect(csp.title).toBe("NVDA CSP $485");
  });

  it("emits items for active CCs on assigned shares", () => {
    const positions = {
      open_csps: [],
      open_leaps: [],
      open_spreads: [],
      assigned_shares: [{
        ticker: "AAPL",
        active_cc: { strike: 185, expiry_date: "2026-05-15" },
      }],
    };
    const out = buildPaletteItems({ positions });
    const cc = out.find(it => it.kind === "position" && it.title.startsWith("AAPL CC"));
    expect(cc).toBeTruthy();
    expect(cc.title).toBe("AAPL CC $185");
  });

  it("emits items for LEAPs (top-level and nested)", () => {
    const positions = {
      open_csps: [],
      open_spreads: [],
      open_leaps: [{ ticker: "SPY", strike: 400, expiry_date: "2027-01-15" }],
      assigned_shares: [{
        ticker: "AAPL",
        open_leaps: [{ strike: 150, expiry_date: "2027-06-18" }],
      }],
    };
    const out = buildPaletteItems({ positions });
    const leaps = out.filter(it => it.title.includes("LEAP"));
    expect(leaps.map(it => it.title).sort()).toEqual(["AAPL LEAP $150", "SPY LEAP $400"]);
  });

  it("pinned items always come first in the returned order", () => {
    const positions = {
      open_csps: [{ ticker: "A", strike: 1, expiry_date: "2026-05-01" }],
      open_leaps: [], assigned_shares: [], open_spreads: [],
    };
    const out = buildPaletteItems({ positions });
    const firstNonPinnedIdx = out.findIndex(it => !it.pinned);
    expect(firstNonPinnedIdx).toBeGreaterThan(-1);
    expect(out.slice(0, firstNonPinnedIdx).every(it => it.pinned)).toBe(true);
  });
});

describe("filterPaletteItems", () => {
  const items = [
    { id: "a", kind: "action",   title: "Open Journal",     pinned: true,  action: "open_journal" },
    { id: "b", kind: "action",   title: "New EOD entry",    pinned: true,  action: "new_eod_entry" },
    { id: "c", kind: "position", title: "NVDA CSP $485", subtitle: "12 DTE", action: "open_position" },
    { id: "d", kind: "position", title: "TSLA CC $210",  subtitle: "8 DTE",  action: "open_position" },
  ];

  it("empty query returns all items in original order", () => {
    expect(filterPaletteItems(items, "")).toEqual(items);
    expect(filterPaletteItems(items, "   ")).toEqual(items);
  });

  it("filters by title substring (case-insensitive)", () => {
    const out = filterPaletteItems(items, "nvda");
    expect(out.map(it => it.id)).toEqual(["c"]);
  });

  it("matches subtitle as well as title", () => {
    const out = filterPaletteItems(items, "12 DTE");
    expect(out.map(it => it.id)).toEqual(["c"]);
  });

  it("matches on each whitespace-separated token independently (AND)", () => {
    const out = filterPaletteItems(items, "csp nvda");
    expect(out.map(it => it.id)).toEqual(["c"]);
    const miss = filterPaletteItems(items, "csp tsla");
    expect(miss).toEqual([]);
  });

  it("when searching, pinned actions are included only when they match", () => {
    const out = filterPaletteItems(items, "journal");
    expect(out.map(it => it.id)).toEqual(["a"]);
  });
});

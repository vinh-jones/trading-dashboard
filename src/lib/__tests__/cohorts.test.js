import { describe, it, expect } from "vitest";
import { slugifyCohortName, resolveCohort } from "../cohorts";

const entry = (ticker, strike, expiry, tags, extra = {}) => ({
  id: `e-${ticker}-${strike}`, ticker, type: "CSP", strike, expiry, tags,
  created_at: "2026-06-01T10:00:00Z", ...extra,
});
const openPos = (ticker, strike, expiry, extra = {}) => ({
  ticker, type: "CSP", strike, expiry_date: expiry, open_date: "2026-05-28",
  contracts: 1, premium_collected: 500, ...extra,
});
// Normalized closed trade: MM/DD `expiry` alongside ISO `expiry_date` (the gotcha).
const closedTrade = (ticker, strike, expiry, extra = {}) => ({
  ticker, type: "CSP", strike, expiry_date: expiry, expiry: "07/02",
  open_date: "2026-05-20", close_date: "2026-06-05", contracts: 1,
  premium: 800, kept_pct: 0.82, ...extra,
});

describe("slugifyCohortName", () => {
  it("lowercases, dashes whitespace/punctuation, collapses and trims dashes", () => {
    expect(slugifyCohortName("Jun 26 batch")).toBe("jun-26-batch");
    expect(slugifyCohortName("  SOFI -- makeup!! ")).toBe("sofi-makeup");
  });
  it("returns empty string when nothing slug-worthy remains", () => {
    expect(slugifyCohortName("!!!")).toBe("");
    expect(slugifyCohortName("")).toBe("");
  });
});

describe("resolveCohort", () => {
  const TAG = "cohort:jun-26-batch";

  it("resolves open members from open positions", () => {
    const { members, unresolved } = resolveCohort(TAG, {
      openPositions: [openPos("CCJ", 107, "2026-06-26")],
      trades: [],
      entries: [entry("CCJ", 107, "2026-06-26", [TAG])],
    });
    expect(unresolved).toHaveLength(0);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      status: "open", ticker: "CCJ", strike: 107, expiry: "2026-06-26",
      contracts: 1, premiumCollected: 500, keptPct: null,
    });
  });

  it("resolves closed members from trades using ISO expiry_date, not MM/DD expiry", () => {
    const { members } = resolveCohort(TAG, {
      openPositions: [],
      trades: [closedTrade("WDC", 450, "2026-07-02")],
      entries: [entry("WDC", 450, "2026-07-02", [TAG])],
    });
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      status: "closed", closeDate: "2026-06-05", premiumCollected: 800, keptPct: 0.82,
    });
  });

  it("ignores entries without the tag and reports unresolved tuples", () => {
    const { members, unresolved } = resolveCohort(TAG, {
      openPositions: [],
      trades: [],
      entries: [
        entry("CCJ", 107, "2026-06-26", [TAG]),                 // matches nothing → unresolved
        entry("CDE", 18, "2026-06-26", ["strategy:sofi-makeup"]), // different tag → ignored
      ],
    });
    expect(members).toHaveLength(0);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]).toMatchObject({ ticker: "CCJ", strike: 107 });
  });

  it("prefers the open position over a closed trade with the same tuple", () => {
    const { members } = resolveCohort(TAG, {
      openPositions: [openPos("GLW", 190, "2026-07-02")],
      trades: [closedTrade("GLW", 190, "2026-07-02")],
      entries: [entry("GLW", 190, "2026-07-02", [TAG])],
    });
    expect(members).toHaveLength(1);
    expect(members[0].status).toBe("open");
  });

  it("dedupes duplicate entries for the same position (merge-on-resave semantics)", () => {
    const { members } = resolveCohort(TAG, {
      openPositions: [openPos("CCJ", 107, "2026-06-26")],
      trades: [],
      entries: [
        entry("CCJ", 107, "2026-06-26", [TAG]),
        { ...entry("CCJ", 107, "2026-06-26", [TAG]), id: "e-dup" },
      ],
    });
    expect(members).toHaveLength(1);
  });

  it("reports cohort created date as the earliest entry created_at", () => {
    const { createdAt } = resolveCohort(TAG, {
      openPositions: [openPos("CCJ", 107, "2026-06-26")],
      trades: [],
      entries: [
        { ...entry("CCJ", 107, "2026-06-26", [TAG]), created_at: "2026-06-03T10:00:00Z" },
        { ...entry("CCJ", 108, "2026-06-26", [TAG]), id: "e2", created_at: "2026-06-01T09:00:00Z" },
      ],
    });
    expect(createdAt).toBe("2026-06-01T09:00:00Z");
  });
});

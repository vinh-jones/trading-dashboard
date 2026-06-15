import { describe, it, expect } from "vitest";
import { slugifyCohortName, resolveCohort, cohortScoreboard, memberCapturePct, memberGlDollars, cohortCaptureSeries } from "../cohorts";
import { buildOccSymbol, normalizeTrade } from "../trading";

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
      status: "closed", closeDate: "2026-06-05", realized: 800, keptPct: 0.82,
    });
    // No entry_cost on this fixture → gross premium reconstructs from realized/kept.
    expect(members[0].premiumCollected).toBeCloseTo(800 / 0.82, 2);
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

  it("tolerates entries with null tags", () => {
    const { members, unresolved } = resolveCohort("cohort:x", {
      openPositions: [], trades: [], entries: [{ id: "e1", ticker: "CCJ", tags: null }],
    });
    expect(members).toHaveLength(0);
    expect(unresolved).toHaveLength(0);
  });
});

const openMember = (over = {}) => ({
  status: "open", ticker: "CCJ", type: "CSP", strike: 107, expiry: "2026-06-26",
  openDate: "2026-05-28", closeDate: null, contracts: 1, premiumCollected: 500,
  keptPct: null, ...over,
});
// premiumCollected = GROSS premium ($800); realized = net P&L ($600 = 0.75 × gross).
const closedMember = (over = {}) => ({
  status: "closed", ticker: "WDC", type: "CSP", strike: 450, expiry: "2026-06-26",
  openDate: "2026-05-20", closeDate: "2026-06-05", contracts: 1, premiumCollected: 800,
  realized: 600, keptPct: 0.75, ...over,
});
// quoteMap with the open member's put marked at 2.50 → unrealized = 500 - 250 = 250 (50%)
const quoteMapFor = (m, mid) =>
  new Map([[buildOccSymbol(m.ticker, m.expiry, false, m.strike), { mid }]]);

describe("cohortScoreboard", () => {
  it("computes collateral from open members only, premium and capture across all", () => {
    const open = openMember();
    const sb = cohortScoreboard([open, closedMember()], quoteMapFor(open, 2.5), 100000);
    expect(sb.memberCount).toBe(2);
    expect(sb.openCount).toBe(1);
    expect(sb.collateral).toBe(107 * 100);            // open only
    expect(sb.collateralPct).toBeCloseTo(10.7, 5);
    expect(sb.maxPremium).toBe(1300);                  // gross 500 + gross 800
    expect(sb.captured).toBeCloseTo(250 + 600, 5);     // unrealized 250 + realized 600
    expect(sb.capturePct).toBeCloseTo(((250 + 600) / 1300) * 100, 5);
    expect(sb.missingMarkCount).toBe(0);
  });

  it("excludes unmarked open members and no-realized closed members from capture, counts them", () => {
    const sb = cohortScoreboard(
      [openMember(), closedMember({ realized: null })],
      new Map(), // no quotes → open member unmarked
      null,
    );
    expect(sb.captured).toBeNull();
    expect(sb.capturePct).toBeNull();
    expect(sb.missingMarkCount).toBe(2);
    expect(sb.maxPremium).toBe(1300);
    expect(sb.collateralPct).toBeNull(); // no account value
  });

  it("handles an all-closed cohort (no collateral)", () => {
    const sb = cohortScoreboard([closedMember()], new Map(), 100000);
    expect(sb.collateral).toBe(0);
    expect(sb.captured).toBeCloseTo(600, 5);
    expect(sb.capturePct).toBeCloseTo(75, 5);
  });
});

describe("memberCapturePct", () => {
  it("uses live marks for open members (percent units)", () => {
    const m = openMember();
    expect(memberCapturePct(m, quoteMapFor(m, 2.5))).toBeCloseTo(50, 5);
    expect(memberCapturePct(m, new Map())).toBeNull();
  });
  it("uses kept_pct for closed members", () => {
    expect(memberCapturePct(closedMember(), new Map())).toBeCloseTo(75, 5);
    expect(memberCapturePct(closedMember({ keptPct: null }), new Map())).toBeNull();
  });
});

describe("memberGlDollars", () => {
  it("uses unrealized mark-to-market dollars for open members", () => {
    const m = openMember(); // premium 500, 1 contract, mid 2.5 → 500 - 250 = 250
    expect(memberGlDollars(m, quoteMapFor(m, 2.5))).toBeCloseTo(250, 5);
    expect(memberGlDollars(m, new Map())).toBeNull(); // no mark
  });
  it("returns the net realized P&L directly for closed members (not premium × kept_pct)", () => {
    expect(memberGlDollars(closedMember(), new Map())).toBeCloseTo(600, 5); // realized, not 800×0.75 re-discounted
    expect(memberGlDollars(closedMember({ realized: null }), new Map())).toBeNull();
  });
  it("goes negative for an underwater open member", () => {
    const m = openMember(); // premium 500, mid 8.0 → 500 - 800 = -300
    expect(memberGlDollars(m, quoteMapFor(m, 8.0))).toBeCloseTo(-300, 5);
  });
});

describe("cohortCaptureSeries", () => {
  // Snapshot member rows use the serialized DB shape: lowercase type, snake_case fields.
  const snap = (ticker, strike, expiry, current_profit_pct, premium_at_open) =>
    ({ ticker, type: "csp", strike, expiry, current_profit_pct, premium_at_open });

  it("premium-weights open members per day and skips days with no contributors", () => {
    const m1 = openMember();                                       // CCJ 107
    const m2 = openMember({ ticker: "SHOP", strike: 118, premiumCollected: 1000 });
    const history = [
      { date: "2026-06-01", members: [snap("CCJ", 107, "2026-06-26", 0.2, 500), snap("SHOP", 118, "2026-06-26", 0.4, 1000)] },
      { date: "2026-06-02", members: [] },                          // no contributors → skipped
      { date: "2026-06-03", members: [snap("CCJ", 107, "2026-06-26", 0.3, 500)] },
    ];
    const series = cohortCaptureSeries([m1, m2], history);
    expect(series).toHaveLength(2);
    // day 1: (0.2×500 + 0.4×1000) / 1500 = 0.3333…
    expect(series[0]).toMatchObject({ date: "2026-06-01" });
    expect(series[0].capturePct).toBeCloseTo(33.33, 1);
    expect(series[1].capturePct).toBeCloseTo(30, 5);
  });

  it("flatlines closed members at kept_pct from their close date", () => {
    const closed = closedMember(); // closes 2026-06-05, kept 0.75, premium 800
    const history = [
      { date: "2026-06-04", members: [snap("WDC", 450, "2026-06-26", 0.6, 800)] },
      { date: "2026-06-06", members: [] }, // member closed; contributes kept_pct
    ];
    const series = cohortCaptureSeries([closed], history);
    expect(series[0].capturePct).toBeCloseTo(60, 5);
    expect(series[1].capturePct).toBeCloseTo(75, 5);
  });

  it("matches snapshot type case-insensitively and stops after the last close when all closed", () => {
    const closed = closedMember(); // closeDate 2026-06-05
    const history = [
      { date: "2026-06-05", members: [] },
      { date: "2026-06-20", members: [] }, // > closeDate of an all-closed cohort → trimmed
    ];
    const series = cohortCaptureSeries([closed], history);
    expect(series).toHaveLength(1);
    expect(series[0].date).toBe("2026-06-05");
  });

  it("returns empty for empty inputs", () => {
    expect(cohortCaptureSeries([], [])).toEqual([]);
    expect(cohortCaptureSeries([openMember()], [])).toEqual([]);
  });

  it("yields a single open member's own current_profit_pct line", () => {
    const m = openMember(); // CCJ 107, premium 500
    const history = [
      { date: "2026-06-01", members: [snap("CCJ", 107, "2026-06-26", 0.12, 500)] },
      { date: "2026-06-02", members: [snap("CCJ", 107, "2026-06-26", -0.30, 500)] },
    ];
    const series = cohortCaptureSeries([m], history);
    expect(series).toEqual([
      { date: "2026-06-01", capturePct: 12 },
      { date: "2026-06-02", capturePct: -30 },
    ]);
  });

  it("keeps exactly one snapshot day after an off-snapshot close, trims the rest", () => {
    const closed = closedMember(); // closeDate 2026-06-05 (not a snapshot day)
    const history = [
      { date: "2026-06-04", members: [snap("WDC", 450, "2026-06-26", 0.6, 800)] },
      { date: "2026-06-06", members: [] },
      { date: "2026-06-07", members: [] },
    ];
    const series = cohortCaptureSeries([closed], history);
    expect(series.map(p => p.date)).toEqual(["2026-06-04", "2026-06-06"]);
  });

  it("passes negative capture through unclamped (underwater cohort)", () => {
    const m = openMember();
    const history = [
      { date: "2026-06-01", members: [snap("CCJ", 107, "2026-06-26", -1.5, 500)] },
    ];
    expect(cohortCaptureSeries([m], history)[0].capturePct).toBeCloseTo(-150, 5);
  });
});

// Regression: production passes normalizeTrade() output (not raw DB rows) into
// resolveCohort. normalizeTrade must carry the numeric kept_pct through, or
// every closed cohort member resolves with keptPct null ("—" / no mark).
describe("resolveCohort with normalizeTrade output", () => {
  // On a CLOSED trade premium_collected is NET realized P&L; gross premium is
  // entry_cost × 100 × contracts. The member must split these: premiumCollected
  // = gross (max), realized = net, and G/L $ = realized (NOT realized × kept_pct).
  it("splits gross premium and net realized from a normalized closed trade", () => {
    const raw = {
      ticker: "COHR", type: "CSP", strike: 350, expiry_date: "2026-06-26",
      open_date: "2026-06-09", close_date: "2026-06-15",
      premium_collected: 1285, entry_cost: 21.4, kept_pct: 0.6005, contracts: 1,
    };
    const TAG = "cohort:x";
    const { members } = resolveCohort(TAG, {
      openPositions: [],
      trades: [normalizeTrade(raw)],
      entries: [{ id: "e1", ticker: "COHR", type: "CSP", strike: 350, expiry: "2026-06-26", tags: [TAG] }],
    });
    expect(members).toHaveLength(1);
    const m = members[0];
    expect(m.status).toBe("closed");
    expect(m.closeDate).toBe("2026-06-15");
    expect(m.premiumCollected).toBeCloseTo(2140, 5); // gross = 21.4 × 100 × 1
    expect(m.realized).toBe(1285);                   // net realized P&L
    expect(m.keptPct).toBeCloseTo(0.6005, 6);
    expect(memberGlDollars(m, new Map())).toBe(1285); // G/L $ = realized, not 1285 × 0.6005
    expect(memberCapturePct(m, new Map())).toBeCloseTo(60.05, 2);
  });

  it("reconstructs gross premium from realized / kept_pct when entry_cost is absent", () => {
    const raw = {
      ticker: "CDE", type: "CSP", strike: 18, expiry_date: "2026-06-26",
      open_date: "2026-06-01", close_date: "2026-06-15",
      premium_collected: 660, kept_pct: 0.5593, contracts: 10, // no entry_cost
    };
    const TAG = "cohort:y";
    const { members } = resolveCohort(TAG, {
      openPositions: [],
      trades: [normalizeTrade(raw)],
      entries: [{ id: "e1", ticker: "CDE", type: "CSP", strike: 18, expiry: "2026-06-26", tags: [TAG] }],
    });
    expect(members[0].realized).toBe(660);
    expect(members[0].premiumCollected).toBeCloseTo(660 / 0.5593, 2); // ≈ 1180
  });
});

import { describe, it, expect } from "vitest";
import { buildScanPayload, resolveCuratedPreset } from "../agent-scan.js";
import { entryScore } from "../../src/lib/entryScore.js";
import { CURATED_PRESETS } from "../../src/components/radar/curatedPresets.js";

// A row that clears Prime Setup on its own merits:
//   compositeIv = (95/100)*0.60 + min(0.90/1.50, 1)*0.40 = 0.57 + 0.24 = 0.81
//   base        = (1 - 0.05)*0.50 + 0.81*0.50            = 0.475 + 0.405 = 0.88
//   × uptrend 1.00 × ivTrend n/a 1.00 × gamma n/a × flow n/a → 0.88 = "Strong"
function strongRow(overrides = {}) {
  return {
    ticker: "AAA", company: "Alpha Corp", sector: "Technology",
    last: 100, prev_close: 98,
    iv: 0.90, iv_rank: 95,
    bb_position: 0.05,
    ma_50: 90, ma_200: 80,   // price above both → uptrend
    rsi_14: 45,
    pe_ttm: 30, beta: 1.2,
    gex_env: "stabilized",
    gamma_env: null, flow_tape_ema: null,
    earnings_date: null,
    ...overrides,
  };
}

const primeSetup = resolveCuratedPreset("prime-setup");

const tickersIn = (payload) => payload.candidates.map(c => c.ticker);

describe("resolveCuratedPreset", () => {
  it("accepts the bare id and the builtin: form", () => {
    expect(resolveCuratedPreset("prime-setup")?.name).toBe("Prime Setup");
    expect(resolveCuratedPreset("builtin:prime-setup")?.name).toBe("Prime Setup");
  });

  it("returns null for unknown or empty", () => {
    expect(resolveCuratedPreset("does-not-exist")).toBeNull();
    expect(resolveCuratedPreset(null)).toBeNull();
  });

  it("resolves every curated preset the UI exposes", () => {
    for (const p of CURATED_PRESETS) {
      expect(resolveCuratedPreset(p.id.replace(/^builtin:/, ""))).toBeTruthy();
    }
  });
});

describe("buildScanPayload — scores", () => {
  it("emits exactly what entryScore computes (no restated math)", () => {
    const row = strongRow();
    const payload = buildScanPayload({ rows: [row] });
    const expected = entryScore(
      row.bb_position, row.iv, row.iv_rank, row.last, row.ma_50, row.ma_200,
      null, row.gamma_env, row.flow_tape_ema,
    );
    expect(payload.candidates[0].score).toBe(Math.round(expected * 1000) / 1000);
    expect(payload.candidates[0].scoreLabel).toBe("Strong");
  });

  it("applies the ivTrend modifier server-side", () => {
    const row = strongRow();
    const rising = { state: "rising", label: "IV Rising ↑", modifier: 1.10 };
    const withTrend = buildScanPayload({
      rows: [row],
      ivTrendsByTicker: new Map([["AAA", rising]]),
    });
    const without = buildScanPayload({ rows: [row] });
    expect(withTrend.candidates[0].score).toBeGreaterThan(without.candidates[0].score);
    expect(withTrend.candidates[0].ivTrend.state).toBe("rising");
  });

  it("sorts candidates by score descending", () => {
    const rows = [
      strongRow({ ticker: "LOW",  bb_position: 0.75, iv_rank: 20, iv: 0.20 }),
      strongRow({ ticker: "HIGH", bb_position: 0.02, iv_rank: 99, iv: 1.20 }),
    ];
    const payload = buildScanPayload({ rows });
    expect(tickersIn(payload)).toEqual(["HIGH", "LOW"]);
  });
});

describe("buildScanPayload — Prime Setup filter wiring", () => {
  it("includes a clean not-held candidate", () => {
    const payload = buildScanPayload({ rows: [strongRow()], preset: primeSetup });
    expect(tickersIn(payload)).toEqual(["AAA"]);
  });

  it("excludes a ticker already held (ownership: not_held)", () => {
    const positions = {
      assigned_shares: [{ ticker: "AAA", cost_basis_total: 10000 }],
      open_csps: [], open_leaps: [], open_spreads: [],
    };
    const payload = buildScanPayload({ rows: [strongRow()], positions, preset: primeSetup });
    expect(tickersIn(payload)).toEqual([]);
  });

  it("excludes a ticker with earnings inside 30 days", () => {
    const soon = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
    const marketContext = { positions: [{ ticker: "AAA", nextEarnings: { date: soon } }] };
    const payload = buildScanPayload({ rows: [strongRow()], marketContext, preset: primeSetup });
    expect(tickersIn(payload)).toEqual([]);
  });

  it("keeps a ticker whose earnings date is UNKNOWN — null is not 'too soon'", () => {
    // Documents live behaviour: market_context only carries earnings for names
    // it tracks, so most non-held candidates have null here. If this ever flips
    // to exclude-on-null, Prime Setup would silently collapse to a few names.
    const payload = buildScanPayload({
      rows: [strongRow()],
      marketContext: { positions: [] },
      preset: primeSetup,
    });
    expect(tickersIn(payload)).toEqual(["AAA"]);
  });

  it("excludes a downtrend name (trend_states)", () => {
    const payload = buildScanPayload({
      rows: [strongRow({ ma_50: 120, ma_200: 130 })], // price 100 below both
      preset: primeSetup,
    });
    expect(tickersIn(payload)).toEqual([]);
  });

  it("reports universe vs candidate counts", () => {
    const rows = [strongRow(), strongRow({ ticker: "BBB", bb_position: 0.90 })];
    const payload = buildScanPayload({ rows, preset: primeSetup });
    expect(payload.counts.universe).toBe(2);
    expect(payload.counts.candidates).toBe(1);
  });

  it("honours limit without losing the true candidate count", () => {
    const rows = [strongRow(), strongRow({ ticker: "BBB" }), strongRow({ ticker: "CCC" })];
    const payload = buildScanPayload({ rows, limit: 2 });
    expect(payload.counts.candidates).toBe(3);
    expect(payload.counts.returned).toBe(2);
    expect(payload.candidates).toHaveLength(2);
  });
});

describe("buildScanPayload — exposure is opt-in", () => {
  const positions = {
    assigned_shares: [{ ticker: "DELL", cost_basis_total: 25000 }],
    open_csps: [], open_leaps: [], open_spreads: [],
  };

  it("omits dollar exposure by default", () => {
    const payload = buildScanPayload({ rows: [strongRow()], positions });
    expect(payload.exposureIncluded).toBe(false);
    const dell = payload.baskets
      .flatMap(b => b.tickers)
      .find(t => t.ticker === "DELL");
    expect(dell.exposure).toBeUndefined();
    expect(payload.baskets.every(b => b.exposure === undefined)).toBe(true);
  });

  it("still reports held/not-held with exposure off", () => {
    const payload = buildScanPayload({ rows: [strongRow()], positions });
    const dell = payload.baskets.flatMap(b => b.tickers).find(t => t.ticker === "DELL");
    expect(dell.held).toBe(true);
  });

  it("includes exposure when explicitly requested", () => {
    const payload = buildScanPayload({ rows: [strongRow()], positions, wantExposure: true });
    expect(payload.exposureIncluded).toBe(true);
    const dell = payload.baskets.flatMap(b => b.tickers).find(t => t.ticker === "DELL");
    expect(dell.exposure).toBe(25000);
  });

  it("cannot include exposure without positions", () => {
    const payload = buildScanPayload({ rows: [strongRow()], positions: null, wantExposure: true });
    expect(payload.exposureIncluded).toBe(false);
  });
});

describe("buildScanPayload — baskets", () => {
  it("averages BB across members with data and buckets the average", () => {
    // Storage basket is WDC + STX.
    const rows = [
      strongRow({ ticker: "WDC", bb_position: 0.03 }),
      strongRow({ ticker: "STX", bb_position: 0.01 }),
    ];
    const storage = buildScanPayload({ rows }).baskets.find(b => b.id === "storage");
    expect(storage.bbAvg).toBe(0.02);
    expect(storage.bbBucket).toBe("near_lower");
  });

  it("yields a null average (not NaN) when no member has BB data", () => {
    const storage = buildScanPayload({ rows: [] }).baskets.find(b => b.id === "storage");
    expect(storage.bbAvg).toBeNull();
    expect(storage.bbBucket).toBeNull();
  });

  it("computes day % from prev_close", () => {
    const rows = [strongRow({ ticker: "WDC", last: 110, prev_close: 100 })];
    const wdc = buildScanPayload({ rows })
      .baskets.flatMap(b => b.tickers).find(t => t.ticker === "WDC");
    expect(wdc.dayPct).toBe(10);
  });
});

describe("buildScanPayload — freshness reporting", () => {
  const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();

  it("reports BB data age in minutes", () => {
    const payload = buildScanPayload({ rows: [strongRow()], bbRefreshedAt: minutesAgo(7) });
    expect(payload.freshness.bbAgeMinutes).toBe(7);
  });

  it("flags stale only when the market is open", () => {
    // 45 minutes old during the session means an ingest is not landing.
    const open = buildScanPayload({ rows: [], bbRefreshedAt: minutesAgo(45), marketOpen: true });
    expect(open.freshness.stale).toBe(true);

    // Same age overnight is just last close — correct, not stale.
    const closed = buildScanPayload({ rows: [], bbRefreshedAt: minutesAgo(45), marketOpen: false });
    expect(closed.freshness.stale).toBe(false);
  });

  it("treats unknown age as stale rather than fresh", () => {
    const payload = buildScanPayload({ rows: [], bbRefreshedAt: null, marketOpen: true });
    expect(payload.freshness.bbAgeMinutes).toBeNull();
    expect(payload.freshness.stale).toBe(true);
  });

  it("surfaces refresh step results so a silent no-op is visible", () => {
    // A refresh can 200 without writing anything; freshness is the check on it.
    const refresh = { ran: true, ms: 1200, allOk: false, steps: [{ step: "/api/uw-gex", ok: false, status: 503 }] };
    const payload = buildScanPayload({ rows: [], refresh, bbRefreshedAt: minutesAgo(90), marketOpen: true });
    expect(payload.refresh.allOk).toBe(false);
    expect(payload.refresh.steps[0].step).toBe("/api/uw-gex");
    expect(payload.freshness.stale).toBe(true);
  });
});

describe("buildScanPayload — self-describing payload", () => {
  it("ships a field legend and the caveats an agent needs to read it correctly", () => {
    const payload = buildScanPayload({ rows: [strongRow()] });
    expect(payload.methodology.version).toBeTruthy();
    expect(payload.methodology.fields.bb).toMatch(/LOWER IS BETTER/);
    expect(payload.methodology.caveats.join(" ")).toMatch(/not a deploy trigger/i);
  });

  it("lists every curated preset so an agent can discover them", () => {
    const payload = buildScanPayload({ rows: [] });
    expect(payload.availablePresets.map(p => p.id)).toContain("prime-setup");
    expect(payload.availablePresets).toHaveLength(CURATED_PRESETS.length);
  });

  it("points at /api/vix rather than restating VIX", () => {
    expect(buildScanPayload({ rows: [] }).vixSource).toBe("/api/vix");
  });
});

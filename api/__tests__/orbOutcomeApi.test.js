// api/__tests__/orbOutcomeApi.test.js
//
// api/orb-outcome.js does real I/O (UW fetch, Supabase), so we mock its
// external seams — ./_lib/uwClient.js, ./_lib/orbDb.js — and partially mock
// the ET clock helpers in src/lib/orb/calendar.js (only todayET/nowMinutesET
// are overridden; isTradingDay/isAfterClose stay real). bars.js and
// outcome.js run for real so the replay math is genuinely exercised.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../_lib/uwClient.js", () => ({
  hasUwKey: vi.fn(() => true),
  fetchIntradayOhlc: vi.fn(),
}));

vi.mock("../_lib/orbDb.js", () => ({
  getSupabase: vi.fn(() => ({ fake: "supabase-client" })),
  getSession: vi.fn(),
  upsertSession: vi.fn(async (_supabase, row) => ({ id: "row-1", ...row })),
}));

vi.mock("../../src/lib/orb/calendar.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    todayET: vi.fn(actual.todayET),
    nowMinutesET: vi.fn(actual.nowMinutesET),
  };
});

import handler from "../orb-outcome.js";
import { hasUwKey, fetchIntradayOhlc } from "../_lib/uwClient.js";
import { getSession, upsertSession } from "../_lib/orbDb.js";
import { todayET, nowMinutesET } from "../../src/lib/orb/calendar.js";

const CRON_SECRET = "test-cron-secret";
const SESSION_DATE = "2026-08-04"; // Tuesday, EDT (UTC-4) — not an NYSE holiday
const ET_OFFSET_HOURS = 4; // EDT
const AFTER_CLOSE_MIN = 16 * 60; // 16:00 ET

function makeReq({ query = {}, method = "GET", headers } = {}) {
  return { method, headers: headers ?? { authorization: `Bearer ${CRON_SECRET}` }, query };
}

function makeRes() {
  const res = {};
  res.status = vi.fn((code) => { res.statusCode = code; return res; });
  res.json = vi.fn((body) => { res.body = body; return res; });
  return res;
}

function etIso(hh, mm) {
  const utcHour = hh + ET_OFFSET_HOURS;
  return `${SESSION_DATE}T${String(utcHour).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00.000Z`;
}

function bar(hh, mm, { o, h, l, c }) {
  return { start: etIso(hh, mm), o, h, l, c, vol: 10_000 };
}

function baseRow(overrides = {}) {
  return {
    id: "row-1",
    symbol: "QQQ",
    session_date: SESSION_DATE,
    detection_status: "matched",
    pattern: "hammer",
    pattern_bar_start: etIso(9, 50),
    entry: 100, stop: 95, t1: 105, t2: 110,
    outcome_resolved_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = CRON_SECRET;
  delete process.env.APP_SECRET;
  hasUwKey.mockReturnValue(true);
  todayET.mockReturnValue(SESSION_DATE);
  nowMinutesET.mockReturnValue(AFTER_CLOSE_MIN); // after close by default
  fetchIntradayOhlc.mockResolvedValue([]);
  getSession.mockResolvedValue(null);
});

describe("api/orb-outcome — gating", () => {
  it("rejects a non-GET method with 405", async () => {
    const res = makeRes();
    await handler(makeReq({ method: "POST" }), res);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("rejects a request with no credentials with 401", async () => {
    const res = makeRes();
    await handler(makeReq({ headers: {} }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("missing UW_API_KEY is a soft no-op", async () => {
    hasUwKey.mockReturnValue(false);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.body.ok).toBe(true);
    expect(res.body.skipped).toMatch(/UW_API_KEY/);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("a malformed ?date= is rejected (isTradingDay's round-trip validation fails closed)", async () => {
    const res = makeRes();
    await handler(makeReq({ query: { date: "2026-02-30" } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.skipped).toMatch(/not a trading day/);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("a garbage ?date= string is rejected", async () => {
    const res = makeRes();
    await handler(makeReq({ query: { date: "not-a-date" } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.skipped).toMatch(/not a trading day/);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("before the close (no force): bails without reading the session row", async () => {
    nowMinutesET.mockReturnValue(15 * 60); // 15:00 ET, still open
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.skipped).toMatch(/before the close/);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("force=1 bypasses the after-close gate", async () => {
    nowMinutesET.mockReturnValue(10 * 60); // mid-morning
    getSession.mockResolvedValue(baseRow());
    fetchIntradayOhlc.mockResolvedValue([bar(9, 50, { o: 99, h: 101, l: 99, c: 100.5 })]);
    const res = makeRes();
    await handler(makeReq({ query: { force: "1" } }), res);
    expect(getSession).toHaveBeenCalled();
  });
});

describe("api/orb-outcome — row state", () => {
  it("no session row: bails without fetching bars", async () => {
    getSession.mockResolvedValue(null);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.body.skipped).toMatch(/no session row/);
    expect(fetchIntradayOhlc).not.toHaveBeenCalled();
    expect(upsertSession).not.toHaveBeenCalled();
  });

  it.each(["pending", "expired", "skipped"])(
    "detection_status %s (non-matched row): skipped, no fetch, no upsert",
    async (status) => {
      getSession.mockResolvedValue(baseRow({ detection_status: status }));
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res.body.skipped).toMatch(/no signal to resolve/);
      expect(fetchIntradayOhlc).not.toHaveBeenCalled();
      expect(upsertSession).not.toHaveBeenCalled();
    }
  );

  it("outcome_resolved_at already set: idempotent no-op, no fetch, no second upsert", async () => {
    getSession.mockResolvedValue(baseRow({
      outcome_resolved_at: "2026-08-04T21:00:00.000Z", outcome: "t1",
    }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.body.skipped).toMatch(/already resolved/);
    expect(res.body.outcome).toBe("t1");
    expect(fetchIntradayOhlc).not.toHaveBeenCalled();
    expect(upsertSession).not.toHaveBeenCalled();
  });
});

describe("api/orb-outcome — bar windowing", () => {
  it("only bars at/after the signal bar are considered", async () => {
    // A pre-signal bar (09:45) that WOULD read as an immediate fill+stop if it
    // were wrongly included; the real signal bar is 09:50.
    getSession.mockResolvedValue(baseRow({ pattern_bar_start: etIso(9, 50) }));
    fetchIntradayOhlc.mockResolvedValue([
      bar(9, 45, { o: 100, h: 101, l: 90, c: 92 }),  // pre-signal: would fill+stop if included
      bar(9, 50, { o: 99, h: 101, l: 99, c: 100.5 }), // signal bar: fills entry, no stop
      bar(9, 55, { o: 100.5, h: 106, l: 100, c: 105.5 }), // hits t1
    ]);
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.body.outcome).toBe("t1");
    expect(res.body.barsToFill).toBe(0); // relative to the post-signal slice
    expect(res.body.barsExamined).toBe(2); // only the 09:50 and 09:55 bars
    const [, row] = upsertSession.mock.calls[0];
    expect(row.outcome).toBe("t1");
  });
});

describe("api/orb-outcome — side derivation from pattern", () => {
  // entry=100, stop=95, t1=105, t2=110 (matches baseRow). Correct LONG
  // interpretation fills at 09:50 (h=101) and hits t1 at 09:55 (h=106),
  // touching neither stop (l<=95) nor t2 (h>=110) along the way. If side were
  // wrongly derived as short, the 09:50 bar's l=99 <= stop(95)? no — but the
  // point is this fixture is unambiguous under long and only used for the
  // long-pattern cases below.
  const longBars = () => [
    bar(9, 50, { o: 99, h: 101, l: 99, c: 100.5 }),
    bar(9, 55, { o: 100.5, h: 106, l: 100, c: 105.5 }),
  ];

  it.each(["hammer", "bullish_engulfing"])(
    "pattern %s derives side long -> resolves via long predicates (t1)",
    async (pattern) => {
      getSession.mockResolvedValue(baseRow({ pattern }));
      fetchIntradayOhlc.mockResolvedValue(longBars());
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res.body.outcome).toBe("t1");
      expect(res.body.ambiguous).toBe(false);
    }
  );

  // Short-side fixture: entry=100, stop=105, t1=95, t2=90. Correct SHORT
  // interpretation fills at 09:50 (l=99) and hits t1 at 09:55 (l=94), never
  // touching stop (h>=105) or t2 (l<=90). A wrong LONG interpretation of these
  // same numeric levels stops out immediately and ambiguously on the very
  // first bar (h=101 >= stop=105 is false... see below) — the assertion below
  // only pins the correct short outcome, which is sufficient to prove the
  // pattern->side mapping is being used (an inverted mapping would apply the
  // long predicates to these bars/levels and fail to reach "t1").
  const shortBars = () => [
    bar(9, 50, { o: 101, h: 101, l: 99, c: 99.5 }),
    bar(9, 55, { o: 99.5, h: 100, l: 94, c: 94.5 }),
  ];

  it.each(["inverted_hammer", "bearish_engulfing"])(
    "pattern %s derives side short -> resolves via short predicates (t1)",
    async (pattern) => {
      getSession.mockResolvedValue(baseRow({
        pattern, entry: 100, stop: 105, t1: 95, t2: 90,
      }));
      fetchIntradayOhlc.mockResolvedValue(shortBars());
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res.body.outcome).toBe("t1");
      expect(res.body.ambiguous).toBe(false);
    }
  );

  it("a long-pattern row run against the short-shaped bars/levels would NOT reach t1 the same way (sanity check the fixtures actually differ by side)", async () => {
    // Same numeric levels/bars as the short case, but pattern is "hammer"
    // (long). If side derivation were broken and defaulted every pattern to
    // long, this would also report "t1" — proving the two fixtures need
    // side-correct handling to both pass is not enough on its own, so this
    // test pins the actually-different outcome under the long predicates.
    getSession.mockResolvedValue(baseRow({
      pattern: "hammer", entry: 100, stop: 105, t1: 95, t2: 90,
      pattern_bar_start: etIso(9, 50),
    }));
    fetchIntradayOhlc.mockResolvedValue(shortBars());
    const res = makeRes();
    await handler(makeReq(), res);
    // Long predicates: hitsEntry = h>=100 (09:50 h=101 -> fills at bar 0).
    // hitsStop = l<=105 (09:50 l=99 <= 105 -> true immediately).
    // hitsT2 = h>=90 (09:50 h=101 -> true immediately) -> ambiguous stop.
    expect(res.body.outcome).toBe("stop");
    expect(res.body.ambiguous).toBe(true);
  });
});

describe("api/orb-outcome — upsert shape", () => {
  it("the upsert omits the signal fields, sending only the outcome triple + natural key", async () => {
    getSession.mockResolvedValue(baseRow());
    fetchIntradayOhlc.mockResolvedValue([
      bar(9, 50, { o: 99, h: 101, l: 99, c: 100.5 }),
      bar(9, 55, { o: 100.5, h: 106, l: 100, c: 105.5 }),
    ]);
    const res = makeRes();
    await handler(makeReq(), res);

    expect(upsertSession).toHaveBeenCalledTimes(1);
    const [, row] = upsertSession.mock.calls[0];
    expect(Object.keys(row).sort()).toEqual(
      ["outcome", "outcome_ambiguous", "outcome_resolved_at", "session_date", "symbol"].sort()
    );
    expect(row.symbol).toBe("QQQ");
    expect(row.session_date).toBe(SESSION_DATE);
    expect(row.outcome).toBe("t1");
    expect(row.outcome_ambiguous).toBe(false);
    expect(typeof row.outcome_resolved_at).toBe("string");
  });
});

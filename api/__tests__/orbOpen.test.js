// api/__tests__/orbOpen.test.js
//
// api/orb-open.js does real I/O (UW fetch, Supabase), so we mock its three
// external seams — ./_lib/uwClient.js, ./_lib/orbDb.js, and the ET clock
// helpers in src/lib/orb/calendar.js — and exercise the handler's decision
// logic directly. Everything else (bars.js, atr.js, openingRange.js) runs
// for real so the box/ATR/liquidity math is genuinely exercised, not stubbed.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../_lib/uwClient.js", () => ({
  hasUwKey: vi.fn(() => true),
  fetchDailyOhlc: vi.fn(),
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

import handler from "../orb-open.js";
import { hasUwKey, fetchDailyOhlc, fetchIntradayOhlc } from "../_lib/uwClient.js";
import { upsertSession } from "../_lib/orbDb.js";
import { todayET, nowMinutesET, BOX_COMPLETE_MIN } from "../../src/lib/orb/calendar.js";
import { wilderAtr } from "../../src/lib/orb/atr.js";

const CRON_SECRET = "test-cron-secret";
const SESSION_DATE = "2026-08-04"; // Tuesday, EDT (UTC-4) — not an NYSE holiday
const ET_OFFSET_HOURS = 4; // EDT

function makeReq({ query = {} } = {}) {
  return {
    method: "GET",
    headers: { authorization: `Bearer ${CRON_SECRET}` },
    query,
  };
}

function makeRes() {
  const res = {};
  res.status = vi.fn((code) => { res.statusCode = code; return res; });
  res.json = vi.fn((body) => { res.body = body; return res; });
  return res;
}

function isoDateAdd(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function etIso(sessionDate, hh, mm) {
  const utcHour = hh + ET_OFFSET_HOURS;
  return `${sessionDate}T${String(utcHour).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00.000Z`;
}

// 20 prior daily bars with a steady true range (~1.5) so ATR converges
// predictably, plus an optional huge bar dated sessionDate itself — which
// must be excluded from the ATR calculation entirely.
function genDailyBars(sessionDate, { count = 20, includeHugeToday = false } = {}) {
  const bars = [];
  for (let i = count; i >= 1; i--) {
    const date = isoDateAdd(sessionDate, -i);
    const c = 100 + (count - i);
    bars.push({ date, o: c - 0.2, h: c + 0.5, l: c - 0.5, c, vol: 1_000_000 });
  }
  if (includeHugeToday) {
    const c = 100 + count;
    bars.push({ date: sessionDate, o: c, h: c + 500, l: c - 500, c, vol: 9_000_000 });
  }
  return bars;
}

function genIntradayBars(sessionDate, { qualify }) {
  const bars = qualify
    ? [
        { start: etIso(sessionDate, 9, 30), o: 500,   h: 500.5, l: 499.5, c: 500.2 },
        { start: etIso(sessionDate, 9, 35), o: 500.2, h: 501,   l: 500,   c: 500.8 },
        { start: etIso(sessionDate, 9, 40), o: 500.8, h: 501.5, l: 500.3, c: 501.3 },
      ]
    : [
        { start: etIso(sessionDate, 9, 30), o: 500,    h: 500.05, l: 499.95, c: 500.02 },
        { start: etIso(sessionDate, 9, 35), o: 500.02, h: 500.06, l: 499.98, c: 500.03 },
        { start: etIso(sessionDate, 9, 40), o: 500.03, h: 500.07, l: 499.99, c: 500.04 },
      ];
  return bars.map((b) => ({ ...b, vol: 10_000 }));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = CRON_SECRET;
  delete process.env.APP_SECRET;
  hasUwKey.mockReturnValue(true);
  todayET.mockReturnValue(SESSION_DATE);
  nowMinutesET.mockReturnValue(BOX_COMPLETE_MIN); // inside the box window by default
  fetchDailyOhlc.mockResolvedValue(genDailyBars(SESSION_DATE));
  fetchIntradayOhlc.mockResolvedValue(genIntradayBars(SESSION_DATE, { qualify: true }));
});

describe("api/orb-open — gating", () => {
  it("short-circuits on a non-trading day (Saturday) without calling UW", async () => {
    todayET.mockReturnValue("2026-08-08"); // Saturday
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.skipped).toMatch(/not a trading day/);
    expect(fetchDailyOhlc).not.toHaveBeenCalled();
    expect(fetchIntradayOhlc).not.toHaveBeenCalled();
    expect(upsertSession).not.toHaveBeenCalled();
  });

  it("short-circuits outside the 09:45 ET box window", async () => {
    nowMinutesET.mockReturnValue(BOX_COMPLETE_MIN + 60); // 10:45 ET
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.skipped).toMatch(/box window/);
    expect(fetchDailyOhlc).not.toHaveBeenCalled();
    expect(upsertSession).not.toHaveBeenCalled();
  });

  it("force=1 bypasses the box-window gate", async () => {
    nowMinutesET.mockReturnValue(BOX_COMPLETE_MIN + 60); // outside the window
    const req = makeReq({ query: { force: "1" } });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.skipped).toBeUndefined();
    expect(fetchDailyOhlc).toHaveBeenCalled();
    expect(upsertSession).toHaveBeenCalled();
  });

  it("missing UW_API_KEY is a soft no-op, not an error", async () => {
    hasUwKey.mockReturnValue(false);
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.skipped).toMatch(/UW_API_KEY/);
    expect(fetchDailyOhlc).not.toHaveBeenCalled();
    expect(fetchIntradayOhlc).not.toHaveBeenCalled();
  });
});

describe("api/orb-open — happy path", () => {
  it("writes a row with detection_status 'pending' when the box qualifies", async () => {
    fetchIntradayOhlc.mockResolvedValue(genIntradayBars(SESSION_DATE, { qualify: true }));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(upsertSession).toHaveBeenCalledTimes(1);
    const [, row] = upsertSession.mock.calls[0];
    expect(row.symbol).toBe("QQQ");
    expect(row.session_date).toBe(SESSION_DATE);
    expect(row.detection_status).toBe("pending");
    expect(row.qualified).toBe(true);
    expect(row.direction).not.toBeNull();
    expect(row.box_range).toBeCloseTo(2.0, 5);
  });

  it("writes detection_status 'skipped' and direction:null on a non-qualifying day", async () => {
    fetchIntradayOhlc.mockResolvedValue(genIntradayBars(SESSION_DATE, { qualify: false }));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(upsertSession).toHaveBeenCalledTimes(1);
    const [, row] = upsertSession.mock.calls[0];
    expect(row.qualified).toBe(false);
    expect(row.direction).toBeNull();
    expect(row.detection_status).toBe("skipped");
  });
});

describe("api/orb-open — ATR correctness", () => {
  it("excludes the in-progress session from ATR — a huge bar dated sessionDate must not move atr14", async () => {
    // Daily bars WITHOUT today's huge bar — this is what ATR should be computed from.
    const priorOnly = genDailyBars(SESSION_DATE, { includeHugeToday: false })
      .filter((b) => b.date < SESSION_DATE);
    const expectedAtr = wilderAtr(priorOnly.slice(-120), 14);

    // Feed the handler daily bars that DO include a huge bar dated sessionDate.
    fetchDailyOhlc.mockResolvedValue(genDailyBars(SESSION_DATE, { includeHugeToday: true }));

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(upsertSession).toHaveBeenCalledTimes(1);
    const [, row] = upsertSession.mock.calls[0];

    // atr_asof must be strictly before sessionDate.
    expect(row.atr_asof < SESSION_DATE).toBe(true);
    expect(row.atr_asof).not.toBe(SESSION_DATE);

    // If the huge same-day bar had leaked into the ATR calc, atr14 would be
    // an order of magnitude larger than this (~1.5 -> ~70+).
    expect(row.atr14).toBeCloseTo(expectedAtr, 5);
    expect(row.atr14).toBeLessThan(5);
  });

  it("computes a finite ATR from daily bars in UW's real shape (date field, no start)", async () => {
    const bars = genDailyBars(SESSION_DATE);
    // Sanity: these fixtures really do have no `start`/`end`, proving the
    // finite ATR below can only come from the normalizeDailyBars path.
    expect(bars.every((b) => b.start === undefined && b.end === undefined)).toBe(true);
    fetchDailyOhlc.mockResolvedValue(bars);

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    const [, row] = upsertSession.mock.calls[0];
    expect(Number.isFinite(row.atr14)).toBe(true);
    expect(row.atr14).toBeGreaterThan(0);
  });
});

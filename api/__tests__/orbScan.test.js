// api/__tests__/orbScan.test.js
//
// api/orb-scan.js does real I/O (UW fetch, Supabase, Pushover), so we mock
// its external seams — ./_lib/uwClient.js, ./_lib/orbDb.js, ./_lib/notify.js
// — and partially mock the ET clock helpers in src/lib/orb/calendar.js
// (only todayET/nowMinutesET are overridden; isTradingDay/isScanWindow/the
// minute constants stay real). bars.js, patterns.js and signal.js run for
// real so the detection math is genuinely exercised — every fixture bar
// below is hand-checked against the real hammer/engulfing geometry, not
// hand-built match objects.

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

vi.mock("../_lib/notify.js", () => ({
  sendPushover: vi.fn(async () => ({ status: 1 })),
}));

vi.mock("../../src/lib/orb/calendar.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    todayET: vi.fn(actual.todayET),
    nowMinutesET: vi.fn(actual.nowMinutesET),
  };
});

// buildSignal is left real for every test except the one that specifically
// proves a throw can't abort the scan (constraint #3: buildSignal throws on
// an unrecognized pattern, but real detectPattern output can never produce
// one — the only way to exercise that guard is to force one throw via spy,
// which reverts to the real implementation immediately after).
vi.mock("../../src/lib/orb/signal.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, buildSignal: vi.fn(actual.buildSignal) };
});

import handler from "../orb-scan.js";
import { hasUwKey, fetchIntradayOhlc } from "../_lib/uwClient.js";
import { getSession, upsertSession } from "../_lib/orbDb.js";
import { sendPushover } from "../_lib/notify.js";
import { todayET, nowMinutesET, BOX_COMPLETE_MIN, WINDOW_END_MIN } from "../../src/lib/orb/calendar.js";
import { buildSignal } from "../../src/lib/orb/signal.js";

const CRON_SECRET = "test-cron-secret";
const SESSION_DATE = "2026-08-04"; // Tuesday, EDT (UTC-4) — not an NYSE holiday
const ET_OFFSET_HOURS = 4; // EDT

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

// Doji-shaped, deliberately below minBodyPctOfRange so passesGuards rejects
// it outright regardless of prev/atr — a safe, inert filler bar.
function flat(hh, mm) {
  return bar(hh, mm, { o: 109.0, h: 109.5, l: 108.5, c: 109.02 });
}

// Real hammer geometry (verified against isHammer's zone/wick-ratio math):
// range 4.5, body 1.1 in the top third, lowerWick 3.2 >= 2x body, upperWick
// 0.2 <= 0.5x body. Close 99.3 < box_low(100) -> outside for a bullish setup.
// Does not depend on prev (hammer/inverted-hammer never read it), so it's
// reusable at any position.
function hammer(hh, mm) {
  return bar(hh, mm, { o: 98.2, h: 99.5, l: 95, c: 99.3 });
}
const HAMMER_BOX = { box_high: 110, box_low: 100, box_range: 10 };
const HAMMER_ATR = 10;

// Real bearish-engulfing pair (verified against isBearishEngulfing's
// tolerance math): prev green (o112/c112.8), bar red whose open sits inside
// prev's close+tol and whose close sits inside prev's open+tol. prevWeak is
// false (prev's body 0.8 is well above both the doji and tolerance floors).
// Close 112.0 > box_high(110) -> outside for a bearish setup.
function bePrev(hh, mm) {
  return bar(hh, mm, { o: 112, h: 113, l: 111.5, c: 112.8 });
}
function beBar(hh, mm) {
  return bar(hh, mm, { o: 112.85, h: 113.2, l: 111.8, c: 112.0 });
}
const BE_BOX = { box_high: 110, box_low: 100, box_range: 10 };
const BE_ATR = 10;

// Real, non-weak bullish-engulfing pair (verified against isBullishEngulfing's
// tolerance math): prev red with a solid body (1.2, well above both the doji
// and tolerance floors -> prevWeak: false), bar green whose open/close sit
// inside prev's close/open +/- tol. Close 99.1 < box_low(100) -> outside for
// a bullish setup. Used for the title test — weakBar above is prevWeak and
// never pushes, so it can't be used to assert on a real Pushover title.
function buPrev(hh, mm) {
  return bar(hh, mm, { o: 99, h: 99.3, l: 97.5, c: 97.8 });
}
function buBar(hh, mm) {
  return bar(hh, mm, { o: 97.75, h: 99.4, l: 97.5, c: 99.1 });
}
const BU_BOX = { box_high: 110, box_low: 100, box_range: 10 };
const BU_ATR = 10;

// Real inverted hammer (verified against isInvertedHammer's zone/wick-ratio
// math): body 1.0 in the bottom third, upperWick 3.7 >= 2x body, lowerWick
// 0.3 <= 0.5x body. Close 111.8 > box_high(110) -> outside for a bearish
// setup (side "short"). Entry (bar.l = 110.5) sits past t1 (box.high = 110)
// in the normal direction, so t1Ahead is true here — this is a "clean"
// signal, not the degenerate t1Ahead-false case covered separately above.
function ihBar(hh, mm) {
  return bar(hh, mm, { o: 110.8, h: 115.5, l: 110.5, c: 111.8 });
}
const IH_BOX = { box_high: 110, box_low: 100, box_range: 10 };
const IH_ATR = 10;

// Real bullish-engulfing pair whose PRIOR bar is doji-shaped (body 0.1 <
// 0.10 * range 2.0) -> detectPattern reports prevWeak: true. buildSignal
// still returns a coherent, non-null signal (entry 103/stop 101.6, both
// finite R:R) — this is NOT the "buildSignal returns null" incoherent case
// from orbSignal.test.js, it's a genuine match that must be logged but never
// alerted. Close 102.5 < box_low(103.5) -> outside for a bullish setup.
function weakPrev(hh, mm) {
  return bar(hh, mm, { o: 102.05, h: 103, l: 101, c: 101.95 });
}
function weakBar(hh, mm) {
  return bar(hh, mm, { o: 101.9, h: 102.7, l: 101.6, c: 102.5 });
}
const WEAK_BOX = { box_high: 113.5, box_low: 103.5, box_range: 10 };
const WEAK_ATR = 10;

// Real hammer whose high (entry) pokes back above the near box edge even
// though the close stays outside — t1Ahead false. Verified: hammer geometry
// holds (body 1.6 in zone, lowerWick 8.2 >= 2x body, upperWick 0.7 <= 0.5x
// body), close 99.8 < box_low(100), entry 100.5 > t1(100).
function t1BehindBar(hh, mm) {
  return bar(hh, mm, { o: 98.2, h: 100.5, l: 90, c: 99.8 });
}
const T1_BOX = { box_high: 110, box_low: 100, box_range: 10 };
const T1_ATR = 10;

function baseRow(overrides = {}) {
  return {
    id: "row-1",
    symbol: "QQQ",
    session_date: SESSION_DATE,
    box_high: HAMMER_BOX.box_high, box_low: HAMMER_BOX.box_low, box_range: HAMMER_BOX.box_range,
    atr14: HAMMER_ATR,
    direction: "bullish",
    grey_band: false,
    detection_status: "pending",
    last_scanned_bar: null,
    shadow_matches: [],
    alerted_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = CRON_SECRET;
  delete process.env.APP_SECRET;
  hasUwKey.mockReturnValue(true);
  todayET.mockReturnValue(SESSION_DATE);
  nowMinutesET.mockReturnValue(BOX_COMPLETE_MIN + 10); // inside the scan window by default
  sendPushover.mockResolvedValue({ status: 1 });
  fetchIntradayOhlc.mockResolvedValue([]);
  getSession.mockResolvedValue(null);
});

describe("api/orb-scan — gating", () => {
  it("short-circuits on a non-trading day without calling the DB or UW", async () => {
    todayET.mockReturnValue("2026-08-08"); // Saturday
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.skipped).toMatch(/not a trading day/);
    expect(getSession).not.toHaveBeenCalled();
    expect(fetchIntradayOhlc).not.toHaveBeenCalled();
  });

  it("short-circuits outside the scan window", async () => {
    nowMinutesET.mockReturnValue(BOX_COMPLETE_MIN); // one minute short of the window opening
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.skipped).toMatch(/scan window/);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("force=1 bypasses the scan-window gate", async () => {
    nowMinutesET.mockReturnValue(WINDOW_END_MIN + 60); // well outside the window
    getSession.mockResolvedValue(baseRow({ shadow_matches: [] }));
    fetchIntradayOhlc.mockResolvedValue([flat(9, 45)]);
    const res = makeRes();
    await handler(makeReq({ query: { force: "1" } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(getSession).toHaveBeenCalled();
    expect(fetchIntradayOhlc).toHaveBeenCalled();
    expect(upsertSession).toHaveBeenCalled();
  });

  it("missing UW_API_KEY is a soft no-op", async () => {
    hasUwKey.mockReturnValue(false);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.body.ok).toBe(true);
    expect(res.body.skipped).toMatch(/UW_API_KEY/);
    expect(getSession).not.toHaveBeenCalled();
  });

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
});

describe("api/orb-scan — no row / not-qualifying / no box", () => {
  it("no session row: bails without fetching bars or alerting", async () => {
    getSession.mockResolvedValue(null);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(fetchIntradayOhlc).not.toHaveBeenCalled();
    expect(sendPushover).not.toHaveBeenCalled();
    expect(upsertSession).not.toHaveBeenCalled();
  });

  it("detection_status 'skipped' (did not qualify): bails without fetching bars or alerting", async () => {
    getSession.mockResolvedValue(baseRow({ detection_status: "skipped" }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(fetchIntradayOhlc).not.toHaveBeenCalled();
    expect(sendPushover).not.toHaveBeenCalled();
    expect(upsertSession).not.toHaveBeenCalled();
  });

  it("box_high null: bails without fetching bars or alerting", async () => {
    getSession.mockResolvedValue(baseRow({ box_high: null }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(fetchIntradayOhlc).not.toHaveBeenCalled();
    expect(sendPushover).not.toHaveBeenCalled();
    expect(upsertSession).not.toHaveBeenCalled();
  });
});

describe("api/orb-scan — real matches", () => {
  it("a real bullish hammer produces exactly one Pushover and detection_status 'matched'", async () => {
    getSession.mockResolvedValue(baseRow({ ...HAMMER_BOX, atr14: HAMMER_ATR, direction: "bullish" }));
    fetchIntradayOhlc.mockResolvedValue([flat(9, 45), hammer(9, 50)]);
    const res = makeRes();
    await handler(makeReq(), res);

    expect(sendPushover).toHaveBeenCalledTimes(1);
    const [, row] = upsertSession.mock.calls[0];
    expect(row.detection_status).toBe("matched");
    expect(row.pattern).toBe("hammer");
    expect(row.prev_weak).toBe(false);
    expect(row.entry).toBeCloseTo(99.5, 5);
    expect(row.stop).toBeCloseTo(95, 5);
    expect(row.alerted_at).toBeTruthy();
    expect(row.shadow_matches).toEqual([]);
  });

  it("a real bearish engulfing produces exactly one Pushover and detection_status 'matched'", async () => {
    getSession.mockResolvedValue(baseRow({ ...BE_BOX, atr14: BE_ATR, direction: "bearish" }));
    fetchIntradayOhlc.mockResolvedValue([bePrev(9, 45), beBar(9, 50)]);
    const res = makeRes();
    await handler(makeReq(), res);

    expect(sendPushover).toHaveBeenCalledTimes(1);
    const [, row] = upsertSession.mock.calls[0];
    expect(row.detection_status).toBe("matched");
    expect(row.pattern).toBe("bearish_engulfing");
    expect(row.prev_weak).toBe(false);
    expect(row.entry).toBeCloseTo(111.5, 5);
    expect(row.stop).toBeCloseTo(113.2, 5);
    expect(row.alerted_at).toBeTruthy();
  });

  it("t1Ahead false: alert text calls it out instead of printing a bare 0.00R, T2 still carries an R:R", async () => {
    getSession.mockResolvedValue(baseRow({ ...T1_BOX, atr14: T1_ATR, direction: "bullish" }));
    fetchIntradayOhlc.mockResolvedValue([flat(9, 45), t1BehindBar(9, 50)]);
    const res = makeRes();
    await handler(makeReq(), res);

    expect(sendPushover).toHaveBeenCalledTimes(1);
    const [, row] = upsertSession.mock.calls[0];
    expect(row.t1_ahead).toBe(false);

    const push = sendPushover.mock.calls[0][0];
    expect(push.message).toMatch(/already passed at entry/);
    expect(push.message).not.toMatch(/T1[^\n]*0\.00R/);
    expect(push.message).toMatch(/T2 .*R\)/);
  });
});

// The engulfing pattern names already encode their side ("bullish_engulfing",
// "bearish_engulfing"), so the title template must strip that before
// prefixing dirWord — otherwise it stutters ("Bullish bullish engulfing").
// Each case below pins the EXACT title string (not a loose regex) so a
// future edit to the template can't reintroduce the stutter or silently
// drop the direction for hammer/inverted_hammer, which carry no side word
// of their own.
describe("api/orb-scan — alert title text (no side-word stutter)", () => {
  it("hammer -> 'QQQ ORB — Bullish hammer'", async () => {
    getSession.mockResolvedValue(baseRow({ ...HAMMER_BOX, atr14: HAMMER_ATR, direction: "bullish" }));
    fetchIntradayOhlc.mockResolvedValue([flat(9, 45), hammer(9, 50)]);
    await handler(makeReq(), makeRes());
    expect(sendPushover.mock.calls[0][0].title).toBe("QQQ ORB — Bullish hammer");
  });

  it("inverted_hammer -> 'QQQ ORB — Bearish inverted hammer'", async () => {
    getSession.mockResolvedValue(baseRow({ ...IH_BOX, atr14: IH_ATR, direction: "bearish" }));
    fetchIntradayOhlc.mockResolvedValue([flat(9, 45), ihBar(9, 50)]);
    await handler(makeReq(), makeRes());
    expect(sendPushover.mock.calls[0][0].title).toBe("QQQ ORB — Bearish inverted hammer");
  });

  it("bullish_engulfing -> 'QQQ ORB — Bullish engulfing' (no duplicated side word)", async () => {
    getSession.mockResolvedValue(baseRow({ ...BU_BOX, atr14: BU_ATR, direction: "bullish" }));
    fetchIntradayOhlc.mockResolvedValue([buPrev(9, 45), buBar(9, 50)]);
    await handler(makeReq(), makeRes());
    expect(sendPushover.mock.calls[0][0].title).toBe("QQQ ORB — Bullish engulfing");
  });

  it("bearish_engulfing -> 'QQQ ORB — Bearish engulfing' (no duplicated side word)", async () => {
    getSession.mockResolvedValue(baseRow({ ...BE_BOX, atr14: BE_ATR, direction: "bearish" }));
    fetchIntradayOhlc.mockResolvedValue([bePrev(9, 45), beBar(9, 50)]);
    await handler(makeReq(), makeRes());
    expect(sendPushover.mock.calls[0][0].title).toBe("QQQ ORB — Bearish engulfing");
  });

  it("pins the full message body end to end for a normal (non-degenerate) signal", async () => {
    getSession.mockResolvedValue(baseRow({ ...HAMMER_BOX, atr14: HAMMER_ATR, direction: "bullish" }));
    fetchIntradayOhlc.mockResolvedValue([flat(9, 45), hammer(9, 50)]);
    await handler(makeReq(), makeRes());

    const push = sendPushover.mock.calls[0][0];
    expect(push.title).toBe("QQQ ORB — Bullish hammer");
    expect(push.message).toBe(
      "Entry 99.50  Stop 95.00  Risk 4.50\n" +
      "T1 100.00 (0.11R)\n" +
      "T2 110.00 (2.33R)\n" +
      "Box 100.00–110.00\n" +
      "20 min into session"
    );
  });
});

describe("api/orb-scan — prevWeak suppression (most important test)", () => {
  it("a prevWeak match sends NO Pushover but DOES appear in shadow_matches", async () => {
    getSession.mockResolvedValue(baseRow({ ...WEAK_BOX, atr14: WEAK_ATR, direction: "bullish" }));
    fetchIntradayOhlc.mockResolvedValue([weakPrev(9, 45), weakBar(9, 50)]);
    const res = makeRes();
    await handler(makeReq(), res);

    expect(sendPushover).not.toHaveBeenCalled();
    const [, row] = upsertSession.mock.calls[0];
    expect(row.shadow_matches).toHaveLength(1);
    expect(row.shadow_matches[0].pattern).toBe("bullish_engulfing");
    expect(row.shadow_matches[0].prev_weak).toBe(true);
    // Not promoted: detection_status untouched (still pending, before deadline).
    expect(row.detection_status).toBeUndefined();
    expect(row.pattern).toBeUndefined();
  });
});

describe("api/orb-scan — dedup and shadow routing", () => {
  it("a second match after a primary goes to shadow_matches, not a second push", async () => {
    getSession.mockResolvedValue(baseRow({ ...HAMMER_BOX, atr14: HAMMER_ATR, direction: "bullish" }));
    fetchIntradayOhlc.mockResolvedValue([flat(9, 45), hammer(9, 50), hammer(9, 55)]);
    const res = makeRes();
    await handler(makeReq(), res);

    expect(sendPushover).toHaveBeenCalledTimes(1);
    const [, row] = upsertSession.mock.calls[0];
    expect(row.pattern_bar_start).toBe(hammer(9, 50).start);
    expect(row.shadow_matches).toHaveLength(1);
    expect(row.shadow_matches[0].bar_start).toBe(hammer(9, 55).start);
  });

  it("alerted_at already set: no second push on a later invocation, new match still logged to shadow", async () => {
    getSession.mockResolvedValue(baseRow({
      ...HAMMER_BOX, atr14: HAMMER_ATR, direction: "bullish",
      detection_status: "matched", alerted_at: "2026-08-04T13:50:00.000Z",
      last_scanned_bar: hammer(9, 50).start,
    }));
    fetchIntradayOhlc.mockResolvedValue([flat(9, 45), hammer(9, 50), hammer(9, 55)]);
    const res = makeRes();
    await handler(makeReq(), res);

    expect(sendPushover).not.toHaveBeenCalled();
    const [, row] = upsertSession.mock.calls[0];
    expect(row.shadow_matches).toHaveLength(1);
    expect(row.shadow_matches[0].bar_start).toBe(hammer(9, 55).start);
    // Stored status preserved, not re-sent.
    expect(row.detection_status).toBeUndefined();
    expect(row.alerted_at).toBeUndefined();
  });
});

describe("api/orb-scan — cursor self-healing", () => {
  it("skips bars at/before the cursor, and one invocation catches every bar after a gap", async () => {
    const cursorBar = hammer(9, 50); // would match if evaluated, but is AT the cursor -> skipped
    getSession.mockResolvedValue(baseRow({
      ...HAMMER_BOX, atr14: HAMMER_ATR, direction: "bullish",
      last_scanned_bar: cursorBar.start,
    }));
    fetchIntradayOhlc.mockResolvedValue([
      flat(9, 45),
      cursorBar,           // 09:50 — at the cursor, must NOT be re-evaluated
      hammer(9, 55),        // first bar after the cursor -> primary
      hammer(10, 0),         // simulates a missed invocation -> still caught, shadow
      hammer(10, 5),         // shadow
    ]);
    const res = makeRes();
    await handler(makeReq(), res);

    expect(sendPushover).toHaveBeenCalledTimes(1);
    const [, row] = upsertSession.mock.calls[0];
    expect(row.pattern_bar_start).toBe(hammer(9, 55).start);
    expect(row.shadow_matches).toHaveLength(2);
    expect(row.shadow_matches.map((m) => m.bar_start)).toEqual([
      hammer(10, 0).start,
      hammer(10, 5).start,
    ]);
    expect(row.last_scanned_bar).toBe(hammer(10, 5).start);
  });
});

describe("api/orb-scan — hard time gate", () => {
  it("a bar at or past 11:00 ET is never evaluated", async () => {
    getSession.mockResolvedValue(baseRow({ ...HAMMER_BOX, atr14: HAMMER_ATR, direction: "bullish" }));
    fetchIntradayOhlc.mockResolvedValue([flat(9, 45), hammer(9, 50), hammer(11, 0)]);
    const res = makeRes();
    await handler(makeReq(), res);

    expect(sendPushover).toHaveBeenCalledTimes(1);
    const [, row] = upsertSession.mock.calls[0];
    expect(row.pattern_bar_start).toBe(hammer(9, 50).start);
    expect(row.shadow_matches).toEqual([]);
    // Cursor must not advance past the excluded 11:00 bar.
    expect(row.last_scanned_bar).toBe(hammer(9, 50).start);
  });
});

describe("api/orb-scan — expiry", () => {
  it("no match, at/after the deadline, row still pending: detection_status becomes 'expired'", async () => {
    nowMinutesET.mockReturnValue(WINDOW_END_MIN);
    getSession.mockResolvedValue(baseRow({ ...HAMMER_BOX, atr14: HAMMER_ATR, direction: "bullish" }));
    fetchIntradayOhlc.mockResolvedValue([flat(9, 45), flat(9, 50)]);
    const res = makeRes();
    await handler(makeReq(), res);

    expect(sendPushover).not.toHaveBeenCalled();
    const [, row] = upsertSession.mock.calls[0];
    expect(row.detection_status).toBe("expired");
  });

  it("no match, before the deadline: detection_status is NOT sent at all", async () => {
    nowMinutesET.mockReturnValue(BOX_COMPLETE_MIN + 10);
    getSession.mockResolvedValue(baseRow({ ...HAMMER_BOX, atr14: HAMMER_ATR, direction: "bullish" }));
    fetchIntradayOhlc.mockResolvedValue([flat(9, 45), flat(9, 50)]);
    const res = makeRes();
    await handler(makeReq(), res);

    const [, row] = upsertSession.mock.calls[0];
    expect("detection_status" in row).toBe(false);
  });

  it("at/after the deadline but row already 'matched' from an earlier invocation: not regressed to expired", async () => {
    nowMinutesET.mockReturnValue(WINDOW_END_MIN + 5);
    getSession.mockResolvedValue(baseRow({
      ...HAMMER_BOX, atr14: HAMMER_ATR, direction: "bullish",
      detection_status: "matched", alerted_at: "2026-08-04T13:50:00.000Z",
    }));
    fetchIntradayOhlc.mockResolvedValue([flat(9, 45), flat(9, 50)]);
    const res = makeRes();
    await handler(makeReq(), res);

    expect(sendPushover).not.toHaveBeenCalled();
    const [, row] = upsertSession.mock.calls[0];
    expect("detection_status" in row).toBe(false);
  });
});

describe("api/orb-scan — resilience", () => {
  it("buildSignal throwing on one bar does not abort the scan — later bars still evaluated", async () => {
    buildSignal.mockImplementationOnce(() => { throw new Error("boom"); });
    getSession.mockResolvedValue(baseRow({ ...HAMMER_BOX, atr14: HAMMER_ATR, direction: "bullish" }));
    // hammer(9,50) hits the forced throw and is swallowed; hammer(9,55) goes
    // through the real (unmocked-for-this-call) implementation and becomes
    // the primary.
    fetchIntradayOhlc.mockResolvedValue([flat(9, 45), hammer(9, 50), hammer(9, 55)]);
    const res = makeRes();
    await expect(handler(makeReq(), res)).resolves.not.toThrow();

    expect(res.status).toHaveBeenCalledWith(200);
    expect(sendPushover).toHaveBeenCalledTimes(1);
    const [, row] = upsertSession.mock.calls[0];
    expect(row.pattern_bar_start).toBe(hammer(9, 55).start);
    expect(row.last_scanned_bar).toBe(hammer(9, 55).start);
  });
});

describe("api/orb-scan — Pushover unconfigured", () => {
  it("push skipped: alerted_at is not set but the row still records the match", async () => {
    sendPushover.mockResolvedValue({ skipped: true, reason: "env_missing" });
    getSession.mockResolvedValue(baseRow({ ...HAMMER_BOX, atr14: HAMMER_ATR, direction: "bullish" }));
    fetchIntradayOhlc.mockResolvedValue([flat(9, 45), hammer(9, 50)]);
    const res = makeRes();
    await handler(makeReq(), res);

    expect(sendPushover).toHaveBeenCalledTimes(1);
    const [, row] = upsertSession.mock.calls[0];
    expect(row.detection_status).toBe("matched");
    expect(row.pattern).toBe("hammer");
    expect(row.alerted_at).toBeUndefined();
  });
});

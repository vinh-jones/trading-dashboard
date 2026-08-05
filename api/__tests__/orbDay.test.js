// api/__tests__/orbDay.test.js
//
// api/orb-day.js is read-only and does real I/O (Supabase), so we mock its
// external seam — ./_lib/orbDb.js — and partially mock the ET clock helper
// in src/lib/orb/calendar.js (only todayET is overridden). Unlike
// orbScan.test.js / orbOutcomeApi.test.js, orb-day.js doesn't call
// getSession/upsertSession — it builds its own Supabase query chain
// (.from().select().eq().order().limit()), so the mock here is a fake
// chainable client rather than mocked helper functions.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../_lib/orbDb.js", () => ({
  getSupabase: vi.fn(),
}));

vi.mock("../../src/lib/orb/calendar.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    todayET: vi.fn(actual.todayET),
  };
});

import handler from "../orb-day.js";
import { getSupabase } from "../_lib/orbDb.js";
import { todayET } from "../../src/lib/orb/calendar.js";

const APP_SECRET = "test-app-secret";
const TODAY = "2026-08-05";

function makeReq({ query = {}, method = "GET", headers } = {}) {
  return { method, headers: headers ?? { authorization: `Bearer ${APP_SECRET}` }, query };
}

function makeRes() {
  const res = {};
  res.status = vi.fn((code) => { res.statusCode = code; return res; });
  res.json = vi.fn((body) => { res.body = body; return res; });
  return res;
}

// Fake Supabase query builder: .from/.select/.eq/.order all return the same
// chainable object; .limit() is the terminal call and resolves the query,
// matching how api/orb-day.js actually chains its read.
function makeSupabase({ data = [], error = null } = {}) {
  const client = {};
  client.from   = vi.fn(() => client);
  client.select = vi.fn(() => client);
  client.eq     = vi.fn(() => client);
  client.order  = vi.fn(() => client);
  client.limit  = vi.fn(() => Promise.resolve({ data, error }));
  return client;
}

function row(sessionDate, overrides = {}) {
  return { id: sessionDate, symbol: "QQQ", session_date: sessionDate, detection_status: "pending", ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.APP_SECRET = APP_SECRET;
  todayET.mockReturnValue(TODAY);
});

describe("api/orb-day — method and auth", () => {
  it("rejects a non-GET method with 405", async () => {
    const res = makeRes();
    await handler(makeReq({ method: "POST" }), res);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(getSupabase).not.toHaveBeenCalled();
  });

  it("rejects a request with no credentials with 401, and never touches the database", async () => {
    const res = makeRes();
    await handler(makeReq({ headers: {} }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(getSupabase).not.toHaveBeenCalled();
  });

  it("accepts the app_auth cookie as an alternative to the bearer token", async () => {
    const supabase = makeSupabase({ data: [] });
    getSupabase.mockReturnValue(supabase);
    const res = makeRes();
    await handler(makeReq({ headers: { cookie: `app_auth=${APP_SECRET}` } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe("api/orb-day — today/history split", () => {
  it("splits today's row out of history when it's present in the page", async () => {
    const supabase = makeSupabase({
      data: [row(TODAY), row("2026-08-04"), row("2026-08-03")],
    });
    getSupabase.mockReturnValue(supabase);
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.today).toEqual(row(TODAY));
    expect(res.body.history).toEqual([row("2026-08-04"), row("2026-08-03")]);
  });

  it("returns today: null and still returns history when there is no row for today", async () => {
    const supabase = makeSupabase({
      data: [row("2026-08-04"), row("2026-08-03")],
    });
    getSupabase.mockReturnValue(supabase);
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.body.today).toBeNull();
    expect(res.body.history).toEqual([row("2026-08-04"), row("2026-08-03")]);
  });

  it("propagates a Supabase error as a 500 with the message", async () => {
    const supabase = makeSupabase({ data: null, error: { message: "boom" } });
    getSupabase.mockReturnValue(supabase);
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.body.error).toMatch(/boom/);
  });
});

describe("api/orb-day — limit handling", () => {
  it("defaults to a limit of 30 (queries limit+1 = 31)", async () => {
    const supabase = makeSupabase({ data: [] });
    getSupabase.mockReturnValue(supabase);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(supabase.limit).toHaveBeenCalledWith(31);
  });

  it("?limit=90 is honored (queries limit+1 = 91)", async () => {
    const supabase = makeSupabase({ data: [] });
    getSupabase.mockReturnValue(supabase);
    const res = makeRes();
    await handler(makeReq({ query: { limit: "90" } }), res);
    expect(supabase.limit).toHaveBeenCalledWith(91);
  });

  it("?limit=500 clamps to 250 (queries limit+1 = 251)", async () => {
    const supabase = makeSupabase({ data: [] });
    getSupabase.mockReturnValue(supabase);
    const res = makeRes();
    await handler(makeReq({ query: { limit: "500" } }), res);
    expect(supabase.limit).toHaveBeenCalledWith(251);
  });

  it("a non-numeric limit falls back to the default instead of NaN", async () => {
    const supabase = makeSupabase({ data: [] });
    getSupabase.mockReturnValue(supabase);
    const res = makeRes();
    await handler(makeReq({ query: { limit: "banana" } }), res);
    expect(supabase.limit).toHaveBeenCalledWith(31);
  });

  it("history is sliced back down to the limit even when today's row rides along in the same page", async () => {
    // limit=2 -> query fetches 3; today's row plus 2 history rows fill it
    // exactly, so slicing to `limit` shouldn't drop anything real.
    const supabase = makeSupabase({
      data: [row(TODAY), row("2026-08-04"), row("2026-08-03")],
    });
    getSupabase.mockReturnValue(supabase);
    const res = makeRes();
    await handler(makeReq({ query: { limit: "2" } }), res);

    expect(supabase.limit).toHaveBeenCalledWith(3);
    expect(res.body.today).toEqual(row(TODAY));
    expect(res.body.history).toHaveLength(2);
  });
});

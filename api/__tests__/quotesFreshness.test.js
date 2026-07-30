import { describe, it, expect } from "vitest";
import { latestQuoteRefreshAge } from "../quotes.js";

// Regression guard for the "option marks freeze at the open" bug.
//
// `quotes.refreshed_at` is a SHARED column: api/bb.js (every 15 min) and
// api/uw-iv.js (every 30 min) stamp it on EQUITY rows all session long, so it
// can't tell whether the live Public.com fetch actually ran. api/quotes.js owns
// a dedicated `quotes_refreshed_at` column (mirroring bb.js's bb_refreshed_at)
// and the refresh gate must measure freshness from THAT column only.

// Minimal fake of the supabase-js query builder: honors .eq()/.not() filters,
// sorts by the .order() column, and returns the freshest matching row.
function fakeSupabaseWith(rows) {
  const eqs = [];
  const notNulls = [];
  let orderCol = null;
  const builder = {
    from() { return builder; },
    select() { return builder; },
    eq(col, val) { eqs.push([col, val]); return builder; },
    not(col, op, val) { if (op === "is" && val === null) notNulls.push(col); return builder; },
    order(col) { orderCol = col; return builder; },
    limit() { return builder; },
    async maybeSingle() {
      const matched = rows
        .filter(r => eqs.every(([c, v]) => r[c] === v))
        .filter(r => notNulls.every(c => r[c] != null))
        .sort((a, b) => new Date(b[orderCol]) - new Date(a[orderCol]));
      return { data: matched[0] ?? null, error: null };
    },
  };
  return builder;
}

describe("latestQuoteRefreshAge — gate reads the dedicated quotes_refreshed_at column", () => {
  it("reports the stale live-marks age even when bb.js just stamped refreshed_at", async () => {
    const now = new Date("2026-07-30T14:15:00Z").getTime();
    const supabase = fakeSupabaseWith([
      // bb.js stamped the shared refreshed_at fresh 1 min ago, but never touches
      // quotes_refreshed_at (leaves it null on equity rows).
      { instrument_type: "EQUITY", refreshed_at: "2026-07-30T14:14:00Z", quotes_refreshed_at: null },
      // quotes.js last wrote the live option mark 45 min ago (the 9:30 open).
      { instrument_type: "OPTION", refreshed_at: "2026-07-30T13:30:00Z", quotes_refreshed_at: "2026-07-30T13:30:00Z" },
    ]);

    const { ageMs } = await latestQuoteRefreshAge(supabase, now);

    // Must reflect the 45-min-stale quotes_refreshed_at, NOT the fresh refreshed_at.
    expect(ageMs).toBe(45 * 60 * 1000);
  });

  it("returns Infinity age when no row has been stamped by quotes.js yet", async () => {
    const now = Date.now();
    const supabase = fakeSupabaseWith([
      { instrument_type: "EQUITY", refreshed_at: new Date(now).toISOString(), quotes_refreshed_at: null },
    ]);

    const { ageMs, lastRefresh } = await latestQuoteRefreshAge(supabase, now);

    expect(ageMs).toBe(Infinity);
    expect(lastRefresh).toBeNull();
  });
});

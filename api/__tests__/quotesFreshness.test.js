import { describe, it, expect } from "vitest";
import { latestOptionQuoteAge } from "../quotes.js";

// Regression guard for the "option marks freeze at the open" bug.
//
// `quotes.refreshed_at` is a SHARED column: api/bb.js (every 15 min) and
// api/uw-iv.js (every 30 min) stamp it on EQUITY rows all session long. The
// /api/quotes refresh gate must therefore measure freshness from OPTION rows
// only — the rows this endpoint alone writes — or the whole-table max stays
// perpetually fresh and refreshQuotes() never runs intraday.

// Minimal fake of the supabase-js query builder: records .eq() filters and
// returns the freshest row that matches them (mirrors .order().limit(1)).
function fakeSupabaseWith(rows) {
  const filters = [];
  const builder = {
    from() { return builder; },
    select() { return builder; },
    eq(col, val) { filters.push([col, val]); return builder; },
    order() { return builder; },
    limit() { return builder; },
    async maybeSingle() {
      const matched = rows
        .filter(r => filters.every(([c, v]) => r[c] === v))
        .sort((a, b) => new Date(b.refreshed_at) - new Date(a.refreshed_at));
      return { data: matched[0] ?? null, error: null };
    },
  };
  return builder;
}

describe("latestOptionQuoteAge — gate reads OPTION-row freshness, not the shared max", () => {
  it("reports the stale OPTION age even when an EQUITY row was just refreshed", async () => {
    const now = new Date("2026-07-30T14:15:00Z").getTime();
    const supabase = fakeSupabaseWith([
      // bb.js stamped refreshed_at on this equity row 1 min ago…
      { instrument_type: "EQUITY", refreshed_at: "2026-07-30T14:14:00Z" },
      // …but the live option mark is 45 min stale (frozen since the 9:30 open).
      { instrument_type: "OPTION", refreshed_at: "2026-07-30T13:30:00Z" },
    ]);

    const { ageMs } = await latestOptionQuoteAge(supabase, now);

    // Must reflect the 45-min-stale OPTION row, NOT the 1-min-fresh EQUITY row.
    expect(ageMs).toBe(45 * 60 * 1000);
  });

  it("returns Infinity age when the portfolio holds no options", async () => {
    const now = Date.now();
    const supabase = fakeSupabaseWith([
      { instrument_type: "EQUITY", refreshed_at: new Date(now).toISOString() },
    ]);

    const { ageMs, lastRefresh } = await latestOptionQuoteAge(supabase, now);

    expect(ageMs).toBe(Infinity);
    expect(lastRefresh).toBeNull();
  });
});

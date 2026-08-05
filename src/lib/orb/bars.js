// src/lib/orb/bars.js
//
// Unusual Whales returns OHLC newest-first, with h/l as strings and o/c as
// numbers. Everything downstream assumes ascending order and numeric fields,
// so every UW payload passes through here first.

const ET = "America/New_York";

/** ISO timestamp -> "YYYY-MM-DD" in Eastern Time. */
export function etDate(iso) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: ET });
}

/** ISO timestamp -> minutes past midnight ET. */
export function etMinutes(iso) {
  const s = new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: ET, hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

// Number(null) coerces to 0 and Number("") / Number("  ") also coerce to 0 —
// none of those are a signal we want to treat as "valid but zero". A
// null/undefined/missing/blank OHLC field should disqualify the bar, so
// coerce those to NaN explicitly before Number.isFinite gets to judge them.
function toNum(v) {
  if (v === null || v === undefined) return NaN;
  if (typeof v === "string" && v.trim() === "") return NaN;
  return Number(v);
}

export function normalizeBars(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((b) => b && typeof b === "object")
    .map((b) => ({
      start: b.start,
      end:   b.end,
      o: toNum(b.o),
      h: toNum(b.h),
      l: toNum(b.l),
      c: toNum(b.c),
      vol: Number(b.vol ?? 0),
      market: b.market,
    }))
    .filter((b) =>
      b.start &&
      // No regular-session query param exists on the UW OHLC endpoint, so
      // extended-hours bars can come back mixed in with regular-session ones.
      // Absent `market` must still pass — existing fixtures/tests omit the
      // field entirely, and only live payloads carry it.
      (b.market === undefined || b.market === "r") &&
      [b.o, b.h, b.l, b.c].every((v) => Number.isFinite(v)))
    .sort((a, b) => new Date(a.start) - new Date(b.start));
}

export function sliceSession(bars, sessionDate) {
  return bars.filter((b) => etDate(b.start) === sessionDate);
}

/**
 * UW's 1d/1w candles carry a `date` field and no start/end timestamps, so they
 * cannot go through normalizeBars (which requires `start`). Keep daily bars in
 * date space rather than synthesizing an instant — a bare date turned into a
 * timestamp is exactly the kind of conversion that silently lands on the wrong
 * calendar day.
 *
 * @returns {Array<{date:string,o:number,h:number,l:number,c:number,vol:number}>}
 *          sorted ascending by date
 */
export function normalizeDailyBars(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((b) => b && typeof b === "object")
    .map((b) => ({
      date: b.date,
      o: toNum(b.o), h: toNum(b.h), l: toNum(b.l), c: toNum(b.c),
      vol: Number(b.vol ?? 0),
    }))
    .filter((b) =>
      typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date) &&
      [b.o, b.h, b.l, b.c].every((v) => Number.isFinite(v)))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

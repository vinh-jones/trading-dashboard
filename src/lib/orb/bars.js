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

// Number(null) and Number(undefined) coerce to 0 / NaN respectively — neither
// is a signal we want to treat as "valid but zero". A null/undefined/missing
// OHLC field should disqualify the bar, so coerce those to NaN explicitly
// before Number.isFinite gets to judge them.
function toNum(v) {
  return v === null || v === undefined ? NaN : Number(v);
}

export function normalizeBars(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((b) => ({
      start: b.start,
      end:   b.end,
      o: toNum(b.o),
      h: toNum(b.h),
      l: toNum(b.l),
      c: toNum(b.c),
      vol: Number(b.vol ?? 0),
    }))
    .filter((b) =>
      b.start &&
      [b.o, b.h, b.l, b.c].every((v) => Number.isFinite(v)))
    .sort((a, b) => new Date(a.start) - new Date(b.start));
}

export function sliceSession(bars, sessionDate) {
  return bars.filter((b) => etDate(b.start) === sessionDate);
}

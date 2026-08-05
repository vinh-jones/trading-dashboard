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
    }))
    .filter((b) =>
      b.start &&
      [b.o, b.h, b.l, b.c].every((v) => Number.isFinite(v)))
    .sort((a, b) => new Date(a.start) - new Date(b.start));
}

export function sliceSession(bars, sessionDate) {
  return bars.filter((b) => etDate(b.start) === sessionDate);
}

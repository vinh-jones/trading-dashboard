// src/lib/orb/calendar.js
//
// NYSE full-closure dates. Early closes are deliberately absent: the ORB window
// runs 09:45-11:00 ET and always completes before a 13:00 half-day close, so a
// half day is an ordinary session for this strategy.
//
// Vercel crons run in UTC and the market runs in ET, so the cron expressions are
// scheduled wide enough to cover both DST offsets and each handler gates on real
// ET wall-clock using nowMinutesET()/todayET() below. Do not move that gating
// into the cron expression.
//
// Extend NYSE_HOLIDAYS before 2028.

export const NYSE_HOLIDAYS = new Set([
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  // 2027
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
  "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

/** @param {string} sessionDate "YYYY-MM-DD" (an ET calendar date) */
export function isTradingDay(sessionDate) {
  if (NYSE_HOLIDAYS.has(sessionDate)) return false;
  // Parse as UTC noon so no timezone can shift the weekday.
  const day = new Date(`${sessionDate}T12:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
}

/**
 * ET calendar date, "YYYY-MM-DD", for the given instant (defaults to now).
 * A late-evening UTC instant can still be the previous day in ET — e.g.
 * 2026-08-05T02:00:00Z is 2026-08-04 22:00 ET. Getting this wrong writes the
 * handler's output to the wrong session row overnight.
 */
export function todayET(now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/**
 * Minutes past midnight, ET, for the given instant (defaults to now).
 *
 * The same UTC instant lands on a different ET minute-of-day depending on
 * whether DST is in effect (EDT = UTC-4, EST = UTC-5) — e.g. 13:45 UTC is
 * 09:45 ET in March (EDT) but 08:45 ET in January (EST). This is the whole
 * reason the crons are scheduled wide and the handlers gate on this function
 * instead of relying on the cron expression's fixed UTC time: if this drifts,
 * the system runs an hour off for half the year.
 */
export function nowMinutesET(now = new Date()) {
  const s = now.toLocaleTimeString("en-GB", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

// Window predicates, expressed as pure functions of ET minutes-past-midnight so
// they're testable without touching the clock. All three handlers gate on these.

export const MARKET_OPEN_MIN = 9 * 60 + 30;   // 09:30 ET
export const BOX_COMPLETE_MIN = 9 * 60 + 45;  // 09:45 ET — opening range is set
export const WINDOW_END_MIN = 11 * 60;        // 11:00 ET — hard deadline

/** The 09:45 job: build the box. Narrow window so a stuck cron cannot re-run it at noon. */
export function isBoxWindow(mins) {
  return mins >= BOX_COMPLETE_MIN && mins < BOX_COMPLETE_MIN + 15;
}

/** The 5-minute scan. Starts one bar after the box, runs 10 min past the deadline
 *  so the final bars still get scanned and the row can be closed out as expired. */
export function isScanWindow(mins) {
  return mins >= BOX_COMPLETE_MIN + 5 && mins <= WINDOW_END_MIN + 10;
}

/** Outcome resolution: after the closing bell. */
export function isAfterClose(mins) {
  return mins >= 16 * 60;
}

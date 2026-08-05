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

/** Today's ET calendar date, "YYYY-MM-DD". */
export function todayET() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Minutes past midnight, ET, right now. */
export function nowMinutesET() {
  const s = new Date().toLocaleTimeString("en-GB", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

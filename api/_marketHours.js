// Shared market-hours checks for server-side API routes.
//
// Two windows are exposed because different callers have intentionally
// different needs:
//
//   isMarketOpen()          — 9:30 AM–4:00 PM ET, Mon–Fri. Regular cash session.
//                             Use for signal-dependent features (alerts, quotes
//                             freshness, radar sample fetch) where pre-market's
//                             thin data is worse than no data.
//
//   isMarketOpenExtended()  — 8:30 AM–4:15 PM ET, Mon–Fri. Extended window.
//                             Use for cache warmup / EOD cron routes that want
//                             one last pass 15 min after close to capture
//                             settled prices, and a pre-market warmup window.
//
// Both gate on isTradingDay(), which covers weekends AND NYSE full closures.
// The Vercel cron expressions can only express day-of-week (`* * 1-5`), so a
// holiday that falls on a weekday reaches the handler and has to be rejected
// here — Labor Day 2026 otherwise ran a full alert evaluation against a frozen
// book and paged on a position that had not moved.

import { isTradingDay, todayET, nowMinutesET } from "../src/lib/orb/calendar.js";

const OPEN_MIN           = 9 * 60 + 30;   // 09:30 ET
const CLOSE_MIN          = 16 * 60;       // 16:00 ET
const EXTENDED_OPEN_MIN  = 8 * 60 + 30;   // 08:30 ET
const EXTENDED_CLOSE_MIN = 16 * 60 + 15;  // 16:15 ET

export function isMarketOpen() {
  if (!isTradingDay(todayET())) return false;
  const mins = nowMinutesET();
  return mins >= OPEN_MIN && mins <= CLOSE_MIN;
}

export function isMarketOpenExtended() {
  if (!isTradingDay(todayET())) return false;
  const mins = nowMinutesET();
  return mins >= EXTENDED_OPEN_MIN && mins <= EXTENDED_CLOSE_MIN;
}

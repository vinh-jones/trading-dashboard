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

function nowET() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}

export function isMarketOpen() {
  const et   = nowET();
  const day  = et.getDay();                               // 0=Sun, 6=Sat
  const time = et.getHours() + et.getMinutes() / 60;
  return day >= 1 && day <= 5 && time >= 9.5 && time <= 16;
}

export function isMarketOpenExtended() {
  const et   = nowET();
  const day  = et.getDay();
  const time = et.getHours() + et.getMinutes() / 60;
  return day >= 1 && day <= 5 && time >= 8.5 && time <= 16.25;
}

-- Flow smoothing (finance review): persist the intraday EMA and the daily-close
-- streak so flow-driven pull-toward-risk recommendations (let-it-ride, ★ whale
-- candidacy) require confirmed, repeated flow rather than a single print.
-- flow_sentiment stays the raw current reading; these are the smoothed/streak
-- layers maintained by the uw-snapshot cron via src/lib/flowSmoothing.js.
--
-- Idempotent: re-running is a no-op.

alter table public.uw_signals
  add column if not exists flow_ema    numeric,
  add column if not exists flow_day    date,
  add column if not exists flow_streak integer default 0;

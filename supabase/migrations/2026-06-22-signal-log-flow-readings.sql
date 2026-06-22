-- Decision-attribution: log BOTH flow readings side by side during the
-- observation window (finance review), so the week-4 scoreboard can adjudicate
-- which definition earns its keep from data rather than guessing.
--   flow_alert — the alert-subset value the app currently uses (flow_ema)
--   flow_tape  — the full-tape / aggregate value (null until the cron wires it)
--
-- Idempotent: re-running is a no-op.

alter table public.signal_log
  add column if not exists flow_alert numeric,
  add column if not exists flow_tape  numeric;

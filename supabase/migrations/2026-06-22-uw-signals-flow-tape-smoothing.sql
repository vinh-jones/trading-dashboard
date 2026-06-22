-- Flow-tape smoothing state. The raw full-tape conviction reading (flow_tape,
-- added in 2026-06-22-uw-signals-flow-tape.sql) gets its OWN smoothing track —
-- separate from the alert-subset's flow_ema/flow_day/flow_streak — so the
-- let-it-ride overlay keeps the finance-review rigor: an intraday EMA kills
-- single-print noise and a multi-day streak demands repeat activity before the
-- tool nudges toward risk. Mirrors updateFlowState's three-field shape exactly:
--   flow_tape_ema    — intraday EMA over the snapshots (alpha 0.3)
--   flow_tape_day    — the trading day the EMA belongs to (streak roll boundary)
--   flow_tape_streak — consecutive in-direction trading days
--
-- Sourced for held tickers on the 15-min uw-snapshot run and for the full
-- approved universe on the twice-daily uw-gex run. The conviction consumers read
-- flow_tape_ema (entry nudge) and flow_tape_ema + flow_tape_streak (let-it-ride);
-- both stay no-ops until populated.
--
-- Idempotent: re-running is a no-op.

alter table public.uw_signals
  add column if not exists flow_tape_ema    numeric,
  add column if not exists flow_tape_day    date,
  add column if not exists flow_tape_streak integer;

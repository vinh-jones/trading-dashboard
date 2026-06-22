-- Flow-split (finance review): the single flow_sentiment scalar was being read by
-- three consumers that actually want three different definitions. This column
-- holds the FULL-TAPE conviction reading (far-OTM put-selling conviction across
-- the whole tape), distinct from the alert-subset value (flow_sentiment/flow_ema,
-- which captures near-money hedging in the unusual-activity feed).
--
-- The conviction consumers route here:
--   • let-it-ride overlay (OpenPositionsTab) — pull-toward-risk; extends a hold.
--   • entry-score flow nudge (RadarTab/entryScore) — the ±15% richness modifier.
-- Both "go quiet until sourced": flow_tape is null until the snapshot cron wires
-- the per-strike / aggregate endpoint, so confirmedBullish stays false and
-- flowMod is a no-op — they never run on the wrong (alert-subset) definition.
--
-- Defense + shed stay on the alert subset; candidacy keys off the put-sell tape
-- (the whale prints) directly — neither reads this column.
--
-- Idempotent: re-running is a no-op.

alter table public.uw_signals
  add column if not exists flow_tape numeric;

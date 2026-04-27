-- Assigned-share income & health snapshot — daily_snapshots columns.
-- Persists the aggregate result of computeAssignedShareIncome alongside
-- each EOD snapshot so historical capacity/health trends are queryable
-- without re-running the option-chain calc.
--
-- Headline totals (rounded $/mo):
--   assigned_share_income_total       — every position, raw
--   assigned_share_income_on_target   — excludes delta-off-target picks
--   assigned_share_income_healthy     — band rollup
--   assigned_share_income_recovering  — band rollup
--   assigned_share_income_grinding    — band rollup
--
-- Per-position breakdown stored as JSONB for ad-hoc analysis. Same shape
-- as the API's `per_position` array.

ALTER TABLE public.daily_snapshots
  ADD COLUMN IF NOT EXISTS assigned_share_income_total       numeric,
  ADD COLUMN IF NOT EXISTS assigned_share_income_on_target   numeric,
  ADD COLUMN IF NOT EXISTS assigned_share_income_healthy     numeric,
  ADD COLUMN IF NOT EXISTS assigned_share_income_recovering  numeric,
  ADD COLUMN IF NOT EXISTS assigned_share_income_grinding    numeric,
  ADD COLUMN IF NOT EXISTS assigned_share_income_per_position jsonb;

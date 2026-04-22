-- Pipeline Forecast v2 — add new columns to daily_snapshots.
-- See docs/pipeline_forecast_v2_spec.md §Data model.
--
-- Legacy `open_premium_expected` (flat-60% assumption) and
-- `pipeline_implied_monthly` are retained for at least 30 days for
-- backward compatibility per spec §Implementation Note 9.

alter table public.daily_snapshots
  add column if not exists forecast_realized_to_date      numeric,
  add column if not exists forecast_this_month_remaining  numeric,
  add column if not exists forecast_month_total           numeric,
  add column if not exists forecast_target_gap            numeric,
  add column if not exists forward_pipeline_premium       numeric,
  add column if not exists csp_pipeline_premium           numeric,
  add column if not exists cc_pipeline_premium            numeric,
  add column if not exists below_cost_cc_premium          numeric,
  add column if not exists pipeline_phase                 text;

comment on column public.daily_snapshots.forecast_month_total is
  'v2 pipeline forecast: realized-to-date + expected this-month realization '
  'from open positions (position-type-aware capture curves + calendar-month '
  'timing). Replaces the flat-60% pipeline_implied_monthly.';

comment on column public.daily_snapshots.pipeline_phase is
  'flexible (CSP >55% of forward pipeline), constraint (CC >55%), or mixed.';

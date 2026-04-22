-- Pipeline Forecast v2 — scaffolding.
-- Creates the two tables that v2 implementation depends on, and seeds
-- forecast_calibration with values from the 2026-04-22 backtest.
--
-- v2 algorithm itself (capture curves, realization-timing logic, Pipeline
-- Detail page) is NOT wired up here. See docs/pipeline_forecast_v2_backtest.md
-- and SPEC_PIPELINE_FORECAST_V2.md for the full design.

-- ---------------------------------------------------------------------------
-- forecast_calibration: one row per (position_type, bucket, calibration_date)
-- ---------------------------------------------------------------------------
create table if not exists public.forecast_calibration (
  id                 bigserial   primary key,
  position_type      text        not null check (position_type in ('csp','cc')),
  bucket             text        not null,
  calibrated_capture numeric     not null,
  sample_size        integer     not null default 0,
  calibration_date   date        not null default current_date,
  notes              text,
  created_at         timestamptz not null default now(),
  unique (position_type, bucket, calibration_date)
);

create index if not exists idx_forecast_calibration_lookup
  on public.forecast_calibration (position_type, bucket, calibration_date desc);

comment on table public.forecast_calibration is
  'Per-bucket expected-final-capture rates for the v2 pipeline forecast. '
  'One row per (position_type, bucket, calibration_date). The v2 capture '
  'curve reads the most recent row per (position_type, bucket).';

-- ---------------------------------------------------------------------------
-- position_daily_state: daily open-position snapshot for future calibration
-- ---------------------------------------------------------------------------
-- Captures the inputs that the v2 capture curves depend on, once per market
-- day per open position. Enables calibration against trajectory (not just
-- terminal state) once 3+ months of data accumulates. Closed-trade data
-- alone is tautological for in-band buckets — see docs/pipeline_forecast_v2_backtest.md.
create table if not exists public.position_daily_state (
  id                     bigserial   primary key,
  snapshot_date          date        not null,
  position_key           text        not null,                 -- ticker|type|strike|expiry
  ticker                 text        not null,
  position_type          text        not null check (position_type in ('csp','cc')),
  strike                 numeric,
  expiry                 date,
  contracts              integer,
  premium_at_open        numeric,
  -- state observed today (inputs to the capture curve)
  current_profit_pct     numeric,                              -- 0..1 (or negative)
  dte                    integer,
  stock_price            numeric,
  -- CC-specific state (null for CSPs)
  cost_basis             numeric,
  is_below_cost          boolean,
  position_pnl           numeric,
  distance_to_strike_pct numeric,
  created_at             timestamptz not null default now(),
  unique (snapshot_date, position_key)
);

create index if not exists idx_position_daily_state_key
  on public.position_daily_state (position_key, snapshot_date);

create index if not exists idx_position_daily_state_type_date
  on public.position_daily_state (position_type, snapshot_date);

comment on table public.position_daily_state is
  'Daily snapshot of open-position state (profit%, DTE, stock price, etc.). '
  'Written by the daily 4:30 PM ET cron once v2 is implemented. Enables '
  'future backtests to answer "of positions ever in state X, what was final '
  'realization?" — which closed-trade data alone cannot answer.';

-- ---------------------------------------------------------------------------
-- Seed forecast_calibration with 2026-04-22 backtest results.
-- Idempotent via unique (position_type, bucket, calibration_date).
-- ---------------------------------------------------------------------------
insert into public.forecast_calibration
  (position_type, bucket, calibrated_capture, sample_size, calibration_date, notes)
values
  -- ===== CSP =====
  -- CALIBRATED from 113 closed trades in the 60%+ profit band. Mean 0.764,
  -- median 0.702, std 0.158. Stable across Q1 and full-dataset windows.
  ('csp', 'profit_60_plus',         0.76, 113, '2026-04-22',
   'CALIBRATED: full-dataset mean=0.764, median=0.702, std=0.158. '
   'Q1 2026 close-basis mean=0.790 (n=29). Last-2-month shows slight '
   'downshift to 0.710 (n=20) — watch item, not a change yet.'),

  -- Tautological: trades that closed in the 40-60% band have mean capture in
  -- that band by construction. Keep spec starting value; requires
  -- position_daily_state trajectory data for true calibration.
  ('csp', 'profit_40_60_dte_high',  0.65,  48, '2026-04-22',
   'spec starting value. Observed closed-trade mean=0.499 (n=48) is '
   'tautological (selection = outcome). Needs position_daily_state '
   'trajectory data for real calibration.'),

  -- NEW bucket — patches spec gap (profit 40-60% with DTE <= 10 was
  -- unspecified). Starting estimate, not calibrated. Observed data exists
  -- (n=4) but is tautological (closed-in-band) and below n<5 threshold.
  ('csp', 'profit_40_60_dte_low',   0.70,   4, '2026-04-22',
   'NEW SPEC GAP PATCH, uncalibrated starting estimate. Covers '
   'profit in [0.40, 0.60) with DTE <= 10. Near expiry + decent profit '
   '-> rides to 60/60 or cleanup. Observed n=4, mean=0.535 (tautological, '
   'closed-in-band). Needs position_daily_state for real calibration.'),

  -- Narrowed to profit in [0.20, 0.40) with DTE <= 10 now that
  -- profit_40_60_dte_low covers the upper half.
  ('csp', 'profit_20_plus_dte_low', 0.90,   1, '2026-04-22',
   'spec starting value. Observed n=1 (narrowed — upper half now in '
   'profit_40_60_dte_low). Keep start, tautological.'),

  -- NEW bucket — patches spec gap (profit 20-40% with DTE > 10 was
  -- unspecified). Starting estimate, not calibrated. Observed data exists
  -- (n=17) but is tautological (closed-in-band).
  ('csp', 'profit_20_40_dte_high',  0.58,  17, '2026-04-22',
   'NEW SPEC GAP PATCH, uncalibrated starting estimate. Covers '
   'profit in [0.20, 0.40) with DTE > 10. Moderate profit + time '
   '-> may hit 60/60 or decay further. Observed n=17, mean=0.337 '
   '(tautological, closed-in-band). Needs position_daily_state for '
   'real calibration.'),

  -- n<5: keep spec starting value per §Backtest methodology.
  ('csp', 'profit_low_dte_low',     0.93,   2, '2026-04-22',
   'spec starting value (n<5). Observed mean=-0.145 is not trustworthy.'),

  -- Tautological.
  ('csp', 'profit_low_dte_high',    0.55,  16, '2026-04-22',
   'spec starting value. Observed mean=-0.023 (n=16) is tautological '
   '(closed-low bucket has low mean by selection). Needs '
   'position_daily_state for real calibration.'),

  -- ===== CC =====
  -- CALIBRATED. Very stable across all windows.
  ('cc',  'profit_80_plus',         0.89,  28, '2026-04-22',
   'CALIBRATED: full-dataset mean=0.892, median=0.880, std=0.061. '
   'Stable across Q1 (0.884) and last-2-month (0.874) windows.'),

  -- n<5: keep spec starting value.
  ('cc',  'profit_60_plus_dte_low', 0.85,   4, '2026-04-22',
   'spec starting value (n<5). Observed mean=0.742 (n=4) suggestive '
   'but below threshold.'),

  -- IMPORTANT: contaminated by defensive rolls. See backtest doc.
  ('cc',  'dte_very_low',           0.92,  13, '2026-04-22',
   'spec starting value. OBSERVED CONTAMINATION: mean=-1.789 (n=13, '
   'std=2.72) mixes two populations — CCs riding to worthless expiry '
   '(capture ~1.0) and defensively-closed CCs that went ITM '
   '(HOOD -8.47x, CRDO -5.17x, APP -4.97x). The 0.92 starting value '
   'is likely OPTIMISTIC in practice. Proper separation requires '
   'stock-price-at-close, captured going forward via '
   'position_daily_state.'),

  -- Also contaminated by defensive rolls (though less severely).
  ('cc',  'default',                0.75,  22, '2026-04-22',
   'spec starting value. Observed mean=0.250 (n=22) contaminated by '
   'defensive rolls. Needs position_daily_state for true calibration.'),

  -- No historical data (requires close-time stock price + cost basis).
  ('cc',  'below_cost_strike_near', 0.20,   0, '2026-04-22',
   'spec starting value. Conditional in algorithm: -0.20 if position '
   'PnL < 0, else 0.20. No historical data; requires close-time quote '
   'data. Captured going forward via position_daily_state.'),

  ('cc',  'strike_near_non_below_cost', 0.50, 0, '2026-04-22',
   'spec starting value. No historical data; requires close-time '
   'stock-price data. Captured going forward via position_daily_state.')
on conflict (position_type, bucket, calibration_date) do update
set calibrated_capture = excluded.calibrated_capture,
    sample_size        = excluded.sample_size,
    notes              = excluded.notes;

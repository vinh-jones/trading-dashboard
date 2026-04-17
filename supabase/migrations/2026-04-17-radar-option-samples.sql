-- Radar 30DTE / 30δ CSP sample cache.
-- One row per ticker. Overwritten on refresh (no historical time series).
-- status = 'ok' | 'no_suitable_strike' | 'fetch_failed'

create table if not exists public.radar_option_samples (
  ticker          text        primary key,
  fetched_at      timestamptz not null default now(),
  status          text        not null,
  strike          numeric,
  delta           numeric,
  expiry_date     date,
  dte             integer,
  mid             numeric,
  iv              numeric,
  collateral      numeric
);

create index if not exists idx_radar_option_samples_fetched_at
  on public.radar_option_samples (fetched_at desc);

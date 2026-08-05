-- docs/orb-schema.sql
-- One row per symbol per session. Written by api/orb-open.js, updated by
-- api/orb-scan.js and api/orb-outcome.js, read by api/orb-day.js.
--
-- Rows are created for EVERY trading day, qualifying or not. `qualified` and
-- `range_atr_pct` are stored side by side so the 25% threshold can be
-- recalibrated later from the accumulated record rather than being baked in.

create table if not exists orb_sessions (
  id                  uuid primary key default gen_random_uuid(),
  symbol              text not null,
  session_date        date not null,

  box_high            numeric,
  box_low             numeric,
  box_range           numeric,
  candle_color        text,          -- 'green' | 'red'
  candle_open         numeric,
  candle_close        numeric,

  atr14               numeric,
  atr_threshold       numeric,
  atr_asof            date,          -- last daily bar used; must be < session_date

  range_atr_pct       numeric,
  qualified           boolean,
  grey_band           boolean,

  direction           text,          -- 'bearish' | 'bullish'

  detection_status    text not null default 'pending', -- pending|matched|expired|skipped
  pattern             text,
  pattern_bar_start   timestamptz,
  pattern_ohlc        jsonb,
  outside_rule        text,          -- 'close_above' | 'close_below'
  -- True when an engulfing's PRIOR bar was too small to be meaningfully
  -- engulfed. Detection still happens and the row is still written; only the
  -- alert is suppressed. Kept as data so the choice can be revisited.
  prev_weak           boolean default false,
  minutes_elapsed     integer,
  last_scanned_bar    timestamptz,   -- self-healing cursor for the 5-min poll

  entry               numeric,
  stop                numeric,
  t1                  numeric,
  t2                  numeric,
  risk                numeric,
  rr_t1               numeric,
  rr_t2               numeric,
  t1_ahead            boolean,       -- false when T1 was already behind the entry
  alerted_at          timestamptz,

  outcome             text,          -- 't2' | 't1' | 'stop' | 'none'
  outcome_ambiguous   boolean default false,
  outcome_resolved_at timestamptz,

  params              jsonb not null,
  shadow_matches      jsonb not null default '[]'::jsonb,
  error               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint orb_sessions_unique unique (symbol, session_date)
);

create index if not exists orb_sessions_date_idx on orb_sessions (session_date desc);

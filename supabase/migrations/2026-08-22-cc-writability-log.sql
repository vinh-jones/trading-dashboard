-- CC-writability shadow log — docs/spec_cc_writability_alert_v1.md §8.2
--
-- ONE ROW PER IN-SCOPE TICKER PER EVALUATION, firing or not. The non-firing
-- rows are the point of the table: §8 rejected an iv_rank >= 30 gate on
-- evidence and pre-registered a replacement hypothesis
--
--     writes opened at iv_rank_pctile_90d >= 0.67 retain a higher share of
--     premium than those below
--
-- which can only be tested against a baseline that is NOT conditioned on the
-- alert having fired. Logging only the alerts that fired would answer a
-- different question and quietly answer it wrong.
--
-- `iv_rank` and `iv_rank_pctile_90d` are SHADOW COLUMNS. Nothing in the trigger
-- path may read them (acceptance 8). They are here to make the eventual
-- backtest possible, not to gate anything today.
--
-- Volume: 3-5 in-scope tickers x ~16 intraday runs/day ≈ 60-80 rows/day.
-- Retention is deliberately unbounded for now — the pre-registered test wants
-- >= 4 quarters of history and the row count stays trivial at this rate.

CREATE TABLE IF NOT EXISTS cc_writability_log (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker                   TEXT        NOT NULL,
  log_date                 DATE        NOT NULL,
  evaluated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  tier                     TEXT,                  -- 'RED' | 'AMBER' | NULL
  status                   TEXT,                  -- 'ok' | 'no_spot' | 'below_min_lot' | ...
  spot                     NUMERIC,
  gross_basis              NUMERIC,
  k_basis                  NUMERIC,
  iv                       NUMERIC,               -- shadow (§8)
  iv_rank                  NUMERIC,               -- shadow (§8)
  iv_rank_pctile_90d       NUMERIC,               -- shadow (§8), the pre-registered candidate
  bb_position              NUMERIC,
  best_rate_rung           INTEGER,               -- target DTE, not the listed DTE
  shortest_qualifying_rung INTEGER,
  qualifying_rung_count    INTEGER,
  suppressed_rung_count    INTEGER,
  pushable                 BOOLEAN     NOT NULL DEFAULT false,
  priced_from              TEXT,                  -- 'chain' | 'model'
  payload                  JSONB                  -- full per-rung + strike ladder
);

CREATE INDEX IF NOT EXISTS idx_cc_writability_log_ticker_time
  ON cc_writability_log (ticker, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS idx_cc_writability_log_date
  ON cc_writability_log (log_date);

ALTER TABLE cc_writability_log DISABLE ROW LEVEL SECURITY;

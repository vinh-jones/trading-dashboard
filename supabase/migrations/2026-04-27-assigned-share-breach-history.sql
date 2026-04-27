-- assigned_share_breach_history: one row per assigned-share position per
-- snapshot day. Captures sigma-to-breach + supporting fields so we can
-- trend "did IREN's breach risk grow this week?" without re-fetching old
-- option chains.
--
-- Keyed on (snapshot_date, ticker) because positions table is wiped and
-- reinserted on every sync, so positions.id is not stable across days.
-- Assigned-share rows are 1:1 with ticker, so ticker is the natural key.

CREATE TABLE IF NOT EXISTS assigned_share_breach_history (
  snapshot_date         DATE     NOT NULL,
  ticker                TEXT     NOT NULL,
  regime                TEXT,
  health_band           TEXT,
  has_active_cc         BOOLEAN,
  distance_pct          NUMERIC,
  cc_strike             NUMERIC,
  cc_dte                INTEGER,
  cc_required_move_pct  NUMERIC,
  cc_sigmas_to_breach   NUMERIC,
  iv_used               NUMERIC,
  inserted_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_date, ticker)
);

CREATE INDEX IF NOT EXISTS idx_asbh_ticker_date
  ON assigned_share_breach_history (ticker, snapshot_date DESC);

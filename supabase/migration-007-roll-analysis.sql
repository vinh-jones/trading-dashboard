-- migration-007-roll-analysis.sql
--
-- On-demand roll analysis results, one row per ticker.
-- Written by POST /api/roll-analysis (triggered by "Check Rolls" button).
-- Entire table is replaced on each check — delete-all then re-insert qualifying rows.
--
-- Read by:
--   GET /api/roll-analysis  → frontend on mount (load cached results)
--   useRollAnalysis hook    → drives Roll Analysis card sections + focus rule

CREATE TABLE IF NOT EXISTS roll_analysis (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker               text        NOT NULL,
  fetched_at           timestamptz NOT NULL DEFAULT now(),
  threshold_pct        numeric     NOT NULL,          -- threshold used when this row was fetched (e.g. 25)

  -- Position context
  cost_basis_per_share numeric,
  current_stock_price  numeric,
  assignment_strike    integer,                       -- Math.round(cost_basis_per_share)
  current_cc_strike    numeric,
  current_cc_expiry    date,
  current_cc_mid       numeric,                       -- from existing quotes cache, no extra API call

  -- 14 DTE roll window
  roll_14dte_expiry    date,
  roll_14dte_dte       integer,
  roll_14dte_mid       numeric,                       -- null if data unavailable (e.g. monthly-only ticker)
  roll_14dte_net       numeric,                       -- roll_14dte_mid - current_cc_mid
  roll_14dte_viable    boolean,                       -- net >= 0

  -- 28 DTE roll window
  roll_28dte_expiry    date,
  roll_28dte_dte       integer,
  roll_28dte_mid       numeric,
  roll_28dte_net       numeric,
  roll_28dte_viable    boolean,

  any_viable           boolean,                       -- either window is viable
  data_sufficient      boolean,                       -- cc mid + at least one roll window present
  notes                text        NOT NULL DEFAULT '' -- e.g. "weekly options not available for 14 DTE window"
);

-- One row per ticker — enforced via application-level delete-all + re-insert on each fetch
CREATE UNIQUE INDEX IF NOT EXISTS idx_roll_analysis_ticker ON roll_analysis (ticker);

-- RLS: reads are open (anon key), writes come from server-side with service key
ALTER TABLE roll_analysis ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON roll_analysis FOR ALL USING (true);

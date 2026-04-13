-- migration-009: add 21 DTE roll window columns to roll_analysis
-- Run in Supabase SQL Editor

ALTER TABLE roll_analysis
  ADD COLUMN IF NOT EXISTS roll_21dte_expiry  date,
  ADD COLUMN IF NOT EXISTS roll_21dte_dte     integer,
  ADD COLUMN IF NOT EXISTS roll_21dte_strike  integer,
  ADD COLUMN IF NOT EXISTS roll_21dte_mid     numeric,
  ADD COLUMN IF NOT EXISTS roll_21dte_net     numeric,
  ADD COLUMN IF NOT EXISTS roll_21dte_viable  boolean;

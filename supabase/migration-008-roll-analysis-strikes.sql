-- migration-008: add winning roll strike columns to roll_analysis
-- Run in Supabase SQL Editor

ALTER TABLE roll_analysis
  ADD COLUMN IF NOT EXISTS roll_14dte_strike integer,
  ADD COLUMN IF NOT EXISTS roll_28dte_strike integer;

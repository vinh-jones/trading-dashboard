-- Backfill historical vix_band labels and recompute deployment flags after
-- introducing the 18-22 Transition band (cash target 15-20%).
--
-- Old layout (pre-2026-05-01): 6 bands — ≤12, 12-15, 15-20, 20-25, 25-30, ≥30
-- New layout: 7 bands — ≤12, 12-15, 15-18, 18-22, 22-25, 25-30, ≥30
--
-- Two table updates:
--   1. daily_snapshots — relabel + populate cash_floor/ceiling targets (which
--      were never written due to a band?.floor / band?.floorPct typo) +
--      recompute within_band / overdeployed / underdeployed against new bands.
--   2. account_snapshots — relabel vix_band only.
--
-- Idempotent: re-running produces identical state because every value is
-- derived from the raw vix / vix_current numeric columns.

-- ── 1. daily_snapshots ────────────────────────────────────────────────────────

UPDATE daily_snapshots
SET
  vix_band = CASE
    WHEN vix IS NULL    THEN vix_band
    WHEN vix <= 12 THEN '≤12'
    WHEN vix <= 15 THEN '12–15'
    WHEN vix <= 18 THEN '15–18'
    WHEN vix <= 22 THEN '18–22'
    WHEN vix <= 25 THEN '22–25'
    WHEN vix <= 30 THEN '25–30'
    ELSE '≥30'
  END,
  cash_floor_target_pct = CASE
    WHEN vix IS NULL    THEN cash_floor_target_pct
    WHEN vix <= 12 THEN 0.40
    WHEN vix <= 15 THEN 0.30
    WHEN vix <= 18 THEN 0.20
    WHEN vix <= 22 THEN 0.15
    WHEN vix <= 25 THEN 0.10
    WHEN vix <= 30 THEN 0.05
    ELSE 0.00
  END,
  cash_ceiling_target_pct = CASE
    WHEN vix IS NULL    THEN cash_ceiling_target_pct
    WHEN vix <= 12 THEN 0.50
    WHEN vix <= 15 THEN 0.40
    WHEN vix <= 18 THEN 0.25
    WHEN vix <= 22 THEN 0.20
    WHEN vix <= 25 THEN 0.15
    WHEN vix <= 30 THEN 0.10
    ELSE 0.05
  END,
  within_band = CASE
    WHEN vix IS NULL OR free_cash_pct IS NULL THEN within_band
    WHEN vix <= 12 THEN free_cash_pct >= 0.40 AND free_cash_pct <= 0.50
    WHEN vix <= 15 THEN free_cash_pct >= 0.30 AND free_cash_pct <= 0.40
    WHEN vix <= 18 THEN free_cash_pct >= 0.20 AND free_cash_pct <= 0.25
    WHEN vix <= 22 THEN free_cash_pct >= 0.15 AND free_cash_pct <= 0.20
    WHEN vix <= 25 THEN free_cash_pct >= 0.10 AND free_cash_pct <= 0.15
    WHEN vix <= 30 THEN free_cash_pct >= 0.05 AND free_cash_pct <= 0.10
    ELSE                free_cash_pct >= 0.00 AND free_cash_pct <= 0.05
  END,
  overdeployed = CASE
    WHEN vix IS NULL OR free_cash_pct IS NULL THEN overdeployed
    WHEN vix <= 12 THEN free_cash_pct < 0.40
    WHEN vix <= 15 THEN free_cash_pct < 0.30
    WHEN vix <= 18 THEN free_cash_pct < 0.20
    WHEN vix <= 22 THEN free_cash_pct < 0.15
    WHEN vix <= 25 THEN free_cash_pct < 0.10
    WHEN vix <= 30 THEN free_cash_pct < 0.05
    ELSE                free_cash_pct < 0.00
  END,
  underdeployed = CASE
    WHEN vix IS NULL OR free_cash_pct IS NULL THEN underdeployed
    WHEN vix <= 12 THEN free_cash_pct > 0.50
    WHEN vix <= 15 THEN free_cash_pct > 0.40
    WHEN vix <= 18 THEN free_cash_pct > 0.25
    WHEN vix <= 22 THEN free_cash_pct > 0.20
    WHEN vix <= 25 THEN free_cash_pct > 0.15
    WHEN vix <= 30 THEN free_cash_pct > 0.10
    ELSE                free_cash_pct > 0.05
  END;

-- ── 2. account_snapshots ──────────────────────────────────────────────────────

UPDATE account_snapshots
SET vix_band = CASE
  WHEN vix_current <= 12 THEN '≤12'
  WHEN vix_current <= 15 THEN '12–15'
  WHEN vix_current <= 18 THEN '15–18'
  WHEN vix_current <= 22 THEN '18–22'
  WHEN vix_current <= 25 THEN '22–25'
  WHEN vix_current <= 30 THEN '25–30'
  ELSE '≥30'
END
WHERE vix_current IS NOT NULL;

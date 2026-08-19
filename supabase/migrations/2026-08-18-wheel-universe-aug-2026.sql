-- Migration: wheel_universe sync to Ryan's Aug 2026 approved list
-- Source: "Approved Wheel Stocks FINAL OTU (Aug 2026)" sheet
-- Applied to live DB on sync; this file is the repo record.
--
-- Changes vs. the 2026-06-04 list (migration-024):
--   Dropped from approved : none
--   Promoted -> approved   : BE (was not_approved)
--   New approved rows      : KLAC, TER, LYTE
--   Refreshed price_category + pe_ratio on all kept approved names
-- Approved count: 55 -> 59
--
-- Sector strings deliberately deviate from the sheet in two places — the sheet's
-- "Original Sector" column mislabels both, and these strings drive Radar's sector
-- group filters (src/components/radar/radarConstants.js):
--   BE   → 'Energy' (sheet says Semiconductors; Bloom Energy makes fuel cells)
--   LYTE → 'Photonics - Semiconductor' (matches COHR, its basket-mate)
-- AMAT is also re-sectored 'Industrial Machinery' -> 'Semiconductors' (step 4). It
-- was the only reason the Radar "Semiconductors" group claimed 'Industrial
-- Machinery', which had the side effect of filing CAT under semis. That string now
-- belongs to the Industrials group, where CAT is the only approved member.
--
-- LYTE price_category is 'Under $50', not the sheet's 'Over $200' — the sheet's
-- LYTE row has no price at all and the category looks like a leftover default.
-- Verified live 2026-08-18: LYTE last $26.10.
--
-- NOTE ON LYTE: monthly expirations only (8/21, 9/18, 12/18, 3/19) — no weeklies.
-- Kept because it is on Ryan's list; AMKR was excluded in migration-024 on the
-- same criterion, so flag this if Ryan's weekly-options rule is meant to bind.

BEGIN;

-- 1. Promotion: not_approved -> approved
UPDATE wheel_universe
SET list_type='approved', price_category='Over $200', pe_ratio=NULL
WHERE ticker='BE';

-- 2. New approved rows
INSERT INTO wheel_universe (ticker, company, sector, list_type, price_category, pe_ratio) VALUES
  ('KLAC','KLA Corp','Semiconductors','approved','$100-$200',53.21),
  ('TER','Teradyne Inc','Semiconductors','approved','Over $200',55.47),
  ('LYTE','Roundhill Photonics ETF','Photonics - Semiconductor','approved','Under $50',NULL)
ON CONFLICT (ticker) DO UPDATE SET
  list_type='approved', company=EXCLUDED.company, sector=EXCLUDED.sector,
  price_category=EXCLUDED.price_category, pe_ratio=EXCLUDED.pe_ratio;

-- 3. Refresh price_category + pe_ratio on all kept approved names
UPDATE wheel_universe AS w SET price_category = v.pc, pe_ratio = v.pe
FROM (VALUES
  ('AA','$50-$100',10.37),    ('AAPL','Over $200',35.54), ('ADI','Over $200',55.97),
  ('AMAT','Over $200',44.36), ('AMD','Over $200',124.30), ('AMZN','Over $200',20.87),
  ('ANET','$100-$200',60.92), ('APH','$100-$200',39.95),  ('APP','Over $200',23.62),
  ('AVGO','Over $200',63.26), ('AXP','Over $200',20.55),  ('CAT','Over $200',36.17),
  ('CCJ','$50-$100',163.53),  ('CCL','Under $50',12.15),  ('CDE','Under $50',15.22),
  ('CEG','Over $200',26.00),  ('CLS','Over $200',32.28),  ('COHR','Over $200',74.38),
  ('CRDO','Over $200',98.03), ('CSCO','$100-$200',33.54), ('DELL','Over $200',37.22),
  ('DRAM','$50-$100',NULL),   ('EQT','$50-$100',12.33),   ('ETHA','Under $50',NULL),
  ('FCX','$50-$100',32.67),   ('FTNT','$100-$200',55.67), ('FUTU','$100-$200',12.00),
  ('GE','Over $200',44.16),   ('GLW','$100-$200',73.41),  ('GOOGL','Over $200',17.29),
  ('HL','Under $50',36.31),   ('HOOD','$50-$100',40.47),  ('IBIT','Under $50',NULL),
  ('INOD','$50-$100',46.63),  ('INTC','$50-$100',NULL),   ('IREN','Under $50',94.99),
  ('JPM','Over $200',15.56),  ('KTOS','$50-$100',356.82), ('LRCX','Over $200',56.92),
  ('META','Over $200',20.47), ('MSFT','Over $200',26.84), ('MU','Over $200',21.30),
  ('NBIS','Over $200',NULL),  ('NEM','$100-$200',14.64),  ('NVDA','Over $200',33.65),
  ('PLTR','$100-$200',146.18),('RTX','Over $200',39.70),  ('SHOP','$100-$200',98.84),
  ('SMH','Over $200',NULL),   ('SOFI','Under $50',37.22), ('STX','Over $200',64.99),
  ('TSLA','Over $200',312.92),('TSM','Over $200',30.14),  ('VRT','Over $200',61.68),
  ('WDC','Over $200',20.44)
) AS v(ticker, pc, pe)
WHERE w.ticker = v.ticker;

-- 4. Re-sector AMAT so 'Industrial Machinery' can move to the Industrials radar group
UPDATE wheel_universe SET sector='Semiconductors' WHERE ticker='AMAT';

COMMIT;

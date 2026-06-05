-- Migration: wheel_universe sync to Ryan's 2026-06-04 approved list
-- Source: "Approved Wheel Stocks (FINAL OTU)" sheet, priced 2026-06-04
-- Applied to live DB on sync; this file is the repo record.
--
-- Changes vs. the 2026-04-12 seed (migration-005):
--   Dropped from approved : UBER, NU, TIGR (rotated off; rows deleted)
--   Promoted -> approved   : INTC, NBIS (were not_approved)
--   New approved rows      : DRAM, SMH, CEG
--   AMKR intentionally NOT added — no weekly options (per Ryan)
--   Refreshed price_category + pe_ratio on all kept approved names
-- Approved count: 53 -> 55

BEGIN;

-- 1. Dropped from approved (rotated off Ryan's list)
DELETE FROM wheel_universe WHERE ticker IN ('UBER','NU','TIGR');

-- 2. Promotions: not_approved -> approved (with refreshed fields)
UPDATE wheel_universe SET list_type='approved', price_category='$100-$200', pe_ratio=NULL  WHERE ticker='INTC';
UPDATE wheel_universe SET list_type='approved', price_category='Over $200',  pe_ratio=91.11 WHERE ticker='NBIS';

-- 3. New approved rows (AMKR intentionally excluded — no weekly options)
INSERT INTO wheel_universe (ticker, company, sector, list_type, price_category, pe_ratio) VALUES
  ('DRAM','Roundhill Memory ETF','AI - Memory','approved','$50-$100',NULL),
  ('SMH','VanEck Semiconductor ETF','Semiconductors','approved','Over $200',NULL),
  ('CEG','Constellation Energy Corp','Energy','approved','Over $200',22.77)
ON CONFLICT (ticker) DO UPDATE SET
  list_type='approved', company=EXCLUDED.company, sector=EXCLUDED.sector,
  price_category=EXCLUDED.price_category, pe_ratio=EXCLUDED.pe_ratio;

-- 4. Refresh price_category + pe_ratio on all kept approved names
UPDATE wheel_universe AS w SET price_category = v.pc, pe_ratio = v.pe
FROM (VALUES
  ('AA','$50-$100',20.49),   ('AAPL','Over $200',37.62), ('ADI','Over $200',63.59),
  ('AMAT','Over $200',46.93),('AMD','Over $200',172.53), ('AMZN','Over $200',30.44),
  ('ANET','$100-$200',56.48),('APH','$100-$200',42.14),  ('APP','Over $200',50.19),
  ('AVGO','Over $200',80.84),('AXP','Over $200',19.59),  ('CAT','Over $200',46.54),
  ('CCJ','$100-$200',106.54),('CCL','Under $50',12.17),  ('CDE','Under $50',15.32),
  ('CLS','Over $200',51.03), ('COHR','Over $200',199.12),('CRDO','Over $200',84.36),
  ('CSCO','$100-$200',42.53),('DELL','Over $200',32.86), ('EQT','$50-$100',10.47),
  ('ETHA','Under $50',NULL), ('FCX','$50-$100',36.98),   ('FTNT','$100-$200',57.6),
  ('FUTU','$50-$100',10.62), ('GE','Over $200',39.94),   ('GLW','$100-$200',93.73),
  ('GOOGL','Over $200',28.15),('HL','Under $50',40.93),  ('HOOD','$50-$100',41.7),
  ('IBIT','Under $50',NULL), ('INOD','$100-$200',108.75),('IREN','$50-$100',138.74),
  ('JPM','Over $200',14.83), ('KTOS','$50-$100',371.51), ('LRCX','Over $200',63.51),
  ('META','Over $200',23.23),('MSFT','Over $200',25.66), ('MU','Over $200',47.62),
  ('NEM','$100-$200',14.15), ('NVDA','Over $200',33.01), ('PLTR','$100-$200',160.5),
  ('RTX','$100-$200',33.49), ('SHOP','$100-$200',115.06),('SOFI','Under $50',39.02),
  ('STX','Over $200',87.87), ('TSLA','Over $200',384.86),('TSM','Over $200',37.13),
  ('VRT','Over $200',79.9),  ('WDC','Over $200',34.78)
) AS v(ticker, pc, pe)
WHERE w.ticker = v.ticker;

COMMIT;

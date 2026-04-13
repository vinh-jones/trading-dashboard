-- Migration: wheel_universe table
-- Ryan Hildreth's approved ticker list
-- Last updated: 2026-04-12
-- Update manually when Ryan changes the list (roughly quarterly)

CREATE TABLE wheel_universe (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker TEXT NOT NULL UNIQUE,
  company TEXT,
  sector TEXT,
  list_type TEXT NOT NULL,  -- 'approved' | 'safe_haven' | 'not_approved'
  price_category TEXT,      -- 'Under $50' | '$50-$100' | '$100-$200' | 'Over $200'
  pe_ratio NUMERIC,
  added_at TIMESTAMPTZ DEFAULT now(),
  notes TEXT DEFAULT ''
);

-- Enable RLS
ALTER TABLE wheel_universe ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON wheel_universe FOR ALL USING (true);

-- Index for fast list_type filtering
CREATE INDEX idx_wheel_universe_list_type ON wheel_universe(list_type);

-- Pre-populate with Ryan's list as of 2026-04-12
INSERT INTO wheel_universe (ticker, company, sector, list_type, price_category, pe_ratio) VALUES
  ('AMD', 'Advanced Micro Devices Inc', 'Semiconductors', 'approved', 'Over $200', 94.33),
  ('VRT', 'Vertiv Holdings Co', 'Tech Infra', 'approved', 'Over $200', 86.55),
  ('PLTR', 'Palantir Technologies Inc', 'Tech / Data', 'approved', '$100-$200', 202.01),
  ('FUTU', 'Futu Holdings Ltd', 'Financials', 'approved', '$100-$200', 15.01),
  ('SHOP', 'Shopify Inc', 'Ecommerce', 'approved', '$100-$200', 117.6),
  ('DELL', 'Dell Technologies Inc', 'Tech', 'approved', '$100-$200', 20.65),
  ('CRDO', 'Credo Technology Group Holding Ltd', 'Computer Technology', 'approved', '$100-$200', 66.1),
  ('ANET', 'Arista Networks Inc', 'Tech/Cloud Infrastructure', 'approved', '$100-$200', 53.51),
  ('HOOD', 'Robinhood Markets Inc', 'Financials/Crypto Exchange', 'approved', '$50-$100', 33.67),
  ('WDC', 'Western Digital Corp', 'Computer Technology', 'approved', 'Over $200', 34.61),
  ('CCJ', 'Cameco Corp', 'Mining', 'approved', '$100-$200', 119.64),
  ('UBER', 'Uber Technologies Inc', 'Technology & Transportation', 'approved', '$50-$100', 14.96),
  ('KTOS', 'Kratos Defense & Security Solutions Inc', 'Aerospace & Defense', 'approved', '$50-$100', 523.09),
  ('FTNT', 'Fortinet Inc', 'Cybersecurity', 'approved', '$50-$100', 32.29),
  ('INOD', 'Innodata Inc', 'Technology', 'approved', 'Under $50', 38.18),
  ('CSCO', 'Cisco Systems Inc', 'Networking', 'approved', '$50-$100', 29.79),
  ('IBIT', 'iShares Bitcoin Trust ETF', 'Crypto Currency', 'approved', 'Under $50', NULL),
  ('META', 'Meta Platforms Inc', 'Advertising/Social Media/Ai', 'approved', 'Over $200', 21.67),
  ('APP', 'Applovin Corp', 'Tech', 'approved', 'Over $200', 38.41),
  ('MSFT', 'Microsoft Corp', 'Technology', 'approved', 'Over $200', 23.19),
  ('TSLA', 'Tesla Inc', 'EV / Energy', 'approved', 'Over $200', 319.8),
  ('AXP', 'American Express Co', 'Financials/Credit Services', 'approved', 'Over $200', 20.41),
  ('AVGO', 'Broadcom Inc', 'Semiconductors', 'approved', 'Over $200', 73.1),
  ('GE', 'General Electric Co', 'Industrials', 'approved', 'Over $200', 37.83),
  ('JPM', 'JPMorgan Chase & Co', 'Banking', 'approved', 'Over $200', 15.43),
  ('CLS', 'Celestica Inc', 'Electronics Mfg', 'approved', 'Over $200', 49.27),
  ('TSM', 'Taiwan Semiconductor Manufacturing Co Ltd', 'Semiconductors', 'approved', 'Over $200', 35.77),
  ('AAPL', 'Apple Inc', 'Technology', 'approved', 'Over $200', 33.11),
  ('GOOGL', 'Alphabet Inc Class A', 'Search / Cloud', 'approved', 'Over $200', 29.46),
  ('STX', 'Seagate Technology Holdings PLC', 'Computer Technology', 'approved', 'Over $200', 56.75),
  ('AMZN', 'Amazon.com Inc', 'Consumer Cloud', 'approved', 'Over $200', 33.21),
  ('MU', 'Micron Technology Inc', 'Semiconductors', 'approved', 'Over $200', 19.7),
  ('NVDA', 'NVIDIA Corp', 'AI / Semiconductors', 'approved', '$100-$200', 38.59),
  ('ETHA', 'iShares Ethereum Trust ETF', 'Crypto Currency', 'approved', 'Under $50', NULL),
  ('SOFI', 'SoFi Technologies Inc', 'Financials', 'approved', 'Under $50', 41.95),
  ('NU', 'Nu Holdings Ltd', 'Financials', 'approved', 'Under $50', 25.44),
  ('CDE', 'Coeur Mining Inc', 'Gold & Silver Miner', 'approved', 'Under $50', 21.0),
  ('TIGR', 'UP Fintech Holding Ltd', 'Financials', 'approved', 'Under $50', 7.21),
  ('IREN', 'IREN Ltd', 'Bitcoin Mining/AI Cloud', 'approved', 'Under $50', 30.37),
  ('AA', 'Alcoa Corp', 'Aluminum', 'approved', '$50-$100', 16.57),
  ('ADI', 'Analog Devices Inc', 'Semiconductors', 'approved', 'Over $200', 63.89),
  ('CCL', 'Carnival Corp', 'Cruise Lines', 'approved', 'Under $50', 12.25),
  ('HL', 'Hecla Mining Co', 'Precious Metals - Silver', 'approved', 'Under $50', 39.73),
  ('AMAT', 'Applied Materials Inc', 'Industrial Machinery', 'approved', 'Over $200', 41.24),
  ('LRCX', 'Lam Research Corp', 'Semiconductors', 'approved', 'Over $200', 54.27),
  ('APH', 'Amphenol Corp', 'Electronic Components - Semi', 'approved', '$100-$200', 42.37),
  ('EQT', 'EQT Corp', 'Natural Gas', 'approved', '$50-$100', 17.77),
  ('NEM', 'Newmont Corporation', 'Precious Metals', 'approved', '$100-$200', 18.9),
  ('CAT', 'Caterpillar Inc', 'Industrial Machinery', 'approved', 'Over $200', 42.31),
  ('FCX', 'Freeport-McMoRan Inc', 'Precious Metals - copper, gold', 'approved', '$50-$100', 44.35),
  ('RTX', 'RTX Corp', 'Aerospace & Defense', 'approved', 'Over $200', 40.79),
  ('GLW', 'Corning Inc', 'Materials - Glass & Fiberoptics', 'approved', '$100-$200', 93.91),
  ('COHR', 'Coherent Corp', 'Photonics - Semiconductor', 'approved', 'Over $200', 328.48),
  -- Safe Haven
  ('BRK.B', 'Berkshire Hathaway Inc Class B', 'Conglomerate', 'safe_haven', 'Over $200', 0.01),
  ('LMT', 'Lockheed Martin Corp', 'Industrials / Defense', 'safe_haven', 'Over $200', 28.89),
  ('MCD', 'McDonald''s Corp', 'Consumer Discretionary / Restaurants', 'safe_haven', 'Over $200', 25.65),
  ('PGR', 'Progressive Corp', 'Financials / Insurance', 'safe_haven', '$100-$200', 10.19),
  ('ALL', 'Allstate Corp', 'Financials / Insurance', 'safe_haven', 'Over $200', 5.54),
  ('PG', 'Procter & Gamble Co', 'Consumer Staples / Household Products', 'safe_haven', '$100-$200', 21.6),
  ('XOM', 'Exxon Mobil Corp', 'Energy / Oil & Gas', 'safe_haven', '$100-$200', 22.94),
  ('T', 'AT&T Inc', 'Communication Services / Telecom', 'safe_haven', 'Under $50', 8.64),
  -- Not Approved (stored for reference / negative filtering)
  ('LLY', 'Eli Lilly And Co', 'Pharmaceuticals', 'not_approved', 'Over $200', 41.04),
  ('CRWD', 'Crowdstrike Holdings Inc', 'Cybersecurity', 'not_approved', 'Over $200', NULL),
  ('UNH', 'UnitedHealth Group Inc', 'Health Insurance / Managed Care', 'not_approved', 'Over $200', 23.33),
  ('ADBE', 'Adobe Inc', 'Software / Digital Media', 'not_approved', 'Over $200', 13.14),
  ('ZS', 'Zscaler Inc', 'Cybersecurity / Cloud Security', 'not_approved', '$100-$200', NULL),
  ('MSTR', 'Strategy Inc Class A', 'Business Intelligence / Bitcoin Holdings', 'not_approved', '$100-$200', NULL),
  ('CRM', 'Salesforce Inc', 'Enterprise Software / CRM', 'not_approved', '$100-$200', 21.04),
  ('LULU', 'Lululemon Athletica Inc', 'Apparel / Activewear', 'not_approved', '$100-$200', 12.4),
  ('OKLO', 'Oklo Inc', 'Nuclear Energy / Clean Energy', 'not_approved', '$50-$100', NULL),
  ('CRWV', 'CoreWeave Inc', 'Cloud Computing / AI Infrastructure', 'not_approved', '$100-$200', NULL),
  ('RBLX', 'Roblox Corp', 'Online Gaming / Digital Entertainment', 'not_approved', '$50-$100', NULL),
  ('NBIS', 'Nebius Group NV', 'AI Infrastructure / Cloud Technology', 'not_approved', '$100-$200', 1274.56),
  ('ASTS', 'AST SpaceMobile Inc', 'Satellite Communications / SpaceTech', 'not_approved', '$50-$100', NULL),
  ('NKE', 'Nike Inc', 'Apparel / Footwear', 'not_approved', 'Under $50', 28.34),
  ('RKLB', 'Rocket Lab Corp', 'Aerospace / Launch Services', 'not_approved', '$50-$100', NULL),
  ('UPST', 'Upstart Holdings Inc', 'FinTech / AI Lending', 'not_approved', 'Under $50', 53.89),
  ('TTD', 'Trade Desk Inc', 'Digital Advertising / AdTech', 'not_approved', 'Under $50', 22.65),
  ('BMNR', 'Bitmine Immersion Technologies Inc', 'Crypto Mining / Immersion Cooling Tech', 'not_approved', 'Under $50', NULL),
  ('INTC', 'Intel Corp', 'Semiconductors', 'not_approved', '$50-$100', NULL),
  ('SMR', 'NuScale Power Corp', 'Nuclear Power / Energy Technology', 'not_approved', 'Under $50', NULL),
  ('ENPH', 'Enphase Energy Inc', 'Solar Energy / Energy Storage', 'not_approved', 'Under $50', 24.79),
  ('OSCR', 'Oscar Health Inc', 'Health Insurance Technology', 'not_approved', 'Under $50', NULL),
  ('RKT', 'Rocket Companies Inc', 'Mortgage Lending / FinTech', 'not_approved', 'Under $50', NULL),
  ('BE', 'Bloom Energy Corp', 'Energy', 'not_approved', '$100-$200', NULL),
  ('HIMS', 'Hims & Hers Health Inc', 'Telehealth / Wellness', 'not_approved', 'Under $50', 38.06);

-- New columns on quotes table for Bollinger Band data
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS bb_position     NUMERIC;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS bb_upper        NUMERIC;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS bb_lower        NUMERIC;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS bb_sma20        NUMERIC;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS bb_refreshed_at TIMESTAMPTZ;

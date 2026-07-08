-- Add 14-day Wilder RSI to quotes for the Radar tab.
-- Populated by api/bb.js from the same daily-close series it already fetches for
-- Bollinger Bands. Display-only context signal — NOT part of the Scanner Score.
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS rsi_14 numeric;

COMMENT ON COLUMN public.quotes.rsi_14 IS '14-day Wilder RSI computed from daily closes by api/bb.js. Radar context signal (displayed only), not part of the Scanner Score.';

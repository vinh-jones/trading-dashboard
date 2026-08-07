-- Replaces market_context.macro_events, which died with OpenClaw (last write
-- 2026-07-01). Fed by api/uw-macro-events.js from UW's economic calendar.
--
-- One row per (event_date, event_type): UW emits four rows for a single CPI
-- print (headline, core, YoY, core YoY) and the calendar wants one chip. The
-- normalizer in api/_lib/macroEvents.js keeps only the headline.
--
-- forecast/previous are text, not numeric: UW returns them pre-formatted and
-- unit-mixed ("3.5%", "85000", "12000000000") and nothing downstream does
-- arithmetic on them.
--
-- UW's calendar only looks ~8 days ahead. The cron replaces the whole table
-- each run, so passed events clear rather than accumulating.
CREATE TABLE IF NOT EXISTS public.macro_events (
  event_date   date        NOT NULL,
  event_type   text        NOT NULL,
  event_time   timestamptz NOT NULL,
  title        text        NOT NULL,
  forecast     text,
  previous     text,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_date, event_type)
);

CREATE INDEX IF NOT EXISTS idx_macro_events_date ON public.macro_events(event_date);

-- RLS on with no policy — service-role only, exactly as market_context was.
-- The only reader is api/focus-context.js, which uses the service key.
ALTER TABLE public.macro_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.macro_events IS
  'Upcoming US macro releases from Unusual Whales, written daily by api/uw-macro-events.js. Six whitelisted types (CPI/PPI/NFP/FOMC/PCE/RETAIL_SALES), headline print only. ~8-day forward horizon — UW does not publish further out.';

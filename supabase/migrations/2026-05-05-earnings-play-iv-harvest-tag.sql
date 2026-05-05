-- Add `earnings-play:iv-harvest` to tag_vocabulary so it appears as a
-- pre-filled selectable suggestion in the journal entry tag UI.
--
-- Captures plays where elevated pre-earnings IV is the mechanism being
-- harvested — closing before the print to collect premium that crushes
-- after the earnings announcement regardless of direction.
--
-- Apply to BOTH legs of the trade: the close of the original position and
-- the open of the replacement position, so a query for this tag returns
-- the complete picture of the play.
--
-- Idempotent: re-running this migration leaves the row untouched.

INSERT INTO tag_vocabulary (tag, category, description) VALUES
  ('earnings-play:iv-harvest', 'earnings-play', 'Closed before earnings print to capture pre-earnings IV crush')
ON CONFLICT (tag) DO NOTHING;

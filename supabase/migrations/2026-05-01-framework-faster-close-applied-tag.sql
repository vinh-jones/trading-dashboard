-- Add `framework:faster-close-applied` to tag_vocabulary so it appears as a
-- pre-filled selectable suggestion in the journal entry tag UI.
--
-- Captures trades closed earlier than the original plan (faster than 60/60 or
-- the original DTE target) to free capital sooner — distinct from
-- framework:60-60-applied which is the canonical 60% profit + 60% DTE rule.
--
-- Idempotent: re-running this migration leaves the row untouched.

INSERT INTO tag_vocabulary (tag, category, description) VALUES
  ('framework:faster-close-applied', 'framework', 'Closed earlier than original plan to free capital faster')
ON CONFLICT (tag) DO NOTHING;

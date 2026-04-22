-- migration-016: tag vocabulary table + GIN index upgrade on journal_entries.tags
-- Run in Supabase SQL editor.

-- ── 1. tag_vocabulary table ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tag_vocabulary (
  tag          TEXT PRIMARY KEY,
  category     TEXT NOT NULL,
  description  TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  deprecated   BOOLEAN DEFAULT FALSE,
  deprecated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tag_vocabulary_category
  ON tag_vocabulary(category) WHERE NOT deprecated;

ALTER TABLE tag_vocabulary ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Allow all" ON tag_vocabulary FOR ALL USING (true);

-- ── 2. Add GIN index to journal_entries.tags (column already exists as text[]) ──

CREATE INDEX IF NOT EXISTS idx_journal_entries_tags
  ON journal_entries USING GIN (tags);

-- ── 3. tag_usage_stats RPC ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION tag_usage_stats(from_date TIMESTAMPTZ, to_date TIMESTAMPTZ)
RETURNS TABLE (tag TEXT, category TEXT, count BIGINT) AS $$
  SELECT
    t.tag,
    split_part(t.tag, ':', 1) AS category,
    COUNT(*) AS count
  FROM journal_entries,
       unnest(tags) AS t(tag)
  WHERE (from_date IS NULL OR created_at >= from_date)
    AND (to_date   IS NULL OR created_at <= to_date)
  GROUP BY t.tag
  ORDER BY count DESC;
$$ LANGUAGE SQL STABLE;

-- ── 4. Seed vocabulary (54 tags) ──────────────────────────────────────────────

INSERT INTO tag_vocabulary (tag, category, description) VALUES
  -- earnings-play (13)
  ('earnings-play',                      'earnings-play', 'CSP opened around scheduled earnings event'),
  ('earnings-play:path-a-avoid',         'earnings-play', 'Pre-earnings expiry, skip the event'),
  ('earnings-play:path-b-defensive',     'earnings-play', 'Strike outside expected move'),
  ('earnings-play:path-c-standard',      'earnings-play', 'Strike at expected lower bound'),
  ('earnings-play:path-d-aggressive',    'earnings-play', 'Strike inside expected move'),
  ('earnings-play:conviction-low',       'earnings-play', 'Low conviction entry'),
  ('earnings-play:conviction-standard',  'earnings-play', 'Standard conviction entry'),
  ('earnings-play:conviction-high',      'earnings-play', 'High conviction entry'),
  ('earnings-play:outcome-profitable',   'earnings-play', 'Closed for profit'),
  ('earnings-play:outcome-assigned',     'earnings-play', 'Took assignment'),
  ('earnings-play:outcome-rolled',       'earnings-play', 'Rolled instead of closing/assigning'),
  ('earnings-play:outcome-breached-implied', 'earnings-play', 'Stock moved beyond implied move'),
  ('earnings-play:outcome-within-implied',   'earnings-play', 'Stock stayed within implied move'),

  -- drift (9)
  ('drift:rattling',              'drift', 'Multiple justifications when one would do'),
  ('drift:moved-before-ryan',     'drift', 'Acted independently then Ryan agreed'),
  ('drift:am-i-doing-enough',     'drift', 'Pressure to trade without setup'),
  ('drift:end-of-month-anxiety',  'drift', 'Month-end uncertainty, fully deployed'),
  ('drift:fatigue',               'drift', 'Impaired sleep, elevated error risk'),
  ('drift:narrative-building',    'drift', 'Post-hoc justification for weak trade'),
  ('drift:revenge-trade',         'drift', 'Reacting emotionally to recent loss'),
  ('drift:overconfidence-after-win', 'drift', 'Size/aggression creep after success'),
  ('drift:fomo-missed-signal',    'drift', 'Chasing after missing Ryan entry'),

  -- framework (10)
  ('framework:60-60-applied',            'framework', 'Closed at 60% profit, 60%+ DTE remaining'),
  ('framework:60-60-skipped',            'framework', '60/60 conditions met, did not close'),
  ('framework:below-cost-cc',            'framework', 'Rolled to assignment price on CC below cost'),
  ('framework:late-cycle-itm-csp',       'framework', '<5 DTE ITM CSP scenario'),
  ('framework:vix-cash-floor-respected', 'framework', 'Deployment held to VIX cash floor'),
  ('framework:vix-cash-floor-breached',  'framework', 'Deployment exceeded VIX cash floor'),
  ('framework:180-dte-leaps',            'framework', 'LEAPS at/below 180 DTE evaluation trigger'),
  ('framework:concentration-ceiling',    'framework', 'Per-ticker concentration cap relevant'),
  ('framework:deployment-ceiling',       'framework', '125% deployment ceiling relevant'),
  ('framework:gap-identified',           'framework', 'Scenario not covered by existing rule'),

  -- macro (9)
  ('macro:iran-war',                'macro', 'US-Iran conflict developments'),
  ('macro:fed',                     'macro', 'Fed commentary, rate decisions'),
  ('macro:tariffs',                 'macro', 'Tariff announcements, trade policy'),
  ('macro:vix-spike',               'macro', 'Notable VIX regime change'),
  ('macro:kobeissi-step-identified','macro', 'Kobeissi conflict playbook step matched'),
  ('macro:earnings-season',         'macro', 'Earnings-season regime context'),
  ('macro:geopolitics',             'macro', 'Geopolitical event, non-Iran'),
  ('macro:oil',                     'macro', 'Oil price regime shift'),
  ('macro:bonds',                   'macro', 'Bond / yield regime shift'),

  -- signal (5)
  ('signal:ryan',                 'signal', 'Trade originated from Ryan signal'),
  ('signal:independent',          'signal', 'Trade originated independently'),
  ('signal:ryan-plus-independent','signal', 'Independent read, confirmed by Ryan'),
  ('signal:kobeissi',             'signal', 'Trade informed by Kobeissi macro framework'),
  ('signal:framework-rule',       'signal', 'Trade triggered by explicit framework rule'),

  -- position-action (10)
  ('position-action:opened-csp',          'position-action', 'Opened cash-secured put'),
  ('position-action:opened-cc',           'position-action', 'Opened covered call'),
  ('position-action:assignment',          'position-action', 'Took assignment'),
  ('position-action:closed-60-60',        'position-action', 'Closed per 60/60 rule'),
  ('position-action:closed-early-conditions', 'position-action', 'Closed early, conditions-based'),
  ('position-action:closed-expiry-cleanup',   'position-action', 'Closed for expiry cleanup'),
  ('position-action:rolled-up',           'position-action', 'Rolled to higher strike'),
  ('position-action:rolled-down',         'position-action', 'Rolled to lower strike'),
  ('position-action:rolled-out',          'position-action', 'Rolled to later expiry'),
  ('position-action:held-to-expiry',      'position-action', 'Held to expiration')

ON CONFLICT (tag) DO NOTHING;

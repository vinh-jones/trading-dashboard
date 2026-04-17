# Audit — Journal

**Scope files:** `src/components/journal/JournalTab.jsx`, `src/components/journal/JournalEntryCard.jsx`, `src/components/journal/JournalField.jsx`, `src/components/journal/JournalAutoTextarea.jsx`, `src/components/journal/JournalInlineEditForm.jsx`
**Produced:** 2026-04-17

## Q1 — Hardcoded hex

Note: Monthly target progress bar colors in `JournalEntryCard.jsx` are allowlisted. `MOODS` and `JOURNAL_ENTRY_TYPES` from `journalConstants.js` (used in JournalTab and JournalInlineEditForm) are allowlisted.

**JournalInlineEditForm.jsx:**
- [x] Replace hardcoded hex `"#fff"` on Save button text color at `src/components/journal/JournalInlineEditForm.jsx:84` with `theme.text.primary` — `#fff` white is not a named token; `theme.text.primary` (`#e6edf3`) is the correct near-white

## Q2 — Off-grid spacing

**JournalTab.jsx:**
- [x] Replace off-grid spacing `20` (gap in main layout flex) at `src/components/journal/JournalTab.jsx:401` with `theme.space[5]`
- [x] Replace off-grid spacing `8` (gap in filter bar) at `src/components/journal/JournalTab.jsx:408` — 8px is `theme.space[2]`; use the token
- [x] Replace off-grid padding `"10px 12px"` on filter bar at `src/components/journal/JournalTab.jsx:409` — 10px off-grid; replace with `"${theme.space[2]}px ${theme.space[3]}px"` (8px 12px)
- [x] Replace off-grid spacing `16` (marginBottom on filter bar) at `src/components/journal/JournalTab.jsx:411` with `theme.space[4]`
- [x] Replace raw fontSize `12` for filter label "Filter:" at `src/components/journal/JournalTab.jsx:413` with `theme.size.sm` (12px — same value but use the token)
- [x] Replace off-grid spacing `4` (marginRight on filter label) at `src/components/journal/JournalTab.jsx:413` with `theme.space[1]`
- [x] Replace raw fontSize `13` on loading text at `src/components/journal/JournalTab.jsx:433` with `theme.size.sm` (12px) — 13px is an off-scale value
- [x] Replace raw fontSize `13` on error text at `src/components/journal/JournalTab.jsx:437` with `theme.size.sm` — same issue
- [x] Replace off-grid padding `"10px 12px"` on feedError div at `src/components/journal/JournalTab.jsx:437` with `"${theme.space[2]}px ${theme.space[3]}px"`
- [x] Replace off-grid spacing `12` (marginBottom on feedError) at `src/components/journal/JournalTab.jsx:437` with `theme.space[3]`
- [x] Replace raw fontSize `13` on empty state text at `src/components/journal/JournalTab.jsx:441` with `theme.size.sm`
- [x] Replace off-grid padding `16` on right-panel form wrapper at `src/components/journal/JournalTab.jsx:467` with `theme.space[4]`
- [x] Replace off-grid spacing `14` (marginBottom on form header) at `src/components/journal/JournalTab.jsx:470` with `theme.space[3]`
- [x] Replace off-grid spacing `6` (gap in entry type selector row) at `src/components/journal/JournalTab.jsx:475` with `theme.space[1]`
- [x] Replace off-grid spacing `16` (marginBottom on entry type selector row) at `src/components/journal/JournalTab.jsx:475` with `theme.space[4]`
- [x] Replace raw fontSize `12` on entry type buttons at `src/components/journal/JournalTab.jsx:483` with `theme.size.sm`
- [x] Replace off-grid padding `"7px 0"` on entry type buttons at `src/components/journal/JournalTab.jsx:483` — 7px off-grid; replace with `"${theme.space[1]}px 0"` (4px) or `"${theme.space[2]}px 0"` (8px)
- [x] Replace off-grid borderRadius `4` on entry type buttons at `src/components/journal/JournalTab.jsx:484` with `theme.radius.sm`
- [x] Replace off-grid spacing `16` (gap in Source radio group) at `src/components/journal/JournalTab.jsx:521` with `theme.space[4]`
- [x] Replace raw fontSize `13` on Source radio label at `src/components/journal/JournalTab.jsx:521` with `theme.size.sm`
- [x] Replace off-grid spacing `8` (gap in snapshot grid) at `src/components/journal/JournalTab.jsx:574` with `theme.space[2]`
- [x] Replace off-grid spacing `14` (marginBottom on snapshot grid) at `src/components/journal/JournalTab.jsx:574` with `theme.space[3]`
- [x] Replace off-grid padding `"10px 12px"` on preview panel at `src/components/journal/JournalTab.jsx:587` with `"${theme.space[2]}px ${theme.space[3]}px"`
- [x] Replace off-grid spacing `14` (marginBottom on preview panel) at `src/components/journal/JournalTab.jsx:587` with `theme.space[3]`
- [x] Replace raw fontSize `12` on preview panel at `src/components/journal/JournalTab.jsx:587` with `theme.size.sm`
- [x] Replace off-grid spacing `6` (marginBottom in preview items) at `src/components/journal/JournalTab.jsx:594` with `theme.space[1]`
- [x] Replace off-grid spacing `8` (gap in actions row) at `src/components/journal/JournalTab.jsx:689` with `theme.space[2]`
- [x] Replace off-grid padding `"6px 12px"` on Cancel button at `src/components/journal/JournalTab.jsx:691` — 6px off-grid; replace with `"${theme.space[1]}px ${theme.space[3]}px"`
- [x] Replace off-grid padding `"6px 16px"` on Save button at `src/components/journal/JournalTab.jsx:700` — 6px off-grid; replace with `"${theme.space[1]}px ${theme.space[4]}px"`
- [x] Replace off-grid spacing `10` (marginBottom for saveError) at `src/components/journal/JournalTab.jsx:683` with `theme.space[2]`
- [x] Replace off-grid padding `"8px 10px"` on saveError div at `src/components/journal/JournalTab.jsx:683` with `"${theme.space[2]}px ${theme.space[2]}px"`
- [x] Replace raw fontSize `12` on saveError at `src/components/journal/JournalTab.jsx:683` with `theme.size.sm`

**JournalEntryCard.jsx:**
- [x] Replace off-grid spacing `12` (marginBottom on card wrapper) at `src/components/journal/JournalEntryCard.jsx:79` with `theme.space[3]`
- [x] Replace off-grid padding `16` on collapsed EOD card at `src/components/journal/JournalEntryCard.jsx:83` with `theme.space[4]`
- [x] Replace off-grid spacing `6` (marginBottom on card header) at `src/components/journal/JournalEntryCard.jsx:86` with `theme.space[1]`
- [x] Replace off-grid spacing `8` (gap in header flex) at `src/components/journal/JournalEntryCard.jsx:87` with `theme.space[2]`
- [x] Replace off-grid spacing `10` (gap in date row) at `src/components/journal/JournalEntryCard.jsx:93` with `theme.space[2]`
- [x] Replace raw fontSize `11` on badge label at `src/components/journal/JournalEntryCard.jsx:88` with `theme.size.xs` (10px) — 11px is an off-scale value
- [x] Replace off-grid spacing `8` (marginBottom on stinger line) at `src/components/journal/JournalEntryCard.jsx:100` with `theme.space[2]`
- [x] Replace off-grid spacing `6` (gap in stinger span) at `src/components/journal/JournalEntryCard.jsx:100` with `theme.space[1]`
- [x] Replace off-grid spacing `10` on marginBottom body preview at `src/components/journal/JournalEntryCard.jsx:125` — use `theme.space[2]`
- [x] Replace off-grid padding `"16px 16px 12px"` on expanded EOD detail at `src/components/journal/JournalEntryCard.jsx:137` — 12px bottom is off-grid vs expected 16px; use `"${theme.space[4]}px ${theme.space[4]}px ${theme.space[3]}px"`
- [x] Replace off-grid spacing `18px 20px` gap on metadata grid at `src/components/journal/JournalEntryCard.jsx:140` — 18px off-grid; replace with `"${theme.space[4]}px ${theme.space[5]}px"` (16px 20px)
- [x] Replace off-grid spacing `20` (marginBottom on metadata grid) at `src/components/journal/JournalEntryCard.jsx:140` with `theme.space[5]`
- [x] Replace off-grid spacing `10` (marginBottom on CELL_LBL) at `src/components/journal/JournalEntryCard.jsx:74` with `theme.space[2]`
- [x] Replace off-grid spacing `10` (marginBottom on SEC_HDR) at `src/components/journal/JournalEntryCard.jsx:76` with `theme.space[2]`
- [x] Replace off-grid spacing `20` (marginBottom on monthly targets section) at `src/components/journal/JournalEntryCard.jsx:177` with `theme.space[5]`
- [x] Replace off-grid spacing `16` (paddingBottom on monthly targets) at `src/components/journal/JournalEntryCard.jsx:177` with `theme.space[4]`
- [x] Replace off-grid spacing `6` (marginBottom on each target bar row) at `src/components/journal/JournalEntryCard.jsx:187` with `theme.space[1]`
- [x] Replace off-grid spacing `10` (gap in target bar row) at `src/components/journal/JournalEntryCard.jsx:187` with `theme.space[2]`
- [x] Replace off-grid spacing `20` (marginBottom on Activity section) at `src/components/journal/JournalEntryCard.jsx:201` with `theme.space[5]`
- [x] Replace off-grid spacing `10` (paddingTop inside Activity border) at `src/components/journal/JournalEntryCard.jsx:203` with `theme.space[2]`
- [x] Replace off-grid spacing `6` (marginBottom on activity rows) at `src/components/journal/JournalEntryCard.jsx:209` with `theme.space[1]`
- [x] Replace off-grid spacing `8` (gap in activity row) at `src/components/journal/JournalEntryCard.jsx:209` with `theme.space[2]`
- [x] Replace off-grid spacing `20` (marginBottom on CSP snapshot section) at `src/components/journal/JournalEntryCard.jsx:232` with `theme.space[5]`
- [x] Replace off-grid spacing `10` (paddingTop inside snapshot border) at `src/components/journal/JournalEntryCard.jsx:234` with `theme.space[2]`
- [x] Replace off-grid padding `"5px 12px 5px 0"` on CSP snapshot table cells at `src/components/journal/JournalEntryCard.jsx:251–257` — 5px off-grid; replace with `"${theme.space[1]}px ${theme.space[3]}px ${theme.space[1]}px 0"` (4px 12px 4px 0)
- [x] Replace off-grid spacing `16` (marginBottom on body text + paddingTop) at `src/components/journal/JournalEntryCard.jsx:269` with `theme.space[4]`
- [x] Replace off-grid spacing `14` (paddingTop on body text) at `src/components/journal/JournalEntryCard.jsx:269` — 14px off-grid; use `theme.space[3]` (12px) or `theme.space[4]` (16px)
- [x] Replace off-grid spacing `8` (gap in edit/delete actions) at `src/components/journal/JournalEntryCard.jsx:275` with `theme.space[2]`
- [x] Replace off-grid padding `"5px 8px"` on Delete button at `src/components/journal/JournalEntryCard.jsx:278` — 5px off-grid; replace with `"${theme.space[1]}px ${theme.space[2]}px"`
- [x] Replace off-grid padding `"5px 14px"` on Edit button at `src/components/journal/JournalEntryCard.jsx:283` — 5px off-grid; replace with `"${theme.space[1]}px ${theme.space[3]}px"` (4px 12px)
- [x] Replace off-grid spacing `12` (marginBottom on legacy card) at `src/components/journal/JournalEntryCard.jsx:297` with `theme.space[3]`
- [x] Replace off-grid spacing `8` (marginBottom on header row in legacy card) at `src/components/journal/JournalEntryCard.jsx:299` with `theme.space[2]`
- [x] Replace off-grid spacing `8` (gap in legacy header flex) at `src/components/journal/JournalEntryCard.jsx:300` with `theme.space[2]`
- [x] Replace raw fontSize `11` on badge in legacy card at `src/components/journal/JournalEntryCard.jsx:301` with `theme.size.xs`
- [x] Replace raw fontSize `16` on mood emoji in legacy card at `src/components/journal/JournalEntryCard.jsx:305` with `theme.size.lg`
- [x] Replace raw fontSize `13` on context line at `src/components/journal/JournalEntryCard.jsx:313` with `theme.size.sm`
- [x] Replace raw fontSize `15` on cardEmoji at `src/components/journal/JournalEntryCard.jsx:314` with `theme.size.md` or `theme.size.lg`
- [x] Replace off-grid spacing `8` (marginBottom on context line) at `src/components/journal/JournalEntryCard.jsx:313` with `theme.space[2]`
- [x] Replace off-grid spacing `5` (gap in context line) at `src/components/journal/JournalEntryCard.jsx:313` with `theme.space[1]`
- [x] Replace off-grid spacing `8` (marginBottom on trade metadata row) at `src/components/journal/JournalEntryCard.jsx:363` with `theme.space[2]`
- [x] Replace off-grid spacing `8` (gap in trade metadata row) at `src/components/journal/JournalEntryCard.jsx:363` with `theme.space[2]`
- [x] Replace off-grid spacing `10` (marginBottom on tags section) at `src/components/journal/JournalEntryCard.jsx:385` with `theme.space[2]`
- [x] Replace off-grid spacing `6` (marginRight on tag chip) at `src/components/journal/JournalEntryCard.jsx:387` with `theme.space[1]`
- [x] Replace off-grid spacing `12` (gap in legacy card actions) at `src/components/journal/JournalEntryCard.jsx:395` with `theme.space[3]`

**JournalField.jsx:**
- [x] Replace off-grid spacing `14` (marginBottom) at `src/components/journal/JournalField.jsx:5` with `theme.space[3]` (12px) or `theme.space[4]` (16px)

**JournalInlineEditForm.jsx:**
- [x] Replace off-grid spacing `14` (marginBottom on edit form header) at `src/components/journal/JournalInlineEditForm.jsx:12` with `theme.space[3]`
- [x] Replace off-grid spacing `6` (gap in mood button row) at `src/components/journal/JournalInlineEditForm.jsx:29` with `theme.space[1]`
- [x] Replace off-grid spacing `8` (padding on mood buttons) — `"8px 2px"` at `src/components/journal/JournalInlineEditForm.jsx:33` — 8px is `theme.space[2]`, use token; 2px is sub-grid but acceptable for small vertical centering
- [x] Replace off-grid spacing `3` (gap inside mood button column) at `src/components/journal/JournalInlineEditForm.jsx:37` with `theme.space[1]`
- [x] Replace off-grid spacing `16` (gap in source radio group) at `src/components/journal/JournalInlineEditForm.jsx:56` with `theme.space[4]`
- [x] Replace off-grid spacing `8` (gap in actions row) at `src/components/journal/JournalInlineEditForm.jsx:80` with `theme.space[2]`
- [x] Replace off-grid padding `"6px 12px"` on Cancel button at `src/components/journal/JournalInlineEditForm.jsx:81` — 6px off-grid; `"${theme.space[1]}px ${theme.space[3]}px"`
- [x] Replace off-grid padding `"6px 16px"` on Save button at `src/components/journal/JournalInlineEditForm.jsx:84` — 6px off-grid; `"${theme.space[1]}px ${theme.space[4]}px"`
- [x] Replace off-grid spacing `10` (marginBottom on error div) at `src/components/journal/JournalInlineEditForm.jsx:75` with `theme.space[2]`
- [x] Replace off-grid padding `"8px 10px"` on error div at `src/components/journal/JournalInlineEditForm.jsx:75` — 10px off-grid; `"${theme.space[2]}px ${theme.space[2]}px"`

## Q3 — Font-size outliers

- [x] Replace raw fontSize `11` (badge labels) in JournalEntryCard.jsx at lines `88` and `301` with `theme.size.xs` (10px) — 11px is between xs and sm with no token
- [x] Replace raw fontSize `13` (context line, loading text, error text, empty state) throughout JournalTab.jsx and JournalEntryCard.jsx — 13px is between sm (12px) and md (14px); replace with `theme.size.sm` at all occurrences
- [x] Replace raw fontSize `15` (cardEmoji span) at `src/components/journal/JournalEntryCard.jsx:314` with `theme.size.md` (14px)
- [x] Replace raw fontSize `16` (mood emoji display) at `src/components/journal/JournalEntryCard.jsx:305` with `theme.size.lg` (16px — same value but use token)
- [x] Replace raw fontSize `20` (mood emoji in buttons) at `src/components/journal/JournalTab.jsx:565` and `src/components/journal/JournalInlineEditForm.jsx:39` — 20px is between `lg` (16px) and `xl` (18px); acceptable for emoji display but not a token value. Consider `theme.size.xl` (18px) or document as a one-off.
- [x] Replace raw fontSize `12` (various labels in JournalTab.jsx at lines 413, 433, 437, 441, 483, 587) with `theme.size.sm` — 12px equals `theme.size.sm`, use the token

## Q4 — Surface inconsistency

- [x] Right-panel form wrapper at `src/components/journal/JournalTab.jsx:467` uses raw `padding: 16` instead of `theme.space[4]` — correct value but should use the token
- [x] EOD expanded detail at `src/components/journal/JournalEntryCard.jsx:137` uses `background: theme.bg.base` (darker than surface) — this is correct for a nested expand-below-card pattern, but the padding uses mixed raw values (see Q2)
- [x] Legacy EOD + non-EOD card at `src/components/journal/JournalEntryCard.jsx:297` uses `padding: theme.space[4]` — correct; consistent with canonical panel

## Q5 — State gaps

- [x] Missing hover state on entry type selector buttons (Trade Note / EOD Update / Position Note) at `src/components/journal/JournalTab.jsx:479` — `cursor: pointer` and `onClick` but no hover handler
- [x] Missing hover state on mood picker buttons in JournalTab at `src/components/journal/JournalTab.jsx:554` — `cursor: pointer` and `onClick` but no hover feedback
- [x] Missing hover state on mood picker buttons in JournalInlineEditForm at `src/components/journal/JournalInlineEditForm.jsx:33` — same issue
- [x] Missing hover state on Cancel button at `src/components/journal/JournalTab.jsx:691` and `src/components/journal/JournalInlineEditForm.jsx:81`
- [x] Missing hover state on collapsed EOD card click-to-expand at `src/components/journal/JournalEntryCard.jsx:82` — `cursor: pointer` but no hover background change
- [x] Missing hover state on Edit/Delete buttons in legacy card at `src/components/journal/JournalEntryCard.jsx:396–397` — `cursor: pointer` but no visual hover feedback
- [x] Missing focus rings on all `<input>` and `<select>` elements across JournalTab.jsx — filter selects (lines 413–428), title inputs, tags inputs, date input have no explicit focus indicator

## Total items: 74

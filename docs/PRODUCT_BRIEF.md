# Product Brief — Trading Dashboard Redesign

> Fill this in before handing to Claude for a redesign pass. Keep answers short —
> 1–3 sentences each. The goal is intent, not exhaustive spec.

---

## 1. The one-liner

_What is this app, in one sentence? Who uses it, what does it do, why does it exist?_

…

## 2. Who uses it

- **Primary user:**
- **How often they use it:** (daily before market open? intraday? weekly review?)
- **Device mix:** (desktop-only? also phone for on-the-go checks?)
- **Skill level:** (builds their own strategy / follows a mentor / somewhere in between)

## 3. Jobs-to-be-done

_Top 3–5 things the user is trying to accomplish. Phrase as "When ___, I want to ___, so I can ___."_

1. When **{trigger/context}**, I want to **{action}**, so I can **{outcome}**.
2. …
3. …
4. …
5. …

## 4. What's working today

_Screens, flows, or features that already feel right and should be preserved in the redesign._

- …
- …
- …

## 5. What's broken / frustrating

_Pain points. Be specific — "the radar tab feels cluttered" is more useful than "looks bad"._

- …
- …
- …

## 6. Trading strategy context

_The "why" behind the numbers. A redesigner who doesn't understand this will produce generic dashboard slop._

- **Core strategy:** (e.g., wheel, LEAPS + CSPs, swing, etc.)
- **Decision inputs:** (VIX regime, BB position, earnings, macro, … — what do you actually look at before making a trade?)
- **Cadence:** (how often are you opening/closing/rolling?)
- **Risk framework:** (VIX-based cash targets are already in CLAUDE.md — anything else?)
- **Reference docs:** (link to Ryan's style guide, focus rules, etc. that already live in the repo)

## 7. Information hierarchy

_If you could only show ONE number on screen, what is it? Three numbers? Ten?_

- **Tier 1 (always visible):** …
- **Tier 2 (one click away):** …
- **Tier 3 (drill-down / on demand):** …

## 8. Non-goals

_What this app is explicitly NOT trying to be. Prevents scope creep during redesign._

- Not a broker / order-entry tool
- Not a social / shared tool
- Not …
- Not …

## 9. Design constraints (already fixed — do not redesign these)

- Inline `style={{}}` only, no CSS files or Tailwind
- Theme tokens from `src/lib/theme.js` — never hardcode hex
- 4-point spacing grid, fixed font-size scale (xs/sm/md/lg/xl/xxl)
- Market-hours logic in ET, user-facing timestamps in browser-local
- See `CLAUDE.md` for full list

## 10. Redesign scope

_What's actually on the table for this pass?_

- [ ] Full visual refresh (colors, type, spacing)
- [ ] Information architecture (tab structure, nav)
- [ ] Specific screens only: _list them_
- [ ] Add new surfaces / views
- [ ] Mobile layout

## 11. Success criteria

_How will we know the redesign is better? Pick 2–3 measurable-ish things._

- …
- …
- …

## 12. Inspirations / anti-inspirations

_Optional. Apps or screenshots you want it to feel like — and ones you want to avoid._

- **Feels like:** …
- **Does NOT feel like:** …

---

## Attachments to include when handing to Claude

1. This filled-in brief
2. Screenshots of every current tab (desktop + mobile if relevant), labeled
3. One "happy path" screen recording (optional, 30–60s)
4. Links to `CLAUDE.md`, `DESIGN.md`, `RYAN_STYLE_GUIDE.md`, `FOCUS_RULES.md`

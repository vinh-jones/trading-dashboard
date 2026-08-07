# Deprecate `market_context` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every `market_context` code path — re-source Radar/Focus earnings from
`quotes.earnings_date`, and replace `macro_events` with a UW economic-calendar cron.

**Architecture:** `market_context` was fed by OpenClaw, which is not coming back; the table
has been frozen since 2026-07-01. Earnings move to `quotes.earnings_date` (already refreshed
daily by the `uw-earnings-dates` cron). Macro events move to a new `macro_events` table fed by
a new daily `uw-macro-events` cron. A new pure module `api/_lib/macroEvents.js` holds the
UW→row normalizer so it is testable without network.

**Tech Stack:** Vercel serverless (Node, ESM), Supabase (Postgres + RLS), React 18 with inline
style objects, vitest.

**Spec:** [docs/superpowers/specs/2026-08-07-deprecate-market-context-design.md](../specs/2026-08-07-deprecate-market-context-design.md)

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/2026-08-07-macro-events.sql` | **Create** — `macro_events` table, RLS-locked (service-role only, mirroring `market_context`) |
| `api/_lib/macroEvents.js` | **Create** — pure: classify a UW calendar row to an event type, normalize to a table row. No I/O |
| `api/__tests__/macroEvents.test.js` | **Create** — classifier + normalizer tests against a captured UW fixture |
| `api/_lib/__fixtures__/uw-economic-calendar.json` | **Create** — captured real UW REST response |
| `api/uw-macro-events.js` | **Create** — daily cron: fetch → normalize → replace window |
| `api/_lib/uwClient.js` | **Modify** — add `fetchMarketEvents` |
| `vercel.json` | **Modify** — cron entry + `maxDuration` |
| `middleware.js` | **Modify** — BYPASS entry (without it the cron 401s before the handler runs) |
| `api/_lib/loadFocusData.js` | **Modify** — `loadMarketContext` → `loadMacroEvents` |
| `api/focus-context.js` | **Modify** — return `macroEvents` + `macroRefreshedAt` |
| `api/_lib/evaluateAlerts.js` | **Modify** — pass `macroEvents` |
| `api/agent-scan.js` | **Modify** — drop `market_context`, build earnings map from rows |
| `api/ingest.js` | **Modify** — drop the `market_context` branch, keep `fundamentals` |
| `src/lib/radarData.js` | **Modify** — `getEarningsDaysAway` takes a ticker→date map |
| `src/lib/focusEngine.js` | **Modify** — earnings from `quoteMap`, macro from `macroEvents` |
| `src/components/RadarTab.jsx` | **Modify** — drop `marketContext` prop threading, read `row.earnings_date` |
| `src/components/FocusTab.jsx` | **Modify** — `MacroCalendar` on new shape, drop the past-release fallback |
| `src/hooks/useFocusItems.js` | **Modify** — fetch `macroEvents` |
| `src/App.jsx` | **Modify** — drop the `marketContext` prop |
| `src/data/market-context.json` | **Delete** — dev fixture |

**Not touched:** the `market_context` table itself stays (65 rows, historical record; dropping
is irreversible and unnecessary). `fundamentals`, `s5fi`, `fedwatch` are out of scope — see the
spec's "Out of scope" section.

---

## Task 1: Capture the real UW REST shape

The MCP tool and the REST endpoint return **different field names** for the same UW resource —
this bit us on candles (`o/h/l/c/start` vs `open/high/low/close/start_time`). The design was
written against MCP output. Everything downstream depends on getting the REST shape right, so
capture it first and let the fixture drive the code.

**Files:**
- Create: `api/_lib/__fixtures__/uw-economic-calendar.json`

- [ ] **Step 1: Get a UW key into the shell**

There is no `.env` with `UW_API_KEY` in this repo. Pull it from Vercel:

```bash
vercel env pull .env.local && grep UW_API_KEY .env.local
```

If the Vercel CLI is not installed, get the value from the Vercel dashboard
(Project → Settings → Environment Variables → `UW_API_KEY`) and export it by hand.

- [ ] **Step 2: Hit the REST endpoint and save the raw response**

```bash
curl -s -H "Authorization: Bearer $UW_API_KEY" -H "Accept: application/json" "https://api.unusualwhales.com/api/market/economic-calendar" -o api/_lib/__fixtures__/uw-economic-calendar.json && python3 -m json.tool api/_lib/__fixtures__/uw-economic-calendar.json | head -40
```

Expected: a JSON object wrapping an array. Each element should carry a date/time field, an
event-name field, and forecast/previous fields.

If that path 404s, the endpoint name differs. Find the right one:

```bash
curl -s -H "Authorization: Bearer $UW_API_KEY" "https://api.unusualwhales.com/api/market/economic-calendar?min_date=2026-08-07&max_date=2026-08-21" -o api/_lib/__fixtures__/uw-economic-calendar.json; head -c 400 api/_lib/__fixtures__/uw-economic-calendar.json
```

- [ ] **Step 3: Record the exact field names and the event names you actually see**

```bash
python3 -c "
import json
d=json.load(open('api/_lib/__fixtures__/uw-economic-calendar.json'))
rows=d.get('data') or d.get('result') or d
print('FIELD NAMES:', sorted(rows[0].keys()))
print('ROW COUNT:', len(rows))
print()
for r in sorted(rows, key=lambda x: str(x.get('time') or x.get('date'))):
    print(repr(r.get('event')), '|', r.get('time') or r.get('date'), '|', r.get('type'))
"
```

Write down the printed field names. Task 2's normalizer uses `time`, `event`, `type`,
`forecast` and `prev` — **if the REST names differ, use the REST names** and adjust the
normalizer in Task 2 Step 3 accordingly.

These four headline names were confirmed present during design and the regexes in Task 2 are
built for them:

- `Consumer price index` → CPI
- `Producer price index` → PPI
- `U.S. employment report` → NFP
- `U.S. retail sales` → RETAIL_SALES

**PCE and FOMC were not observable** in the ~8-day window available at design time. Look for
them in your output. If you see a PCE or an FOMC/Fed-decision row, note its exact name — Task 2
Step 6 has you assert on it.

- [ ] **Step 4: Commit the fixture**

```bash
git add api/_lib/__fixtures__/uw-economic-calendar.json
git commit -m "test: capture UW economic-calendar REST response as a fixture"
```

---

## Task 2: The pure classifier and normalizer

**Files:**
- Create: `api/_lib/macroEvents.js`
- Create: `api/__tests__/macroEvents.test.js`

- [ ] **Step 1: Write the failing test**

Create `api/__tests__/macroEvents.test.js`:

```js
import { describe, it, expect } from "vitest";
import { classifyEvent, normalizeEvents, MACRO_EVENT_TYPES } from "../_lib/macroEvents.js";

describe("classifyEvent", () => {
  it("matches the headline print for each confirmed type", () => {
    expect(classifyEvent("Consumer price index")).toBe("CPI");
    expect(classifyEvent("Producer price index")).toBe("PPI");
    expect(classifyEvent("U.S. employment report")).toBe("NFP");
    expect(classifyEvent("U.S. retail sales")).toBe("RETAIL_SALES");
  });

  it("rejects the core/YoY/MoM variants UW emits alongside the headline", () => {
    // UW returns four CPI rows for one release. Only the headline may survive,
    // or the calendar shows the same event four times.
    expect(classifyEvent("Core CPI")).toBeNull();
    expect(classifyEvent("CPI year over year")).toBeNull();
    expect(classifyEvent("Core CPI year over year")).toBeNull();
    expect(classifyEvent("Core PPI")).toBeNull();
    expect(classifyEvent("PPI year over year")).toBeNull();
    expect(classifyEvent("Retail sales minus autos")).toBeNull();
  });

  it("rejects unrelated low-signal releases", () => {
    expect(classifyEvent("Wholesale inventories")).toBeNull();
    expect(classifyEvent("NFIB optimism index")).toBeNull();
    expect(classifyEvent("Business inventories")).toBeNull();
    expect(classifyEvent("Initial jobless claims")).toBeNull();
  });

  it("is case- and whitespace-insensitive", () => {
    expect(classifyEvent("  CONSUMER PRICE INDEX  ")).toBe("CPI");
  });

  it("returns null for junk input", () => {
    expect(classifyEvent(null)).toBeNull();
    expect(classifyEvent("")).toBeNull();
    expect(classifyEvent(123)).toBeNull();
  });
});

describe("normalizeEvents", () => {
  const now = "2026-08-07T12:00:00.000Z";

  it("keeps only whitelisted headline events", () => {
    const rows = normalizeEvents([
      { time: "2026-08-12T12:30:00Z", event: "Consumer price index", prev: "-0.4%", forecast: "0.2%" },
      { time: "2026-08-12T12:30:00Z", event: "Core CPI",             prev: "0.0%",  forecast: null },
      { time: "2026-08-11T10:00:00Z", event: "NFIB optimism index",  prev: null,    forecast: null },
    ], now);

    expect(rows).toEqual([{
      event_date:   "2026-08-12",
      event_type:   "CPI",
      event_time:   "2026-08-12T12:30:00Z",
      title:        "Consumer price index",
      forecast:     "0.2%",
      previous:     "-0.4%",
      refreshed_at: now,
    }]);
  });

  it("dates events by New York calendar day, not UTC", () => {
    // 2026-08-13T00:30:00Z is 8:30pm ET on 08-12. Market logic is ET.
    const [row] = normalizeEvents(
      [{ time: "2026-08-13T00:30:00Z", event: "U.S. retail sales" }],
      now,
    );
    expect(row.event_date).toBe("2026-08-12");
  });

  it("keeps the earliest row when one type appears twice on a date", () => {
    // The table PK is (event_date, event_type); emitting both would fail the insert.
    const rows = normalizeEvents([
      { time: "2026-08-12T18:00:00Z", event: "Consumer price index", prev: "b" },
      { time: "2026-08-12T12:30:00Z", event: "Consumer price index", prev: "a" },
    ], now);
    expect(rows).toHaveLength(1);
    expect(rows[0].previous).toBe("a");
  });

  it("coerces forecast and previous to strings or null", () => {
    const [row] = normalizeEvents(
      [{ time: "2026-08-12T12:30:00Z", event: "Consumer price index", prev: 330.21, forecast: undefined }],
      now,
    );
    expect(row.previous).toBe("330.21");
    expect(row.forecast).toBeNull();
  });

  it("skips rows with no usable timestamp rather than writing a null date", () => {
    expect(normalizeEvents([{ time: null, event: "Consumer price index" }], now)).toEqual([]);
  });

  it("returns [] for junk input", () => {
    expect(normalizeEvents(null, now)).toEqual([]);
    expect(normalizeEvents({}, now)).toEqual([]);
  });

  it("exposes exactly the six whitelisted types", () => {
    expect([...MACRO_EVENT_TYPES].sort()).toEqual(
      ["CPI", "FOMC", "NFP", "PCE", "PPI", "RETAIL_SALES"],
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run api/__tests__/macroEvents.test.js`

Expected: FAIL — `Failed to resolve import "../_lib/macroEvents.js"`.

- [ ] **Step 3: Write the implementation**

Create `api/_lib/macroEvents.js`:

```js
/**
 * api/_lib/macroEvents.js — pure UW economic-calendar → macro_events rows.
 *
 * No I/O, so the classifier is testable against a captured fixture.
 *
 * UW emits several rows per release: for one CPI print you get "Consumer price
 * index", "Core CPI", "CPI year over year" and "Core CPI year over year". We
 * keep only the headline, one row per (date, type) — that is what the Focus
 * calendar and the macro_overlap rule both want, and it matches the table PK.
 *
 * Matching is an anchored regex on the exact headline name rather than a
 * substring, precisely so the core/YoY variants fall through.
 */

export const MACRO_EVENT_TYPES = ["CPI", "PPI", "NFP", "FOMC", "PCE", "RETAIL_SALES"];

// Order matters only for readability — the names are mutually exclusive.
const TYPE_MATCHERS = [
  { type: "CPI",          re: /^consumer price index$/ },
  { type: "PPI",          re: /^producer price index$/ },
  { type: "NFP",          re: /^u\.s\. employment report$/ },
  { type: "RETAIL_SALES", re: /^u\.s\. retail sales$/ },
  // Not observable in the ~8-day window at design time — see Task 1 Step 3.
  // Anchored alternatives cover the plausible UW spellings.
  { type: "PCE",          re: /^(pce index|personal consumption expenditures?( price index)?)$/ },
  { type: "FOMC",         re: /^(fomc announcement|fomc rate decision|fed interest[- ]rate decision)$/ },
];

/** Whitelisted event type for a UW event name, or null. */
export function classifyEvent(name) {
  if (typeof name !== "string") return null;
  const s = name.trim().toLowerCase();
  if (!s) return null;
  for (const { type, re } of TYPE_MATCHERS) {
    if (re.test(s)) return type;
  }
  return null;
}

// Market-facing dates are ET regardless of where the user sits (see CLAUDE.md).
// An 00:30Z release is the previous ET calendar day and must not drift forward.
const ET_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric", month: "2-digit", day: "2-digit",
});

function etDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return ET_DATE.format(d); // en-CA formats as YYYY-MM-DD
}

function str(v) {
  if (v === null || v === undefined || v === "") return null;
  return String(v);
}

/**
 * UW rows → macro_events rows, deduped to one per (event_date, event_type),
 * keeping the earliest event_time on a tie.
 */
export function normalizeEvents(rows, refreshedAt) {
  const list = Array.isArray(rows) ? rows : Array.isArray(rows?.data) ? rows.data : [];
  const byKey = new Map();

  for (const r of list) {
    const type = classifyEvent(r?.event);
    if (!type) continue;
    const time = r?.time;
    const date = time ? etDate(time) : null;
    if (!date) continue;

    const key = `${date}|${type}`;
    const prev = byKey.get(key);
    if (prev && String(prev.event_time) <= String(time)) continue;

    byKey.set(key, {
      event_date:   date,
      event_type:   type,
      event_time:   time,
      title:        String(r.event).trim(),
      forecast:     str(r?.forecast),
      previous:     str(r?.prev),
      refreshed_at: refreshedAt,
    });
  }

  return [...byKey.values()].sort(
    (a, b) => a.event_date.localeCompare(b.event_date) || a.event_type.localeCompare(b.event_type),
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run api/__tests__/macroEvents.test.js`

Expected: PASS, 13 tests.

- [ ] **Step 5: Add a fixture-driven coverage assertion**

This is the guard against silent classifier rot.

First add the fixture import alongside the existing imports at the **top** of
`api/__tests__/macroEvents.test.js` (Vite resolves JSON imports natively):

```js
import fixture from "../_lib/__fixtures__/uw-economic-calendar.json";
```

Then append the new describe block at the bottom of the file:

```js
describe("against the captured UW fixture", () => {
  const rows = normalizeEvents(fixture, "2026-08-07T12:00:00.000Z");

  it("classifies at least one real event", () => {
    // If UW renames its headline events, every type silently vanishes and the
    // Focus calendar goes blank with no error. This is the tripwire.
    expect(rows.length).toBeGreaterThan(0);
  });

  it("emits only whitelisted types", () => {
    for (const r of rows) expect(MACRO_EVENT_TYPES).toContain(r.event_type);
  });

  it("emits at most one row per (date, type)", () => {
    const keys = rows.map(r => `${r.event_date}|${r.event_type}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("emits a well-formed date for every row", () => {
    for (const r of rows) expect(r.event_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
```

- [ ] **Step 6: Run it and reconcile against what Task 1 actually showed**

Run: `npx vitest run api/__tests__/macroEvents.test.js`

Expected: PASS.

If "classifies at least one real event" **fails**, the REST event names differ from the MCP
names the regexes were built for. Print what the fixture actually contains and fix
`TYPE_MATCHERS` to match:

```bash
python3 -c "
import json
d=json.load(open('api/_lib/__fixtures__/uw-economic-calendar.json'))
rows=d.get('data') or d.get('result') or d
for r in rows: print(repr(r.get('event')))
" | sort -u
```

If Task 1 Step 3 showed a **PCE or FOMC** row, add an explicit assertion for it now so the
spelling is pinned — e.g. `expect(classifyEvent("<exact name you saw>")).toBe("PCE")`. If
neither appeared, leave the speculative regexes as they are; the coverage assertion above will
still catch a total classifier failure.

- [ ] **Step 7: Commit**

```bash
git add api/_lib/macroEvents.js api/__tests__/macroEvents.test.js
git commit -m "feat(macro): pure UW economic-calendar classifier and normalizer"
```

---

## Task 3: The `macro_events` table

**Files:**
- Create: `supabase/migrations/2026-08-07-macro-events.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/2026-08-07-macro-events.sql`:

```sql
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
-- UW's calendar only looks ~8 days ahead. The cron replaces the whole window
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
```

- [ ] **Step 2: Apply it**

Apply via the Supabase MCP `apply_migration` tool (project `bzfhheqqkwqqwsiqyqzk`, name
`2026-08-07-macro-events`) with the SQL above, or paste it into the Supabase SQL editor.

- [ ] **Step 3: Verify the table exists and is locked down**

Run this via the Supabase MCP `execute_sql` tool:

```sql
select c.relname, c.relrowsecurity, count(p.polname) as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public' and c.relname = 'macro_events'
group by 1, 2;
```

Expected: one row, `relrowsecurity = true`, `policies = 0`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/2026-08-07-macro-events.sql
git commit -m "feat(macro): add macro_events table"
```

---

## Task 4: `fetchMarketEvents` in the UW client

**Files:**
- Modify: `api/_lib/uwClient.js` (append after `fetchStockScreener`, around line 129)

- [ ] **Step 1: Add the fetcher**

Append after the `fetchStockScreener` function in `api/_lib/uwClient.js`:

```js
// Economic calendar — upcoming US macro releases. UW only publishes ~8 days
// forward; a wider max_date returns nothing extra, it does not error.
export function fetchMarketEvents(minDate, maxDate) {
  const qs = minDate && maxDate
    ? `?min_date=${encodeURIComponent(minDate)}&max_date=${encodeURIComponent(maxDate)}`
    : "";
  return uwGet(`/market/economic-calendar${qs}`);
}
```

If Task 1 Step 2 found a different path, use that path here instead.

- [ ] **Step 2: Verify it parses**

Run: `node --input-type=module -e "import('./api/_lib/uwClient.js').then(m => console.log(typeof m.fetchMarketEvents))"`

Expected: `function`

- [ ] **Step 3: Commit**

```bash
git add api/_lib/uwClient.js
git commit -m "feat(macro): add fetchMarketEvents to the UW client"
```

---

## Task 5: The `uw-macro-events` cron

**Files:**
- Create: `api/uw-macro-events.js`
- Modify: `vercel.json`
- Modify: `middleware.js:23-48`

- [ ] **Step 1: Write the handler**

Create `api/uw-macro-events.js`:

```js
/**
 * api/uw-macro-events.js — Vercel serverless function (cron)
 *
 * GET /api/uw-macro-events        → refresh the upcoming macro window
 * GET /api/uw-macro-events?days=3 → narrower window (smoke test)
 *
 * Replaces market_context.macro_events, which died with OpenClaw. Writes the
 * six whitelisted headline releases (CPI/PPI/NFP/FOMC/PCE/RETAIL_SALES) into
 * macro_events for the Focus calendar and focusEngine's macro_overlap rule.
 *
 * DELETE-then-INSERT the whole window rather than upserting: UW's horizon is
 * ~8 days, so passed events must clear or the table accumulates history the
 * calendar would have to filter around forever.
 *
 * Macro dates move slowly → once daily. In middleware BYPASS;
 * self-authenticates. Soft no-op until UW_API_KEY is set.
 */

import { createClient } from "@supabase/supabase-js";
import { hasUwKey, fetchMarketEvents } from "./_lib/uwClient.js";
import { normalizeEvents } from "./_lib/macroEvents.js";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

function authorized(req) {
  const auth   = req.headers["authorization"] || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const cron   = process.env.CRON_SECRET;
  const app    = process.env.APP_SECRET;
  if (cron && bearer === cron) return true;
  if (app && bearer === app) return true;
  const cookie = req.headers.cookie || "";
  const m = cookie.match(/(?:^|;\s*)app_auth=([^;]+)/);
  const cookieTok = m ? decodeURIComponent(m[1]) : null;
  return !!(app && cookieTok === app);
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });
  if (!hasUwKey()) return res.status(200).json({ ok: true, skipped: "UW_API_KEY not configured", written: 0 });

  try {
    const supabase = getSupabase();
    const now      = new Date().toISOString();
    const today    = now.slice(0, 10);
    const days     = Math.min(Math.max(parseInt(req.query.days, 10) || 21, 1), 60);
    const maxDate  = new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

    const resp = await fetchMarketEvents(today, maxDate);
    const rows = normalizeEvents(resp, now);

    // Clear the range we are about to rewrite: everything up to and including
    // maxDate. Bounded on purpose — rows past the window (which UW never
    // produces) are left alone rather than swept up by a match-all predicate.
    //
    // The floor has to be open, not `>= today`. A `>= today` delete orphans one
    // row every single day: a row written today for today sits below tomorrow's
    // floor and is never revisited, so the table grows without bound — the
    // opposite of what replace-per-run is for. Every consumer filters
    // `>= today`, so those strays would accumulate invisibly.
    //
    // Deleting the whole range also means a cancelled or renamed UW release
    // cannot linger as a phantom future row, which a plain upsert would leave.
    const { error: delErr } = await supabase
      .from("macro_events")
      .delete()
      .lte("event_date", maxDate);
    if (delErr) throw new Error(`macro_events delete failed: ${delErr.message}`);

    if (rows.length) {
      const { error: insErr } = await supabase.from("macro_events").insert(rows);
      if (insErr) throw new Error(`macro_events insert failed: ${insErr.message}`);
    }

    const types = [...new Set(rows.map((r) => r.event_type))].sort();
    // An empty type list means the classifier stopped matching UW's names.
    if (!types.length) {
      console.warn("[api/uw-macro-events] no events classified — check UW event names against api/_lib/macroEvents.js");
    }
    console.log(`[api/uw-macro-events] wrote ${rows.length} rows through ${maxDate} (types: ${types.join(", ") || "none"})`);

    return res.status(200).json({ ok: true, written: rows.length, types, through: maxDate });
  } catch (err) {
    console.error("[api/uw-macro-events]", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
```

- [ ] **Step 2: Register the cron and its duration**

In `vercel.json`, add to the `functions` object (after the `api/uw-earnings-dates.js` line):

```json
    "api/uw-macro-events.js": { "maxDuration": 60 },
```

And add to the `crons` array (after the `/api/uw-earnings-dates` entry). 11:30 UTC puts it
before the 12:00 earnings cron and well ahead of the open:

```json
    {
      "path": "/api/uw-macro-events",
      "schedule": "30 11 * * 1-5"
    },
```

- [ ] **Step 3: Add the middleware bypass**

**Without this the cron 401s before the handler ever runs** — Vercel cron sends `CRON_SECRET`
but the middleware checks `APP_SECRET`. In `middleware.js`, add to the `BYPASS` set next to
`"/api/uw-earnings-dates"`:

```js
  "/api/uw-macro-events",
```

- [ ] **Step 4: Verify the config is valid JSON and the bypass landed**

```bash
python3 -m json.tool vercel.json > /dev/null && echo "vercel.json OK" && grep -c "uw-macro-events" vercel.json middleware.js
```

Expected: `vercel.json OK`, then `vercel.json:2` and `middleware.js:1`.

- [ ] **Step 5: Commit**

```bash
git add api/uw-macro-events.js vercel.json middleware.js
git commit -m "feat(macro): add uw-macro-events cron with middleware bypass"
```

---

## Task 6: Point `getEarningsDaysAway` at a ticker→date map

`radarFilter` calls `ctx.earningsDaysAway(row.ticker)`, so the lookup stays ticker-keyed. Only
the second argument changes: a `marketContext` blob becomes a plain `Map`/object of
ticker → `YYYY-MM-DD`.

**Files:**
- Modify: `src/lib/radarData.js:128-139`
- Test: `src/lib/__tests__/radarData.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/__tests__/radarData.test.js` (add `getEarningsDaysAway` and
`buildEarningsMap` to the existing import from `../radarData`):

```js
describe("buildEarningsMap", () => {
  it("maps ticker to earnings_date, skipping rows without one", () => {
    const map = buildEarningsMap([
      { ticker: "AAA", earnings_date: "2026-09-01" },
      { ticker: "BBB", earnings_date: null },
      { ticker: "CCC" },
    ]);
    expect(map.get("AAA")).toBe("2026-09-01");
    expect(map.has("BBB")).toBe(false);
    expect(map.has("CCC")).toBe(false);
  });

  it("tolerates junk input", () => {
    expect(buildEarningsMap(null).size).toBe(0);
  });
});

describe("getEarningsDaysAway", () => {
  const iso = (offsetDays) =>
    new Date(Date.now() + offsetDays * 864e5).toISOString().slice(0, 10);

  it("returns whole days until the earnings date", () => {
    const map = new Map([["AAA", iso(10)]]);
    expect(getEarningsDaysAway("AAA", map)).toBe(10);
  });

  it("returns null for an unknown ticker — unknown is not zero", () => {
    // radarFilter treats null as "don't filter". Returning 0 here would make
    // every unknown ticker look like it reports today and fail earnings_days_min.
    expect(getEarningsDaysAway("ZZZ", new Map())).toBeNull();
  });

  it("returns null when the map is missing entirely", () => {
    expect(getEarningsDaysAway("AAA", null)).toBeNull();
  });

  it("returns a negative number for a past date", () => {
    const map = new Map([["AAA", iso(-5)]]);
    expect(getEarningsDaysAway("AAA", map)).toBeLessThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/__tests__/radarData.test.js`

Expected: FAIL — `buildEarningsMap is not a function`.

- [ ] **Step 3: Replace the implementation**

In `src/lib/radarData.js`, replace the whole `getEarningsDaysAway` block (the comment and the
function, lines 128–139) with:

```js
/**
 * Ticker → earnings_date map, built from merged Radar rows or quote rows.
 * Both carry `earnings_date` sourced from the uw-earnings-dates cron.
 */
export function buildEarningsMap(rows) {
  const map = new Map();
  for (const r of rows || []) {
    if (r?.ticker && r.earnings_date) map.set(r.ticker, r.earnings_date);
  }
  return map;
}

/**
 * Days until a ticker's next earnings, from a ticker → date map.
 * Shared with api/agent-scan.js so the server builds the same filter ctx.
 *
 * Returns null when the ticker has no known date — callers (and
 * rowMatchesFilters) treat null as "unknown", NOT as "fails the filter".
 */
export function getEarningsDaysAway(ticker, earningsByTicker) {
  const date = earningsByTicker?.get?.(ticker);
  if (!date) return null;
  return Math.ceil((new Date(date) - new Date()) / (1000 * 60 * 60 * 24));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/__tests__/radarData.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/radarData.js src/lib/__tests__/radarData.test.js
git commit -m "feat(radar): source earnings-days-away from quotes.earnings_date"
```

---

## Task 7: Rewire RadarTab

`marketContext` was threaded down purely for earnings. Rows already carry `earnings_date`, so
the prop disappears from `RadarRow` and `ExpandedPanel` entirely.

**Files:**
- Modify: `src/components/RadarTab.jsx` (lines 2, 92–99, 534, 547, 770, 783, 805, 1414, 1424–1433, 1490, 1498, 1513, 1548, 1694)

- [ ] **Step 1: Drop the dev-fixture import**

Delete line 2 of `src/components/RadarTab.jsx`:

```js
import marketContextDev from "../data/market-context.json";
```

Then add `buildEarningsMap` to the existing `radarData` import. Find the line importing
`getEarningsDaysAway` and make it:

```js
import { getEarningsDaysAway, buildEarningsMap } from "../lib/radarData";
```

(If `getEarningsDaysAway` is imported from elsewhere in the file, add `buildEarningsMap` to
that same import rather than creating a second one.)

- [ ] **Step 2: Rewrite the earnings warning to read the row**

Replace the `getEarningsWarning` function (lines 92–99) with:

```js
function getEarningsWarning(earningsDate) {
  if (!earningsDate) return null;
  const daysAway = Math.ceil((new Date(earningsDate) - new Date()) / (1000 * 60 * 60 * 24));
  if (daysAway <= 21 && daysAway >= 0) return `⚠ Earnings ${earningsDate}`;
  return null;
}
```

- [ ] **Step 3: Drop the prop from `RadarRow`**

Line 534 — remove `marketContext` from the parameter list:

```js
function RadarRow({ row, sample, positions, expanded, onToggle, sortBy, account, ivTrend }) {
```

Line 547 — read the row instead:

```js
  const earningsWarn = getEarningsWarning(row.earnings_date);
```

Line 770 — delete this line from the `<ExpandedPanel .../>` props:

```js
          marketContext={marketContext}
```

- [ ] **Step 4: Drop the prop from `ExpandedPanel`**

Lines 783–784 — remove `marketContext` from the parameter list and add `earnings_date` to the
`row` destructure (it is not currently destructured). Replace both lines with:

```js
function ExpandedPanel({ row, sample, indicators, positions, bucket, score, account, ivTrend }) {
  const { ticker, company, sector, last, iv, iv_rank, bb_position, bb_upper, bb_lower, bb_sma20, rsi_14, pe_ttm, pe_annual, eps_ttm, beta, ma_50, ma_200, gex_env, gex_support, gex_resistance, gex_air_pocket, earnings_date } = row;
```

Line 805 — read the destructured value instead of the blob:

```js
  const earningsDate = earnings_date ?? null;
```

- [ ] **Step 5: Replace the state and fetch with a derived map**

Delete line 1414:

```js
  const [marketContext, setMarketContext]       = useState(null);
```

Delete the whole `useEffect` at lines 1424–1433 (the one that sets `marketContext` from
`/api/focus-context`).

Add this `useMemo` immediately after the `ivTrendsByTicker` memo (which ends at line 1412):

```js
  // Earnings dates ride along on the Radar rows (quotes.earnings_date, refreshed
  // daily by the uw-earnings-dates cron) — no separate fetch needed.
  const earningsByTicker = useMemo(() => buildEarningsMap(rows), [rows]);
```

- [ ] **Step 6: Update both filter contexts and their dependency arrays**

Line 1490 (inside `curatedCounts`) and line 1513 (inside `processedRows`) — both become:

```js
        earningsDaysAway: (ticker) => getEarningsDaysAway(ticker, earningsByTicker),
```

Line 1498 — swap `marketContext` for `earningsByTicker`:

```js
  }, [rows, positions, earningsByTicker, ivTrendsByTicker]);
```

Line 1548 — same swap:

```js
  }, [rows, bbFilter, advancedFilters, sortBy, positions, earningsByTicker, ivTrendsByTicker]);
```

- [ ] **Step 7: Drop the prop at the render site**

Line 1694 — delete this line from the `<RadarRow .../>` props:

```js
              marketContext={marketContext}
```

- [ ] **Step 8: Verify nothing references marketContext and the build passes**

```bash
grep -n "marketContext\|market-context" src/components/RadarTab.jsx; npm run build
```

Expected: no grep output, build succeeds.

- [ ] **Step 9: Run the full suite**

Run: `npm test`

Expected: PASS except `api/__tests__/agent-scan.test.js`, which Task 8 fixes. If any other
suite fails, fix it before continuing.

- [ ] **Step 10: Commit**

```bash
git add src/components/RadarTab.jsx
git commit -m "feat(radar): read earnings from quotes, drop marketContext threading"
```

---

## Task 8: Rewire agent-scan

**Files:**
- Modify: `api/agent-scan.js` (lines 75, 153, 165, 202, 265, 338–361)
- Test: `api/__tests__/agent-scan.test.js:118-134`

- [ ] **Step 1: Update the failing tests first**

In `api/__tests__/agent-scan.test.js`, replace both earnings tests (lines 118–134) with:

```js
  it("excludes a ticker with earnings inside 30 days", () => {
    const soon = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
    const payload = buildScanPayload({
      rows: [strongRow({ earnings_date: soon })],
      preset: primeSetup,
    });
    expect(tickersIn(payload)).toEqual([]);
  });

  it("keeps a ticker whose earnings date is UNKNOWN — null is not 'too soon'", () => {
    // Documents live behaviour: quotes.earnings_date is null for names with no
    // upcoming report. If this ever flips to exclude-on-null, Prime Setup would
    // silently collapse to a few names.
    const payload = buildScanPayload({
      rows: [strongRow({ earnings_date: null })],
      preset: primeSetup,
    });
    expect(tickersIn(payload)).toEqual(["AAA"]);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run api/__tests__/agent-scan.test.js`

Expected: FAIL — the first test still passes the ticker through, because `buildScanPayload`
is still reading `marketContext`.

- [ ] **Step 3: Update `buildScanPayload`**

Line 153 — delete the `marketContext = null,` parameter.

Add `buildEarningsMap` to the existing `radarData` import at the top of the file (alongside
`getEarningsDaysAway`).

Immediately before the `const ctx = {` block (line 162-ish), add:

```js
  const earningsByTicker = buildEarningsMap(rows);
```

Line 165 becomes:

```js
    earningsDaysAway: (ticker) => getEarningsDaysAway(ticker, earningsByTicker),
```

Line 202 becomes:

```js
      earningsDaysAway: getEarningsDaysAway(r.ticker, earningsByTicker),
```

Line 265 — delete the `marketContextAsOf` line from the `asOf` object, leaving:

```js
    asOf: {
      bbRefreshedAt,
    },
```

- [ ] **Step 4: Drop the `market_context` query from the handler**

Lines 338–341 — replace the comment and the `Promise.all` with:

```js
    // Positions fail soft — without them `ownership` degrades to "unknown",
    // which the filter treats as a pass rather than silently emptying the list.
    const [ivTrendsByTicker, positionsResult] = await Promise.all([
      fetchIvTrends(supabase, tickers),
      supabase.from("positions").select("*").order("ticker"),
    ]);
```

Delete the `contextResult` error check (the `PGRST116` block, lines 352–355) and the
`const marketContext = ...` assignment (lines 356–359).

In the `buildScanPayload({ ... })` call, remove `marketContext,` from the argument object.

Line 75 — delete the stale comment mentioning `market_context` is RLS-locked, if it refers only
to that table. Check the surrounding lines first; if it also justifies the service-role client
for `positions`, reword it to name `positions` instead of deleting.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run api/__tests__/agent-scan.test.js`

Expected: PASS.

- [ ] **Step 6: Verify no references remain**

```bash
grep -n "marketContext\|market_context" api/agent-scan.js api/__tests__/agent-scan.test.js
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add api/agent-scan.js api/__tests__/agent-scan.test.js
git commit -m "feat(agent-scan): source earnings from row data, drop market_context"
```

---

## Task 9: focusEngine — earnings from `quoteMap`, macro from `macroEvents`

The third positional arg of `generateFocusItems` changes from a `marketContext` blob to a
`macroEvents` array. Arity is unchanged, and every existing test passes `null` there, so they
keep passing.

**Files:**
- Modify: `src/lib/focusEngine.js` (lines 44–67, 421–424, 466–470, 678, 699–700)
- Test: `src/lib/__tests__/focusEngine.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/__tests__/focusEngine.test.js`, inside the `describe("generateFocusItems")`
block. Reuse the file's existing `emptyPositions()` helper:

```js
  it("fires earnings_before_expiry from quoteMap earnings data", () => {
    const soon   = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
    const expiry = new Date(Date.now() + 12 * 864e5).toISOString().slice(0, 10);
    const positions = {
      ...emptyPositions(),
      open_csps: [{ ticker: "AAA", type: "CSP", strike: 100, expiry_date: expiry }],
    };
    const quoteMap = new Map([
      ["AAA", {
        symbol: "AAA",
        instrument_type: "EQUITY",
        earnings_date: soon,
        earnings_meta: { hour: "amc", epsEstimate: 1.25 },
      }],
    ]);

    const items = generateFocusItems(positions, {}, null, null, quoteMap);
    const item  = items.find(i => i.rule === "earnings_before_expiry");

    expect(item).toBeDefined();
    expect(item.ticker).toBe("AAA");
    expect(item.detail).toContain("AMC");
    expect(item.detail).toContain("+1.25");
  });

  it("does not fire earnings_before_expiry when earnings land after expiry", () => {
    const expiry = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
    const later  = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10);
    const positions = {
      ...emptyPositions(),
      open_csps: [{ ticker: "AAA", type: "CSP", strike: 100, expiry_date: expiry }],
    };
    const quoteMap = new Map([
      ["AAA", { symbol: "AAA", instrument_type: "EQUITY", earnings_date: later }],
    ]);

    const items = generateFocusItems(positions, {}, null, null, quoteMap);
    expect(items.find(i => i.rule === "earnings_before_expiry")).toBeUndefined();
  });

  it("fires macro_overlap from a macroEvents array", () => {
    const evtDate = new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10);
    const positions = {
      ...emptyPositions(),
      open_csps: [{ ticker: "AAA", type: "CSP", strike: 100, expiry_date: evtDate }],
    };
    const macroEvents = [{ event_date: evtDate, event_type: "CPI", title: "Consumer price index" }];

    const items = generateFocusItems(positions, {}, macroEvents, null);
    const item  = items.find(i => i.rule === "macro_overlap");

    expect(item).toBeDefined();
    expect(item.id).toBe(`macro-CPI-${evtDate}`);
  });

  it("ignores macro events that have already passed", () => {
    const past = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
    const positions = {
      ...emptyPositions(),
      open_csps: [{ ticker: "AAA", type: "CSP", strike: 100, expiry_date: past }],
    };
    const macroEvents = [{ event_date: past, event_type: "CPI", title: "Consumer price index" }];

    const items = generateFocusItems(positions, {}, macroEvents, null);
    expect(items.find(i => i.rule === "macro_overlap")).toBeUndefined();
  });

  it("fires no macro_overlap when the macro_events table is empty", () => {
    // The empty case is the one that used to render April data via
    // MacroCalendar's past-release fallback. Empty must stay empty.
    const evtDate = new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10);
    const positions = {
      ...emptyPositions(),
      open_csps: [{ ticker: "AAA", type: "CSP", strike: 100, expiry_date: evtDate }],
    };
    expect(generateFocusItems(positions, {}, [],   null).find(i => i.rule === "macro_overlap")).toBeUndefined();
    expect(generateFocusItems(positions, {}, null, null).find(i => i.rule === "macro_overlap")).toBeUndefined();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/__tests__/focusEngine.test.js`

Expected: FAIL — the new tests find no `earnings_before_expiry` / `macro_overlap` item.

- [ ] **Step 3: Rewrite the two helpers**

In `src/lib/focusEngine.js`, replace `buildEarningsMap` and `getUpcomingMacroEvents`
(lines 44–67) with:

Note the rename: `buildEarningsMap` → `buildQuoteEarningsMap`. Task 6 adds a *different*
`buildEarningsMap` to `radarData.js` that returns a `Map` of ticker → date string. Two helpers
with one name and different return types is a trap for whoever reads this next, so this one
takes the more specific name.

```js
// Build { TICKER -> { date, time, epsEstimate } } from the quotes map.
// quotes.earnings_date / earnings_meta are refreshed daily by the
// uw-earnings-dates cron; earnings_meta carries hour + epsEstimate.
//
// NOT the same function as radarData.js's buildEarningsMap, which returns a
// Map of ticker -> date string for the Radar filter ctx.
function buildQuoteEarningsMap(quoteMap) {
  const map = {};
  if (!quoteMap?.forEach) return map;
  quoteMap.forEach((q, symbol) => {
    if (q?.instrument_type !== "EQUITY") return;
    if (!q?.earnings_date) return;
    map[symbol] = {
      date:        q.earnings_date,
      time:        q.earnings_meta?.hour ?? null,
      epsEstimate: q.earnings_meta?.epsEstimate ?? null,
    };
  });
  return map;
}

// Upcoming rows from the macro_events table. The table PK is
// (event_date, event_type) and UW's horizon is ~8 days, so there is no
// dedupe to do here — just drop what has already passed.
function getUpcomingMacroEvents(macroEvents) {
  if (!Array.isArray(macroEvents)) return [];
  const todayStr = today();
  return macroEvents
    .filter(e => e?.event_date && e.event_date >= todayStr)
    .map(e => ({ ...e, date: e.event_date, eventType: e.event_type }));
}
```

- [ ] **Step 4: Update the two rules**

Line 421–424 — change the signature and the map source:

```js
function ruleEarningsBeforeExpiry(positions, quoteMap) {
  const items = [];
  const earningsMap = buildQuoteEarningsMap(quoteMap);
  const options = [];
```

(Delete the `if (!marketContext) return [];` guard — `buildQuoteEarningsMap` already returns
`{}` for a missing map.)

Line 466–470 — change the signature:

```js
function ruleMacroOverlap(positions, macroEvents) {
  const items = [];
  const upcoming = getUpcomingMacroEvents(macroEvents);
  if (!upcoming.length) return items;
```

Then inside that function rename the local reference: the `for (const evt of macroEvents)` loop
at line 481 must iterate `upcoming`, not the raw argument:

```js
  for (const evt of upcoming) {
```

- [ ] **Step 5: Update the entry point**

Line 678 — rename the third parameter:

```js
export function generateFocusItems(positions, account, macroEvents, liveVix, quoteMap = new Map(), rollAnalysisMap = {}, assignedShareIncome = null) {
```

Lines 699–700:

```js
    ...ruleEarningsBeforeExpiry(positions, quoteMap),
    ...ruleMacroOverlap(positions, macroEvents),
```

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run src/lib/__tests__/focusEngine.test.js`

Expected: PASS, including the pre-existing tests that pass `null` as the third arg.

- [ ] **Step 7: Commit**

```bash
git add src/lib/focusEngine.js src/lib/__tests__/focusEngine.test.js
git commit -m "feat(focus): earnings from quoteMap, macro from macro_events"
```

---

## Task 10: Server-side loaders

**Files:**
- Modify: `api/_lib/loadFocusData.js:10, 25-45`
- Modify: `api/_lib/evaluateAlerts.js:28, 33-43`
- Modify: `api/focus-context.js`

- [ ] **Step 1: Replace the loader**

In `api/_lib/loadFocusData.js`, update the header comment on line 10:

```js
 *   - macroEvents     : array of macro_events rows (possibly empty)
```

Replace the entire `loadMarketContext` function (lines 25–45) with:

```js
export async function loadMacroEvents(supabase) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("macro_events")
      .select("event_date, event_type, event_time, title, forecast, previous, refreshed_at")
      .gte("event_date", today)
      .order("event_date", { ascending: true });

    if (error) throw error;
    return data ?? [];
  } catch (err) {
    console.warn("[loadFocusData] macro_events load failed:", err.message);
    return [];
  }
}
```

- [ ] **Step 2: Update the alert evaluator**

In `api/_lib/evaluateAlerts.js`, line 28 — swap the import name:

```js
import { loadQuoteMap, loadMacroEvents, loadRollAnalysisMap, loadAssignedShareIncome } from "./loadFocusData.js";
```

Lines 33–43 — swap the destructured name, the loader call, and the argument:

```js
  const [quoteMap, macroEvents, rollAnalysisMap, assignedShareIncome] = await Promise.all([
    loadQuoteMap(supabase),
    loadMacroEvents(supabase),
    loadRollAnalysisMap(supabase),
    loadAssignedShareIncome(supabase),
  ]);

  const items = generateFocusItems(
    reshapedPositions,
    accountSnap,
    macroEvents,
    liveVix,
    quoteMap,
    rollAnalysisMap,
    assignedShareIncome,
  );
```

- [ ] **Step 3: Update the browser-facing endpoint**

In `api/focus-context.js`, update the header comment (line 7):

```js
 *   - `macroEvents`:   upcoming rows from `macro_events` (UW economic calendar)
```

Line 21 comment — `macro_events` is RLS-locked the same way, so just rename:

```js
  // macro_events is RLS-locked (no anon policy) — must use the service
```

Replace the `market_context` sub-query inside `Promise.all` with:

```js
      supabase
        .from("macro_events")
        .select("event_date, event_type, event_time, title, forecast, previous, refreshed_at")
        .gte("event_date", new Date().toISOString().slice(0, 10))
        .order("event_date", { ascending: true }),
```

Rename `contextResult` to `macroResult` throughout, and replace the error check plus the
`marketContext` construction with:

```js
    if (macroResult.error) {
      console.warn("[api/focus-context] macro_events read failed:", macroResult.error.message);
    }
    const macroEvents      = macroResult.data ?? [];
    const macroRefreshedAt = macroEvents[0]?.refreshed_at ?? null;
```

(The `PGRST116` special case goes away — this is a list query, not `.single()`, so an empty
table is `[]` and not an error.)

Finally, the response:

```js
    res.status(200).json({ ok: true, macroEvents, macroRefreshedAt, alertState });
```

- [ ] **Step 4: Verify no references remain and the suite passes**

```bash
grep -n "marketContext\|market_context" api/_lib/loadFocusData.js api/_lib/evaluateAlerts.js api/focus-context.js; npm test
```

Expected: no grep output; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/loadFocusData.js api/_lib/evaluateAlerts.js api/focus-context.js
git commit -m "feat(focus): load macro_events server-side, drop market_context loader"
```

---

## Task 11: FocusTab — new shape, no past-release fallback

The fallback branch is what put April CPI on screen. With a live feed, an empty upcoming set
must render nothing.

**Files:**
- Modify: `src/components/FocusTab.jsx` (lines 76–109, 165–176, 214–240, 268)

- [ ] **Step 1: Replace `MacroCalendar`'s event-selection logic**

Replace everything from the comment above `function MacroCalendar` through
`if (!events.length) return null;` (lines ~76–109) with:

```js
// Upcoming macro releases from the macro_events table (UW economic calendar,
// ~8-day horizon). Rows arrive pre-deduped — one per (date, type) — and already
// filtered to today-or-later by the API, so there is nothing to collapse here.
//
// Deliberately NO fall-back-to-most-recent-past-release: the old market_context
// version did that, and when its feed died it rendered four-month-old CPI/PPI as
// if current. An empty upcoming set renders nothing.
function MacroCalendar({ macroEvents }) {
  const events = [...(macroEvents ?? [])].sort((a, b) =>
    a.event_date.localeCompare(b.event_date),
  );
  if (!events.length) return null;
```

- [ ] **Step 2: Rebuild the table body for the new row shape**

Two things change beyond field names. The old markup has an **Actual** column and derives
`isPast` from `evt.actual != null` — `macro_events` has no `actual` column (UW's calendar is
forward-looking, and every row we store is upcoming by construction), so both go. And the label
special-case tests for `"FOMC_RATE_DECISION"`, which is not one of our six types.

Add this label map just above `function MacroCalendar`:

```js
const MACRO_LABELS = {
  CPI:          "CPI",
  PPI:          "PPI",
  NFP:          "Jobs report",
  FOMC:         "FOMC",
  PCE:          "PCE",
  RETAIL_SALES: "Retail sales",
};
```

Then replace the `<table>` element (from `<table style={{ width: "100%"` through its closing
`</table>`) with:

```jsx
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: theme.size.sm }}>
        <thead>
          <tr style={{ color: theme.text.subtle, borderBottom: `1px solid ${theme.border.default}` }}>
            <th style={{ ...colStyle, fontWeight: 500 }}>Event</th>
            <th style={{ ...colStyle, fontWeight: 500 }}>Date</th>
            <th style={{ ...colStyle, fontWeight: 500, textAlign: "right" }}>Previous</th>
            <th style={{ ...colStyle, fontWeight: 500, textAlign: "right" }}>Forecast</th>
          </tr>
        </thead>
        <tbody>
          {events.map((evt) => (
            <tr
              key={`${evt.event_date}-${evt.event_type}`}
              style={{
                borderBottom: `1px solid ${theme.border.default}`,
                color:        theme.text.secondary,
              }}
            >
              <td style={colStyle}>{MACRO_LABELS[evt.event_type] ?? evt.event_type}</td>
              <td style={{ ...colStyle, color: theme.text.muted }}>{formatExpiry(evt.event_date)}</td>
              <td style={{ ...colStyle, textAlign: "right", color: theme.text.muted }}>{evt.previous ?? "—"}</td>
              <td style={{ ...colStyle, textAlign: "right", color: theme.text.muted }}>{evt.forecast ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
```

The `key` moves from the array index to `${event_date}-${event_type}`, which is the table's
primary key and therefore genuinely stable across refetches.

- [ ] **Step 3: Retitle the freshness row**

"Market context" no longer exists as a concept. Line 165 — rename the prop:

```js
function DataFreshnessInfo({ quotesRefreshedAt, macroRefreshedAt, positionsLastUpdated }) {
```

Lines 172–176 — replace the middle entry of the `rows` array:

```js
  const rows = [
    { label: "Quotes",         value: fmt(quotesRefreshedAt),      note: "30 min cache · market hours only" },
    { label: "Macro calendar", value: fmt(macroRefreshedAt),       note: "daily · uw-macro-events cron" },
    { label: "Positions",      value: positionsLastUpdated || "—", note: "daily snapshot" },
  ];
```

- [ ] **Step 4: Update the FocusTab props**

Line 218 — swap the prop:

```js
  macroEvents,
  macroRefreshedAt,
```

Delete line 231 (`const macroEvents = marketContext?.macroEvents ?? [];`) — it is a prop now.

Line 238:

```js
          macroRefreshedAt={macroRefreshedAt}
```

Line 268 stays as-is (`<MacroCalendar macroEvents={macroEvents} />`).

- [ ] **Step 5: Verify and build**

```bash
grep -n "marketContext" src/components/FocusTab.jsx; npm run build
```

Expected: no grep output, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/components/FocusTab.jsx
git commit -m "feat(focus): render macro calendar from macro_events, drop stale fallback"
```

---

## Task 12: useFocusItems and App.jsx

**Files:**
- Modify: `src/hooks/useFocusItems.js` (lines 2, 21–46, 62)
- Modify: `src/App.jsx:281`

- [ ] **Step 1: Rewire the hook**

In `src/hooks/useFocusItems.js`, delete line 2:

```js
import marketContextDev from "../data/market-context.json";
```

Replace the state declarations (lines 21–22) with:

```js
  const [macroEvents, setMacroEvents]           = useState([]);
  const [macroRefreshedAt, setMacroRefreshedAt] = useState(null);
  const [mcLoading, setMcLoading]               = useState(true);
```

Replace the whole `useEffect` (lines 25–42) with:

```js
  useEffect(() => {
    // No dev fixture: local Vite does not serve api/*, so this simply stays
    // empty locally and the macro calendar renders nothing. That is honest —
    // the old market-context.json fixture is exactly how stale data got
    // mistaken for live during development.
    fetch("/api/focus-context")
      .then(r => r.json())
      .then(data => {
        if (!data.ok) return;
        if (Array.isArray(data.macroEvents)) setMacroEvents(data.macroEvents);
        if (data.macroRefreshedAt) setMacroRefreshedAt(data.macroRefreshedAt);
        if (Array.isArray(data.alertState)) {
          setNotifiedMap(new Map(data.alertState.map(a => [a.alert_id, { firstFiredAt: a.first_fired_at }])));
        }
      })
      .catch(err => console.warn("[useFocusItems] focus-context fetch failed:", err.message))
      .finally(() => setMcLoading(false));
  }, []);
```

Update the memo (lines 44–47):

```js
  const items = useMemo(
    () => generateFocusItems(positions, account, macroEvents, liveVix, quoteMap, rollMap, assignedShareIncome),
    [positions, account, macroEvents, liveVix, quoteMap, rollMap, assignedShareIncome]
  );
```

In the return object, replace `marketContext,` with:

```js
    macroEvents,
    macroRefreshedAt,
```

- [ ] **Step 2: Update App.jsx**

Line 281 — replace the `marketContext` prop with the two new ones:

```js
              macroEvents={focus.macroEvents}
              macroRefreshedAt={focus.macroRefreshedAt}
```

- [ ] **Step 3: Verify and build**

```bash
grep -rn "marketContext" src/ --include="*.jsx" --include="*.js" | grep -v redesign; npm run build
```

Expected: no grep output (the `src/redesign/` hits are excluded — that folder is frozen and
deliberately untouched), build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useFocusItems.js src/App.jsx
git commit -m "feat(focus): wire macroEvents through useFocusItems and App"
```

---

## Task 13: Strip the ingest write path and the dev fixture

**Files:**
- Modify: `api/ingest.js` (lines 5–21, 46–70, 115–118)
- Delete: `src/data/market-context.json`

- [ ] **Step 1: Update the header comment**

Replace lines 5–21 of `api/ingest.js` with:

```js
 * POST /api/ingest
 *
 * Fundamentals ingest. The market_context branch was removed on 2026-08-07 when
 * that table was deprecated (see docs/superpowers/specs/2026-08-07-deprecate-market-context-design.md).
 *
 * NOTE: the OpenClaw pusher that fed this endpoint is no longer running, so
 * `fundamentals` is itself frozen (last write 2026-07-01) and Radar's P/E plus
 * useRiskUnits' beta are stale. Re-sourcing it from UW is tracked in that
 * spec's out-of-scope section. The endpoint is kept, not deleted, so that work
 * has somewhere to land.
 *
 * Authentication: X-Ingest-Secret header must match MARKET_CONTEXT_INGEST_SECRET
 * env var. The env var keeps its historical name so no Vercel change is needed.
 *
 * Expected body shape:
 *   {
 *     fundamentals: array — [{ ticker, pe_ttm, pe_annual, eps_ttm, eps_annual, beta }]
 *   }
 */
```

- [ ] **Step 2: Replace the validation**

Replace lines 46–49 (the `asOf`/`positions`/`macroEvents` check) with:

```js
  if (!Array.isArray(body.fundamentals)) {
    return res.status(400).json({ ok: false, error: "Invalid payload: missing fundamentals" });
  }
```

- [ ] **Step 3: Delete the market_context insert**

Remove the `// Always: insert market context row` block — the entire
`tasks.push(supabase.from("market_context")...)` call (lines ~58–70). Keep the
`const tasks = [];` line and the fundamentals block that follows.

Change the fundamentals guard from a conditional to unconditional, since it is now the only
task. Replace:

```js
    if (Array.isArray(body.fundamentals) && body.fundamentals.length > 0) {
```

with:

```js
    if (body.fundamentals.length > 0) {
```

- [ ] **Step 4: Drop `asOf` from the response**

Remove this line from the results loop (line ~117):

```js
      if (r.type === "marketContext") response.asOf = r.asOf;
```

- [ ] **Step 5: Delete the dev fixture**

```bash
git rm src/data/market-context.json
```

- [ ] **Step 6: Verify nothing references it**

```bash
grep -rn "market_context\|market-context\|marketContext" src api --include="*.js" --include="*.jsx" | grep -v redesign | grep -v MARKET_CONTEXT_INGEST_SECRET
```

Expected: no output.

- [ ] **Step 7: Run the whole suite and build**

```bash
npm test && npm run build
```

Expected: all tests pass, build succeeds.

- [ ] **Step 8: Commit**

```bash
git add api/ingest.js src/data/market-context.json
git commit -m "refactor(ingest): drop the market_context write path and dev fixture"
```

---

## Task 14: Version bump and ship

**Files:**
- Modify: `package.json:4`
- Modify: `src/lib/constants.js:35`

- [ ] **Step 1: Confirm the baseline from main, not the local file**

This repo uses worktrees, so the local `package.json` may be behind:

```bash
git show origin/main:package.json | grep '"version"'
```

Expected: `"version": "1.175.4"`. If it differs, increment the **minor** from what you see, not
from `1.175.4`.

- [ ] **Step 2: Bump both files**

New feature plus behavior changes → minor bump. In `package.json` line 4 and
`src/lib/constants.js` line 35, set the version to `1.176.0`:

```json
  "version": "1.176.0",
```

```js
export const VERSION = "1.176.0";
```

- [ ] **Step 3: Verify they agree**

```bash
grep '"version"' package.json; grep 'const VERSION' src/lib/constants.js
```

Expected: both show `1.176.0`.

- [ ] **Step 4: Full verification before shipping**

```bash
npm test && npm run build
```

Expected: all suites pass, build succeeds. **Do not proceed if either fails.**

- [ ] **Step 5: Commit and push**

```bash
git add package.json src/lib/constants.js && git commit -m "chore: v1.176.0 — deprecate market_context" && git push origin main
```

Expected: push succeeds. Per CLAUDE.md, the change is not "done" until the push completes.

- [ ] **Step 6: Smoke-test the cron on the deployment**

Wait for the Vercel deploy to finish, then trigger the cron by hand. `$APP_SECRET` must be
exported (`vercel env pull .env.local` and source it):

```bash
curl -s -H "Authorization: Bearer $APP_SECRET" "https://<your-deployment-domain>/api/uw-macro-events" | python3 -m json.tool
```

Expected: `{"ok": true, "written": <n>, "types": [...], "through": "..."}` with `written > 0`
and `types` containing at least one of CPI/PPI/NFP/PCE/RETAIL_SALES/FOMC.

**If `written` is 0 or `types` is empty**, the classifier is not matching UW's REST event names.
Re-run Task 2 Step 6's diagnostic against a freshly captured fixture and fix `TYPE_MATCHERS`.
A 401 instead means the middleware BYPASS entry from Task 5 Step 3 did not land.

- [ ] **Step 7: Verify the rows landed**

Via the Supabase MCP `execute_sql` tool:

```sql
select event_date, event_type, title, forecast, previous, refreshed_at
from macro_events order by event_date;
```

Expected: one row per upcoming release, no duplicate `(event_date, event_type)` pairs, dates
all today-or-later.

- [ ] **Step 8: Verify the Radar earnings badge is alive again**

Open the deployed Radar tab. Cross-check against the tickers that have near-term earnings:

```sql
select symbol, earnings_date from quotes
where instrument_type = 'EQUITY' and earnings_date is not null
  and earnings_date <= (current_date + 21) order by earnings_date;
```

Expected: every ticker in that result which appears in the Radar list shows a
`⚠ Earnings YYYY-MM-DD` badge. This is the regression that has been silently broken for months
— confirm it visually, not just by reading the code.

---

## Notes for the implementer

**Local dev cannot verify the API-driven panels.** Vite has no API proxy in this repo, so
`/api/*` returns nothing locally and the Focus macro calendar will render empty. That is
expected. Verification is `npm test` + `npm run build` locally, then the deployment smoke tests
in Task 14.

**There is no component-test infrastructure.** `vitest.config.js` sets `environment: "node"`
and `@testing-library/react` is not a dependency. So `MacroCalendar` returning `null` on an
empty event list cannot be unit-tested here — the plan covers the same failure mode at the
engine layer instead (Task 9's "fires no macro_overlap when the macro_events table is empty"),
and the rendered result is confirmed on the deployment in Task 14. Do not add a testing-library
dependency for this; it is out of scope.

**`src/redesign/` is frozen.** It has its own copies of `RadarSurface.jsx`, `MacroGlance.jsx`
and `CalendarBar.jsx` that reference `marketContext`. Do not port these changes into that
folder; `src/components/` is canonical. Every `grep` verification step in this plan filters
`redesign` out for exactly this reason.

**The `market_context` table is intentionally left in place.** Do not add a `DROP TABLE`.

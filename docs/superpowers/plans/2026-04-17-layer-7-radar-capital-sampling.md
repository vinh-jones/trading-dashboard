# Layer 7 — Radar Capital-Required Sampling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show "what a 30DTE / 30δ CSP would look like today" inline on each Radar row, backed by a lazy, hour-cached Supabase sampling layer that calls Public.com only on the first Radar visit of the hour during market hours.

**Architecture:** Vercel serverless endpoint reads from a `radar_option_samples` Supabase table; if rows are stale AND market is open, it fans out Public.com option-chain fetches per ticker (concurrency-limited), picks the closest strike to 30 delta within the window, upserts fresh rows, and returns the combined result. Client hook calls the endpoint once on Radar mount; UI progressively populates the new cell.

**Tech Stack:** React 18 + Vite (client), Vercel serverless JS (`api/*.js`), Supabase (persistence), Public.com API (option chain + greeks), Vitest (unit tests).

**Spec:** `docs/superpowers/specs/2026-04-17-layer-7-radar-capital-sampling-design.md`

---

## Project-specific rules (apply to every task)

- **Repo:** `/Users/vinhjones/trading-dashboard` (main branch — user works directly on main per CLAUDE.md)
- **Commit workflow:** After every commit, ALWAYS `git push origin main` immediately. Never consider a change done before the push succeeds.
- **Commit messages:** End every message with the `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` trailer. Use conventional prefixes (`feat(radar):`, `chore(db):`, etc.).
- **All colors from `theme.js`.** No hardcoded hex outside the CLAUDE.md allowlist.
- **No behavior changes beyond what this plan specifies.** No copy tweaks, no styling rework, no "while I'm here" cleanup unrelated to the task.
- **Version bump:** Reserved for the final task (Task 6). Intermediate tasks must NOT modify `package.json` or `src/lib/constants.js`.
- **Timezones:** market-hours logic is ET (`America/New_York`). User-facing timestamps in the Radar freshness line use browser-local.

---

## File structure

**Create:**
- `supabase/migrations/2026-04-17-radar-option-samples.sql` — table migration (also runnable in the Supabase console)
- `api/_marketHours.js` — shared `isMarketOpen()` helper
- `api/_radar-sampling.js` — pure helpers `pickSampleExpiry`, `pickSampleStrike`, `computeCollateral`
- `api/__tests__/radar-sampling.test.js` — unit tests for the sampling helpers
- `api/radar-sample.js` — the GET endpoint
- `src/hooks/useRadarSamples.js` — client-side fetch hook

**Modify:**
- `api/quotes.js` — swap the inline `isMarketOpen()` function for an import from `api/_marketHours.js` (DRY; same behavior)
- `api/alert-check.js` — same DRY swap
- `src/components/RadarTab.jsx` — wire the hook, render sample cell (compact row), sample subrow (expanded view), freshness line
- `package.json` — version bump to `1.52.0` (Task 6 only)
- `src/lib/constants.js` — version bump to `1.52.0` (Task 6 only)

---

## Task 1: Supabase migration — `radar_option_samples` table

**Files:**
- Create: `supabase/migrations/2026-04-17-radar-option-samples.sql`

### Steps

- [ ] **Step 1: Check whether a migrations directory exists**

Run:
```bash
ls /Users/vinhjones/trading-dashboard/supabase 2>/dev/null || echo "no supabase dir"
```

If `supabase/migrations/` doesn't exist yet, that's fine — create the directory with the file in Step 2.

- [ ] **Step 2: Write the migration file**

Create `/Users/vinhjones/trading-dashboard/supabase/migrations/2026-04-17-radar-option-samples.sql`:

```sql
-- Radar 30DTE / 30δ CSP sample cache.
-- One row per ticker. Overwritten on refresh (no historical time series).
-- status = 'ok' | 'no_suitable_strike' | 'fetch_failed'

create table if not exists public.radar_option_samples (
  ticker          text        primary key,
  fetched_at      timestamptz not null default now(),
  status          text        not null,
  strike          numeric,
  delta           numeric,
  expiry_date     date,
  dte             integer,
  mid             numeric,
  iv              numeric,
  collateral      numeric
);

create index if not exists idx_radar_option_samples_fetched_at
  on public.radar_option_samples (fetched_at desc);
```

- [ ] **Step 3: Run the migration against Supabase**

If the project uses Supabase CLI:
```bash
cd /Users/vinhjones/trading-dashboard
supabase db push
```

If the project applies SQL manually via the Supabase dashboard, open the SQL editor in the Supabase console and paste the file contents. Run.

Verify in the Supabase table editor that `radar_option_samples` exists with the listed columns and a primary key on `ticker`.

If neither workflow is available, commit the migration file anyway — the spec notes the file lives in the repo for reference. The user will apply manually.

- [ ] **Step 4: Commit**

```bash
cd /Users/vinhjones/trading-dashboard
git add supabase/migrations/2026-04-17-radar-option-samples.sql
git commit -m "$(cat <<'EOF'
chore(db): add radar_option_samples table for layer 7 capital sampling

One row per ticker, overwritten on refresh. Stores the closest 30δ
strike's mid/IV/collateral at the closest-to-30-DTE expiry (21–45 DTE
window). Primary key on ticker; index on fetched_at for freshness queries.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push origin main
```

Verify: `git log origin/main -1 --oneline`

---

## Task 2: Pure sampling helpers (TDD)

**Files:**
- Create: `api/_radar-sampling.js`
- Create: `api/__tests__/radar-sampling.test.js`

### Steps

- [ ] **Step 1: Write the failing tests**

Create `/Users/vinhjones/trading-dashboard/api/__tests__/radar-sampling.test.js`:

```js
import { describe, it, expect } from "vitest";
import {
  pickSampleExpiry,
  pickSampleStrike,
  computeCollateral,
} from "../_radar-sampling.js";

describe("pickSampleExpiry", () => {
  const today = "2026-04-17";

  it("returns null when the list is empty", () => {
    expect(pickSampleExpiry([], today)).toBeNull();
  });

  it("returns exact 30-DTE match when present", () => {
    // Apr 17 + 30d = May 17. Include that plus some others.
    const expiries = ["2026-05-01", "2026-05-17", "2026-05-29"];
    expect(pickSampleExpiry(expiries, today)).toBe("2026-05-17");
  });

  it("returns the closest expiry within 21–45 DTE", () => {
    // Only a 25-day and a 40-day option — pick 25 because |25-30|=5 < |40-30|=10.
    const expiries = ["2026-05-12", "2026-05-27"];
    expect(pickSampleExpiry(expiries, today)).toBe("2026-05-12");
  });

  it("returns null when no expiry is within 21–45 DTE", () => {
    // All options are either < 21 DTE or > 45 DTE.
    const expiries = ["2026-04-20", "2026-06-15"];
    expect(pickSampleExpiry(expiries, today)).toBeNull();
  });

  it("prefers the lower DTE on a tie", () => {
    // 2 days before and 2 days after 30 DTE — pick the earlier one.
    const expiries = ["2026-05-15", "2026-05-19"]; // 28 DTE and 32 DTE
    expect(pickSampleExpiry(expiries, today)).toBe("2026-05-15");
  });

  it("ignores invalid date strings", () => {
    const expiries = ["not-a-date", "2026-05-17"];
    expect(pickSampleExpiry(expiries, today)).toBe("2026-05-17");
  });
});

describe("pickSampleStrike", () => {
  it("returns null when the list is empty", () => {
    expect(pickSampleStrike([])).toBeNull();
  });

  it("returns the strike with delta closest to 0.30 within the window", () => {
    const strikes = [
      { strike: 70, delta: 0.20 },
      { strike: 72, delta: 0.28 },
      { strike: 74, delta: 0.35 },
      { strike: 76, delta: 0.45 },
    ];
    expect(pickSampleStrike(strikes)).toEqual({ strike: 72, delta: 0.28 });
  });

  it("returns null when no strike is in the 0.25–0.35 window", () => {
    const strikes = [
      { strike: 50, delta: 0.10 },
      { strike: 90, delta: 0.50 },
    ];
    expect(pickSampleStrike(strikes)).toBeNull();
  });

  it("prefers the lower delta on a tie (29 over 31)", () => {
    // Both are exactly 0.01 off of 0.30.
    const strikes = [
      { strike: 75, delta: 0.29 },
      { strike: 72, delta: 0.31 },
    ];
    expect(pickSampleStrike(strikes)).toEqual({ strike: 75, delta: 0.29 });
  });

  it("skips entries missing delta", () => {
    const strikes = [
      { strike: 70, delta: null },
      { strike: 72, delta: undefined },
      { strike: 74, delta: 0.28 },
    ];
    expect(pickSampleStrike(strikes)).toEqual({ strike: 74, delta: 0.28 });
  });

  it("accepts puts with positive-magnitude delta", () => {
    // Put deltas from some data sources arrive as positive magnitudes; the
    // filter should treat 0.28 the same regardless of sign. (We already pass
    // absolute values into the helper; this test asserts that contract.)
    const strikes = [{ strike: 72, delta: 0.28 }];
    expect(pickSampleStrike(strikes)).toEqual({ strike: 72, delta: 0.28 });
  });
});

describe("computeCollateral", () => {
  it("returns strike * 100 for a single contract", () => {
    expect(computeCollateral(72)).toBe(7200);
    expect(computeCollateral(300)).toBe(30000);
  });

  it("returns null for missing or invalid strike", () => {
    expect(computeCollateral(null)).toBeNull();
    expect(computeCollateral(undefined)).toBeNull();
    expect(computeCollateral("not a number")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

Run:
```bash
cd /Users/vinhjones/trading-dashboard
npx vitest run api/__tests__/radar-sampling.test.js
```

Expected: FAIL with `Failed to resolve import '../_radar-sampling.js'`.

- [ ] **Step 3: Check whether vitest is configured to find `api/__tests__/`**

Run:
```bash
cat /Users/vinhjones/trading-dashboard/vitest.config.js 2>/dev/null || cat /Users/vinhjones/trading-dashboard/vite.config.js 2>/dev/null | grep -A5 test
```

If the test is not discovered (vitest might be scoped to `src/`), move the test file to `src/lib/__tests__/radar-sampling.test.js` and adjust the import path to `../../../api/_radar-sampling.js`. Re-run Step 2 to confirm it's now discovered AND failing on the missing implementation.

If tests ARE discovered in `api/__tests__/`, proceed with the original location.

- [ ] **Step 4: Write the implementation**

Create `/Users/vinhjones/trading-dashboard/api/_radar-sampling.js`:

```js
// Pure sampling helpers for Radar capital-required column.
// No I/O — these are driven by caller-provided data.

const DTE_MIN   = 21;
const DTE_MAX   = 45;
const DTE_TARGET = 30;

const DELTA_MIN    = 0.25;
const DELTA_MAX    = 0.35;
const DELTA_TARGET = 0.30;

// Given a list of expiry ISO date strings and today's ISO date, returns the
// expiry closest to 30 DTE within the 21–45 DTE window. Returns null if no
// expiry falls within the window. Ties break to the LOWER DTE.
export function pickSampleExpiry(expiries, todayISO) {
  if (!expiries || expiries.length === 0) return null;

  const today = parseISODate(todayISO);
  if (!today) return null;

  let best = null;
  let bestDiff = Infinity;
  let bestDTE  = Infinity;

  for (const iso of expiries) {
    const d = parseISODate(iso);
    if (!d) continue;
    const dte = Math.round((d - today) / (24 * 60 * 60 * 1000));
    if (dte < DTE_MIN || dte > DTE_MAX) continue;

    const diff = Math.abs(dte - DTE_TARGET);
    // Lower-DTE tiebreaker: if diff is equal, pick the smaller DTE
    if (diff < bestDiff || (diff === bestDiff && dte < bestDTE)) {
      best = iso;
      bestDiff = diff;
      bestDTE = dte;
    }
  }

  return best;
}

// Given a list of { strike, delta } objects (delta as positive magnitude),
// returns the entry with delta closest to 0.30 within the 0.25–0.35 window.
// Returns null if no strike falls in the window. Ties break to the LOWER delta
// (e.g. 0.29 preferred over 0.31).
export function pickSampleStrike(strikes) {
  if (!strikes || strikes.length === 0) return null;

  let best = null;
  let bestDiff = Infinity;
  let bestDelta = Infinity;

  for (const s of strikes) {
    if (s == null || s.delta == null) continue;
    const delta = Math.abs(s.delta);
    if (delta < DELTA_MIN || delta > DELTA_MAX) continue;

    const diff = Math.abs(delta - DELTA_TARGET);
    if (diff < bestDiff || (diff === bestDiff && delta < bestDelta)) {
      best = { strike: s.strike, delta };
      bestDiff = diff;
      bestDelta = delta;
    }
  }

  return best;
}

export function computeCollateral(strike) {
  if (strike == null) return null;
  const n = Number(strike);
  if (!Number.isFinite(n)) return null;
  return n * 100;
}

function parseISODate(iso) {
  if (!iso || typeof iso !== "string") return null;
  const d = new Date(iso + "T00:00:00Z");
  return Number.isFinite(d.getTime()) ? d : null;
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
cd /Users/vinhjones/trading-dashboard
npx vitest run api/__tests__/radar-sampling.test.js
```

(Or the adjusted path if you moved it in Step 3.)

Expected: all 14 tests pass.

- [ ] **Step 6: Run the full test suite to confirm no regressions**

```bash
cd /Users/vinhjones/trading-dashboard
npm test
```

Expected: previous 89 + new 14 = 103 tests pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/vinhjones/trading-dashboard
git add api/_radar-sampling.js api/__tests__/radar-sampling.test.js
# If you moved the test to src/lib/__tests__/, adjust the add path accordingly.
git commit -m "$(cat <<'EOF'
feat(radar): add pure sampling helpers for 30DTE / 30δ strike selection

pickSampleExpiry returns the closest expiry to 30 DTE within the
21–45 DTE window (tie-break to lower DTE).
pickSampleStrike returns the strike with delta closest to 0.30 within
the 0.25–0.35 window (tie-break to lower delta).
computeCollateral returns strike * 100 for a single contract.

14 unit tests cover empty inputs, exact matches, out-of-window,
tie-breaking, and missing-field handling.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push origin main
```

Verify: `git log origin/main -1 --oneline`.

---

## Task 3: Extract shared `isMarketOpen()` helper

**Goal:** DRY the `isMarketOpen()` duplication between `api/quotes.js` and `api/alert-check.js` so the new `api/radar-sample.js` can import it too.

**Files:**
- Create: `api/_marketHours.js`
- Modify: `api/quotes.js` (remove inline `isMarketOpen`, add import)
- Modify: `api/alert-check.js` (remove inline `isMarketOpen`, add import)

### Steps

- [ ] **Step 1: Capture the current function body from both files**

Run:
```bash
cd /Users/vinhjones/trading-dashboard
sed -n '32,41p' api/quotes.js
sed -n '34,48p' api/alert-check.js
```

Confirm they're the same logic. `api/quotes.js` version:

```js
function isMarketOpen() {
  const et   = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day  = et.getDay();
  const time = et.getHours() + et.getMinutes() / 60;
  return day >= 1 && day <= 5 && time >= 8.5 && time <= 16.25;
}
```

If `api/alert-check.js` version differs meaningfully (different time window, etc.), STOP and surface that to the controller — don't silently homogenize. Otherwise proceed; use the quotes.js version as the canonical one (the 4:15pm close extension is intentional per CLAUDE.md's quotes cron fix).

- [ ] **Step 2: Create the shared helper**

Create `/Users/vinhjones/trading-dashboard/api/_marketHours.js`:

```js
// Shared market-hours check for server-side API routes.
// Returns true Mon–Fri during 8:30 AM–4:15 PM ET (extended window to cover
// pre-market warmup and the 4:15 PM closing-price cron).

export function isMarketOpen() {
  const et   = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day  = et.getDay();                               // 0=Sun, 6=Sat
  const time = et.getHours() + et.getMinutes() / 60;
  return day >= 1 && day <= 5 && time >= 8.5 && time <= 16.25;
}
```

- [ ] **Step 3: Update `api/quotes.js`**

Remove the inline `isMarketOpen` function (lines ~32–41, including the `// ── Market hours (ET) ──` banner comment).

Add an import near the other imports at the top:
```js
import { isMarketOpen } from "./_marketHours.js";
```

- [ ] **Step 4: Update `api/alert-check.js`**

Remove the inline `isMarketOpen` function (around lines 34–48).

Add the import near the other imports:
```js
import { isMarketOpen } from "./_marketHours.js";
```

- [ ] **Step 5: Verify the diff**

```bash
cd /Users/vinhjones/trading-dashboard
git diff api/quotes.js api/alert-check.js api/_marketHours.js
```

Expected: the two modified files lose ~10 lines each (the function definition + banner comment) and gain 1 import line. The new file adds the shared implementation.

- [ ] **Step 6: Run tests**

```bash
cd /Users/vinhjones/trading-dashboard
npm test
```

Expected: 103 tests pass. No regressions.

- [ ] **Step 7: Commit**

```bash
cd /Users/vinhjones/trading-dashboard
git add api/_marketHours.js api/quotes.js api/alert-check.js
git commit -m "$(cat <<'EOF'
refactor(api): extract shared isMarketOpen helper to _marketHours.js

DRYs the duplicate function currently inlined in api/quotes.js and
api/alert-check.js. Same behavior (8:30 AM–4:15 PM ET Mon–Fri);
api/radar-sample.js in layer 7 will import from here too.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push origin main
```

Verify: `git log origin/main -1 --oneline`.

---

## Task 4: `/api/radar-sample` endpoint

**Files:**
- Create: `api/radar-sample.js`

### Steps

- [ ] **Step 1: Understand Public.com's option-chain endpoints**

The existing app uses two Public.com endpoints (from `api/quotes.js`):
- `POST /userapigateway/marketdata/{ACCOUNT_ID}/quotes` — batched quotes for a given instrument list
- `GET  /userapigateway/option-details/{ACCOUNT_ID}/greeks?osiSymbols=...` — greeks for specific OSI symbols

For radar sampling we also need:
- **Option expirations** for a ticker
- **Option chain** at a specific expiry (strikes + deltas)

Public.com exposes these via MCP tools `get_option_expirations(symbol)` and `get_option_chain(symbol, expiration_date)`. The underlying REST paths live in the `userapigateway/option-details/{ACCOUNT_ID}` namespace (same prefix as greeks).

**Discover the exact REST paths and response shapes by calling the MCP tools against a test ticker.** Run:

```
# In the same session, call the MCP tool:
#   mcp__public-com__get_option_expirations({ symbol: "AAPL" })
# Record the response shape.

# Then:
#   mcp__public-com__get_option_chain({ symbol: "AAPL", expiration_date: "<one-of-the-expiries>" })
# Record the response shape — specifically the field names for strike, delta, mid, IV.
```

If the MCP wrapper also emits the underlying HTTP request (check any logs it produces), capture that URL. Otherwise, check if the MCP source is in `node_modules/` or accessible via the runtime — the goal is to know the REST path the serverless function needs to call.

**If you can't determine the exact REST paths from MCP output alone**, use these likely paths (based on the greeks endpoint pattern) and adjust if they 404:
- `GET /userapigateway/option-details/{ACCOUNT_ID}/expirations?symbol=AAPL`
- `GET /userapigateway/option-details/{ACCOUNT_ID}/chain?symbol=AAPL&expiration=2026-05-15`

Surface the final URLs + response shapes in a comment at the top of `api/radar-sample.js`.

- [ ] **Step 2: Write the endpoint scaffolding**

Create `/Users/vinhjones/trading-dashboard/api/radar-sample.js`:

```js
/**
 * api/radar-sample.js — Vercel serverless function
 *
 * GET /api/radar-sample?tickers=KTOS,EQT,GLW,…
 *
 * Returns the closest 30δ / 30DTE CSP sample per ticker for the Radar tab.
 * Caching model:
 *   - Rows newer than 1 hour → returned directly (cache hit).
 *   - Stale rows AND market is open → refetch from Public.com, upsert, return.
 *   - Stale rows AND market is closed → return stale (best available).
 *
 * See docs/superpowers/specs/2026-04-17-layer-7-radar-capital-sampling-design.md
 */

import { createClient } from "@supabase/supabase-js";
import { isMarketOpen } from "./_marketHours.js";
import { buildOccSymbol } from "./_lib/occ.js";
import {
  pickSampleExpiry,
  pickSampleStrike,
  computeCollateral,
} from "./_radar-sampling.js";

const PUBLIC_COM_BASE = "https://api.public.com";
const ACCOUNT_ID      = process.env.PUBLIC_COM_ACCOUNT_ID;

const CACHE_TTL_MS       = 60 * 60 * 1000; // 1 hour
const CONCURRENCY_LIMIT  = 8;              // max parallel per-ticker fetches

// ── Supabase ──────────────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.SUPABASE_URL      || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

// ── Public.com token (reuses the same app_cache row quotes.js uses) ──────────

const TOKEN_VALIDITY_MINUTES = 1440;
const TOKEN_BUFFER_MS        = 5 * 60 * 1000;

async function getPublicAccessToken(supabase) {
  const { data: cached } = await supabase
    .from("app_cache")
    .select("value, expires_at")
    .eq("key", "public_com_token")
    .single();

  if (cached?.value && new Date(cached.expires_at).getTime() - TOKEN_BUFFER_MS > Date.now()) {
    return cached.value;
  }

  const secret = process.env.PUBLIC_COM_SECRET;
  if (!secret) throw new Error("PUBLIC_COM_SECRET not set");

  const res = await fetch(`${PUBLIC_COM_BASE}/userapiauthservice/personal/access-tokens`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ secret, validityInMinutes: TOKEN_VALIDITY_MINUTES }),
  });

  if (!res.ok) throw new Error(`Public.com auth failed (${res.status}): ${await res.text()}`);

  const data = await res.json();
  if (!data.accessToken) throw new Error("Public.com auth: no accessToken in response");

  const expiresAt = new Date(Date.now() + TOKEN_VALIDITY_MINUTES * 60 * 1000).toISOString();
  await supabase.from("app_cache").upsert({ key: "public_com_token", value: data.accessToken, expires_at: expiresAt });
  return data.accessToken;
}

// ── Public.com option-chain fetchers ──────────────────────────────────────────

async function fetchExpirations(token, symbol) {
  // Replace with the exact endpoint + response shape confirmed in Step 1.
  const res = await fetch(
    `${PUBLIC_COM_BASE}/userapigateway/option-details/${ACCOUNT_ID}/expirations?symbol=${encodeURIComponent(symbol)}`,
    { headers: { "Authorization": `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`expirations ${symbol} failed ${res.status}`);
  const data = await res.json();
  // Adjust field name per Step 1 discovery; likely `expirations` array of YYYY-MM-DD strings.
  return data.expirations || [];
}

async function fetchChain(token, symbol, expirationDate) {
  // Replace with the exact endpoint + response shape confirmed in Step 1.
  const res = await fetch(
    `${PUBLIC_COM_BASE}/userapigateway/option-details/${ACCOUNT_ID}/chain?symbol=${encodeURIComponent(symbol)}&expiration=${expirationDate}`,
    { headers: { "Authorization": `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`chain ${symbol} ${expirationDate} failed ${res.status}`);
  const data = await res.json();
  // Response shape TBD per Step 1 discovery — adapt the extraction below accordingly.
  // We expect each strike entry to include strike, type ("PUT"/"CALL"), delta, mid (or bid/ask).
  return data.chain || data.strikes || [];
}

// ── Per-ticker sampler ───────────────────────────────────────────────────────

async function sampleOneTicker(token, ticker, todayISO) {
  // Step A: list expirations
  const expirations = await fetchExpirations(token, ticker);
  const chosenExpiry = pickSampleExpiry(expirations, todayISO);
  const dte = chosenExpiry
    ? Math.round((new Date(chosenExpiry + "T00:00:00Z") - new Date(todayISO + "T00:00:00Z")) / (24 * 60 * 60 * 1000))
    : null;

  if (!chosenExpiry) {
    return {
      ticker,
      status:       "no_suitable_strike",
      fetched_at:   new Date().toISOString(),
      expiry_date:  null,
      dte:          null,
      strike:       null,
      delta:        null,
      mid:          null,
      iv:           null,
      collateral:   null,
    };
  }

  // Step B: fetch chain at that expiry
  const chain = await fetchChain(token, ticker, chosenExpiry);

  // Step C: filter to puts. Adjust field names per Step 1 discovery.
  const puts = chain.filter(c => (c.type ?? c.option_type ?? c.right) === "PUT");

  // Step D: normalize { strike, delta } pairs.
  const strikesWithDeltas = puts.map(p => ({
    strike: Number(p.strike),
    delta:  p.delta != null ? Math.abs(Number(p.delta)) : null,
    _row:   p,  // keep the raw row for later mid/iv lookup
  }));

  const picked = pickSampleStrike(strikesWithDeltas);
  if (!picked) {
    return {
      ticker,
      status:       "no_suitable_strike",
      fetched_at:   new Date().toISOString(),
      expiry_date:  chosenExpiry,
      dte,
      strike:       null,
      delta:        null,
      mid:          null,
      iv:           null,
      collateral:   null,
    };
  }

  // Step E: find the matching row to read mid/iv. Adjust field access per Step 1 discovery.
  const raw = strikesWithDeltas.find(s => s.strike === picked.strike)?._row ?? {};
  const mid  = pickMid(raw);
  const iv   = raw.iv ?? raw.implied_volatility ?? null;

  return {
    ticker,
    status:       "ok",
    fetched_at:   new Date().toISOString(),
    expiry_date:  chosenExpiry,
    dte,
    strike:       picked.strike,
    delta:        picked.delta,
    mid,
    iv,
    collateral:   computeCollateral(picked.strike),
  };
}

function pickMid(rawRow) {
  if (rawRow.mid != null) return Number(rawRow.mid);
  if (rawRow.bid != null && rawRow.ask != null) {
    return (Number(rawRow.bid) + Number(rawRow.ask)) / 2;
  }
  return null;
}

// ── Concurrency-limited fan-out ──────────────────────────────────────────────

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = await fn(items[i]);
      } catch (err) {
        results[i] = { error: err, item: items[i] };
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const tickersRaw = (req.query.tickers || "").toString();
  const tickers = tickersRaw
    .split(",")
    .map(t => t.trim().toUpperCase())
    .filter(Boolean);

  if (tickers.length === 0) {
    return res.status(400).json({ ok: false, error: "tickers_required" });
  }

  const supabase = getSupabase();

  // 1. Read existing rows
  const { data: existing, error: readErr } = await supabase
    .from("radar_option_samples")
    .select("*")
    .in("ticker", tickers);
  if (readErr) {
    return res.status(500).json({ ok: false, error: `read_failed: ${readErr.message}` });
  }

  // 2. Partition into fresh / stale
  const existingByTicker = Object.fromEntries((existing || []).map(r => [r.ticker, r]));
  const now = Date.now();
  const fresh = [];
  const staleTickers = [];

  for (const t of tickers) {
    const row = existingByTicker[t];
    if (row && new Date(row.fetched_at).getTime() > now - CACHE_TTL_MS) {
      fresh.push(row);
    } else {
      staleTickers.push(t);
    }
  }

  // 3. If nothing stale, return immediately
  if (staleTickers.length === 0) {
    return res.status(200).json({ ok: true, cached: true, samples: fresh });
  }

  // 4. If market is closed, return stale-as-cached (no refetch)
  if (!isMarketOpen()) {
    const stale = staleTickers.map(t => existingByTicker[t]).filter(Boolean);
    return res.status(200).json({ ok: true, cached: true, samples: [...fresh, ...stale] });
  }

  // 5. Market open — refetch stale tickers
  let token;
  try {
    token = await getPublicAccessToken(supabase);
  } catch (err) {
    return res.status(502).json({ ok: false, error: "public_com_unavailable", detail: err.message });
  }

  const todayISO = new Date().toISOString().slice(0, 10);
  const fetchedRows = await mapWithConcurrency(staleTickers, CONCURRENCY_LIMIT, async (ticker) => {
    try {
      return await sampleOneTicker(token, ticker, todayISO);
    } catch (err) {
      console.error(`[radar-sample] ${ticker} failed:`, err.message);
      return {
        ticker,
        status:     "fetch_failed",
        fetched_at: new Date().toISOString(),
      };
    }
  });

  // 6. Upsert the fresh fetches
  const { error: writeErr } = await supabase
    .from("radar_option_samples")
    .upsert(fetchedRows, { onConflict: "ticker" });
  if (writeErr) {
    console.error("[radar-sample] upsert failed:", writeErr.message);
    // Don't fail the whole request — still return what we have.
  }

  // 7. Merge fresh + fetched
  return res.status(200).json({
    ok:      true,
    cached:  false,
    samples: [...fresh, ...fetchedRows],
  });
}
```

- [ ] **Step 3: Validate the response shape discovery**

Adjust the field extraction in `sampleOneTicker` (Step C / Step D / Step E) and in `pickMid` based on what you learned from the MCP calls in Step 1. The placeholder field names (`type`, `option_type`, `right`, `mid`, `bid`, `ask`, `iv`, `implied_volatility`) are guesses — pick the correct names once you've seen the real response.

Also verify the endpoint paths. If 404 on either expirations or chain, the path guess was wrong — use the MCP's actual URL.

- [ ] **Step 4: Run tests to confirm no regressions**

```bash
cd /Users/vinhjones/trading-dashboard
npm test
```

Expected: 103 tests pass.

- [ ] **Step 5: Smoke-test the endpoint manually**

Start the dev Vercel environment (the repo uses `vite` for the client but has Vercel serverless routes; if the app runs via `vercel dev` locally, use that; otherwise test by deploying a preview branch, or by running a quick ad-hoc Node REPL that imports the handler).

Quickest smoke path: deploy a preview and curl the endpoint with a small ticker set:

```bash
curl -s "$PREVIEW_URL/api/radar-sample?tickers=KTOS,EQT" | jq .
```

Expected response:
- First call (cold cache, market hours): `"cached": false`, `samples` with real `ok` statuses.
- Second call within the hour: `"cached": true`, same data.

If the user's dev environment doesn't support `vercel dev`, skip this step and rely on manual verification after Task 5 lands in prod.

- [ ] **Step 6: Commit**

```bash
cd /Users/vinhjones/trading-dashboard
git add api/radar-sample.js
git commit -m "$(cat <<'EOF'
feat(radar): add /api/radar-sample endpoint — lazy 1hr cache + market-hours refresh

GET /api/radar-sample?tickers=KTOS,EQT,… returns the closest 30δ /
30DTE CSP sample per ticker. Fresh rows (< 1hr old) return instantly.
Stale rows trigger a per-ticker fan-out (concurrency 8) to Public.com
only when market is open; otherwise return stale cache as best-available.

Sampling logic delegates to api/_radar-sampling.js. Market-hours check
reuses api/_marketHours.js.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push origin main
```

Verify: `git log origin/main -1 --oneline`.

---

## Task 5: Client hook + Radar UI

**Files:**
- Create: `src/hooks/useRadarSamples.js`
- Modify: `src/components/RadarTab.jsx`

### Steps

- [ ] **Step 1: Create the client hook**

Create `/Users/vinhjones/trading-dashboard/src/hooks/useRadarSamples.js`:

```js
import { useState, useEffect, useRef } from "react";

// Fetches /api/radar-sample once per mount for the given tickers.
// Returns { samplesByTicker, loading, error, fetchedAt }:
//   - samplesByTicker: Map<ticker, sample> (empty until load resolves)
//   - loading: true until the first response arrives
//   - error: string | null
//   - fetchedAt: ISO timestamp (the freshest fetched_at across samples, for the
//                freshness line)
//
// Intentionally does NOT refetch in-session — the 1-hour cache lives server-
// side; a second Radar visit triggers the endpoint again, which handles the
// cache decision.
export function useRadarSamples(tickers) {
  const [samplesByTicker, setSamples] = useState(() => new Map());
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [fetchedAt, setFetchedAt]     = useState(null);

  // Stable signature to avoid re-firing when the tickers array identity
  // changes but contents don't.
  const keyRef = useRef("");
  const key    = [...(tickers || [])].sort().join(",");

  useEffect(() => {
    if (!key) {
      setLoading(false);
      return;
    }
    if (keyRef.current === key) return;
    keyRef.current = key;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/radar-sample?tickers=${encodeURIComponent(key)}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (!data.ok) {
          setError(data.error || "fetch failed");
          setLoading(false);
          return;
        }
        const map = new Map((data.samples || []).map(s => [s.ticker, s]));
        setSamples(map);

        let latest = null;
        for (const s of (data.samples || [])) {
          if (s.fetched_at && (!latest || s.fetched_at > latest)) latest = s.fetched_at;
        }
        setFetchedAt(latest);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [key]);

  return { samplesByTicker, loading, error, fetchedAt };
}
```

- [ ] **Step 2: Wire the hook into RadarTab**

Open `/Users/vinhjones/trading-dashboard/src/components/RadarTab.jsx` and locate:
- The top-level `RadarTab` component (not `RadarRow` or `ExpandedPanel`).
- Where it maps over rows and gets the list of tickers. If there isn't an explicit `visibleTickers` array, derive it from the rows being rendered.

Add this import near the top with the other hooks:
```jsx
import { useRadarSamples } from "../hooks/useRadarSamples";
```

Inside the `RadarTab` component (where `rows` / `filteredRows` / similar is computed), add:
```jsx
const visibleTickers = useMemo(
  () => (rows || []).map(r => r.ticker).filter(Boolean),
  [rows]
);
const { samplesByTicker, fetchedAt: samplesFetchedAt } = useRadarSamples(visibleTickers);
```

Replace `rows` with the actual variable name used in that file. If the rows are filtered before render, use the filtered list (don't waste requests on tickers not being shown).

- [ ] **Step 3: Pass samples down to RadarRow + ExpandedPanel**

Find the `<RadarRow ... />` render call. Add a `sample` prop:
```jsx
<RadarRow
  key={row.ticker}
  row={row}
  sample={samplesByTicker.get(row.ticker) ?? null}
  positions={positions}
  marketContext={marketContext}
  account={account}
  expanded={…}
  onToggle={…}
  sortBy={…}
/>
```

Update `RadarRow` signature to accept `sample`:
```jsx
function RadarRow({ row, sample, positions, marketContext, account, expanded, onToggle, sortBy }) {
```

Pass `sample` to `ExpandedPanel`:
```jsx
<ExpandedPanel
  row={row}
  sample={sample}
  indicators={indicators}
  positions={positions}
  marketContext={marketContext}
  bucket={bucket}
  score={score}
  account={account}
/>
```

Update `ExpandedPanel` signature:
```jsx
function ExpandedPanel({ row, sample, indicators, positions, marketContext, bucket, score, account }) {
```

- [ ] **Step 4: Render the compact-row sample cell**

Inside `RadarRow`, find where the existing inline stats render (the row with `BB: X.XX  IV: XX%  IVR: XX.X  …`). Add a new cell BETWEEN the BB/IV stats and the position indicators.

Exact JSX to insert (place it as a sibling span within the flex row):

```jsx
{(() => {
  if (!sample) {
    // Loading or no response yet
    return (
      <span style={{
        fontSize: theme.size.sm,
        color:    theme.text.faint,
        fontFamily: "inherit",
        marginLeft: theme.space[3],
        minWidth: 180,
      }}>—</span>
    );
  }
  if (sample.status === "ok") {
    const ror = (sample.mid * 100 / sample.collateral) * 100;
    const collatStr = sample.collateral >= 1000
      ? `$${(sample.collateral / 1000).toFixed(1)}k`
      : `$${sample.collateral}`;
    return (
      <span style={{
        fontSize: theme.size.sm,
        fontFamily: "inherit",
        marginLeft: theme.space[3],
        minWidth: 180,
        color: theme.text.muted,
      }}>
        <span style={{ color: theme.text.primary, fontWeight: 600 }}>${sample.strike}p</span>
        {" · "}
        <span style={{ color: theme.text.secondary }}>${sample.mid.toFixed(2)}</span>
        {" · "}
        {ror.toFixed(1)}% RoR
        {" · "}
        {collatStr}
      </span>
    );
  }
  if (sample.status === "no_suitable_strike") {
    return (
      <span style={{
        fontSize: theme.size.sm,
        color:    theme.text.subtle,
        fontStyle: "italic",
        fontFamily: "inherit",
        marginLeft: theme.space[3],
        minWidth: 180,
      }}>no 25–35δ</span>
    );
  }
  // fetch_failed
  return (
    <span style={{
      fontSize: theme.size.sm,
      color:    theme.text.subtle,
      fontFamily: "inherit",
      marginLeft: theme.space[3],
      minWidth: 180,
    }}>—</span>
  );
})()}
```

If the existing inline stats use a different wrapping pattern (e.g. a series of individual `<span>` siblings in a flex container), adapt the outer element type but keep the inline styles shown above.

- [ ] **Step 5: Render the expanded-view sample subrow**

In `ExpandedPanel`, find the "IV & Premium Quality" section. Locate the end of the `Raw IV / IV Rank / Composite` flex row and the start of the IV_EXPLANATIONS narrative block. Insert the sample subrow BETWEEN them.

```jsx
{sample?.status === "ok" && (
  <div style={{
    display: "flex",
    gap: theme.space[4],
    flexWrap: "wrap",
    marginTop: theme.space[2],
    marginBottom: theme.space[2],
  }}>
    {fieldRow("Sample", `$${sample.strike}p @ $${sample.mid.toFixed(2)} mid`)}
    {fieldRow("DTE",    `${sample.dte}d`)}
    {fieldRow("Delta",  `${(sample.delta * 100).toFixed(0)}δ`)}
    {fieldRow("RoR",    `${((sample.mid * 100 / sample.collateral) * 100).toFixed(2)}%`)}
    {fieldRow("Collateral", `$${sample.collateral.toLocaleString()}`)}
  </div>
)}
{sample?.status === "no_suitable_strike" && (
  <div style={{
    fontSize: theme.size.sm,
    color: theme.text.subtle,
    marginTop: theme.space[2],
    fontStyle: "italic",
  }}>
    No strike in the 25–35δ window at {sample.dte ?? "~30"}-day expiry. Illiquid chain or extreme IV.
  </div>
)}
```

`fieldRow` is already defined inside `ExpandedPanel` and used by other sections — reuse it.

- [ ] **Step 6: Add the sample freshness line**

Find the existing "BB data as of" freshness line in `RadarTab` (grep for "BB data as of"). Add a sibling line directly beneath it:

```jsx
{samplesFetchedAt && (
  <span style={{ color: theme.text.subtle, fontSize: theme.size.xs }}>
    Sample data as of: {new Date(samplesFetchedAt).toLocaleString()}
  </span>
)}
```

Match the existing line's inline style so they visually align. If the BB line uses a specific container, place this one next to it or on a new line below — whichever matches the existing pattern.

- [ ] **Step 7: Verify no hardcoded hex**

```bash
cd /Users/vinhjones/trading-dashboard
grep -nE '#[0-9a-fA-F]{3,6}\b' src/components/RadarTab.jsx src/hooks/useRadarSamples.js
```

Expected: matches ONLY inside the allowlisted `BB_BUCKET_COLORS` and `SCORE_ROW_BG` blocks in RadarTab.jsx. Anything else is a violation.

- [ ] **Step 8: Run tests**

```bash
cd /Users/vinhjones/trading-dashboard
npm test
```

Expected: 103 tests pass.

- [ ] **Step 9: Commit**

```bash
cd /Users/vinhjones/trading-dashboard
git add src/hooks/useRadarSamples.js src/components/RadarTab.jsx
git commit -m "$(cat <<'EOF'
feat(radar): render 30d/30δ capital sample column + expanded subrow

New useRadarSamples hook fetches /api/radar-sample once on Radar mount
with the visible tickers list. RadarRow gains a sample cell between
the BB/IV stats and position markers: '$72p · $1.20 · 1.7% RoR · $7.2k'.
ExpandedPanel gains a Sample / DTE / Delta / RoR / Collateral subrow
inside the IV & Premium Quality section. Adds a 'Sample data as of'
freshness line next to the existing BB freshness line.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push origin main
```

Verify: `git log origin/main -1 --oneline`.

---

## Task 6: Version bump to 1.52.0

**Files:**
- Modify: `package.json`
- Modify: `src/lib/constants.js`

### Steps

- [ ] **Step 1: Confirm main's current version**

```bash
git show origin/main:package.json | grep '"version"'
```

Expected: `"version": "1.51.0",` (bumped in Layer 6 and the narrative patch).

If different, use the actual value and bump to the next minor.

- [ ] **Step 2: Bump `package.json`**

Edit `/Users/vinhjones/trading-dashboard/package.json`:
```json
"version": "1.52.0",
```

- [ ] **Step 3: Bump `src/lib/constants.js`**

Edit `/Users/vinhjones/trading-dashboard/src/lib/constants.js`:
```js
export const VERSION = "1.52.0";
```

- [ ] **Step 4: Run tests one last time**

```bash
cd /Users/vinhjones/trading-dashboard
npm test
```

Expected: 103 tests pass.

- [ ] **Step 5: Commit and push**

```bash
cd /Users/vinhjones/trading-dashboard
git add package.json src/lib/constants.js
git commit -m "$(cat <<'EOF'
chore(release): v1.52.0 — layer 7 radar capital sampling

Adds a lazy, hour-cached 30DTE / 30δ CSP sample on each Radar row.
Cold first visit during market hours: one batched Public.com fan-out
(concurrency 8). Subsequent visits within the hour: zero API calls.
Off-hours: stale cache returned as best-available.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push origin main
```

- [ ] **Step 6: Confirm push succeeded**

```bash
git log origin/main -1 --oneline
```

Expected: starts with the commit hash of the release commit with message `chore(release): v1.52.0`.

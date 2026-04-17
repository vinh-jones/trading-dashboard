# Layer 7 — Radar Capital-Required Sampling — Design Spec

**Date:** 2026-04-17
**Status:** Approved — ready for implementation plan
**Parent:** `docs/superpowers/specs/2026-04-16-dashboard-redesign-design.md` (Radar polish / evaluation-flow enhancement)

---

## Summary

Show "what a 30DTE / 30δ CSP would look like today" inline on each Radar row so capital-deployment evaluation doesn't require leaving the page. A lazy, hour-cached Supabase layer pre-computes the closest strike to 30 delta (within 25–35) from the closest expiry to 30 DTE (within 21–45) for each candidate ticker, populated on the first Radar visit of the hour during market hours.

## Goals

- **Evaluate candidates without mental math.** Compact row gains strike, mid premium, RoR, and collateral.
- **Minimize broker API load.** Zero calls on days Radar isn't visited; one batched fetch per hour of active use.
- **No perceived page-load slowdown.** The rest of the Radar row already has the data to render — only the new cell progressively enhances.
- **Keep Radar focused on evaluation.** Existing-position current values stay in Open Positions tab; Radar shows the generic sample regardless of whether the user already has exposure.

## Non-goals

- No historical time-series of samples — one row per ticker, overwrite on refresh.
- No multi-strike samples (e.g. 20δ + 30δ + 40δ). Just 30δ ± 5.
- No per-position current premium in Radar. That lives in Positions → Roll Analysis.
- No real-time / in-session refresh. The 1-hour server-side cache is load-bearing.
- No cron-scheduled pre-warming. Lazy-on-visit is the model.
- No capital-fits-budget filter, sort-by-capital column, or alerting on sample changes.
- No UI button to force-refresh. The cache rule is opaque to the client.

## Architecture

```
Radar tab mounts
  ↓
useRadarSamples(tickers) hook fires
  ↓
GET /api/radar-sample?tickers=KTOS,EQT,…
  ↓
Vercel serverless handler
  ├── SELECT FROM radar_option_samples WHERE ticker IN (…) AND fetched_at > now() - 1h
  ├── Partition into fresh (< 1h old) vs. stale (>= 1h old OR missing)
  ├── If stale.length === 0 → return all fresh rows
  ├── Else if isMarketOpen()  (ET check, America/New_York)
  │     ├── For each stale ticker:
  │     │     1. Fetch option chain via Public.com (put expiries in [today+21, today+45])
  │     │     2. Pick expiry closest to 30 DTE
  │     │     3. Fetch greeks for that expiry's put chain
  │     │     4. Filter strikes where delta ∈ [0.25, 0.35]
  │     │     5. Pick argmin(abs(delta - 0.30)); tie-break lower delta (29 over 31)
  │     │     6. If no fit → upsert { ticker, status: 'no_suitable_strike', fetched_at: now() }
  │     │        Else    → upsert full sample row
  │     └── Return fresh + freshly-fetched rows
  └── Else (market closed) → return stale cache rows unchanged (best available)

Client renders Radar rows immediately with existing data (BB, IV, score, sector).
Sample cell shows "—" placeholder until the fetch resolves.
On response: React state updates, sample cell populates or shows error state.
```

## Schema

```sql
create table radar_option_samples (
  ticker          text        primary key,        -- one row per ticker
  fetched_at      timestamptz not null default now(),
  status          text        not null,           -- 'ok' | 'no_suitable_strike' | 'fetch_failed'
  strike          numeric,                        -- null unless status='ok'
  delta           numeric,                        -- actual delta, e.g. 0.28
  expiry_date     date,                           -- actual expiry
  dte             integer,                        -- days to expiry at fetch time
  mid             numeric,                        -- option mid price (dollars)
  iv              numeric,                        -- strike-level IV
  collateral      numeric                         -- strike * 100 (for 1 contract)
);

create index on radar_option_samples (fetched_at desc);
```

**Row semantics:** one row per ticker. Upsert on refresh overwrites previous data. Historical sampling is out of scope.

**`status` values:**
- `ok` — all fields populated, sample is valid
- `no_suitable_strike` — no strike within 25–35δ was found at the closest-to-30 DTE expiry. Other fields may be null. `dte` should be populated if the expiry existed but no strike fit.
- `fetch_failed` — an error occurred reaching Public.com. Logged server-side. Row exists so we don't retry-hammer within the cache window.

## API endpoint

### `GET /api/radar-sample`

**Query params:** `tickers` — comma-separated, uppercase ticker list (e.g. `?tickers=KTOS,EQT,GLW`).

**Response:**
```json
{
  "cached": false,
  "samples": [
    {
      "ticker": "KTOS",
      "status": "ok",
      "strike": 72,
      "delta": 0.28,
      "expiry_date": "2026-05-15",
      "dte": 28,
      "mid": 1.20,
      "iv": 0.82,
      "collateral": 7200,
      "fetched_at": "2026-04-17T14:03:18.000Z"
    }
  ]
}
```

`cached` is `true` iff no refetch occurred (every requested ticker was fresh).

**Behavior:** as described in Architecture above.

**Error handling:**
- Individual ticker failures → upsert `fetch_failed` row with `fetched_at = now()`. The failure is opaque to the client; a `fetch_failed` row looks like a permanent miss until the next hour.
- Global Public.com auth failure (token endpoint down) → return 502 with `{ error: "public_com_unavailable" }`. Client renders all sample cells as silent `—`.

**Concurrency:** single-user app. Double-fetches from two simultaneous mounts are acceptable — upsert is idempotent. No row-level locking.

**Market-hours check:** `isMarketOpen()` already exists in two server-side files — `api/quotes.js:32` and `api/alert-check.js:34`. Pattern has been to copy the small helper into each API route rather than share via a Vite-bundled file. Either copy the same function body into `api/radar-sample.js` or (cleaner) extract to `api/_marketHours.js` during this layer and update both existing call sites as a bonus cleanup. Implementation plan will decide which.

## Client changes

### New hook `src/hooks/useRadarSamples.js`

```js
// useRadarSamples(tickers) → { samplesByTicker, loading, error, fetchedAt }
//
// - Fires ONCE on mount with the visible tickers list.
// - No in-session refetch. A second Radar mount re-fires (different React tree instance).
// - samplesByTicker is a Map<ticker, sample>.
// - fetchedAt is the freshest fetched_at across all samples (for the freshness line).
```

### `src/components/RadarTab.jsx` — compact row

Add a new cell between the existing BB/IV inline stats and the position markers. Approximate width 180px.

States:
- **Loading** (fetch in flight): `—` in `theme.text.faint`, `theme.size.sm`, monospace (inherits)
- **`status = 'ok'`**: `$72p · $1.20 · 1.7% RoR · $7.2k`, where:
  - `$72p` — strike in `theme.text.primary`
  - `$1.20` — mid in `theme.text.secondary`
  - `1.7% RoR` — computed as `(mid * 100 / collateral) * 100`
  - `$7.2k` — collateral formatted as dollars with `k` suffix for >= 1000
- **`status = 'no_suitable_strike'`**: `no 25–35δ` in `theme.text.subtle` italic
- **`status = 'fetch_failed'`**: `—` in `theme.text.subtle` (silent)
- **No entry in the map yet**: `—` in `theme.text.faint` (loading)

### `src/components/RadarTab.jsx` — expanded view

In the "IV & Premium Quality" section, after the `Raw IV / IV Rank / Composite` line and BEFORE the IV_EXPLANATIONS narrative, insert the sample subrow:

```jsx
{sample?.status === 'ok' && (
  <div style={{ display: "flex", gap: theme.space[4], flexWrap: "wrap", marginTop: theme.space[2], marginBottom: theme.space[2] }}>
    {fieldRow("Sample", `$${sample.strike}p @ $${sample.mid.toFixed(2)} mid`)}
    {fieldRow("DTE",    `${sample.dte}d`)}
    {fieldRow("Delta",  `${(sample.delta * 100).toFixed(0)}δ`)}
    {fieldRow("RoR",    `${((sample.mid * 100 / sample.collateral) * 100).toFixed(2)}%`)}
    {fieldRow("Collateral", `$${sample.collateral.toLocaleString()}`)}
  </div>
)}
{sample?.status === 'no_suitable_strike' && (
  <div style={{ fontSize: theme.size.sm, color: theme.text.subtle, marginTop: theme.space[2], fontStyle: "italic" }}>
    No strike in the 25–35δ window at {sample.dte ?? '~30'}-day expiry. Illiquid chain or extreme IV.
  </div>
)}
```

### Freshness line

Below the existing `BB data as of: Apr 17, 2026 7:03 AM · 53 tickers` header line on the Radar tab, add a sibling:

```
Sample data as of: <fetched_at formatted like the BB line>
```

When all samples are `status = 'fetch_failed'` or missing, hide the sample line.

## Sequencing

Five commits, each shippable on its own:

### Commit 1 — Supabase migration

Create the `radar_option_samples` table. Run via Supabase migration or manual SQL in the project console. Add the migration file to the repo at `supabase/migrations/NNNN_radar_option_samples.sql` (check whether a migrations dir exists; if not, add a plain `supabase/migrations/2026-04-17-radar-option-samples.sql` file).

No code changes. No version bump.

### Commit 2 — Option-chain sampling logic

New helper module: `api/_radar-sampling.js` (underscore prefix so Vercel doesn't route it as a public endpoint).

Exports:
- `pickSampleExpiry(expiries, today)` — returns expiry string closest to 30 DTE within 21–45 DTE, or null.
- `pickSampleStrike(strikesWithDeltas)` — returns `{ strike, delta }` or null. Filters to `delta ∈ [0.25, 0.35]`, picks `argmin(abs(delta - 0.30))`, tie-break lower delta.

Unit tests in `api/__tests__/radar-sampling.test.js` — or alongside existing tests under `src/lib/__tests__/` if the vitest config finds them there.

Test cases:
- `pickSampleExpiry`: returns exact match at 30; returns closest within range; returns null if all are outside range; tie-break chooses lower DTE (29 over 31).
- `pickSampleStrike`: returns exact match at 0.30; returns closest; returns null if none in range; tie-break lower delta (0.29 over 0.31); handles missing/null delta in input.

No endpoint yet. No UI. No version bump.

### Commit 3 — `/api/radar-sample` endpoint

Create `api/radar-sample.js` implementing the GET handler described in **API endpoint** above.

Uses the sampling helpers from Commit 2 and the existing Public.com integration patterns in `api/quotes.js` (token fetch, batched instrument list, greeks endpoint). Reuse `fetchOptionGreeks` and auth-token logic rather than duplicating.

Smoke-test manually: `curl "http://localhost:3000/api/radar-sample?tickers=KTOS,EQT"` against dev Supabase.

No UI changes. No version bump.

### Commit 4 — Client hook + Radar UI

- New file: `src/hooks/useRadarSamples.js`
- Modify `src/components/RadarTab.jsx`:
  - Call `useRadarSamples(visibleTickers)`
  - Render new compact-row sample cell
  - Add expanded-view sample subrow inside the IV & Premium Quality section
  - Add the "Sample data as of" freshness line near the BB freshness line
- Bump version to **1.52.0** in `package.json` and `src/lib/constants.js`.

### Commit 5 — (optional) Skeleton polish

If the initial fetch latency feels rough on a cold cache, replace the `—` placeholder with a subtle pulsing skeleton in `theme.border.default`. Otherwise skip.

No version bump (patch if actually shipped).

## Verification

- **Commit 1:** `radar_option_samples` table exists in Supabase, visible in the dashboard.
- **Commit 2:** `npm test` includes the new unit tests, all pass. Existing 89 tests still pass.
- **Commit 3:** Manual curl returns the expected shape; Supabase table has rows after a call.
- **Commit 4:** Load Radar on prod — compact row shows sample data after ~1–3s on a cold cache and instantly on a warm cache. Expanded view shows the detailed subrow. Freshness line shows the sample timestamp.

No automated UI tests are added — the existing pattern in the repo is to rely on manual prod smoke-check for visual/interaction changes.

## Success criteria

- First Radar visit of an hour during market hours triggers one batched Public.com fetch covering all stale tickers.
- Subsequent visits within the hour incur zero API calls.
- Off-hours visits return stale cache without triggering a fetch.
- Compact row shows `$strike · $mid · RoR · $collateral` for tickers with a suitable 30δ strike.
- Expanded view shows `Sample / DTE / Delta / RoR / Collateral` in the IV & Premium Quality section.
- The "no suitable strike" case renders a clear message rather than looking perpetually loading.
- Version 1.52.0 on main, pushed.

## Out of scope (explicit)

- Historical / time-series sampling
- Multi-strike samples
- Capital-fits-budget filter
- Sort-by-capital column or row
- Refresh-now button in UI
- Alerting on sample changes
- Pre-warming cache via cron
- Current-premium lookup for existing positions in Radar
- Automated UI tests

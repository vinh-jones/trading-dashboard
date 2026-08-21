# `/api/agent-scan` — derived factor definitions (v1)

**Status:** documentation only. No code was changed to produce this.
**Pinned version:** **v1.171.1** = commit `6c59066`, dated 2026-07-21.
**Also read:** `main` at `262530d` (v1.183.0) — see §-1 for the complete delta between them.
**Payload contract version:** `METHODOLOGY_VERSION = "1.0.0"` ([api/agent-scan.js:71](api/agent-scan.js:71)) — unchanged across the entire range.

Everything below is read from source. No endpoint was called and nothing is inferred from
payload output.

### Scope note

"vinh-wheel" resolves to this repository. There is no directory by that name, but the git
remote is `git@github.com:**vinh-jones**/trading-dashboard.git`, the only `/api/agent-scan`
implementation on this machine is [api/agent-scan.js](api/agent-scan.js), it emits exactly the
field names in the request (`gammaEnv`, `gexEnv`, `flowTapeEma`, `bb`, `trend.state`), and
`v1.171.1` is a real tagged version of it. Treating them as the same codebase.

Note this is *not* the same thing as the runner that writes `agentic_factor_snapshots` — that
one is genuinely external, and §0.1 explains why that boundary is where four of your questions
die.

### Convention used throughout

**"Not determinable"** means: not present in this source, and not inferable from it without
guessing. It is used in preference to a plausible reconstruction everywhere the code does not
actually settle the question. Every affirmative claim below is anchored to a `file:line`.

---

## -1. Version delta: v1.171.1 → v1.183.0

Diffed every file `/api/agent-scan` imports that computes a derived factor.

**Every derived-factor module is byte-identical between v1.171.1 and HEAD:**

```
src/lib/entryScore.js     src/lib/uwNormalize.js    src/lib/gexLevels.js
src/lib/flowSmoothing.js  src/lib/ivTrend.js        src/lib/bbBucket.js
src/lib/rsi.js            src/lib/radarFilter.js    api/bb.js
api/uw-gex.js             api/uw-snapshot.js        api/uw-iv.js
```

So **§1–§5 and §7 of this document apply verbatim at v1.171.1.** Trend classification, the
gamma/GEX split, flow-tape normalization and its EMA, the Bollinger parameters, and the score
formula have not moved. Three files did change:

| File | Change | Affects your questions? |
|---|---|---|
| `api/agent-scan.js` | `market_context` removed; `earningsDaysAway` re-sourced from `quotes.earnings_date` via `buildEarningsMap` | Only §6's earnings row. No factor math. |
| `src/lib/radarData.js` | `getEarningsDaysAway` re-signatured to take a `Map` instead of the `market_context` blob | Same. |
| `vercel.json` | **`/api/bb` cron added**; plus `uw-macro-events`, `uw-breadth`, three `orb-*` crons | **Yes — decisively. See §0.4.** |

At v1.171.1, `earningsDaysAway` came from `market_context.positions[].nextEarnings.date`
rather than `quotes.earnings_date`. That table was deprecated in `3276957`. It changes the
provenance row in §6's table and nothing else.

The `vercel.json` change is not incidental. It is the answer to your 2026-07-22 question.

---

## 0. Discrepancy register

The request supplied four confirmed mappings derived from 226 `agentic_factor_snapshots` rows
and instructed that the source is authoritative where they disagree. They disagree in three of
four cases. This section resolves that first because it changes how the rest of the document
should be read.

### 0.1 `core_score` and `momo_score` are not computed in this repository

| Supplied mapping | Status against this source |
|---|---|
| `trend_mult`: uptrend 1.00 / pullback 0.90 / recovering 0.85 / downtrend 0.70 | **Confirmed exactly.** [src/lib/entryScore.js:25-28](src/lib/entryScore.js:25) |
| `gex_mult`: stabilized 1.00 / neutral 0.90 / choppy 0.80 | **Not present.** No categorical GEX multiplier exists anywhere in this repo. |
| `core_score = (1 − bb) · trend_mult · gex_mult` | **Not present.** |
| `momo_score = bb · trend_mult · flowTapeEma` | **Not present.** |

`grep` for `core_score`, `momo_score`, `coreScore`, `momoScore`, `gex_mult`, `trend_mult`
across all `.js` / `.jsx` / `.sql` / `.md` / `.json` (excluding `node_modules`, `dist`) returns
hits in **exactly two files**, both of which are documentation of an *external* writer:
[docs/agentic-factor-preregistration.md](docs/agentic-factor-preregistration.md) and
[supabase/migrations/2026-08-19-agentic-shadow-columns.sql](supabase/migrations/2026-08-19-agentic-shadow-columns.sql).
Neither computes anything; both reference `core_score` only to define a capture *scope*
("top 10 by `core_score`").

The migration states the ownership boundary directly
([2026-08-19-agentic-shadow-columns.sql:7-11](supabase/migrations/2026-08-19-agentic-shadow-columns.sql:7)):

> SCHEMA ONLY — THIS REPO DOES NOT WRITE THESE TABLES. `agentic_log` and
> `agentic_factor_snapshots` have no code anywhere in trading-dashboard; the agentic runner is
> external and writes them directly.

And the pre-registration repeats it and draws the consequence
([docs/agentic-factor-preregistration.md:131-146](docs/agentic-factor-preregistration.md:131)):
acceptance criterion 7 "cannot be satisfied from this repo, because the decision path does not
live here."

**Conclusion.** `core_score` and `momo_score` are produced by the external agentic runner,
which reads `/api/agent-scan`'s output and re-derives its own scores from it. They are not
`/api/agent-scan` factors. The scoring the endpoint *does* perform is `score` (§7), a
different formula. **For a public write-up: the two score formulas supplied are not
documentable from this source.** They must be read out of the runner's own repository.

The `gex_mult` mapping is the load-bearing case: it implies the runner buckets `gexEnv`
categorically, whereas this repo's own score uses a *continuous* function of `gammaEnv`
([src/lib/entryScore.js:36-40](src/lib/entryScore.js:36)) and never multiplies by `gexEnv` at
all. Two different consumers, two different treatments of the same two fields.

### 0.2 No `−0.50` veto threshold exists in this repository

`grep` for `-0.5` / `veto` across the source finds no threshold applied to `flow_tape_ema`.
The only flow direction cut-points that exist are **±0.20**, in two places, and neither is a
veto on the scan:

- [src/lib/flowSmoothing.js:16-17](src/lib/flowSmoothing.js:16) — `BULLISH: 0.2`, `BEARISH: -0.2`, used to compute the *streak* direction.
- [src/lib/trendOverlay.js:15](src/lib/trendOverlay.js:15) — `{ BULLISH: 0.2, BEARISH: -0.2 }`, the redeploy-signal overlay on **open positions**, not on scan candidates.

**Not determinable** whether the runner's `−0.50` is on a normalized or raw scale — because the
threshold does not exist here. What *is* determinable is the scale of the field it would be
applied to: `flowTapeEma` is normalized and bounded to [−1, 1] by construction (§3). So a
`−0.50` threshold against `flowTapeEma` is on a normalized scale, whatever the runner intends
by it.

### 0.3 `flow_z` and `flow_pctile` do not exist in this repository

Zero occurrences of `flow_z`, `flow_pctile`, `flowZ`, or `flowPctile` in any file. See §4.

### 0.4 The 2026-07-22 stale-`bb` incident — CONFIRMED at v1.171.1

**This supersedes an earlier reading of this document that recorded the claim as "not
determinable." At v1.171.1 the source determines it, and it corroborates you.**

At v1.171.1 (`6c59066`, 2026-07-21) **`/api/bb` had no cron entry.** `git show
6c59066:vercel.json | grep -c "api/bb"` → `0`. The cron was added the **following day** by
`826fce0`, 2026-07-22 08:38 -0700, titled:

> `fix(cron): schedule /api/bb — BB data only refreshed on dashboard page load (v1.171.2)`

Its body states the mechanism and names your consumer explicitly:

> /api/bb was never scheduled. Its only trigger is the fire-and-forget call in
> `useRadar.js:14`, so `bb_position` / `bb_upper` / `bb_lower` / `bb_sma20` refreshed only when
> a browser opened the Radar or AI Thesis tab. /api/quotes does not write the `bb_*` columns,
> so nothing else kept them current.
>
> **Consequence: any headless consumer — the daily agent-scan task in particular — read
> whatever BB the last human page view happened to leave behind, which could be a day or more
> old. `bb_position` is half the scanner score, `(1 - bb) * 0.50`, so the stalest field was
> also the most load-bearing.**

The two facts compound, and the second is the one that makes it acute:

1. At v1.171.1 the only refresh paths for `bb_position` were a browser page load ([useRadar.js:14](src/hooks/useRadar.js:14)) and `?refresh=true`.
2. **v1.171.1 is the commit that made `?refresh=true` opt-in** — one day earlier. v1.171.0 had refreshed on every call; `6c59066` inverted it to default-off because the inline chain was hanging every client ([api/agent-scan.js:98-109](api/agent-scan.js:98)).

So for the ~24 hours spanning 2026-07-21 → 07-22, a headless scanner calling
`/api/agent-scan` with no query params received `bb_position` of **unbounded age** — last
written whenever a human last opened the dashboard — with no refresh path of its own and no
freshness signal that meant anything. The fix commit says that too:

> This also makes agent-scan's `freshness.stale` threshold (>20 min while the market is open)
> meaningful — previously it measured "time since someone last opened the dashboard", which
> was not a signal about ingest health.

**For the write-up:** at v1.171.1, `freshness.bbAgeMinutes` and `freshness.stale` were
actively misleading. They reported a real elapsed time against a stamp that tracked human
browsing, not ingest. A scan could report `stale: false` on `bb` that was hours old, or
`stale: true` purely because nobody had opened a browser tab.

### 0.5 The `dayPct` guard is NOT a workaround for that incident

The guard exists, but it predates the incident by seven weeks and was introduced for a
different cause. [src/components/AIThesisTab.jsx:82-84](src/components/AIThesisTab.jsx:82):

```js
// Sanity guard: a real single-session move >50% on these names is virtually
// always stale/garbage prev_close, not a real gap — show "—" instead.
const dayPct = rawDay != null && Math.abs(rawDay) <= 0.5 ? rawDay : null;
```

`git log -S'Math.abs(rawDay) <= 0.5'` dates it to **`fe76278`, 2026-06-05**, in
*"Fix bb.js prev_close: use prior daily close, not chartPreviousClose (v1.122.3)"*. That commit
fixed [api/bb.js:60-67](api/bb.js:60), where `meta.chartPreviousClose` on a `range=1y` chart
returned the close from ~13 months prior, making day-change read as today-vs-a-year-ago. The
guard is the belt-and-braces half of that fix.

So: **stale `prev_close`, June 5, a display bug — not stale `bb`, July 22, a scoring bug.**
Two different fields, two different failures, seven weeks apart. Worth separating in a public
write-up, because conflating them would misattribute the cause of both.

What *is* true and worth stating: `/api/agent-scan` computes the same basket `dayPct` at
[api/agent-scan.js:218-220](api/agent-scan.js:218) and applies **no guard at all**. The
endpoint will emit a `dayPct` of any magnitude where the UI rendering the same grid shows
"—". That divergence is live at both v1.171.1 and HEAD.

---

## 1. `trend.state`

**Emitted at** [api/agent-scan.js:175](api/agent-scan.js:175) and
[:197](api/agent-scan.js:197) as `trend: { state, modifier }`.
**Classifier:** `getTrendState(price, ma50, ma200)`,
[src/lib/entryScore.js:21-29](src/lib/entryScore.js:21). Reproduced in full:

```js
export function getTrendState(price, ma50, ma200) {
  if (price == null) return null;
  const above200 = ma200 == null || price >= ma200;
  const above50  = ma50  == null || price >= ma50;
  if (above200 && above50)   return { state: "uptrend",   label: "Uptrend",    modifier: 1.00 };
  if (above200 && !above50)  return { state: "pullback",  label: "Pullback",   modifier: 0.90 };
  if (!above200 && above50)  return { state: "recovering",label: "Recovering", modifier: 0.85 };
  return                            { state: "downtrend", label: "Downtrend",  modifier: 0.70 };
}
```

### Inputs

| Argument | Row field | DB column |
|---|---|---|
| `price` | `r.last` | `quotes.last` |
| `ma50` | `r.ma_50` | `quotes.ma_50` |
| `ma200` | `r.ma_200` | `quotes.ma_200` |

Bound at [api/agent-scan.js:175](api/agent-scan.js:175); columns selected at
[src/lib/radarData.js:12-17](src/lib/radarData.js:12).

### Thresholds

There are **no tunable thresholds**. The classifier is two boolean comparisons against the
moving averages, both **inclusive** (`>=`), crossed into a 2×2 table. Exactly at the MA counts
as above. The four states are the four cells, so all four are reachable — consistent with the
report that all four are observed live.

`{ above200: false, above50: true }` → `recovering` and `{ above200: true, above50: false }` →
`pullback` is the only asymmetric pair: 0.85 vs 0.90 means the classifier treats "below the
long MA, above the short" as slightly worse than its mirror.

### Null handling — non-obvious, worth stating

A **null MA is treated as "above."** A ticker with no `ma_200` can never be classified
`downtrend` or `recovering` on that axis; with both MAs null it is unconditionally `uptrend`
with modifier 1.00. A null `price` returns `null` (no trend object) — and separately makes
`entryScore` non-null only if `bb_position` and `compositeIv` survive, so a null-price row can
still carry a score with an implicit trend multiplier of 1.0
([src/lib/entryScore.js:65](src/lib/entryScore.js:65) uses `trend?.modifier ?? 1.0`).

### Lookback

The lookback lives in the MA *producer*, not the classifier —
[api/bb.js:80-83](api/bb.js:80):

```js
const last50  = validCloses.slice(-50);
const last200 = validCloses.slice(-200);
const ma50    = last50.length  >= 50  ? last50.reduce((a,b) => a+b, 0)  / 50  : null;
const ma200   = last200.length >= 200 ? last200.reduce((a,b) => a+b, 0) / 200 : null;
```

- **50 and 200 trailing daily closes**, simple arithmetic mean, no weighting.
- Hard minimum-count gate: fewer than 50 (resp. 200) valid closes → `null`, not a partial average.
- Series is Yahoo Finance `chart?interval=1d&range=1y` ([api/bb.js:35](api/bb.js:35)), filtered to non-null closes ([api/bb.js:58](api/bb.js:58)). A 1-year range yields ~250 trading days, so `ma_200` has roughly 50 sessions of headroom — a ticker with any material gap history, or one listed under ~10 months, gets `ma_200 = null` and (per the null rule above) is scored as if it were above its 200-day.

### Timing subtlety

`validCloses` ends with the **current session's** close, which Yahoo reports as the live price
intraday. So `ma_50` / `ma_200` are 49 (resp. 199) completed sessions plus today's live print,
recomputed on each `/api/bb` run. They are not fixed-at-the-close values.

Separately, `price` and the MAs can come from **different moments**: `quotes.ma_50` / `ma_200`
are written only by `/api/bb`, while `quotes.last` is also overwritten by `/api/uw-iv` and
`/api/quotes` (§6). A `trend.state` in the payload may therefore compare a price from one
refresh against MAs from an earlier one.

---

## 2. `gammaEnv` (numeric) and `gexEnv` (categorical)

### 2.1 The overlap is resolved: they are computed from two different UW endpoints

The request's premise — that `gexEnv` buckets `gammaEnv` and that the observed 228-row overlap
(choppy −0.259…+0.096, neutral −0.158…+0.229, stabilized −0.075…+0.742) is therefore impossible
— rests on an assumption the source contradicts. **`gexEnv` is not derived from `gammaEnv`.**
They are two independently computed numbers written by two different cron jobs from two
different Unusual Whales endpoints, at two different granularities, and the categorical one
additionally carries hysteresis. The overlap is expected, not anomalous.

| | `gammaEnv` | `gexEnv` |
|---|---|---|
| Payload field | `gammaEnv` ([api/agent-scan.js:197](api/agent-scan.js:197)) | `gexEnv` ([api/agent-scan.js:196](api/agent-scan.js:196)) |
| DB column | `uw_signals.gamma_env` | `uw_signals.gex_env` |
| Written by | `/api/uw-snapshot` ([api/uw-snapshot.js:158](api/uw-snapshot.js:158)) | `/api/uw-gex` ([api/uw-gex.js:195](api/uw-gex.js:195)) |
| UW source | `get_greek_exposure_by_ticker` — **one ticker-level row per date** | `/greek-exposure/strike` — **the full per-strike ladder** |
| Aggregation | `(call_gamma + put_gamma) / (\|call_gamma\| + \|put_gamma\|)` on the latest row | Σ over strikes of `(call_gex + put_gex)`, divided by Σ `\|net gamma\|` per strike |
| Cadence | effectively **once per UTC day** (§6) | **twice daily**, 14:15 & 19:15 UTC |
| Path-dependent | No | **Yes** — hysteresis on the prior label |

Three independent reasons a single threshold on `gammaEnv` cannot reproduce `gexEnv`, any one
of which is sufficient:

1. **Different aggregation of different data.** `gammaEnv` normalizes UW's *ticker-level* call/put gamma totals. The `gexEnv` ratio normalizes a *per-strike* sum of `call_gex + put_gex`. These are different quantities with different denominators.
2. **Different refresh moments.** `gammaEnv` is a single pre-market reading held all day (§6.3); `gexEnv` is set at 14:15 and 19:15 UTC. Even were the underlying quantity identical, the two fields describe different instants.
3. **Hysteresis.** `gexEnv` depends on its own prior value, so it is not a function of any same-day input at all.

### 2.2 `gammaEnv` — exact definition

`gammaEnvFromGreek(rows)`, [src/lib/uwNormalize.js:11-20](src/lib/uwNormalize.js:11):

```js
const latest = rows[rows.length - 1];
const call = Number(latest?.call_gamma);
const put  = Number(latest?.put_gamma);
const gross = Math.abs(call) + Math.abs(put);
if (gross === 0) return null;
return (call + put) / gross;
```

- **Source:** `fetchGreekExposure(ticker)` → UW `get_greek_exposure_by_ticker`, rows ascending by date; **only the last row is used**. All history is discarded.
- **Sign convention:** UW signs `put_gamma` negative, so `call + put` is a genuine net ([src/lib/uwNormalize.js:6-9](src/lib/uwNormalize.js:6)).
- **Range:** a signed ratio over its own gross, so **mathematically bounded to [−1, +1]**, with no clamping needed. `> 0` = positive dealer gamma (dampening); `< 0` = negative (amplifying).
- **Null cases:** empty rows, non-finite `call_gamma`/`put_gamma`, or `gross === 0` → `null`.
- **Not per-ticker normalized, not persistence-smoothed.** It is a raw scale-free ratio of one day's snapshot. The module header calls this out explicitly: "Both outputs are scale-free, in [−1, 1], so no per-ticker calibration is needed" ([src/lib/uwNormalize.js:3-4](src/lib/uwNormalize.js:3)).

The observed `stabilized` maximum of +0.742 sits comfortably inside [−1, 1], consistent.

### 2.3 `gexEnv` — exact definition, including the hysteresis rule

The categorical field is `computeGexLevels({rows, spot, prevEnv}).env`,
[src/lib/gexLevels.js:55-87](src/lib/gexLevels.js:55). Two steps.

**Step 1 — the ratio** ([src/lib/gexLevels.js:65-67](src/lib/gexLevels.js:65)):

```js
const netGamma   = clean.reduce((s, r) => s + r.gamma, 0);
const totalAbs   = clean.reduce((s, r) => s + Math.abs(r.gamma), 0);
const gammaRatio = totalAbs > 0 ? +(netGamma / totalAbs).toFixed(4) : 0;
```

`clean` is the per-strike ladder for the **latest date only**
([api/uw-gex.js:85-96](api/uw-gex.js:85)), each entry's `gamma` being
`call_gex + put_gex` at that strike, with documented fallbacks to the
`*_gamma_oi` split and then to a single net field
([api/uw-gex.js:73-81](api/uw-gex.js:73)). Rounded to 4 dp; also bounded to [−1, 1].

Note `gammaRatio` is **not persisted**. Only `gex_env` and the unnormalized
`gex_net_gamma` reach the DB ([api/uw-gex.js:194-201](api/uw-gex.js:194)), so the number the
bucketing actually ran on is not recoverable from a stored row. This is the second reason an
observer sees only `gammaEnv` next to `gexEnv` and infers a broken threshold.

**Step 2 — hysteretic classification** ([src/lib/gexLevels.js:29-47](src/lib/gexLevels.js:29)):

```js
const ENV_ENTER = 0.10;
const ENV_EXIT  = 0.05;

function classifyEnv(ratio, prevEnv) {
  if (prevEnv === "stabilized") {
    if (ratio >  ENV_EXIT)  return "stabilized";
    if (ratio < -ENV_ENTER) return "choppy";
    return "neutral";
  }
  if (prevEnv === "choppy") {
    if (ratio < -ENV_EXIT)  return "choppy";
    if (ratio >  ENV_ENTER) return "stabilized";
    return "neutral";
  }
  if (ratio >  ENV_ENTER) return "stabilized";
  if (ratio < -ENV_ENTER) return "choppy";
  return "neutral";
}
```

Stated as a rule: **entering** `stabilized` or `choppy` from `neutral`/cold-start requires
clearing **±0.10**; once in a state it **holds** until the ratio retreats inside **±0.05**. A
direct flip between `stabilized` and `choppy` without passing through `neutral` requires
crossing the full enter band in one step. `prevEnv` is read per-ticker from the previous
`uw_signals.gex_env` at [api/uw-gex.js:178-182](api/uw-gex.js:178).

The stated purpose ([src/lib/gexLevels.js:24-28](src/lib/gexLevels.js:24)) is to stop names
sitting near their gamma flip from relabelling day to day.

**Consequence for the write-up:** `gexEnv` is **path-dependent**. Two tickers with identical
current ladders can carry different `gexEnv` labels depending on where each came from. Any
attempt to recover a threshold by regressing `gexEnv` on a single same-day number is
ill-posed regardless of which number is chosen.

**Null case:** empty ladder, or non-finite / non-positive `spot`, returns `env: null` and the
patch writes `gex_env = null` ([src/lib/gexLevels.js:61-63](src/lib/gexLevels.js:61)). `spot`
comes from `quotes.mid ?? quotes.last` ([api/uw-gex.js:171-173](api/uw-gex.js:171)).

### 2.4 How each is consumed inside this endpoint

- **`gammaEnv`** feeds the score, continuously, via `gammaEnvMod` ([src/lib/entryScore.js:36-40](src/lib/entryScore.js:36)): clamp to [−1, 1], then `g >= 0 ? 1 + 0.10·g : 1 + 0.15·g`. Asymmetric on purpose — up to **+10%** in positive gamma, down to **−15%** in negative. `null` → `1.0`.
- **`gexEnv`** feeds **filtering only**, never the score: `if (!row.gex_env || !f.gex_envs.includes(row.gex_env)) return false` ([src/lib/radarFilter.js:70-72](src/lib/radarFilter.js:70)). Four curated presets constrain it ([src/components/radar/curatedPresets.js:30,65,75,89](src/components/radar/curatedPresets.js:30)). Note the null-exclusion: under an active `gex_envs` filter, a ticker with `gex_env = null` is **dropped**, not passed.

---

## 3. `flowTapeEma`

**Emitted at** [api/agent-scan.js:198](api/agent-scan.js:198) from `r.flow_tape_ema` ←
`uw_signals.flow_tape_ema`.

### 3.1 Source data

`flowTapeFromTape(rows)`, [src/lib/uwNormalize.js:51-61](src/lib/uwNormalize.js:51), over UW
`get_flow_per_strike` (`fetchFlowPerStrike`):

```js
bullish += (Number(r?.call_premium_ask_side) || 0) + (Number(r?.put_premium_bid_side) || 0);
bearish += (Number(r?.call_premium_bid_side) || 0) + (Number(r?.put_premium_ask_side) || 0);
const total = bullish + bearish;
if (total === 0) return null;
return (bullish - bearish) / total;
```

This is the **full options tape** — every strike's directional premium — not the
unusual-activity alert subset. The distinction is documented at
[src/lib/uwNormalize.js:43-50](src/lib/uwNormalize.js:43): the tape can read bullish while the
alert subset (`flow_sentiment`, a separate column) reads bearish, because near-money hedging
dominates alerts while far-OTM put-selling dominates the tape. They are different fields; do
not conflate them.

### 3.2 Normalization — this is what bounds it

`(bullish − bearish) / (bullish + bearish)` where both terms are non-negative sums of premium.
**Mathematically bounded to [−1, +1]**, and it is a *ratio*, so dollar magnitude is divided
out — a $2M tape and a $2B tape with the same directional split produce the same number. There
is no clamp and none is needed. The observed range of −0.829…+0.909 across 228 rows is
interior to the bound, as expected: hitting ±1 requires literally all directional premium on
one side.

### 3.3 The EMA

`updateFlowState`, [src/lib/flowSmoothing.js:43-63](src/lib/flowSmoothing.js:43). It is **not**
a fixed-N window; it is an **alpha-weighted exponential average with a daily reseed**.

```js
EMA_ALPHA: 0.3   // src/lib/flowSmoothing.js:14
```

Three branches:

1. `raw == null` or non-finite → **carry prior state forward unchanged**. No decay toward zero; a dead feed freezes the value indefinitely.
2. `prevDay !== today` → **new trading day: reseed.** `flow_ema = raw` (no blending at all), yesterday's final EMA direction is finalized into the streak, `flow_day = today`.
3. Same day → `ema = 0.3·raw + 0.7·prevEma`.

Result rounded to 4 dp (`+ema.toFixed(4)`).

**The effective smoothing therefore depends entirely on how many times per day the ticker is
written**, which differs by held status:

| Ticker class | Tape writes/day | Effective `flow_tape_ema` |
|---|---|---|
| **Held** | every 15 min via `/api/uw-snapshot` ([api/uw-snapshot.js:137-149](api/uw-snapshot.js:137)) | a genuine α=0.3 intraday EMA over ~30 prints |
| **Approved, not held** | **twice**, via `/api/uw-gex` ([api/uw-gex.js:210-226](api/uw-gex.js:210)) | first run reseeds to **raw**; second run is a single blend `0.3·raw + 0.7·raw₁`. At most a 2-sample average. |

For the majority of scan candidates — which are by definition not held — `flowTapeEma` is
therefore **close to a raw tape ratio**, not a smoothed one. That is the most likely reason the
observed range reaches ±0.83/0.91: smoothing that never accumulates cannot compress the tails.
State this in a write-up; "EMA" overstates what most rows carry.

`/api/uw-snapshot` explicitly carries the prior tape forward untouched for non-held names
([api/uw-snapshot.js:133-136](api/uw-snapshot.js:133)), so its 15-minute cadence does **not**
advance `flow_tape_ema` for them.

### 3.4 The `−0.50` question

**Not determinable** — no such threshold exists in this source (§0.2). The only thing that can
be answered: the scale is **normalized**. `flowTapeEma` is a dimensionless ratio in [−1, 1]
throughout, from `flowTapeFromTape` through the EMA (a convex combination of values in [−1, 1]
stays in [−1, 1]). A `−0.50` cut on it means "net bearish premium exceeds net bullish by 3:1,"
which is the arithmetic of the ratio and holds regardless of which consumer applies it.

### 3.5 How it is consumed inside this endpoint

Via `flowMod` ([src/lib/entryScore.js:45-49](src/lib/entryScore.js:45)): clamp to [−1, 1],
then `1 + 0.15·f` — symmetric ±15%, `null` → `1.0`. Passed as the ninth argument to
`entryScore` at [api/agent-scan.js:178](api/agent-scan.js:178). Note the parameter is named
`flowSentiment` in `entryScore`'s signature but `agent-scan` and `radarFilter` both pass
`flow_tape_ema` — the tape, not the alert subset. The name is misleading; the wiring is
consistent between the two call sites ([api/agent-scan.js:178](api/agent-scan.js:178),
[src/lib/radarFilter.js:66](src/lib/radarFilter.js:66)).

`flow_tape_ema` has **no filter dimension** — it affects the score, never inclusion.

---

## 4. `flow_z` and `flow_pctile`

**Not determinable. These fields do not exist in this source.**

A repo-wide search for `flow_z`, `flow_pctile`, `flowZ`, `flowPctile` across `.js`, `.jsx`,
`.sql`, `.md`, `.json` (excluding `node_modules`, `dist`) returns **zero matches**. They are
not computed, not read, not written, and not emitted by `/api/agent-scan`. The endpoint's full
per-candidate field list is [api/agent-scan.js:180-204](api/agent-scan.js:180) and contains
neither.

Given §0.1, the most probable location is the external agentic runner, alongside `core_score`
and `momo_score`. Whether *any* consumer reads them — the actual question asked — cannot be
answered from here, because both the writer and every candidate reader are outside this
repository. Answering it requires the runner's source.

**What does exist**, and should not be mistaken for them — the four flow columns this repo
maintains on `uw_signals`:

| Column | Meaning | Written by | Reaches `/api/agent-scan`? |
|---|---|---|---|
| `flow_sentiment` | raw alert-subset ratio, `flowSentimentFromAlerts` ([src/lib/uwNormalize.js:29-41](src/lib/uwNormalize.js:29)) | `/api/uw-snapshot` | selected into the row ([src/lib/radarData.js:22](src/lib/radarData.js:22)) but **not emitted** and **not scored** |
| `flow_ema` | α=0.3 EMA of `flow_sentiment` | `/api/uw-snapshot` | selected, **not emitted** |
| `flow_streak` | consecutive whole days the daily-close EMA agreed in direction; signed; a neutral day (\|v\| < 0.2) zeroes it ([src/lib/flowSmoothing.js:32-37](src/lib/flowSmoothing.js:32)) | `/api/uw-snapshot` | selected, **not emitted** |
| `flow_tape_ema` | §3 | `/api/uw-gex` + `/api/uw-snapshot` (held) | **emitted and scored** |

So within this repo there genuinely *is* write-only flow instrumentation — `flow_sentiment`,
`flow_ema`, `flow_streak` are fetched into every Radar row and then dropped from the payload.
They are read by the open-positions surfaces (`trendOverlay`, `flowConfirmation`), not by the
scan. That may be the pattern the question is reaching for, but it is a different set of
columns, so it should not be presented as an answer about `flow_z` / `flow_pctile`.

---

## 5. `bb` — Bollinger parameters

**Emitted at** [api/agent-scan.js:187](api/agent-scan.js:187) from `r.bb_position` ←
`quotes.bb_position`. Computed once, at ingest, in
[api/bb.js:72-78](api/bb.js:72):

```js
const last20   = validCloses.slice(-20);
const sma20    = last20.reduce((a, b) => a + b, 0) / 20;
const variance = last20.reduce((s, c) => s + Math.pow(c - sma20, 2), 0) / 20;
const stdDev   = Math.sqrt(variance);
const upper    = sma20 + 2 * stdDev;
const lower    = sma20 - 2 * stdDev;
const bbPosition = (price - lower) / (upper - lower);
```

### Confirmed parameters

| Parameter | Value | Evidence |
|---|---|---|
| Period | **20** | `slice(-20)`, `/ 20` — [api/bb.js:72-73](api/bb.js:72) |
| σ multiplier | **2** | `sma20 ± 2 * stdDev` — [api/bb.js:76-77](api/bb.js:76) |
| Price series | **Daily closes**, `chart.result[0].indicators.quote[0].close`, Yahoo Finance `interval=1d&range=1y` | [api/bb.js:35](api/bb.js:35), [:50](api/bb.js:50) |
| σ estimator | **Population (÷N)**, not sample (÷N−1) | `/ 20` at [api/bb.js:74](api/bb.js:74) |
| Minimum data | 20 valid closes, else the ticker throws and is skipped | [api/bb.js:68-70](api/bb.js:68) |

Three points a precise write-up should not omit:

1. **The numerator price is not the series' last close.** `price` is `meta.regularMarketPrice` ([api/bb.js:52](api/bb.js:52)) — the live quote at fetch time — while the band is built from `validCloses`. Intraday these are the same value (Yahoo reports the in-progress session as the last close), but they are read from two different parts of the response and are not guaranteed to agree.
2. **The 20-day window includes today's in-progress session.** `validCloses` ends with the current session, so `sma20` and `stdDev` are 19 completed sessions plus today's live print, recomputed on every `/api/bb` run. These are not fixed-at-the-close Bollinger Bands.
3. **The closes are unadjusted.** `indicators.quote[0].close` is the raw close, not `adjclose`. A dividend or split inside the trailing 20 sessions distorts the band. No adjustment or split-detection exists in the code path.

### Unboundedness — confirmed

`bbPosition = (price − lower) / (upper − lower)` has **no clamp, no `Math.min`/`Math.max`, and
no bounds check** anywhere between computation ([api/bb.js:78](api/bb.js:78)), persistence
([api/bb.js:186](api/bb.js:186)), and emission ([api/agent-scan.js:187](api/agent-scan.js:187)).
Values above 1.0 (price above the upper band) and below 0 (below the lower band) are ordinary
and expected. The consuming bucketer has explicit categories for both
([src/lib/bbBucket.js:5-12](src/lib/bbBucket.js:5)):

```
below_band  pos < 0
near_lower  0    <= pos < 0.20
mid_range   0.20 <= pos < 0.80
near_upper  0.80 <= pos <= 1.0
above_band  pos > 1.0
```

Note the asymmetric endpoints: `near_upper` is closed at 1.0 (`pos <= 1.0`) while `near_lower`
is closed at 0 from below. Exactly 1.0 is `near_upper`, exactly 0 is `near_lower`.

**Degenerate case, undefended:** if all 20 closes are identical, `stdDev = 0`, `upper == lower`,
and `bbPosition` is `±Infinity` or `NaN` (0/0). Nothing in `api/bb.js` guards this; it would be
upserted as-is. Rare on liquid names, but it is a real hole and `NaN` would serialize to `null`
in JSON while `Infinity` would fail `JSON.stringify` differently — worth knowing before
publishing a claim that the field is always a finite number.

`bb` is also the dominant term in the score: `(1 − bb) · 0.50` is half the base
([src/lib/entryScore.js:58](src/lib/entryScore.js:58)), and **lower is better** for a CSP entry
([api/agent-scan.js:126](api/agent-scan.js:126)).

---

## 6. Live vs. cached — field-by-field

This is the section the request flagged as highest-value, so it is stated in full, with the
freshness failure modes after the table.

> **Version warning — §6 is the ONE section that does not hold at v1.171.1.** §1–§5 and §7 are
> byte-identical across the range (§-1). This section is not. **At v1.171.1 the `/api/bb` row
> below does not exist**: there was no cron, and `bb_position` refreshed only on a browser page
> load or `?refresh=true` (§0.4). The table as written describes HEAD. Where a v1.171.1 reading
> differs, it is marked inline.

### 6.1 The two things that are genuinely live at request time

Everything else in the payload is read out of Postgres.

| Live value | Where | Note |
|---|---|---|
| `positions` (→ every `held` flag, and `exposure` when `?exposure=true`) | queried at [api/agent-scan.js:341](api/agent-scan.js:341) | Live **read**, but the table itself is written by the sheet sync, which has **no cron entry** in `vercel.json` — so `held` is only as current as the last manual sync. |
| `freshness.marketOpen`, `asOf.generatedAt` | [api/agent-scan.js:353](api/agent-scan.js:353), [:355](api/agent-scan.js:355) | `isMarketOpen()` = 9:30–16:00 ET Mon–Fri ([api/_marketHours.js:20-25](api/_marketHours.js:20)). |

### 6.2 Full field table

**Cron times below are UTC**, as written in `vercel.json`. Vercel crons are UTC; see §6.6 for
what that means in ET.

| Payload field | DB column | Refresh job | Cron (UTC) | Live at request? |
|---|---|---|---|---|
| `ticker`, `company`, `sector` | `wheel_universe.*` | manual sheet sync | **none** | Cached — manual |
| `price` | `quotes.last` | `/api/bb`, `/api/uw-iv`, `/api/quotes` (held only) | `*/15 12-20 * * 1-5`; `0,30 12-20`; `*/15 12-20` | Cached |
| `bb`, `bbBucket` | `quotes.bb_position` | **`/api/bb`** | `*/15 12-20 * * 1-5` — **added 2026-07-22; NO CRON at v1.171.1** | Cached — see §6.4 |
| `rsi`, `rsiBucket` | `quotes.rsi_14` | `/api/bb` | as `bb` — **no cron at v1.171.1** | Cached (bucket derived live) |
| — (`trend` input) | `quotes.ma_50`, `ma_200` | `/api/bb` | as `bb` — **no cron at v1.171.1** | Cached |
| `iv`, `ivRank` | `quotes.iv`, `iv_rank` | `/api/uw-iv` | `0,30 12-20 * * 1-5` | Cached |
| `compositeIv` | — | — | — | **Derived live** from cached `iv`/`ivRank` |
| `ivTrend` | `iv_snapshots` rows (5-day window) | `/api/uw-iv` inserts one row per ticker per run | `0,30 12-20 * * 1-5` | **Derived live** ([api/agent-scan.js:340](api/agent-scan.js:340)) from cached rows |
| `trend` | — | — | — | **Derived live** from cached `last`/`ma_50`/`ma_200` |
| `score`, `scoreLabel` | — | — | — | **Derived live** from cached inputs |
| `gammaEnv` | `uw_signals.gamma_env` | `/api/uw-snapshot` | `10,25,40,55 12-20 * * 1-5` — but see §6.3 | Cached — **~daily in practice** |
| `gexEnv` | `uw_signals.gex_env` | **`/api/uw-gex`** | `15 14,19 * * 1-5` | Cached — **twice daily** |
| `flowTapeEma` | `uw_signals.flow_tape_ema` | `/api/uw-gex` (all approved); `/api/uw-snapshot` (**held only**) | `15 14,19`; `10,25,40,55 12-20` | Cached — twice daily unless held |
| `pe` | `fundamentals.pe_ttm` | `/api/ingest` (POST push) | **none — feed dead** | Cached, **frozen since 2026-07-01** |
| `beta` | `fundamentals.beta` | `/api/ingest` | **none — feed dead** | Cached, **frozen since 2026-07-01** |
| `earningsDate` | `quotes.earnings_date` | `/api/uw-earnings-dates` | `0 12 * * 1-5` | Cached — daily. **At v1.171.1 sourced from `market_context` instead** (§-1) |
| `earningsDaysAway` | — | — | — | **Derived live** from cached date ([src/lib/radarData.js:147-151](src/lib/radarData.js:147)) |
| `held` | `positions` | sheet sync | **none** | Live read of a manually-synced table |
| `baskets[].tickers[].dayPct` | `quotes.last`, `prev_close` | as `price` above | | Cached, **unguarded** (§0.4) |
| `asOf.bbRefreshedAt` | `quotes.bb_refreshed_at` | `/api/bb` | | The only freshness stamp surfaced |

`?refresh=true` re-runs the ingest chain inline before reading
([api/_lib/refreshChain.js:35-36](api/_lib/refreshChain.js:35): `/api/quotes` →
`/api/bb?force=1` → `/api/uw-iv`, in parallel with `/api/uw-snapshot` → `/api/uw-gex`). It is
opt-in for a documented reason — it costs minutes and shipped inverted in v1.171.0
([api/agent-scan.js:98-109](api/agent-scan.js:98)). Note `/api/bb?force=1` is the **only** way
to bypass the gate in §6.4.

### 6.3 `gammaEnv` is a once-a-day pre-market reading, despite a 15-minute cron

[api/uw-snapshot.js:111-119](api/uw-snapshot.js:111):

```js
const greekFresh = prev?.gamma_env != null && prev?.refreshed_at &&
  new Date(prev.refreshed_at).getTime() >= todayStartMs;
...
if (!greekFresh) {
  const greek = await fetchGreekExposure(ticker);
  gammaEnv = gammaEnvFromGreek(greek);
}
```

`todayStartMs` is **UTC midnight** ([api/uw-snapshot.js:85](api/uw-snapshot.js:85)). So the
greek call fires only on the **first run of each UTC day** — 12:10 UTC, i.e. **08:10 ET (EDT)
or 07:10 ET (EST)**, both of which are **before the cash open**. Every subsequent run that day
reuses `prev.gamma_env` and re-upserts it. The comment says as much: "Greek exposure is daily
data — only refetch when we don't already have a `gamma_env` from today."

**Consequence:** `gammaEnv` in a 3pm scan is a pre-market number. Nothing in the payload
signals this — `freshness` reports only `bbAgeMinutes`, and `uw_signals.refreshed_at` is
restamped every 15 minutes even when `gamma_env` was not refetched, so the row *looks* fresh.
This is the single most misleading freshness property in the payload and belongs in a public
write-up.

### 6.4 Two `bb` staleness bugs, stacked

**Bug 1 — no cron at all (v1.171.1 only; fixed 2026-07-22 in v1.171.2).** Covered in §0.4.
This is the severe one and it is the one that bit you.

**Bug 2 — the gate has no headroom (v1.171.1 AND HEAD; still live).** Once the cron was added,
a second, milder problem surfaced underneath it. `api/bb.js` is unchanged across the whole
range, so this was latent at v1.171.1 and is present today.

[api/bb.js:15](api/bb.js:15) and [:137](api/bb.js:137):

```js
const STALE_MS = 15 * 60 * 1000;      // 15 minutes
...
if (!force && ageMs < STALE_MS) { /* return cached, write nothing */ }
```

The cron fires `*/15` — **exactly the gate interval**. `bb_refreshed_at` is stamped at
[api/bb.js:165](api/bb.js:165), *before* the ~50 sequential Yahoo fetches, so it records each
run's start. Whether the next run's `ageMs` lands above or below 15 minutes therefore turns on
the **difference in cron dispatch jitter between two consecutive runs** — sub-minute, and
signed either way. Some cycles refresh; some return early and write nothing.

This exact failure mode is diagnosed and fixed in the sibling job —
[api/quotes.js:24-29](api/quotes.js:24):

> 13 min, not 15: `refreshQuotes()` stamps `quotes_refreshed_at` a few seconds-to-a-minute after
> each `*/15` cron boundary (fetch latency), so at the next boundary the age is a hair under 15
> min. A 15-min threshold would skip every other cycle and stretch the effective cadence to ~30
> min. 13 min leaves headroom so each cron cycle actually refreshes.

`/api/bb` has no equivalent headroom. **The nominal 15-minute `bb` cadence is not reliable, and
30-minute-old `bb_position` is a normal steady state, not a fault.** This is a concrete,
code-level mechanism for a stale `bb` — the closest thing in this source to the incident the
request describes, though it does not establish that it caused it. It is a defect, not a design
choice: flagged here, not fixed, per the documentation-only scope.

Knock-on: `freshness.stale` trips at `bbAgeMinutes > 20` while the market is open
([api/agent-scan.js:271](api/agent-scan.js:271)), so a pipeline exhibiting the normal skip
behaviour above will intermittently self-report as stale. The flag is real, but it does not
cleanly separate "ingest is dead" from "gate skipped a cycle."

**Net for a write-up.** `bb_position` — half the scanner score — has had exactly one reliable
refresh path for less than the lifetime of the endpoint. Before 2026-07-22 it had none for
headless callers. After 2026-07-22 it has one that skips cycles on sub-minute timing jitter.
The `?refresh=true` escape hatch bypasses the gate (`/api/bb?force=1`,
[api/_lib/refreshChain.js:35](api/_lib/refreshChain.js:35)) but costs minutes and is documented
as not-for-scheduled-use ([api/agent-scan.js:38-40](api/agent-scan.js:38)). That is the whole
freshness story for the most load-bearing field in the payload.

### 6.5 `bbRefreshedAt` is a universe-wide maximum, not per-ticker

[src/lib/radarData.js:118-125](src/lib/radarData.js:118) takes the **newest**
`bb_refreshed_at` across all rows. A ticker whose Yahoo fetch failed keeps its old
`bb_position` and old per-row timestamp, while the payload's single `asOf.bbRefreshedAt`
reports the freshest ticker in the universe. Per-ticker `bb` staleness is **invisible** in the
payload. Failures are collected into `/api/bb`'s own response `errors` array
([api/bb.js:176](api/bb.js:176)) and never propagate to `/api/agent-scan`.

### 6.6 Cron windows are UTC — session coverage shifts with DST

All market-hours crons use `12-20` UTC. Under **EDT** (UTC−4) that is 08:00–16:59 ET, which
covers the 09:30–16:00 session with margin. Under **EST** (UTC−5) it is 07:00–15:59 ET, so the
last `*/15` slot in hour 20 UTC is 15:45 ET and **the final ~15 minutes of the session get no
refresh**. This follows directly from the cron expressions in
[vercel.json:13-53](vercel.json:13) and applies to `/api/quotes`, `/api/bb`, `/api/uw-snapshot`,
`/api/uw-iv`, and `/api/alert-check` alike.

### 6.7 `price` has three writers with different scopes

`quotes.last` is written by:

- `/api/bb` — approved universe, from Yahoo `meta.regularMarketPrice` ([api/bb.js:191](api/bb.js:191))
- `/api/uw-iv` — approved ∪ held, from the UW screener's `close` ([api/uw-iv.js](api/uw-iv.js), via `ivQuoteFromScreenerRow` at [src/lib/uwNormalize.js:80](src/lib/uwNormalize.js:80))
- `/api/quotes` — **open positions only** ([api/quotes.js:229](api/quotes.js:229)), from Public.com

So `price` for a **held** ticker refreshes on three schedules from three vendors, while an
unheld approved ticker gets two. Last writer wins. The value in any given payload is from
whichever job ran most recently for that symbol, and the payload does not say which.

Related: `/api/uw-iv` writes `last` and `prev_close` but **not** `bb_position` or the MAs
(update-only patch, by design — [api/uw-iv.js:14-19](api/uw-iv.js:14)). So a `/api/uw-iv` run
between `/api/bb` runs moves `price` while leaving `bb`, `ma_50`, and `ma_200` on the older
price. `bb` and `price` in the same row are routinely from different instants — a second,
independent mechanism by which `bb` reads stale relative to the price shown beside it.

---

## 7. Appendix — the score `/api/agent-scan` actually computes

Included because §0.1 rules out documenting `core_score` / `momo_score` from this source, and a
write-up needs *something* concrete for the scoring claim.

`entryScore(bb, iv, ivRank, price, ma50, ma200, ivTrend, gammaEnv, flowTapeEma)`,
[src/lib/entryScore.js:51-69](src/lib/entryScore.js:51):

```
base  = (1 − bb) · 0.50  +  compositeIv · 0.50
score = base · trendMod · ivTrendMod · gammaEnvMod(gammaEnv) · flowMod(flowTapeEma)
```

| Term | Definition | Range |
|---|---|---|
| `compositeIv` | `(ivRank/100)·0.60 + min(iv/1.50, 1)·0.40` ([entryScore.js:16-19](src/lib/entryScore.js:16)) | [0, 1] |
| `trendMod` | 1.00 / 0.90 / 0.85 / 0.70 (§1) | — |
| `ivTrendMod` | rising 1.10 · stable 1.00 · falling 0.90 · collapsing 0.90 · spiking 0.85; `insufficient` or absent → 1.00 ([entryScore.js:63](src/lib/entryScore.js:63), [src/lib/ivTrend.js:84-88](src/lib/ivTrend.js:84)) | — |
| `gammaEnvMod` | `g ≥ 0 ? 1 + 0.10g : 1 + 0.15g`, g clamped to [−1,1]; null → 1.0 | [0.85, 1.10] |
| `flowMod` | `1 + 0.15f`, f clamped to [−1,1]; null → 1.0 | [0.85, 1.15] |

Returns `null` if `bb_position` is null or `compositeIv` is null (i.e. either `iv` or `iv_rank`
missing) — [entryScore.js:55-57](src/lib/entryScore.js:55). Rounded to 3 dp at
[api/agent-scan.js:185](api/agent-scan.js:185). Labels: Strong ≥0.70, Moderate ≥0.50, Neutral
≥0.30, Weak <0.30 ([entryScore.js:71-77](src/lib/entryScore.js:71)).

Note the structural difference from the supplied `core_score`: this repo's score uses `bb`
**and** IV richness as co-equal halves, and treats gamma as a **continuous ±10/15% modifier on
`gammaEnv`**, never as a categorical multiplier on `gexEnv`. `rsi` is deliberately excluded to
avoid double-counting Bollinger position ([src/lib/rsi.js:3-8](src/lib/rsi.js:3)).

---

## 8. Summary of what could not be determined

| Item | Reason |
|---|---|
| `core_score` formula | Computed by the external agentic runner; no code in this repo. |
| `momo_score` formula | Same. |
| `gex_mult` categorical multipliers (1.00/0.90/0.80) | Same. This repo never multiplies by `gexEnv`. |
| Whether the `−0.50` flow veto is normalized or raw | The threshold does not exist here. The *field* is normalized to [−1,1]; that much is settled. |
| `flow_z`, `flow_pctile` — definition, window, consumers | Zero occurrences in this repo. |
| ~~That a stale `bb` caused a bad entry on 2026-07-22~~ | **Resolved — CONFIRMED, not indeterminate.** At v1.171.1 `/api/bb` had no cron; the fix commit `826fce0` is dated 2026-07-22 and names the headless agent-scan consumer as the victim. See §0.4. |
| The `gammaRatio` behind any historical `gexEnv` | Not persisted — only the label and the unnormalized `gex_net_gamma` are written. |

## 9. Defects noted (not fixed — documentation-only scope)

All four are present at **both** v1.171.1 and HEAD — every file cited here is byte-identical
across the range (§-1). The v1.171.1-only missing-`/api/bb`-cron defect is excluded; it was
fixed in v1.171.2.

1. **`api/bb.js:15`** — `STALE_MS` equals the cron interval, so refreshes skip on dispatch jitter. `api/quotes.js:24-29` documents the same bug and fixes it with a 13-minute threshold. Latent at v1.171.1 (no cron to skip), live from v1.171.2 onward.
2. **`api/agent-scan.js:218-220`** — basket `dayPct` lacks the ±50% stale-`prev_close` guard that `src/components/AIThesisTab.jsx:82-84` applies to the same computation.
3. **`api/bb.js:78`** — no guard against `stdDev === 0`; would emit `Infinity`/`NaN` for a flat 20-day window.
4. **`api/uw-snapshot.js:169`** — `refreshed_at` is restamped every run even when `gamma_env` was served from cache, so a day-old `gamma_env` presents as fresh.

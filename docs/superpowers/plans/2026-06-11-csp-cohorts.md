# CSP Cohorts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save a CSP selection as a named cohort (tag-based), browse cohorts via a 4th pill on Open Positions, and open a roster-forward detail view with scoreboard and capture-over-time chart.

**Architecture:** A cohort IS the set of positions whose journal entries carry a `cohort:<slug>` tag. Pure resolution/scoreboard/series math in `src/lib/cohorts.js` (vitest); a thin `api/cohort-history.js` endpoint serves per-day member capture from `daily_snapshots.forecast_per_position`; `CohortsPanel` renders list + detail; `CspSelectionBar` gains the save flow; `OpenPositionsTab` wires the pill, entry fetch, and chip routing.

**Tech Stack:** React 18, inline `style={{}}` + `theme` tokens, vitest, Vercel serverless (Supabase server client). Spec: `docs/superpowers/specs/2026-06-11-csp-cohorts-design.md`.

**Worktree discipline (subagents):** ALL work happens in the worktree checkout you are told to use — never `cd` to the main repo checkout, never commit on `main`. Branch: `feat/csp-cohorts`.

---

## Codebase facts you need (verified 2026-06-11, main @ v1.125.1)

- **Journal API** (`api/journal-entry.js`, gated by `middleware.js` matcher `/api/:path*` — new endpoints are auto-gated):
  - GET params: `tickers`, `tag` (exact contains), `hasTags=1`, etc. Client helper: `listJournalEntries(params)` in `src/lib/journalApi.js`.
  - POST body = full entry payload, inserted as-is, NO tag-vocabulary validation. Payload shape used by JournalQuickAdd: `{trade_id, position_id, entry_date, ticker, type, strike, expiry, title, body, tags, source, mood, metadata, focus_snapshot, created_at, updated_at}`.
  - PATCH body = `{id, fields}`. CAUTION: if `fields` contains `source`, the API propagates it to the linked position — cohort code must NEVER include `source` in PATCH fields, and uses `source: null` on POST.
  - DELETE: `/api/journal-entry?id=<id>`.
- **Basket resolution** (`src/lib/strategyBasket.js`): private `tupleMatch(a, b)` compares ticker / `String(type)` / `String(strike)` / `expiry_date ?? expiry` (ISO preferred — normalizeTrade adds an MM/DD `expiry` ALONGSIDE ISO `expiry_date` on closed trades; reading `expiry` first silently fails). Task 1 exports it for reuse.
- **Snapshot history**: `daily_snapshots.forecast_per_position` (written by `api/sync.js` / `api/snapshot.js` via `serializePerPosition` in `api/_lib/computeForecastV2.js`) is an array of `{ticker, type, strike, expiry, bucket, capture_pct, premium_at_open, realized_to_date, current_profit_pct, dte, stock_price, cost_basis, position_pnl, remaining, this_month}` per day. **`type` is LOWERCASE (`'csp'`)** while positions/trades use `'CSP'` — match case-insensitively. **Use `current_profit_pct`** (mark-to-market capture FRACTION, 0–1, negative when underwater) — NOT `capture_pct`, which is the forecast model's expected FINAL capture.
- **`kept_pct` on closed trades is a 0–1 fraction** (`src/lib/trading.js` renders `Math.round(t.kept_pct * 100)`).
- **`useData()`** (DataContext) provides `{trades, positions, account, cspEntryYieldBenchmark, refreshData, deleteTrade}`. Trades are normalized (`premium_collected`→`premium` renamed BUT `kept_pct` and ISO `expiry_date` survive; read premium as `premium_collected ?? premium`).
- **Server supabase pattern** (copy from `api/data.js`): `createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)` via a local `getSupabase()`.
- **OpenPositionsTab** (`src/components/OpenPositionsTab.jsx`, ~1300 lines): contains `PositionsTable` + main component. Selection calculator state: `selectedKeys` Set of `positionKey(pos)` strings; `CspSelectionBar` rendered by `PositionsTable` when `selectable`. Position pills built from a `positionTabs` array; tab clicks clear `selectedKeys`.
- **Tag chips**: `PositionTagChip` rows route clicks: `strategy:*` → `onOpenBasket(tag)`, else → `onShowJournalEntry(entryId)`. `cohort:` is not in `NON_STRATEGIC_TAG_PREFIXES` (`src/lib/tags.js`), so cohort chips surface automatically once entries exist.
- **Design tokens**: `theme` from `src/lib/theme.js`; no hex except the established `rgba(58,130,246,…)` blue family. Formatters: `formatDollarsFull`, `formatExpiry` from `src/lib/format.js`.
- Tests: `npx vitest run`. Build: `npm run build`. Local dev does NOT serve `/api/*` — verification is vitest + build; browser checks happen post-deploy.

---

### Task 0: Branch setup

- [ ] Create worktree/branch `feat/csp-cohorts` from current `origin/main`, `npm install`, run `npx vitest run` (expect all green) to confirm a clean baseline.

---

### Task 1: Cohort resolution + slugify (TDD)

**Files:**
- Modify: `src/lib/strategyBasket.js` (export `tupleMatch`)
- Create: `src/lib/cohorts.js`
- Test: `src/lib/__tests__/cohorts.test.js`

- [ ] **Step 1.1: Export tupleMatch from strategyBasket.js**

Change (line ~8):
```js
function tupleMatch(a, b) {
```
to:
```js
export function tupleMatch(a, b) {
```
Run `npx vitest run src/lib/__tests__/` — expect existing suites still green (export-only change).

- [ ] **Step 1.2: Write the failing tests**

Create `src/lib/__tests__/cohorts.test.js`:

```js
import { describe, it, expect } from "vitest";
import { slugifyCohortName, resolveCohort } from "../cohorts";

const entry = (ticker, strike, expiry, tags, extra = {}) => ({
  id: `e-${ticker}-${strike}`, ticker, type: "CSP", strike, expiry, tags,
  created_at: "2026-06-01T10:00:00Z", ...extra,
});
const openPos = (ticker, strike, expiry, extra = {}) => ({
  ticker, type: "CSP", strike, expiry_date: expiry, open_date: "2026-05-28",
  contracts: 1, premium_collected: 500, ...extra,
});
// Normalized closed trade: MM/DD `expiry` alongside ISO `expiry_date` (the gotcha).
const closedTrade = (ticker, strike, expiry, extra = {}) => ({
  ticker, type: "CSP", strike, expiry_date: expiry, expiry: "07/02",
  open_date: "2026-05-20", close_date: "2026-06-05", contracts: 1,
  premium: 800, kept_pct: 0.82, ...extra,
});

describe("slugifyCohortName", () => {
  it("lowercases, dashes whitespace/punctuation, collapses and trims dashes", () => {
    expect(slugifyCohortName("Jun 26 batch")).toBe("jun-26-batch");
    expect(slugifyCohortName("  SOFI -- makeup!! ")).toBe("sofi-makeup");
  });
  it("returns empty string when nothing slug-worthy remains", () => {
    expect(slugifyCohortName("!!!")).toBe("");
    expect(slugifyCohortName("")).toBe("");
  });
});

describe("resolveCohort", () => {
  const TAG = "cohort:jun-26-batch";

  it("resolves open members from open positions", () => {
    const { members, unresolved } = resolveCohort(TAG, {
      openPositions: [openPos("CCJ", 107, "2026-06-26")],
      trades: [],
      entries: [entry("CCJ", 107, "2026-06-26", [TAG])],
    });
    expect(unresolved).toHaveLength(0);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      status: "open", ticker: "CCJ", strike: 107, expiry: "2026-06-26",
      contracts: 1, premiumCollected: 500, keptPct: null,
    });
  });

  it("resolves closed members from trades using ISO expiry_date, not MM/DD expiry", () => {
    const { members } = resolveCohort(TAG, {
      openPositions: [],
      trades: [closedTrade("WDC", 450, "2026-07-02")],
      entries: [entry("WDC", 450, "2026-07-02", [TAG])],
    });
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      status: "closed", closeDate: "2026-06-05", premiumCollected: 800, keptPct: 0.82,
    });
  });

  it("ignores entries without the tag and reports unresolved tuples", () => {
    const { members, unresolved } = resolveCohort(TAG, {
      openPositions: [],
      trades: [],
      entries: [
        entry("CCJ", 107, "2026-06-26", [TAG]),                 // matches nothing → unresolved
        entry("CDE", 18, "2026-06-26", ["strategy:sofi-makeup"]), // different tag → ignored
      ],
    });
    expect(members).toHaveLength(0);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]).toMatchObject({ ticker: "CCJ", strike: 107 });
  });

  it("prefers the open position over a closed trade with the same tuple", () => {
    const { members } = resolveCohort(TAG, {
      openPositions: [openPos("GLW", 190, "2026-07-02")],
      trades: [closedTrade("GLW", 190, "2026-07-02")],
      entries: [entry("GLW", 190, "2026-07-02", [TAG])],
    });
    expect(members).toHaveLength(1);
    expect(members[0].status).toBe("open");
  });

  it("dedupes duplicate entries for the same position (merge-on-resave semantics)", () => {
    const { members } = resolveCohort(TAG, {
      openPositions: [openPos("CCJ", 107, "2026-06-26")],
      trades: [],
      entries: [
        entry("CCJ", 107, "2026-06-26", [TAG]),
        { ...entry("CCJ", 107, "2026-06-26", [TAG]), id: "e-dup" },
      ],
    });
    expect(members).toHaveLength(1);
  });

  it("reports cohort created date as the earliest entry created_at", () => {
    const { createdAt } = resolveCohort(TAG, {
      openPositions: [openPos("CCJ", 107, "2026-06-26")],
      trades: [],
      entries: [
        { ...entry("CCJ", 107, "2026-06-26", [TAG]), created_at: "2026-06-03T10:00:00Z" },
        { ...entry("CCJ", 108, "2026-06-26", [TAG]), id: "e2", created_at: "2026-06-01T09:00:00Z" },
      ],
    });
    expect(createdAt).toBe("2026-06-01T09:00:00Z");
  });
});
```

- [ ] **Step 1.3: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/cohorts.test.js`
Expected: FAIL — "Failed to resolve import ../cohorts".

- [ ] **Step 1.4: Write the implementation**

Create `src/lib/cohorts.js`:

```js
// Cohort resolution + math for the CSP cohorts feature. A cohort is the set of
// positions whose journal entries carry a `cohort:<slug>` tag; members are
// tuple-matched against open positions and closed trades so they keep
// resolving after close. See docs/superpowers/specs/2026-06-11-csp-cohorts-design.md.

import { tupleMatch } from "./strategyBasket";

export function slugifyCohortName(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toIsoDate(v) {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  return String(v);
}

function memberFromOpen(pos) {
  return {
    status: "open",
    ticker: pos.ticker,
    type: pos.type,
    strike: pos.strike ?? null,
    expiry: pos.expiry_date ?? null,
    openDate: pos.open_date ?? null,
    closeDate: null,
    contracts: pos.contracts ?? null,
    premiumCollected: pos.premium_collected ?? 0,
    keptPct: null,
  };
}

// Accepts raw DB trade rows and normalizeTrade() output (premium_collected→premium).
function memberFromTrade(trade) {
  return {
    status: "closed",
    ticker: trade.ticker,
    type: trade.type,
    strike: trade.strike ?? null,
    expiry: trade.expiry_date ?? null,
    openDate: trade.open_date ?? null,
    closeDate: toIsoDate(trade.close_date ?? trade.closeDate) ?? null,
    contracts: trade.contracts ?? null,
    premiumCollected: trade.premium_collected ?? trade.premium ?? 0,
    keptPct: trade.kept_pct ?? null,
  };
}

function memberKey(m) {
  return `${m.ticker}|${m.type}|${m.strike}|${m.expiry_date ?? m.expiry}`;
}

/**
 * Resolve a cohort tag into members.
 * @returns {{members: Array, unresolved: Array, createdAt: string|null}}
 */
export function resolveCohort(tag, { openPositions = [], trades = [], entries = [] }) {
  const seen = new Set();
  const members = [];
  const unresolved = [];
  let createdAt = null;

  for (const e of entries) {
    if (!Array.isArray(e.tags) || !e.tags.includes(tag)) continue;
    if (e.created_at && (createdAt == null || e.created_at < createdAt)) createdAt = e.created_at;

    const key = memberKey(e);
    if (seen.has(key)) continue;
    seen.add(key);

    const openMatch = openPositions.find(p => tupleMatch(e, p));
    if (openMatch) { members.push(memberFromOpen(openMatch)); continue; }
    const closedMatch = trades.find(t => tupleMatch(e, t));
    if (closedMatch) { members.push(memberFromTrade(closedMatch)); continue; }
    unresolved.push({ ticker: e.ticker, type: e.type, strike: e.strike ?? null, expiry: e.expiry ?? null });
  }

  return { members, unresolved, createdAt };
}
```

- [ ] **Step 1.5: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/cohorts.test.js`
Expected: 8 tests pass.

- [ ] **Step 1.6: Commit**

```bash
git add src/lib/strategyBasket.js src/lib/cohorts.js src/lib/__tests__/cohorts.test.js
git commit -m "Add cohort resolution and name slugify"
```

---

### Task 2: Cohort scoreboard + capture series (TDD)

**Files:**
- Modify: `src/lib/cohorts.js` (append functions)
- Test: `src/lib/__tests__/cohorts.test.js` (append suites)

- [ ] **Step 2.1: Write the failing tests** — append to `src/lib/__tests__/cohorts.test.js`:

```js
import { cohortScoreboard, memberCapturePct, cohortCaptureSeries } from "../cohorts";
import { buildOccSymbol } from "../trading";

const openMember = (over = {}) => ({
  status: "open", ticker: "CCJ", type: "CSP", strike: 107, expiry: "2026-06-26",
  openDate: "2026-05-28", closeDate: null, contracts: 1, premiumCollected: 500,
  keptPct: null, ...over,
});
const closedMember = (over = {}) => ({
  status: "closed", ticker: "WDC", type: "CSP", strike: 450, expiry: "2026-06-26",
  openDate: "2026-05-20", closeDate: "2026-06-05", contracts: 1, premiumCollected: 800,
  keptPct: 0.75, ...over,
});
// quoteMap with the open member's put marked at 2.50 → unrealized = 500 - 250 = 250 (50%)
const quoteMapFor = (m, mid) =>
  new Map([[buildOccSymbol(m.ticker, m.expiry, false, m.strike), { mid }]]);

describe("cohortScoreboard", () => {
  it("computes collateral from open members only, premium and capture across all", () => {
    const open = openMember();
    const sb = cohortScoreboard([open, closedMember()], quoteMapFor(open, 2.5), 100000);
    expect(sb.memberCount).toBe(2);
    expect(sb.openCount).toBe(1);
    expect(sb.collateral).toBe(107 * 100);            // open only
    expect(sb.collateralPct).toBeCloseTo(10.7, 5);
    expect(sb.maxPremium).toBe(1300);                  // 500 + 800
    expect(sb.captured).toBeCloseTo(250 + 600, 5);     // unrealized 250 + kept 0.75×800
    expect(sb.capturePct).toBeCloseTo(((250 + 600) / 1300) * 100, 5);
    expect(sb.missingMarkCount).toBe(0);
  });

  it("excludes unmarked open members and null-kept closed members from capture, counts them", () => {
    const sb = cohortScoreboard(
      [openMember(), closedMember({ keptPct: null })],
      new Map(), // no quotes → open member unmarked
      null,
    );
    expect(sb.captured).toBeNull();
    expect(sb.capturePct).toBeNull();
    expect(sb.missingMarkCount).toBe(2);
    expect(sb.maxPremium).toBe(1300);
    expect(sb.collateralPct).toBeNull(); // no account value
  });

  it("handles an all-closed cohort (no collateral)", () => {
    const sb = cohortScoreboard([closedMember()], new Map(), 100000);
    expect(sb.collateral).toBe(0);
    expect(sb.captured).toBeCloseTo(600, 5);
    expect(sb.capturePct).toBeCloseTo(75, 5);
  });
});

describe("memberCapturePct", () => {
  it("uses live marks for open members (percent units)", () => {
    const m = openMember();
    expect(memberCapturePct(m, quoteMapFor(m, 2.5))).toBeCloseTo(50, 5);
    expect(memberCapturePct(m, new Map())).toBeNull();
  });
  it("uses kept_pct for closed members", () => {
    expect(memberCapturePct(closedMember(), new Map())).toBeCloseTo(75, 5);
    expect(memberCapturePct(closedMember({ keptPct: null }), new Map())).toBeNull();
  });
});

describe("cohortCaptureSeries", () => {
  // Snapshot member rows use the serialized DB shape: lowercase type, snake_case fields.
  const snap = (ticker, strike, expiry, current_profit_pct, premium_at_open) =>
    ({ ticker, type: "csp", strike, expiry, current_profit_pct, premium_at_open });

  it("premium-weights open members per day and skips days with no contributors", () => {
    const m1 = openMember();                                       // CCJ 107
    const m2 = openMember({ ticker: "SHOP", strike: 118, premiumCollected: 1000 });
    const history = [
      { date: "2026-06-01", members: [snap("CCJ", 107, "2026-06-26", 0.2, 500), snap("SHOP", 118, "2026-06-26", 0.4, 1000)] },
      { date: "2026-06-02", members: [] },                          // no contributors → skipped
      { date: "2026-06-03", members: [snap("CCJ", 107, "2026-06-26", 0.3, 500)] },
    ];
    const series = cohortCaptureSeries([m1, m2], history);
    expect(series).toHaveLength(2);
    // day 1: (0.2×500 + 0.4×1000) / 1500 = 0.3333…
    expect(series[0]).toMatchObject({ date: "2026-06-01" });
    expect(series[0].capturePct).toBeCloseTo(33.33, 1);
    expect(series[1].capturePct).toBeCloseTo(30, 5);
  });

  it("flatlines closed members at kept_pct from their close date", () => {
    const closed = closedMember(); // closes 2026-06-05, kept 0.75, premium 800
    const history = [
      { date: "2026-06-04", members: [snap("WDC", 450, "2026-06-26", 0.6, 800)] },
      { date: "2026-06-06", members: [] }, // member closed; contributes kept_pct
    ];
    const series = cohortCaptureSeries([closed], history);
    expect(series[0].capturePct).toBeCloseTo(60, 5);
    expect(series[1].capturePct).toBeCloseTo(75, 5);
  });

  it("matches snapshot type case-insensitively and stops after the last close when all closed", () => {
    const closed = closedMember(); // closeDate 2026-06-05
    const history = [
      { date: "2026-06-05", members: [] },
      { date: "2026-06-20", members: [] }, // > closeDate of an all-closed cohort → trimmed
    ];
    const series = cohortCaptureSeries([closed], history);
    expect(series).toHaveLength(1);
    expect(series[0].date).toBe("2026-06-05");
  });

  it("returns empty for empty inputs", () => {
    expect(cohortCaptureSeries([], [])).toEqual([]);
    expect(cohortCaptureSeries([openMember()], [])).toEqual([]);
  });
});
```

- [ ] **Step 2.2: Run tests to verify the new suites fail**

Run: `npx vitest run src/lib/__tests__/cohorts.test.js`
Expected: FAIL — `cohortScoreboard` etc. not exported.

- [ ] **Step 2.3: Implement** — append to `src/lib/cohorts.js` (and extend the import list at the top):

```js
// at top of file, replace the existing import block with:
import { tupleMatch } from "./strategyBasket";
import { buildOccSymbol } from "./trading";
import { shortOptionGlDollars, shortOptionGlPct } from "./positionMetrics";
```

```js
// appended after resolveCohort:

function optionMidFor(member, quoteMap) {
  if (!member.expiry || member.strike == null || !member.contracts) return null;
  const sym = buildOccSymbol(member.ticker, member.expiry, false, member.strike);
  return quoteMap?.get(sym)?.mid ?? null;
}

/**
 * Roster capture % for one member (percent units, null when unmarked/unkept).
 */
export function memberCapturePct(member, quoteMap) {
  if (member.status === "closed") {
    return member.keptPct != null ? member.keptPct * 100 : null;
  }
  const optionMid = optionMidFor(member, quoteMap);
  return shortOptionGlPct({
    premiumCollected: member.premiumCollected,
    optionMid,
    contracts: member.contracts,
  });
}

/**
 * Scoreboard: collateral from OPEN members only (closed collateral is freed);
 * premium and capture across all members. Capture = unrealized (open, live
 * marks — same math as the selection calculator) + realized (closed, kept_pct).
 * capturePct's denominator covers contributing rows only, consistent with
 * computeCspAggregates' internally-consistent ratio rule.
 */
export function cohortScoreboard(members, quoteMap, accountValue) {
  const open = members.filter(m => m.status === "open");
  const closed = members.filter(m => m.status === "closed");

  let collateral = 0, openPremium = 0, openCaptured = 0, openMarkedPremium = 0, openMissing = 0;
  let hasOpenCapture = false;
  for (const m of open) {
    collateral  += (m.strike ?? 0) * 100 * (m.contracts ?? 0);
    openPremium += m.premiumCollected ?? 0;
    const gl = shortOptionGlDollars({
      premiumCollected: m.premiumCollected,
      optionMid: optionMidFor(m, quoteMap),
      contracts: m.contracts,
    });
    if (gl == null) { openMissing += 1; continue; }
    hasOpenCapture     = true;
    openCaptured      += gl;
    openMarkedPremium += m.premiumCollected ?? 0;
  }

  let closedKept = 0, closedKeptPremium = 0, closedMissing = 0, closedPremium = 0;
  for (const m of closed) {
    closedPremium += m.premiumCollected ?? 0;
    if (m.keptPct == null) { closedMissing += 1; continue; }
    closedKept        += (m.premiumCollected ?? 0) * m.keptPct;
    closedKeptPremium += m.premiumCollected ?? 0;
  }

  const hasClosedCapture = closedKeptPremium > 0;
  const captured = hasOpenCapture || hasClosedCapture ? openCaptured + closedKept : null;
  const captureDenominator = openMarkedPremium + closedKeptPremium;

  return {
    memberCount: members.length,
    openCount: open.length,
    collateral,
    collateralPct: accountValue && open.length ? (collateral / accountValue) * 100 : null,
    maxPremium: openPremium + closedPremium,
    captured,
    capturePct: captured != null && captureDenominator > 0
      ? (captured / captureDenominator) * 100
      : null,
    missingMarkCount: openMissing + closedMissing,
  };
}

// Case-insensitive tuple match between a cohort member and a serialized
// snapshot row (daily_snapshots.forecast_per_position stores type as 'csp').
function snapMatch(member, snap) {
  return (
    member.ticker === snap.ticker &&
    String(member.type).toLowerCase() === String(snap.type).toLowerCase() &&
    String(member.strike) === String(snap.strike) &&
    String(member.expiry) === String(snap.expiry)
  );
}

/**
 * Premium-weighted cohort capture % per snapshot day.
 * Open members contribute current_profit_pct (fraction) weighted by
 * premium_at_open; closed members flatline at kept_pct from closeDate.
 * Days with no contributors are skipped; an all-closed cohort's series is
 * trimmed after the latest closeDate.
 * @param {Array} members - resolveCohort members
 * @param {Array<{date: string, members: Array}>} history - api/cohort-history data
 * @returns {Array<{date: string, capturePct: number}>}
 */
export function cohortCaptureSeries(members, history) {
  if (!members?.length || !history?.length) return [];

  const allClosed = members.every(m => m.status === "closed");
  const lastClose = allClosed
    ? members.reduce((max, m) => (m.closeDate && m.closeDate > max ? m.closeDate : max), "")
    : null;

  const series = [];
  for (const day of history) {
    if (lastClose && day.date > lastClose) continue;
    let num = 0, den = 0;
    for (const m of members) {
      if (m.status === "closed" && m.closeDate && day.date >= m.closeDate) {
        if (m.keptPct == null) continue;
        const w = m.premiumCollected ?? 0;
        num += m.keptPct * w;
        den += w;
        continue;
      }
      const snap = (day.members ?? []).find(s => snapMatch(m, s));
      if (!snap || snap.current_profit_pct == null) continue;
      const w = snap.premium_at_open ?? m.premiumCollected ?? 0;
      num += snap.current_profit_pct * w;
      den += w;
    }
    if (den > 0) series.push({ date: day.date, capturePct: (num / den) * 100 });
  }
  return series;
}
```

- [ ] **Step 2.4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/cohorts.test.js`
Expected: 18 tests pass.

- [ ] **Step 2.5: Run the FULL suite** (`npx vitest run`) — all green — **then commit**

```bash
git add src/lib/cohorts.js src/lib/__tests__/cohorts.test.js
git commit -m "Add cohort scoreboard and capture-series math"
```

---

### Task 3: Cohort history API endpoint (TDD on the pure part)

**Files:**
- Create: `api/_lib/cohortHistory.js`
- Test: `api/_lib/__tests__/cohort-history.test.js`
- Create: `api/cohort-history.js`

- [ ] **Step 3.1: Write the failing tests**

Create `api/_lib/__tests__/cohort-history.test.js`:

```js
import { describe, it, expect } from "vitest";
import { buildCohortHistory } from "../cohortHistory.js";

const tuple = { ticker: "CCJ", type: "CSP", strike: 107, expiry: "2026-06-26" };
const snapRow = (date, members) => ({ snapshot_date: date, forecast_per_position: members });
const pp = (over = {}) => ({
  ticker: "CCJ", type: "csp", strike: 107, expiry: "2026-06-26",
  current_profit_pct: 0.3, premium_at_open: 500, ...over,
});

describe("buildCohortHistory", () => {
  it("filters each day's per-position array to member tuples, case-insensitive type", () => {
    const out = buildCohortHistory(
      [snapRow("2026-06-01", [pp(), pp({ ticker: "ZZZ" })])],
      [tuple],
    );
    expect(out).toEqual([
      { date: "2026-06-01", members: [{ ticker: "CCJ", type: "csp", strike: 107, expiry: "2026-06-26", current_profit_pct: 0.3, premium_at_open: 500 }] },
    ]);
  });

  it("drops days with no matching members and tolerates null/garbage arrays", () => {
    const out = buildCohortHistory(
      [snapRow("2026-06-01", null), snapRow("2026-06-02", [pp({ ticker: "ZZZ" })]), snapRow("2026-06-03", [pp()])],
      [tuple],
    );
    expect(out.map(d => d.date)).toEqual(["2026-06-03"]);
  });

  it("matches strike loosely (string vs number) and returns [] for no members", () => {
    const out = buildCohortHistory([snapRow("2026-06-01", [pp({ strike: "107" })])], [tuple]);
    expect(out).toHaveLength(1);
    expect(buildCohortHistory([snapRow("2026-06-01", [pp()])], [])).toEqual([]);
  });
});
```

- [ ] **Step 3.2: Run to verify failure**

Run: `npx vitest run api/_lib/__tests__/cohort-history.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3.3: Implement the pure module**

Create `api/_lib/cohortHistory.js`:

```js
// Pure filter for the cohort-history endpoint: per-day snapshot rows → the
// subset matching a cohort's member tuples. Snapshot rows store type as
// lowercase 'csp' (serializePerPosition in computeForecastV2.js); journal
// entries/positions use 'CSP' — hence the case-insensitive compare.

function tupleMatches(member, row) {
  return (
    member.ticker === row.ticker &&
    String(member.type).toLowerCase() === String(row.type).toLowerCase() &&
    String(member.strike) === String(row.strike) &&
    String(member.expiry) === String(row.expiry)
  );
}

export function buildCohortHistory(snapshotRows, memberTuples) {
  if (!Array.isArray(memberTuples) || memberTuples.length === 0) return [];
  const out = [];
  for (const row of snapshotRows ?? []) {
    const perPosition = Array.isArray(row.forecast_per_position) ? row.forecast_per_position : [];
    const members = perPosition
      .filter(p => memberTuples.some(t => tupleMatches(t, p)))
      .map(p => ({
        ticker: p.ticker,
        type: p.type,
        strike: p.strike,
        expiry: p.expiry,
        current_profit_pct: p.current_profit_pct ?? null,
        premium_at_open: p.premium_at_open ?? null,
      }));
    if (members.length > 0) out.push({ date: row.snapshot_date, members });
  }
  return out;
}
```

- [ ] **Step 3.4: Run to verify pass**

Run: `npx vitest run api/_lib/__tests__/cohort-history.test.js`
Expected: 3 tests pass.

- [ ] **Step 3.5: Create the endpoint**

Create `api/cohort-history.js`:

```js
/**
 * GET /api/cohort-history?tag=cohort:<slug>
 *
 * Resolves the cohort's member tuples server-side (journal entries carrying
 * the tag) and returns per-day capture data from daily_snapshots'
 * forecast_per_position: [{date, members: [{ticker, type, strike, expiry,
 * current_profit_pct, premium_at_open}]}]. Auth: covered by middleware.js
 * (matcher /api/:path*) like every other endpoint.
 */

import { createClient } from "@supabase/supabase-js";
import { buildCohortHistory } from "./_lib/cohortHistory.js";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars");
  return createClient(url, key);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  const tag = String(req.query.tag ?? "");
  if (!/^cohort:[a-z0-9-]+$/.test(tag)) {
    res.status(400).json({ ok: false, error: "Invalid cohort tag" });
    return;
  }

  try {
    const supabase = getSupabase();

    const { data: entries, error: entriesErr } = await supabase
      .from("journal_entries")
      .select("ticker, type, strike, expiry")
      .contains("tags", [tag]);
    if (entriesErr) throw new Error(entriesErr.message);

    const { data: snaps, error: snapsErr } = await supabase
      .from("daily_snapshots")
      .select("snapshot_date, forecast_per_position")
      .not("forecast_per_position", "is", null)
      .order("snapshot_date", { ascending: true });
    if (snapsErr) throw new Error(snapsErr.message);

    const data = buildCohortHistory(snaps ?? [], entries ?? []);
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.status(200).json({ ok: true, data });
  } catch (err) {
    console.error("[api/cohort-history] Error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}
```

- [ ] **Step 3.6: Full suite + build, then commit**

Run: `npx vitest run` (all green) and `npm run build` (clean).

```bash
git add api/_lib/cohortHistory.js api/_lib/__tests__/cohort-history.test.js api/cohort-history.js
git commit -m "Add cohort-history endpoint over daily snapshot per-position data"
```

---

### Task 4: Save-as-cohort UI in CspSelectionBar

**Files:**
- Modify: `src/components/CspSelectionBar.jsx`

The bar gains an optional `onSaveCohort(name) → Promise` prop. When present, a `Save as cohort` button renders before the ✕ clear (the reserved slot). Clicking it swaps in an inline name input; Enter saves (the parent clears the selection on success, unmounting the bar), Escape cancels, errors render inline without clearing the selection. No unit test (presentational; save logic lives in Task 6's handler) — verify via build.

- [ ] **Step 4.1: Add state + save control**

In `src/components/CspSelectionBar.jsx`, add at the top of the file (after imports):

```jsx
import { useState } from "react";
```

Replace the component's signature and add state + handlers right after the early return:

```jsx
export function CspSelectionBar({ agg, isMobile, onClear, onSaveCohort }) {
  if (!agg || agg.count === 0) return null;
```
becomes:
```jsx
export function CspSelectionBar({ agg, isMobile, onClear, onSaveCohort }) {
  const [naming, setNaming]   = useState(false);
  const [name, setName]       = useState("");
  const [saving, setSaving]   = useState(false);
  const [saveError, setSaveError] = useState(null);

  if (!agg || agg.count === 0) return null;

  async function handleSave() {
    if (saving || !name.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSaveCohort(name);
      setNaming(false);
      setName("");
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }
```

(React hooks must be called before any conditional return — note the state lines go ABOVE the `if (!agg…) return null;` line, exactly as shown.)

- [ ] **Step 4.2: Build the save control element** — add after the `clearBtn` definition:

```jsx
  const saveControl = onSaveCohort && (
    naming ? (
      <span style={{ display: "flex", alignItems: "center", gap: theme.space[2] }}>
        <input
          autoFocus
          value={name}
          disabled={saving}
          placeholder="cohort name"
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") { setNaming(false); setName(""); setSaveError(null); }
          }}
          style={{
            background: theme.bg.surface, color: theme.text.primary,
            border: `1px solid ${BAR_BORDER}`, borderRadius: theme.radius.sm,
            padding: "3px 8px", fontSize: theme.size.sm, fontFamily: "inherit", width: 140,
          }}
        />
        <button
          onClick={handleSave}
          disabled={saving || !name.trim()}
          style={{
            background: "transparent", border: "none", padding: 0,
            color: theme.blue, cursor: saving ? "default" : "pointer",
            fontSize: theme.size.sm, fontFamily: "inherit", whiteSpace: "nowrap",
            opacity: saving || !name.trim() ? 0.5 : 1,
          }}
        >
          {saving ? "saving…" : "save"}
        </button>
        {saveError && (
          <span style={{ fontSize: theme.size.xs, color: theme.red, whiteSpace: "nowrap" }}>{saveError}</span>
        )}
      </span>
    ) : (
      <button
        onClick={() => setNaming(true)}
        style={{
          background: "transparent", border: "none", padding: 0,
          color: theme.blue, cursor: "pointer",
          fontSize: theme.size.sm, fontFamily: "inherit", whiteSpace: "nowrap",
        }}
      >
        ⊕ Save as cohort
      </button>
    )
  );
```

- [ ] **Step 4.3: Place it in both layouts**

Desktop return — insert `{saveControl}` between `{markNote}` and `{clearBtn}`:
```jsx
      {markNote}
      {saveControl}
      {clearBtn}
```

Mobile return — add a third line after the stat grid `</div>` (inside the shell div):
```jsx
        {saveControl && (
          <div style={{ marginTop: theme.space[2], display: "flex", justifyContent: "flex-end" }}>
            {saveControl}
          </div>
        )}
```

- [ ] **Step 4.4: Verify and commit**

Run: `npm run build` — clean (prop unused until Task 6; existing callers pass no `onSaveCohort`, button hidden, behavior unchanged). `npx vitest run` — green.

```bash
git add src/components/CspSelectionBar.jsx
git commit -m "Add save-as-cohort control to selection bar"
```

---

### Task 5: CohortsPanel (list + detail + chart)

**Files:**
- Create: `src/components/CohortsPanel.jsx`

Presentational + fetch component. No unit test (math is in tested libs); verified via build, post-deploy browser.

- [ ] **Step 5.1: Create the component** with this content:

```jsx
import { useEffect, useMemo, useState } from "react";
import { theme } from "../lib/theme";
import { formatDollarsFull, formatExpiry } from "../lib/format";
import { resolveCohort, cohortScoreboard, memberCapturePct, cohortCaptureSeries } from "../lib/cohorts";

const BLUE_BORDER = "rgba(58,130,246,0.40)";

function labelStyle() {
  return {
    fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase",
    letterSpacing: "0.5px", fontWeight: 500, marginBottom: 2,
  };
}

function Stat({ label, value, color }) {
  return (
    <div>
      <div style={labelStyle()}>{label}</div>
      <div style={{ fontSize: theme.size.md, fontWeight: 600, color: color ?? theme.text.primary, whiteSpace: "nowrap" }}>
        {value}
      </div>
    </div>
  );
}

function StatusBadge({ openCount, memberCount }) {
  const allClosed = openCount === 0;
  return (
    <span style={{
      fontSize: theme.size.xs, borderRadius: theme.radius.pill, padding: "1px 8px",
      color: allClosed ? theme.text.muted : theme.green,
      border: `1px solid ${allClosed ? theme.border.default : `${theme.green}66`}`,
      background: allClosed ? "transparent" : `${theme.green}18`,
      whiteSpace: "nowrap",
    }}>
      {allClosed ? "closed" : `${openCount} open${memberCount > openCount ? ` · ${memberCount - openCount} closed` : ""}`}
    </span>
  );
}

// Hand-rolled SVG line, same spirit as the allocation chart — no chart library.
function EvolutionChart({ series }) {
  if (!series.length) {
    return (
      <div style={{ padding: theme.space[3], color: theme.text.subtle, fontSize: theme.size.sm }}>
        No history yet — the chart fills in as daily snapshots accumulate.
      </div>
    );
  }
  const W = 600, H = 140, PAD = 6;
  const ys = series.map(p => p.capturePct);
  const yMin = Math.min(0, ...ys), yMax = Math.max(100, ...ys);
  const x = i => series.length === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (series.length - 1);
  const y = v => H - PAD - ((v - yMin) * (H - 2 * PAD)) / (yMax - yMin || 1);
  const points = series.map((p, i) => `${x(i)},${y(p.capturePct)}`).join(" ");
  const last = series[series.length - 1];
  return (
    <div>
      <div style={{ ...labelStyle(), marginBottom: theme.space[1] }}>
        Capture % over time — now {last.capturePct.toFixed(1)}%
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
        <line x1={PAD} x2={W - PAD} y1={y(0)} y2={y(0)} stroke={theme.border.strong} strokeWidth="1" />
        <line x1={PAD} x2={W - PAD} y1={y(100)} y2={y(100)} stroke={theme.border.default} strokeWidth="1" strokeDasharray="4 4" />
        <polyline points={points} fill="none" stroke={theme.blue} strokeWidth="2" />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: theme.size.xs, color: theme.text.subtle }}>
        <span>{series[0].date}</span>
        <span>0% — solid · 100% — dashed</span>
        <span>{last.date}</span>
      </div>
    </div>
  );
}

function CohortDetail({ cohort, quoteMap, isMobile, onBack, onDelete, deleting }) {
  const { tag, name, members, unresolved, createdAt, scoreboard: sb } = cohort;
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    setHistoryError(null);
    (async () => {
      try {
        const res = await fetch(`/api/cohort-history?tag=${encodeURIComponent(tag)}`);
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
        if (!cancelled) setHistory(json.data ?? []);
      } catch (err) {
        if (!cancelled) setHistoryError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [tag]);

  const series = useMemo(
    () => (history ? cohortCaptureSeries(members, history) : []),
    [history, members],
  );

  const capturedColor = sb.captured == null ? theme.text.muted : sb.captured >= 0 ? theme.green : theme.red;

  const cell = (content, style = {}) => (
    <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, ...style }}>{content}</td>
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: theme.space[2], marginBottom: theme.space[3], flexWrap: "wrap" }}>
        <button
          onClick={onBack}
          style={{ background: "transparent", border: "none", padding: 0, color: theme.text.muted, cursor: "pointer", fontSize: theme.size.sm, fontFamily: "inherit" }}
        >
          ← Cohorts
        </button>
        <span style={{ color: theme.blue, fontWeight: 700, fontSize: theme.size.md }}>{name}</span>
        {createdAt && (
          <span style={{ color: theme.text.subtle, fontSize: theme.size.xs }}>
            created {String(createdAt).slice(0, 10)}
          </span>
        )}
        <button
          onClick={onDelete}
          disabled={deleting}
          style={{ marginLeft: "auto", background: "transparent", border: "none", padding: 0, color: theme.red, cursor: "pointer", fontSize: theme.size.sm, fontFamily: "inherit", opacity: deleting ? 0.5 : 1 }}
        >
          {deleting ? "deleting…" : "✕ delete"}
        </button>
      </div>

      <div style={{
        display: "flex", gap: theme.space[5], flexWrap: "wrap",
        background: theme.bg.elevated, border: `1px solid ${BLUE_BORDER}`,
        borderRadius: theme.radius.md, padding: `${theme.space[2]}px ${theme.space[4]}px`,
        marginBottom: theme.space[4],
      }}>
        <Stat label="Members" value={`${sb.memberCount} (${sb.openCount} open)`} color={theme.blue} />
        <Stat
          label="Collateral"
          value={<>
            {formatDollarsFull(sb.collateral)}
            {sb.collateralPct != null && (
              <span style={{ color: theme.text.muted, fontWeight: 400 }}> ({sb.collateralPct.toFixed(1)}%)</span>
            )}
          </>}
        />
        <Stat label="Max premium" value={formatDollarsFull(sb.maxPremium)} color={theme.green} />
        <Stat
          label="Captured"
          value={<>
            {sb.captured != null ? formatDollarsFull(sb.captured) : "—"}
            {sb.capturePct != null && (
              <span style={{ color: theme.text.muted, fontWeight: 400 }}> ({sb.capturePct.toFixed(1)}%)</span>
            )}
          </>}
          color={capturedColor}
        />
        {sb.missingMarkCount > 0 && (
          <span style={{ alignSelf: "center", fontSize: theme.size.xs, color: theme.text.subtle }}>
            *{sb.missingMarkCount} no mark
          </span>
        )}
      </div>

      <div style={{ overflowX: "auto", marginBottom: theme.space[4] }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: theme.size.md }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${theme.border.strong}` }}>
              {["Member", "Status", "Premium", "Capture"].map(h => (
                <th key={h} style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, fontSize: theme.size.xs, color: theme.text.muted, fontWeight: 500, letterSpacing: "0.5px", textAlign: h === "Member" ? "left" : "right", textTransform: "uppercase" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohort.members.map((m, i) => {
              const cap = memberCapturePct(m, quoteMap);
              const capColor = cap == null ? theme.text.muted : cap >= 0 ? theme.green : theme.red;
              return (
                <tr key={i} style={{ borderBottom: `1px solid ${theme.border.default}` }}>
                  {cell(
                    <span style={{ fontWeight: 700, color: theme.text.primary }}>
                      {m.ticker} ${m.strike} {!isMobile && m.expiry ? formatExpiry(m.expiry) : ""}
                    </span>
                  )}
                  {cell(
                    m.status === "open"
                      ? <span style={{ color: theme.green }}>open</span>
                      : <span style={{ color: theme.text.muted }}>closed {m.closeDate ? String(m.closeDate).slice(5) : ""}</span>,
                    { textAlign: "right" }
                  )}
                  {cell(formatDollarsFull(m.premiumCollected), { color: theme.green, fontWeight: 600, textAlign: "right" })}
                  {cell(cap != null ? `${cap.toFixed(1)}%` : "—", { color: capColor, fontWeight: 600, textAlign: "right" })}
                </tr>
              );
            })}
            {cohort.unresolved.map((u, i) => (
              <tr key={`u-${i}`} style={{ borderBottom: `1px solid ${theme.border.default}` }}>
                {cell(<span style={{ color: theme.text.muted }}>{u.ticker} ${u.strike}</span>)}
                {cell(<span style={{ color: theme.amber, fontSize: theme.size.sm }}>unresolved</span>, { textAlign: "right" })}
                {cell("—", { textAlign: "right", color: theme.text.muted })}
                {cell("—", { textAlign: "right", color: theme.text.muted })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {historyError
        ? <div style={{ color: theme.text.subtle, fontSize: theme.size.sm }}>History unavailable: {historyError}</div>
        : history == null
          ? <div style={{ color: theme.text.subtle, fontSize: theme.size.sm }}>Loading history…</div>
          : <EvolutionChart series={series} />}
    </div>
  );
}

/**
 * Cohort list + detail. Mounted by OpenPositionsTab when the Cohorts pill is
 * active. Membership source of truth: journal entries with cohort:* tags.
 */
export function CohortsPanel({ cohortEntries, openCsps, trades, quoteMap, accountValue, isMobile, selectedTag, onSelectTag, onCohortsChanged }) {
  const [deleting, setDeleting] = useState(false);

  const cohorts = useMemo(() => {
    const tags = [...new Set(
      cohortEntries.flatMap(e => (e.tags ?? []).filter(t => t.startsWith("cohort:")))
    )];
    return tags.map(tag => {
      const resolved = resolveCohort(tag, { openPositions: openCsps, trades, entries: cohortEntries });
      return {
        tag,
        name: tag.slice("cohort:".length),
        ...resolved,
        scoreboard: cohortScoreboard(resolved.members, quoteMap, accountValue),
      };
    }).sort((a, b) => {
      const aActive = a.scoreboard.openCount > 0 ? 0 : 1;
      const bActive = b.scoreboard.openCount > 0 ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""));
    });
  }, [cohortEntries, openCsps, trades, quoteMap, accountValue]);

  const selected = cohorts.find(c => c.tag === selectedTag) ?? null;

  async function handleDelete() {
    if (!selected) return;
    if (!window.confirm(`Delete cohort "${selected.name}"? This removes its tag from ${selected.members.length + selected.unresolved.length} journal entr${selected.members.length + selected.unresolved.length === 1 ? "y" : "ies"}.`)) return;
    setDeleting(true);
    try {
      const memberEntries = cohortEntries.filter(e => (e.tags ?? []).includes(selected.tag));
      for (const e of memberEntries) {
        const newTags = e.tags.filter(t => t !== selected.tag);
        if (newTags.length === 0) {
          const res = await fetch(`/api/journal-entry?id=${encodeURIComponent(e.id)}`, { method: "DELETE" });
          const json = await res.json();
          if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
        } else {
          // NEVER include `source` in PATCH fields — the API propagates it to positions.
          const res = await fetch("/api/journal-entry", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: e.id, fields: { tags: newTags, updated_at: new Date().toISOString() } }),
          });
          const json = await res.json();
          if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
        }
      }
      onSelectTag(null);
      onCohortsChanged();
    } catch (err) {
      window.alert(`Delete failed: ${err.message}`);
    } finally {
      setDeleting(false);
    }
  }

  if (selected) {
    return (
      <CohortDetail
        cohort={selected}
        quoteMap={quoteMap}
        isMobile={isMobile}
        onBack={() => onSelectTag(null)}
        onDelete={handleDelete}
        deleting={deleting}
      />
    );
  }

  if (!cohorts.length) {
    return (
      <div style={{ fontSize: theme.size.sm, color: theme.text.subtle, padding: "12px 0" }}>
        No cohorts yet. Select CSP rows and use "Save as cohort" in the selection bar.
      </div>
    );
  }

  return (
    <div>
      {cohorts.map(c => {
        const sb = c.scoreboard;
        const capColor = sb.captured == null ? theme.text.muted : sb.captured >= 0 ? theme.green : theme.red;
        return (
          <div
            key={c.tag}
            onClick={() => onSelectTag(c.tag)}
            style={{
              display: "flex", alignItems: "baseline", gap: theme.space[3], flexWrap: "wrap",
              padding: `${theme.space[2]}px 0`, borderBottom: `1px solid ${theme.border.default}`,
              cursor: "pointer",
            }}
          >
            <span style={{ color: theme.blue, fontWeight: 700 }}>{c.name}</span>
            <StatusBadge openCount={sb.openCount} memberCount={sb.memberCount} />
            <span style={{ color: theme.text.muted, fontSize: theme.size.sm }}>
              {sb.capturePct != null ? `capture ${sb.capturePct.toFixed(0)}%` : "capture —"}
            </span>
            <span style={{ color: capColor, fontWeight: 600 }}>
              {sb.captured != null ? formatDollarsFull(sb.captured) : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5.2: Verify and commit**

Run: `npm run build` (component not yet imported — syntax check) and `npx vitest run`.

```bash
git add src/components/CohortsPanel.jsx
git commit -m "Add CohortsPanel list and detail views with evolution chart"
```

---

### Task 6: OpenPositionsTab integration

**Files:**
- Modify: `src/components/OpenPositionsTab.jsx`

- [ ] **Step 6.1: Imports** — after `import { CspSelectionBar } from "./CspSelectionBar";` add:

```js
import { CohortsPanel } from "./CohortsPanel";
import { slugifyCohortName } from "../lib/cohorts";
```

- [ ] **Step 6.2: Trades from context** — change:
```js
  const { positions, account, cspEntryYieldBenchmark } = useData();
```
to:
```js
  const { positions, account, cspEntryYieldBenchmark, trades } = useData();
```

- [ ] **Step 6.3: Cohort state + entry fetch** — after the `selectedKeys` state declaration, add:

```js
  // ── Cohorts (tag-based; journal entries are the source of truth) ──────────
  const [selectedCohortTag, setSelectedCohortTag] = useState(null);
  const [cohortEntries, setCohortEntries] = useState([]);
  const [cohortRefreshKey, setCohortRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await listJournalEntries({ hasTags: "1" });
        if (cancelled) return;
        setCohortEntries((data ?? []).filter(e =>
          Array.isArray(e.tags) && e.tags.some(t => typeof t === "string" && t.startsWith("cohort:"))
        ));
      } catch (err) {
        if (cancelled) return;
        console.warn("[OpenPositionsTab] cohort entry fetch failed:", err.message);
        setCohortEntries([]);
      }
    })();
    return () => { cancelled = true; };
  }, [cohortRefreshKey]);

  const cohortCount = new Set(
    cohortEntries.flatMap(e => (e.tags ?? []).filter(t => t.startsWith("cohort:")))
  ).size;
```

- [ ] **Step 6.4: Save handler** — add after the block above:

```js
  // Writes one journal entry per selected CSP with the cohort tag, mirroring
  // the JournalQuickAdd POST payload. `source` stays null — a non-null source
  // would propagate to the linked position via the API.
  async function handleSaveCohort(name) {
    const slug = slugifyCohortName(name);
    if (!slug) throw new Error("Name needs letters or digits");
    const tag = `cohort:${slug}`;
    const selected = open_csps.filter(p => selectedKeys.has(positionKey(p)));
    if (!selected.length) throw new Error("Nothing selected");
    const now = new Date().toISOString();
    for (const pos of selected) {
      const payload = {
        trade_id: null,
        position_id: pos.id ?? null,
        entry_date: now.slice(0, 10),
        ticker: pos.ticker,
        type: pos.type,
        strike: pos.strike,
        expiry: pos.expiry_date,
        title: `Cohort: ${slug}`,
        body: "",
        tags: [tag],
        source: null,
        mood: null,
        metadata: null,
        focus_snapshot: null,
        created_at: now,
        updated_at: now,
      };
      const resp = await fetch("/api/journal-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok || !json?.ok) throw new Error(json?.error || `HTTP ${resp.status}`);
    }
    setCohortRefreshKey(k => k + 1);
    setSelectedKeys(new Set());
  }
```

- [ ] **Step 6.5: Refresh row chips after cohort changes** — the strategic-tags effect (the one calling `groupStrategicTagsByPosition`) has dependency array `[open_csps, open_leaps, assigned_shares]`. Change it to:
```js
  }, [open_csps, open_leaps, assigned_shares, cohortRefreshKey]);
```

- [ ] **Step 6.6: Fourth pill** — change:
```js
  const positionTabs = [
    { key: "csps",  label: `CSPs (${open_csps.length})`,      rows: open_csps     },
    { key: "ccs",   label: `CCs (${open_ccs.length})`,        rows: open_ccs      },
    { key: "leaps", label: `LEAPs (${allOpenLeaps.length})`,  rows: allOpenLeaps  },
  ];
```
to:
```js
  const positionTabs = [
    { key: "csps",    label: `CSPs (${open_csps.length})`,      rows: open_csps     },
    { key: "ccs",     label: `CCs (${open_ccs.length})`,        rows: open_ccs      },
    { key: "leaps",   label: `LEAPs (${allOpenLeaps.length})`,  rows: allOpenLeaps  },
    { key: "cohorts", label: `Cohorts (${cohortCount})`,        rows: []            },
  ];
```

- [ ] **Step 6.7: Tab switch also resets the cohort detail** — change the pill onClick:
```jsx
                  onClick={() => { setPositionTab(t.key); setSelectedKeys(new Set()); }}
```
to:
```jsx
                  onClick={() => { setPositionTab(t.key); setSelectedKeys(new Set()); setSelectedCohortTag(null); }}
```

- [ ] **Step 6.8: Render the panel** — replace the `<PositionsTable …/>` element with a conditional:

```jsx
          {positionTab === "cohorts" ? (
            <CohortsPanel
              cohortEntries={cohortEntries}
              openCsps={open_csps}
              trades={trades}
              quoteMap={quoteMap}
              accountValue={account?.account_value ?? null}
              isMobile={isMobile}
              selectedTag={selectedCohortTag}
              onSelectTag={setSelectedCohortTag}
              onCohortsChanged={() => setCohortRefreshKey(k => k + 1)}
            />
          ) : (
            <PositionsTable
              rows={activeTab?.rows ?? []}
              positionType={positionTab}
              quoteMap={quoteMap}
              cspEntryYieldBenchmark={cspEntryYieldBenchmark}
              selectable={positionTab === "csps"}
              selectedKeys={selectedKeys}
              setSelectedKeys={setSelectedKeys}
              accountValue={account?.account_value ?? null}
              onSaveCohort={handleSaveCohort}
              isMobile={isMobile}
              highlightedTicker={highlightedTicker}
              onOpenTickerDetail={onOpenTickerDetail}
              strategicTagsByPos={strategicTagsByPos}
              onShowJournalEntry={onShowJournalEntry}
              onTagPosition={onTagPosition}
              onOpenBasket={onOpenBasket}
            />
          )}
```

- [ ] **Step 6.9: Thread onSaveCohort and onOpenCohort through PositionsTable** —
extend the `PositionsTable` signature with BOTH new callbacks (after `accountValue`):
```js
function PositionsTable({ rows, positionType, quoteMap, cspEntryYieldBenchmark, isMobile, highlightedTicker, onOpenTickerDetail, strategicTagsByPos, onShowJournalEntry, onTagPosition, onOpenBasket, selectable, selectedKeys, setSelectedKeys, accountValue, onSaveCohort, onOpenCohort }) {
```
Pass `onSaveCohort` to the bar:
```jsx
        <CspSelectionBar
          agg={selectionAgg}
          isMobile={isMobile}
          onClear={() => setSelectedKeys(new Set())}
          onSaveCohort={onSaveCohort}
        />
```
And add the two props to the `<PositionsTable …/>` JSX from Step 6.8, after `onSaveCohort={handleSaveCohort}`:
```jsx
              onOpenCohort={(tag) => { setPositionTab("cohorts"); setSelectedKeys(new Set()); setSelectedCohortTag(tag); }}
```

- [ ] **Step 6.10: Route cohort chips** — in the row's `PositionTagChip` onClick chain (inside `PositionsTable`), change:
```jsx
                            onClick={
                              t.tag.startsWith("strategy:") && onOpenBasket
                                ? () => onOpenBasket(t.tag)
                                : () => onShowJournalEntry?.(t.entryId)
                            }
```
to:
```jsx
                            onClick={
                              t.tag.startsWith("cohort:") && onOpenCohort
                                ? () => onOpenCohort(t.tag)
                                : t.tag.startsWith("strategy:") && onOpenBasket
                                ? () => onOpenBasket(t.tag)
                                : () => onShowJournalEntry?.(t.entryId)
                            }
```

- [ ] **Step 6.11: Verify**

Run: `npx vitest run` — full suite green.
Run: `npm run build` — clean.

- [ ] **Step 6.12: Commit**

```bash
git add src/components/OpenPositionsTab.jsx
git commit -m "Wire cohorts into Open Positions: pill, save flow, chip routing"
```

---

### Task 7: Version bump, PR, merge

- [ ] **Step 7.1: Baseline from origin/main (NEVER the local file)**

```bash
git fetch origin && git show origin/main:package.json | grep '"version"'
```
Expected: `1.125.1` or later — increment the MINOR from whatever it shows (e.g. `1.126.0`).

- [ ] **Step 7.2: Bump in BOTH files** — `package.json` `"version"` AND `export const VERSION` in `src/lib/constants.js`; run `npm install --package-lock-only` to sync the lockfile.

- [ ] **Step 7.3: Final verification** — `npx vitest run && npm run build`, all green.

- [ ] **Step 7.4: Commit, push, PR, merge immediately** (user's standing workflow):

```bash
git add package.json package-lock.json src/lib/constants.js
git commit -m "Bump version to <bumped>"
git push -u origin feat/csp-cohorts
/opt/homebrew/bin/gh pr create --title "CSP cohorts (v<bumped>)" --body "Save a CSP selection as a named cohort (cohort:<slug> journal tags), browse via a Cohorts pill on Open Positions, roster-forward detail with scoreboard and capture-over-time chart from daily snapshot history. Spec: docs/superpowers/specs/2026-06-11-csp-cohorts-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
/opt/homebrew/bin/gh pr merge --squash
```
Report the PR URL and version.

---

## Spec coverage map

| Spec requirement | Task |
|---|---|
| Tag-based storage, tuple resolution incl. MM/DD gotcha | 1 |
| Slugified names, merge-on-duplicate-save | 1, 6.4 |
| Scoreboard (open-only collateral, realized+unrealized capture) | 2 |
| Evolution series (current_profit_pct, premium-weighted, flatline, trim) | 2, 3 |
| `api/cohort-history.js` server-side member resolution | 3 |
| Save flow in selection bar (inline name, error keeps selection) | 4, 6.4 |
| 4th pill `Cohorts (n)` | 6.3, 6.6 |
| List: badges, capture, active-first sort | 5 |
| Detail: breadcrumb, created date, delete (untag/DELETE, no `source`) | 5 |
| Roster with unresolved badge | 5 |
| Chart: SVG, no-history placeholder | 5 |
| Cohort chips on rows → detail | 6.10 |
| Tab switch clears selection + cohort detail | 6.7 |
| No tag_vocabulary involvement | 6.4 (free-form tags) |
| Mobile single-column | 5 (flex-wrap layouts), 4.3 |
| Version bump from origin/main | 7 |

# Per-Position Capture Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the capture-%-over-time chart inside the expand panel of individual CSP and CC positions, hidden until ≥5 snapshot days of history exist.

**Architecture:** Extract the existing `EvolutionChart` into its own file so two consumers can share it. A thin `api/position-history.js` (reusing the tested `buildCohortHistory`) returns one position's per-day snapshot rows; a new `PositionHistoryPanel` fetches lazily on expand, builds a single-member series via the existing `cohortCaptureSeries`, and renders the chart only past the threshold.

**Tech Stack:** React 18, hand-rolled SVG, inline theme styles, vitest, Vercel serverless (Supabase). Spec: `docs/superpowers/specs/2026-06-13-per-position-capture-chart-design.md`.

**Inline execution note:** All work happens in a dedicated worktree on branch `feat/position-capture-chart`. Steps are ordered so the suite/build stay green at each commit.

---

## Codebase facts (verified 2026-06-13, main @ v1.126.2)

- `cohortCaptureSeries(members, history)` (`src/lib/cohorts.js`, exported) → `[{date, capturePct}]`. For a single open member it yields that member's `current_profit_pct × 100` per day; the all-closed trim/flatline branch is skipped for an open member.
- `EvolutionChart` currently lives **inside** `src/components/CohortsPanel.jsx` (lines ~42–134), not exported. It depends on a local `labelStyle()` helper (lines 9–14) and `niceTicks` (`src/lib/chartTicks.js`).
- `buildCohortHistory(snapshotRows, memberTuples)` (`api/_lib/cohortHistory.js`, exported, tested) filters `daily_snapshots.forecast_per_position` rows to the given tuples (case-insensitive type, loose strike). Returns `[{date, members:[{ticker,type,strike,expiry,current_profit_pct,premium_at_open}]}]`.
- `api/cohort-history.js` is the endpoint pattern to mirror: `getSupabase()` env chain (`SUPABASE_URL||VITE_SUPABASE_URL`, `SUPABASE_SERVICE_KEY||SUPABASE_ANON_KEY||VITE_SUPABASE_ANON_KEY`), 405 on non-GET, query-param validation → 400, scans `daily_snapshots.select("snapshot_date, forecast_per_position").not(...).order(asc)`, no-cache headers, `{ok,data}` / `{ok:false,error}`.
- Expanded-row panels in `OpenPositionsTab.jsx` render in a `<td colSpan…>` (~lines 888–894): `CushionPanel`, `HoldYieldPanel`, `PriceTargetPanel`. `canExpand = !isLeap`, so CSP and CC rows both reach this block; LEAPs never expand. `pos` carries `ticker`, `type` (`"CSP"`/`"CC"`), `strike`, `expiry_date`, `premium_collected`, `contracts`.
- Tests: `npx vitest run`. Build: `npm run build`. Local dev does NOT serve `/api/*` — verification is vitest + build; chart verified post-deploy.

---

### Task 0: Branch

- [ ] Create worktree `.worktrees/position-capture-chart` on branch `feat/position-capture-chart` from `origin/main`; `npm install`; `npx vitest run` to confirm baseline green (493 tests).

---

### Task 1: Single-member series test (TDD, locks the reuse contract)

**Files:**
- Test: `src/lib/__tests__/cohorts.test.js` (append one case to the existing `describe("cohortCaptureSeries")`)

- [ ] **Step 1.1: Add the test** — inside `describe("cohortCaptureSeries", …)` append:

```js
  it("yields a single open member's own current_profit_pct line", () => {
    const m = openMember(); // CCJ 107, premium 500
    const history = [
      { date: "2026-06-01", members: [snap("CCJ", 107, "2026-06-26", 0.12, 500)] },
      { date: "2026-06-02", members: [snap("CCJ", 107, "2026-06-26", -0.30, 500)] },
    ];
    const series = cohortCaptureSeries([m], history);
    expect(series).toEqual([
      { date: "2026-06-01", capturePct: 12 },
      { date: "2026-06-02", capturePct: -30 },
    ]);
  });
```
(`openMember` and `snap` helpers already exist in this file from the cohort tests.)

- [ ] **Step 1.2: Run** — `npx vitest run src/lib/__tests__/cohorts.test.js` — PASS (this documents existing behavior; if it fails, stop — the reuse assumption is wrong). Expect 24 passing.

- [ ] **Step 1.3: Commit**

```bash
git add src/lib/__tests__/cohorts.test.js
git commit -m "Pin single-member capture series behavior"
```

---

### Task 2: Extract EvolutionChart into its own file

**Files:**
- Create: `src/components/EvolutionChart.jsx`
- Modify: `src/components/CohortsPanel.jsx` (remove the inline component + its now-unused import usage)

- [ ] **Step 2.1: Create `src/components/EvolutionChart.jsx`** with this exact content (the current component verbatim, plus its own imports and a local `labelStyle`, exported):

```jsx
import { useState } from "react";
import { theme } from "../lib/theme";
import { niceTicks } from "../lib/chartTicks";

function labelStyle() {
  return {
    fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase",
    letterSpacing: "0.5px", fontWeight: 500, marginBottom: 2,
  };
}

// Hand-rolled SVG line, same spirit as the allocation chart — no chart library.
// Y-domain fits the data (0-anchored); hover/tap shows the nearest point.
export function EvolutionChart({ series }) {
  const [activeIdx, setActiveIdx] = useState(null);

  if (!series.length) {
    return (
      <div style={{ padding: theme.space[3], color: theme.text.subtle, fontSize: theme.size.sm }}>
        No history yet — the chart fills in as daily snapshots accumulate.
      </div>
    );
  }

  const W = 600, H = 150, PAD = 10, GUTTER = 40;
  const plotW = W - GUTTER - PAD;
  const ys = series.map(p => p.capturePct);
  const { ticks, domainMin, domainMax } = niceTicks(Math.min(...ys), Math.max(...ys));

  const x = i => series.length === 1 ? GUTTER + plotW / 2 : GUTTER + (i * plotW) / (series.length - 1);
  const y = v => H - PAD - ((v - domainMin) * (H - 2 * PAD)) / (domainMax - domainMin || 1);
  const points = series.map((p, i) => `${x(i)},${y(p.capturePct)}`).join(" ");
  const last = series[series.length - 1];
  const showMaxLine = domainMax >= 100;

  function handlePointer(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) * W) / rect.width;
    if (series.length === 1) { setActiveIdx(0); return; }
    const idx = Math.round(((svgX - GUTTER) / plotW) * (series.length - 1));
    setActiveIdx(Math.max(0, Math.min(series.length - 1, idx)));
  }

  const active = activeIdx != null ? series[activeIdx] : null;
  const fmtPct = v => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
  const midIdx = Math.floor((series.length - 1) / 2);

  return (
    <div>
      <div style={{ ...labelStyle(), marginBottom: theme.space[1] }}>
        Capture % over time — now {last.capturePct.toFixed(1)}%
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block", touchAction: "none" }}
        onPointerMove={handlePointer}
        onPointerDown={handlePointer}
        onPointerLeave={() => setActiveIdx(null)}
      >
        {ticks.map(t => (
          <g key={t}>
            <line
              x1={GUTTER} x2={W - PAD} y1={y(t)} y2={y(t)}
              stroke={t === 0 ? theme.border.strong : theme.border.default}
              strokeWidth="1"
            />
            <text
              x={GUTTER - 6} y={y(t) + 2.5}
              textAnchor="end"
              style={{ fontSize: 7.5, fill: theme.text.muted, fontFamily: theme.font.mono }}
            >
              {t}%
            </text>
          </g>
        ))}
        {showMaxLine && (
          <line x1={GUTTER} x2={W - PAD} y1={y(100)} y2={y(100)} stroke={theme.border.default} strokeWidth="1" strokeDasharray="4 4" />
        )}
        <polyline points={points} fill="none" stroke={theme.blue} strokeWidth="2" />
        {series.length === 1 && (
          <circle cx={x(0)} cy={y(series[0].capturePct)} r="3" fill={theme.blue} />
        )}
        {active && (
          <g>
            <circle cx={x(activeIdx)} cy={y(active.capturePct)} r="4" fill={theme.blue} stroke={theme.bg.surface} strokeWidth="1.5" />
            <text
              x={x(activeIdx) + (activeIdx < series.length / 2 ? 8 : -8)}
              y={Math.max(y(active.capturePct) - 8, 12)}
              textAnchor={activeIdx < series.length / 2 ? "start" : "end"}
              style={{ fontSize: 9, fill: theme.text.primary, fontFamily: theme.font.mono, fontWeight: 600 }}
            >
              {active.date.slice(5)} · {fmtPct(active.capturePct)}
            </text>
          </g>
        )}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", paddingLeft: GUTTER / 6, fontSize: theme.size.xs, color: theme.text.subtle }}>
        <span>{series[0].date}</span>
        {series.length >= 3 && <span>{series[midIdx].date}</span>}
        <span>{last.date}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2.2: Remove the inline `EvolutionChart` from `CohortsPanel.jsx`** — delete the entire block from the `// Hand-rolled SVG line…` comment (line ~42) through its closing `}` (line ~134). Leave the module-level `labelStyle()` (lines 9–14) and `Stat` in place — they're still used by the scoreboard.

- [ ] **Step 2.3: Add the import** in `CohortsPanel.jsx` — after the `niceTicks` import line, add:

```js
import { EvolutionChart } from "./EvolutionChart";
```
(The `niceTicks` import in CohortsPanel.jsx is now unused — remove that line too: `import { niceTicks } from "../lib/chartTicks";`.)

- [ ] **Step 2.4: Verify behavior-preserving** — `npx vitest run` (still 494: 493 + the Task 1 case) and `npm run build` (clean). The cohort detail still renders its chart through the imported component.

- [ ] **Step 2.5: Commit**

```bash
git add src/components/EvolutionChart.jsx src/components/CohortsPanel.jsx
git commit -m "Extract EvolutionChart into its own shared component"
```

---

### Task 3: position-history endpoint

**Files:**
- Create: `api/position-history.js`

- [ ] **Step 3.1: Create `api/position-history.js`:**

```js
/**
 * GET /api/position-history?ticker=&type=&strike=&expiry=
 *
 * Returns one position's per-day capture data from daily_snapshots'
 * forecast_per_position: [{date, members:[{ticker,type,strike,expiry,
 * current_profit_pct,premium_at_open}]}] (members holds the single matching
 * row per day). Reuses buildCohortHistory with a one-tuple list. Auth covered
 * by middleware.js (matcher /api/:path*).
 */

import { createClient } from "@supabase/supabase-js";
import { buildCohortHistory } from "./_lib/cohortHistory.js";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const ticker = String(req.query.ticker ?? "").toUpperCase();
  const type   = String(req.query.type ?? "").toUpperCase();
  const strike = String(req.query.strike ?? "");
  const expiry = String(req.query.expiry ?? "");

  if (!/^[A-Z.]{1,8}$/.test(ticker) ||
      !["CSP", "CC"].includes(type) ||
      !/^\d+(\.\d+)?$/.test(strike) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
    res.status(400).json({ ok: false, error: "Invalid position parameters" });
    return;
  }

  try {
    const supabase = getSupabase();
    const { data: snaps, error } = await supabase
      .from("daily_snapshots")
      .select("snapshot_date, forecast_per_position")
      .not("forecast_per_position", "is", null)
      .order("snapshot_date", { ascending: true });
    if (error) throw new Error(error.message);

    const tuple = { ticker, type, strike: Number(strike), expiry };
    const data = buildCohortHistory(snaps ?? [], [tuple]);
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.status(200).json({ ok: true, data });
  } catch (err) {
    console.error("[api/position-history] Error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}
```
(`buildCohortHistory`'s `tupleMatches` compares strike via `String()`, so passing `Number(strike)` matches `"107"` or `107` in snapshots equally.)

- [ ] **Step 3.2: Verify** — `npm run build` (clean; the endpoint isn't imported by the bundle but build must not break) and `npx vitest run` (494, unaffected).

- [ ] **Step 3.3: Commit**

```bash
git add api/position-history.js
git commit -m "Add position-history endpoint over daily snapshot data"
```

---

### Task 4: PositionHistoryPanel

**Files:**
- Create: `src/components/PositionHistoryPanel.jsx`

- [ ] **Step 4.1: Create `src/components/PositionHistoryPanel.jsx`:**

```jsx
import { useEffect, useState } from "react";
import { theme } from "../lib/theme";
import { cohortCaptureSeries } from "../lib/cohorts";
import { EvolutionChart } from "./EvolutionChart";

const MIN_HISTORY_POINTS = 5; // ~1 trading week; below this the chart is hidden

// Capture-%-over-time chart for a single open position, shown in its expand
// panel. Mounts only when the row is expanded, so the fetch is lazy. Renders
// nothing until there are at least MIN_HISTORY_POINTS snapshot days — and
// nothing on loading/error, since this is secondary content.
export function PositionHistoryPanel({ position }) {
  const [series, setSeries] = useState(null);

  const { ticker, type, strike, expiry_date } = position;

  useEffect(() => {
    let cancelled = false;
    setSeries(null);
    (async () => {
      try {
        const qs = new URLSearchParams({ ticker, type, strike: String(strike), expiry: expiry_date }).toString();
        const res = await fetch(`/api/position-history?${qs}`);
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
        if (cancelled) return;
        const member = {
          status: "open", ticker, type, strike, expiry: expiry_date,
          closeDate: null, keptPct: null,
          premiumCollected: position.premium_collected, contracts: position.contracts ?? 1,
        };
        setSeries(cohortCaptureSeries([member], json.data ?? []));
      } catch {
        if (!cancelled) setSeries([]); // silent — secondary panel
      }
    })();
    return () => { cancelled = true; };
  }, [ticker, type, strike, expiry_date, position.premium_collected, position.contracts]);

  if (!series || series.length < MIN_HISTORY_POINTS) return null;

  return (
    <div style={{ padding: `${theme.space[3]}px ${theme.space[4]}px`, borderTop: `1px solid ${theme.border.default}` }}>
      <EvolutionChart series={series} />
    </div>
  );
}
```

- [ ] **Step 4.2: Verify** — `npm run build` (clean; not yet mounted) and `npx vitest run` (494).

- [ ] **Step 4.3: Commit**

```bash
git add src/components/PositionHistoryPanel.jsx
git commit -m "Add PositionHistoryPanel: lazy per-position capture chart"
```

---

### Task 5: Mount in the expanded row

**Files:**
- Modify: `src/components/OpenPositionsTab.jsx`

- [ ] **Step 5.1: Add import** — with the other component imports near the top of `OpenPositionsTab.jsx` (e.g. after `import { CohortsPanel } from "./CohortsPanel";`):

```js
import { PositionHistoryPanel } from "./PositionHistoryPanel";
```

- [ ] **Step 5.2: Render the panel** — in the expanded-row `<td>`, after the `PriceTargetPanel` block (the `{priceTargets && (…)}` lines ~892–894), add:

```jsx
                      <PositionHistoryPanel position={pos} />
```
So the block reads:
```jsx
                      <HoldYieldPanel hy={holdYield} />
                      {priceTargets && (
                        <PriceTargetPanel targets={priceTargets} position={pos} stockPrice={quoteMap.get(pos.ticker)?.mid ?? null} />
                      )}
                      <PositionHistoryPanel position={pos} />
```
The panel self-gates (renders null below threshold / while loading / on the LEAP path it never mounts since LEAPs don't expand). It mounts for both CSP and CC expanded rows, which is the intended scope.

- [ ] **Step 5.3: Verify** — `npx vitest run` (494 green) and `npm run build` (clean).

- [ ] **Step 5.4: Commit**

```bash
git add src/components/OpenPositionsTab.jsx
git commit -m "Show capture chart in CSP/CC position expand panels"
```

---

### Task 6: Ship (minor bump, PR, merge)

- [ ] **Step 6.1:** `git fetch origin && git show origin/main:package.json | grep '"version"'` — expect `1.126.2`; minor-bump (new feature) → `1.127.0` (adjust if baseline moved).
- [ ] **Step 6.2:** Bump `package.json` + `VERSION` in `src/lib/constants.js`; `npm install --package-lock-only`.
- [ ] **Step 6.3:** `npx vitest run && npm run build` — green.
- [ ] **Step 6.4:** Commit, push branch, `gh pr create` (title `Per-position capture chart (v1.127.0)`), `gh pr merge --squash`, pull main, remove worktree + branch. Report PR URL + version.

---

## Spec coverage map

| Spec requirement | Task |
|---|---|
| Reuse cohortCaptureSeries for single member | 1 (test), 4 |
| Extract EvolutionChart to own file | 2 |
| position-history endpoint (reuse buildCohortHistory, validation) | 3 |
| PositionHistoryPanel, lazy fetch on expand | 4 |
| ≥5-point threshold, render nothing below / loading / error | 4 |
| Mount for CSPs + CCs in expand; LEAPs excluded | 5 |
| Member object shape | 4 |
| Tests (single-member series) + build | 1, all verify steps |
| Minor version bump from origin/main | 6 |

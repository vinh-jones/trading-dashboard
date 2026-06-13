# Cohort Chart Legibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the cohort evolution chart readable: data-fit y-domain, labeled y ticks + gridlines, hover/tap readout, and first/middle/last date ticks.

**Architecture:** New tiny pure module `src/lib/chartTicks.js` (nice-tick/domain math, vitest-covered) consumed by a rewritten `EvolutionChart` in `src/components/CohortsPanel.jsx`. No API or cohort-math changes.

**Tech Stack:** React 18, hand-rolled SVG, inline theme styles, vitest. Spec: `docs/superpowers/specs/2026-06-12-cohort-chart-legibility-design.md`.

---

### Task 1: Tick/domain math (TDD)

**Files:**
- Create: `src/lib/chartTicks.js`
- Test: `src/lib/__tests__/chartTicks.test.js`

- [ ] **Step 1.1: Failing tests** — create `src/lib/__tests__/chartTicks.test.js`:

```js
import { describe, it, expect } from "vitest";
import { niceTicks } from "../chartTicks";

describe("niceTicks", () => {
  it("always includes 0 in the domain and lands ticks on round steps", () => {
    const { ticks, domainMin, domainMax } = niceTicks(-26.4, 9.8);
    expect(domainMin).toBeLessThanOrEqual(-26.4);
    expect(domainMax).toBeGreaterThanOrEqual(9.8);
    expect(ticks).toContain(0);
    const steps = ticks.slice(1).map((t, i) => +(t - ticks[i]).toFixed(6));
    expect(new Set(steps).size).toBe(1); // uniform step
  });

  it("produces a sane tick count (3–8) across scales", () => {
    for (const [lo, hi] of [[-26.4, 9.8], [0, 100], [-3, 2], [12, 87], [-180, -20]]) {
      const { ticks } = niceTicks(lo, hi);
      expect(ticks.length).toBeGreaterThanOrEqual(3);
      expect(ticks.length).toBeLessThanOrEqual(8);
    }
  });

  it("anchors all-positive and all-negative data to 0", () => {
    expect(niceTicks(12, 87).domainMin).toBeLessThanOrEqual(0);
    expect(niceTicks(-80, -20).domainMax).toBeGreaterThanOrEqual(0);
  });

  it("handles a flat series without a zero step", () => {
    const { ticks, domainMin, domainMax } = niceTicks(42, 42);
    expect(domainMax).toBeGreaterThan(domainMin);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
  });

  it("handles the flat-at-zero series", () => {
    const { domainMin, domainMax } = niceTicks(0, 0);
    expect(domainMax).toBeGreaterThan(domainMin);
  });
});
```

- [ ] **Step 1.2:** `npx vitest run src/lib/__tests__/chartTicks.test.js` — FAIL (module not found).

- [ ] **Step 1.3: Implement** — create `src/lib/chartTicks.js`:

```js
// Nice axis ticks for hand-rolled SVG charts. Returns a 0-anchored, padded
// domain rounded outward to a 1/2/5×10ⁿ step, plus the tick values on it.

export function niceTicks(dataMin, dataMax, targetCount = 5) {
  let lo = Math.min(0, dataMin);
  let hi = Math.max(0, dataMax);
  if (hi - lo === 0) { lo -= 1; hi += 1; } // flat series → open a window
  const pad = (hi - lo) * 0.05;
  lo -= pad;
  hi += pad;

  const rawStep = (hi - lo) / (targetCount - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;

  const domainMin = Math.floor(lo / step) * step;
  const domainMax = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = domainMin; v <= domainMax + step / 2; v += step) {
    ticks.push(Math.round(v * 1e6) / 1e6); // kill float drift so 0 is exactly 0
  }
  return { ticks, domainMin, domainMax };
}
```

- [ ] **Step 1.4:** `npx vitest run src/lib/__tests__/chartTicks.test.js` — 5 pass.

- [ ] **Step 1.5: Commit**

```bash
git add src/lib/chartTicks.js src/lib/__tests__/chartTicks.test.js
git commit -m "Add nice-tick axis math for hand-rolled charts"
```

---

### Task 2: EvolutionChart rewrite

**Files:**
- Modify: `src/components/CohortsPanel.jsx` (the `EvolutionChart` function only, lines ~41–78)

- [ ] **Step 2.1: Add import** — with the other lib imports at the top of `CohortsPanel.jsx`:

```js
import { niceTicks } from "../lib/chartTicks";
```

- [ ] **Step 2.2: Replace the whole `EvolutionChart` function** (from `// Hand-rolled SVG line…` comment through its closing brace) with:

```jsx
// Hand-rolled SVG line, same spirit as the allocation chart — no chart library.
// Y-domain fits the data (0-anchored); hover/tap shows the nearest point.
function EvolutionChart({ series }) {
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
              x={GUTTER - 6} y={y(t) + 3}
              textAnchor="end"
              style={{ fontSize: 10, fill: theme.text.muted, fontFamily: theme.font.mono }}
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
              style={{ fontSize: 11, fill: theme.text.primary, fontFamily: theme.font.mono, fontWeight: 600 }}
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

Notes for the implementer:
- `useState` is already imported in this file. The hook MUST stay above the `if (!series.length)` early return, exactly as written.
- SVG `<text>` styling uses raw px font sizes (SVG units scale with the viewBox; theme.size tokens are CSS px and would double-scale) — this is the one sanctioned deviation, matching how the viewBox itself uses raw units.
- The old bottom legend ("0% — solid · 100% — dashed") is gone per spec; tick labels carry the meaning.

- [ ] **Step 2.3: Verify** — `npx vitest run` (full suite green: 490 = 485 + 5) and `npm run build` (clean).

- [ ] **Step 2.4: Commit**

```bash
git add src/components/CohortsPanel.jsx
git commit -m "Make cohort evolution chart legible: fit domain, y ticks, hover readout"
```

---

### Task 3: Ship (patch bump, PR, merge)

- [ ] **Step 3.1:** `git fetch origin && git show origin/main:package.json | grep '"version"'` — expect `1.126.0`; patch-bump from whatever it shows (e.g. `1.126.1`).
- [ ] **Step 3.2:** Bump `package.json` AND `src/lib/constants.js` `VERSION`; `npm install --package-lock-only`.
- [ ] **Step 3.3:** `npx vitest run && npm run build` — green.
- [ ] **Step 3.4:** Commit, push branch, `gh pr create` (title `Cohort chart legibility (v1.126.1)`), `gh pr merge --squash`, pull main, clean up branch/worktree. Report PR URL + version.

---

## Spec coverage map

| Spec requirement | Task |
|---|---|
| Data-fit, 0-anchored, padded domain; 100%-line only when in range | 1, 2 (showMaxLine) |
| 4–5 rounded ticks, labels, gridlines | 1, 2 |
| Hover/tap nearest-point readout, edge-flipped label | 2 (handlePointer, active g) |
| First/middle/last date ticks; legend dropped | 2 |
| Single-point, flat, all-negative edges | 1 (tests), 2 (x()/circle) |
| Tick math vitest | 1 |
| Patch bump | 3 |

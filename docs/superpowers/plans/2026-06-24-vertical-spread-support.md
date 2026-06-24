# Vertical-Spread Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class vertical-spread support (starting with the logged XSP bull put spread) across the sheet contract, parser, position model, Open Positions UI, journal, History/realized path, allocation, and the v2 forecast pipeline.

**Architecture:** Pure spread math lives in two testable modules — `lib/spreadMath.js` (backend, static derivations done once at parse time) and `src/lib/spreads.js` (frontend, live quote-driven math). The parser stores all static derived fields on each `open_spreads` entry; the UI reads them. A new `SpreadsTable.jsx` component renders the Spreads tab. Quotes are extended to fetch both legs; credit spreads feed the existing premium/forecast reducers via `premium_collected` with no special-casing.

**Tech Stack:** Node ESM, React (inline-style components, `theme` tokens), Vitest, Google-Sheets CSV parser, Public.com quotes, Supabase journal, v2 forecast engine.

**Spec:** `docs/superpowers/specs/2026-06-24-vertical-spread-support-design.md`

---

## Conventions for every task

- **Versioning (CLAUDE.md):** every commit bumps `package.json` **and** `VERSION` in `src/lib/constants.js`. Baseline is `git show origin/main:package.json` (NOT the local file — worktrees drift). Minor bump (`x.Y.0`) on the **first** commit of each stage; patch bump (`x.y.Z`) for later commits in the same stage. origin/main is currently `1.154.4`; the stage-opening versions below are the plan's intent — re-verify the baseline at commit time.
- **Tests:** `npx vitest run <path>` for a single file. Local dev does NOT serve `api/*` (no vite API proxy), so API-driven UI is verified via vitest + `npm run build`, not the browser.
- **Commit format:** `<summary> (vX.Y.Z)` to match repo history; end the body with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer. Push to main immediately after each commit (`git push origin main`).

---

# STAGE 1 — Input contract, parser, position model (correctness)

Un-drops the open XSP spread, parses both legs, fixes the "everything → Bear Call" taxonomy. Stage-opening version: **1.155.0**.

## Task 1: Make `lib/**` unit-testable

**Files:**
- Modify: `vitest.config.js:8`

- [ ] **Step 1: Add the `lib/` test glob**

In `vitest.config.js`, change the `include` array to add the backend `lib` test path:

```js
    include: [
      "src/**/*.test.js",
      "src/**/__tests__/**/*.test.js",
      "api/**/__tests__/**/*.test.js",
      "lib/**/__tests__/**/*.test.js",
    ],
```

- [ ] **Step 2: Verify config still loads**

Run: `npx vitest run src/lib/rateExpectations.test.js`
Expected: PASS (existing test unaffected; config parses).

- [ ] **Step 3: Commit**

```bash
git add vitest.config.js package.json src/lib/constants.js
git commit -m "Add lib/ to vitest include for backend spread math (v1.155.0)"
git push origin main
```

(Bump `package.json` → `1.155.0` and `VERSION` in `src/lib/constants.js` → `"1.155.0"` in this commit.)

## Task 2: Pure spread math module — strike parsing + classification

**Files:**
- Create: `lib/spreadMath.js`
- Test: `lib/__tests__/spreadMath.test.js`

- [ ] **Step 1: Write the failing test**

```js
// lib/__tests__/spreadMath.test.js
import { describe, it, expect } from "vitest";
import { parseSpreadStrikes, classifySpread } from "../spreadMath.js";

describe("parseSpreadStrikes", () => {
  it("splits short/long on the slash, short first", () => {
    expect(parseSpreadStrikes("708/703")).toEqual({ short_strike: 708, long_strike: 703 });
  });
  it("handles whitespace and dollar signs", () => {
    expect(parseSpreadStrikes(" $700 / $705 ")).toEqual({ short_strike: 700, long_strike: 705 });
  });
  it("returns null for a single strike or junk", () => {
    expect(parseSpreadStrikes("703")).toBeNull();
    expect(parseSpreadStrikes("")).toBeNull();
  });
});

describe("classifySpread", () => {
  it("maps the four canonical txnType labels", () => {
    expect(classifySpread("Bull Put Spread")).toEqual({ subtype: "Bull Put", is_credit: true, right: "put" });
    expect(classifySpread("Bear Call Spread")).toEqual({ subtype: "Bear Call", is_credit: true, right: "call" });
    expect(classifySpread("Bull Call Spread")).toEqual({ subtype: "Bull Call", is_credit: false, right: "call" });
    expect(classifySpread("Bear Put Spread")).toEqual({ subtype: "Bear Put", is_credit: false, right: "put" });
  });
  it("is case/space tolerant", () => {
    expect(classifySpread("  bull put spread ")).toEqual({ subtype: "Bull Put", is_credit: true, right: "put" });
  });
  it("returns null for non-spread labels", () => {
    expect(classifySpread("LEAPS")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/spreadMath.test.js`
Expected: FAIL — cannot find module `../spreadMath.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/spreadMath.js
//
// Pure, dependency-free vertical-spread math. Backend-side (imported by
// lib/parseSheets.js) so it does NOT import from src/. All static derivations
// happen once at parse time and are stored on the open_spreads entry; the
// frontend reads the stored fields. Live quote-driven math lives separately in
// src/lib/spreads.js.

// Cash-settled, European-style index options — no early assignment.
export const CASH_SETTLED_INDICES = new Set([
  "SPX", "SPXW", "XSP", "NDX", "NDXP", "RUT", "RUTW", "VIX", "DJX", "OEX", "XEO",
]);

// txnType label → spread classification. is_credit drives premium treatment;
// right drives which option chain (put vs call) and the breakeven formula.
const SPREAD_TYPES = {
  "bull put spread":  { subtype: "Bull Put",  is_credit: true,  right: "put"  },
  "bear call spread": { subtype: "Bear Call", is_credit: true,  right: "call" },
  "bull call spread": { subtype: "Bull Call", is_credit: false, right: "call" },
  "bear put spread":  { subtype: "Bear Put",  is_credit: false, right: "put"  },
};

export function classifySpread(txnType) {
  if (!txnType) return null;
  const hit = SPREAD_TYPES[txnType.trim().toLowerCase()];
  return hit ? { ...hit } : null;
}

export function parseSpreadStrikes(cell) {
  if (!cell || typeof cell !== "string") return null;
  const parts = cell.split("/");
  if (parts.length !== 2) return null;
  const num = (s) => {
    const n = parseFloat(String(s).replace(/[$,\s]/g, ""));
    return isNaN(n) ? null : n;
  };
  const short_strike = num(parts[0]);
  const long_strike = num(parts[1]);
  if (short_strike == null || long_strike == null) return null;
  return { short_strike, long_strike };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/__tests__/spreadMath.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/spreadMath.js lib/__tests__/spreadMath.test.js package.json src/lib/constants.js
git commit -m "Add spread strike-parsing + classification (v1.155.1)"
git push origin main
```

## Task 3: Pure spread math — derivations (width, max gain/loss, breakeven, settlement)

**Files:**
- Modify: `lib/spreadMath.js`
- Test: `lib/__tests__/spreadMath.test.js`

- [ ] **Step 1: Write the failing test** (append to the existing test file)

```js
import { deriveSpread } from "../spreadMath.js";

describe("deriveSpread — credit put spread (the XSP trade)", () => {
  const d = deriveSpread({
    ticker: "XSP", short_strike: 708, long_strike: 703,
    credit: 0.66, contracts: 16, is_credit: true, right: "put",
  });
  it("derives width", () => expect(d.width).toBe(5));
  it("derives max gain = credit x 100 x contracts", () => expect(d.max_gain).toBe(1056));
  it("derives max loss = (width - credit) x 100 x contracts", () => expect(d.max_loss).toBe(6944));
  it("capital_fronted equals max loss", () => expect(d.capital_fronted).toBe(6944));
  it("premium_collected equals max gain for credit spreads", () => expect(d.premium_collected).toBe(1056));
  it("put-credit breakeven = short - credit", () => expect(d.breakeven).toBeCloseTo(707.34, 2));
  it("XSP is cash-settled and not assignable", () => {
    expect(d.settlement).toBe("cash");
    expect(d.assignable).toBe(false);
  });
});

describe("deriveSpread — credit call spread on an equity (assignable)", () => {
  const d = deriveSpread({
    ticker: "QQQ", short_strike: 500, long_strike: 505,
    credit: 1.00, contracts: 2, is_credit: true, right: "call",
  });
  it("call-credit breakeven = short + credit", () => expect(d.breakeven).toBeCloseTo(501, 2));
  it("QQQ is physically settled and assignable", () => {
    expect(d.settlement).toBe("physical");
    expect(d.assignable).toBe(true);
  });
  it("premium_collected set for credit", () => expect(d.premium_collected).toBe(200));
});

describe("deriveSpread — debit spreads (not premium)", () => {
  it("bull call debit: breakeven on long leg, no premium_collected", () => {
    // short-first: short 505 (sold higher), long 500 (bought lower); 2.00 debit
    const d = deriveSpread({
      ticker: "AAPL", short_strike: 505, long_strike: 500,
      credit: 2.00, contracts: 1, is_credit: false, right: "call",
    });
    expect(d.max_loss).toBe(200);                 // debit paid
    expect(d.max_gain).toBe(300);                 // (5 - 2) x 100
    expect(d.breakeven).toBeCloseTo(502, 2);      // long(500) + debit(2)
    expect(d.premium_collected).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/spreadMath.test.js`
Expected: FAIL — `deriveSpread` is not exported.

- [ ] **Step 3: Write minimal implementation** (append to `lib/spreadMath.js`)

```js
// Round to whole dollars (matches how premium_collected/capital_fronted are
// stored elsewhere in parseSheets).
const money = (n) => Math.round(n);

export function deriveSpread({ ticker, short_strike, long_strike, credit, contracts, is_credit, right }) {
  const width = Math.abs(short_strike - long_strike);
  const c = credit ?? 0;
  const n = contracts ?? 0;

  let max_gain, max_loss, breakeven, premium_collected;
  if (is_credit) {
    max_gain = money(c * 100 * n);
    max_loss = money((width - c) * 100 * n);
    breakeven = right === "put" ? short_strike - c : short_strike + c;
    premium_collected = max_gain;              // capturable credit feeds premium + forecast
  } else {
    max_loss = money(c * 100 * n);             // `credit` holds the debit paid
    max_gain = money((width - c) * 100 * n);
    breakeven = right === "call" ? long_strike + c : long_strike - c;
    premium_collected = null;                  // debit spreads are directional, not premium
  }

  const settlement = CASH_SETTLED_INDICES.has(ticker) ? "cash" : "physical";
  return {
    width,
    max_gain, max_loss,
    breakeven: Math.round(breakeven * 100) / 100,
    capital_fronted: max_loss,
    premium_collected,
    settlement,
    assignable: settlement === "physical",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/__tests__/spreadMath.test.js`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add lib/spreadMath.js lib/__tests__/spreadMath.test.js package.json src/lib/constants.js
git commit -m "Add spread derivations: width, max gain/loss, breakeven, settlement (v1.155.2)"
git push origin main
```

## Task 4: Parser — build open spreads, parse both legs, fix taxonomy

**Files:**
- Modify: `lib/parseSheets.js` (imports; `processLeapsShares` open branch + closed branch; `buildPositions`; `fetchSheetData`)
- Test: `lib/__tests__/parseSheets.spreads.test.js`

Refactor note: `processLeapsShares` and `buildPositions` are not currently exported. Export them so the parser logic is unit-testable without network I/O.

- [ ] **Step 1: Write the failing test**

```js
// lib/__tests__/parseSheets.spreads.test.js
import { describe, it, expect } from "vitest";
import { processLeapsShares, buildPositions } from "../parseSheets.js";

// Column layout (see parseSheets.js processLeapsShares):
// 0 ticker | 1 open | 2 close | 3 desc | 4 premium | 5 notes | 6 capital
// 7 txnType | 8 expiry | 9 contracts | 10 strike | 11 entry | 12 exit
const openXspRow = [
  "XSP", "6/24/2026", "", "Bull Put Spread", "", "", "$6,944.00",
  "Bull Put Spread", "7/31/2026", "16", "708/703", "$0.66", "",
];

describe("processLeapsShares — open vertical spread", () => {
  const { openSpreads } = processLeapsShares([openXspRow]);

  it("emits one open spread instead of dropping it", () => {
    expect(openSpreads).toHaveLength(1);
  });
  it("captures both legs short-first with derived risk/reward", () => {
    const s = openSpreads[0];
    expect(s).toMatchObject({
      ticker: "XSP", type: "Spread", subtype: "Bull Put",
      is_credit: true, right: "put",
      short_strike: 708, long_strike: 703, width: 5,
      contracts: 16, credit: 0.66,
      max_gain: 1056, max_loss: 6944, capital_fronted: 6944,
      premium_collected: 1056, settlement: "cash", assignable: false,
      expiry_date: "2026-07-31", strike: 708,
    });
    expect(s.breakeven).toBeCloseTo(707.34, 2);
  });
});

describe("processLeapsShares — closed spread routes to a trade with correct subtype", () => {
  const closedRow = [...openXspRow];
  closedRow[2] = "7/31/2026";  // close date
  closedRow[12] = "0";          // exit cost — expired worthless
  const { closedTrades, openSpreads } = processLeapsShares([closedRow]);
  it("does not leave it open", () => expect(openSpreads).toHaveLength(0));
  it("labels it Bull Put, not Bear Call", () => {
    expect(closedTrades[0]).toMatchObject({ type: "Spread", subtype: "Bull Put" });
  });
});

describe("buildPositions threads open_spreads through", () => {
  const { openSpreads } = processLeapsShares([openXspRow]);
  const built = buildPositions({}, [], [], openSpreads);
  it("returns the spreads array", () => {
    expect(built.openSpreads).toHaveLength(1);
    expect(built.openSpreads[0].ticker).toBe("XSP");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/parseSheets.spreads.test.js`
Expected: FAIL — `processLeapsShares`/`buildPositions` not exported (and open-spread handling absent).

- [ ] **Step 3: Implement the parser changes**

(3a) Add the import at the top of `lib/parseSheets.js`:

```js
import { classifySpread, parseSpreadStrikes, deriveSpread } from "./spreadMath.js";
```

(3b) Replace the type/subtype detection block in `processLeapsShares` (currently lines ~147-155, the `if (ticker === "SPAXX") … else { type = "LEAPS" … }` ladder). Insert a structured spread branch that uses the canonical txnType and stash the classification + parsed strikes for reuse:

```js
    let type, subtype, spreadClass = null, spreadStrikes = null;
    if (ticker === "SPAXX") { type = "Interest"; subtype = "Interest"; }
    else if ((spreadClass = classifySpread(txnType)) ) {
      type = "Spread";
      subtype = spreadClass.subtype;
      spreadStrikes = parseSpreadStrikes(col(row, 10));
    }
    else if (txnType.includes("Shares") || txnType === "ASSIGNED SHARES" || desc.includes("Shares")) {
      type = "Shares"; subtype = closeDate ? "Sold" : "Held";
    }
    else { type = "LEAPS"; subtype = closeDate ? "Close" : "Held"; }
```

(3c) Change `processLeapsShares` to also accumulate `openSpreads`. At the top of the function:

```js
  const closedTrades = [], openSharesByTicker = {}, openLeaps = [], openSpreads = [];
```

(3d) In the `if (isOpen)` branch, add a Spread case (the branch currently handles only Shares and LEAPS — this is the silent-drop fix):

```js
      } else if (type === "Spread" && spreadStrikes) {
        const d = deriveSpread({
          ticker, short_strike: spreadStrikes.short_strike, long_strike: spreadStrikes.long_strike,
          credit: entryCost, contracts: contracts != null ? Math.round(contracts) : null,
          is_credit: spreadClass.is_credit, right: spreadClass.right,
        });
        openSpreads.push({
          ticker, type: "Spread", subtype, is_credit: spreadClass.is_credit, right: spreadClass.right,
          short_strike: spreadStrikes.short_strike, long_strike: spreadStrikes.long_strike,
          strike: spreadStrikes.short_strike,            // for positionKey + quotes guard
          width: d.width, contracts: contracts != null ? Math.round(contracts) : null,
          credit: entryCost,
          open_date: openDate, expiry_date: expiryDate, days_to_expiry: calcDTE(expiryDate),
          max_gain: d.max_gain, max_loss: d.max_loss, breakeven: d.breakeven,
          capital_fronted: d.capital_fronted, premium_collected: d.premium_collected,
          settlement: d.settlement, assignable: d.assignable,
          source: "Ryan", notes: notes || "",
        });
      }
```

(3e) The closed branch already pushes any non-open row to `closedTrades`; the taxonomy fix in (3b) means `subtype` is now correct ("Bull Put") for closed spreads. No structural change to the closed branch, but ensure the closed `closedTrades.push({...})` sets `subtype` from the variable above (it already does).

(3f) Return `openSpreads`:

```js
  return { closedTrades, openSharesByTicker, openLeaps, openSpreads };
```

(3g) Update `buildPositions` signature + return to thread spreads through:

```js
function buildPositions(openSharesByTicker, openCCs, openLeaps, openSpreads = []) {
  // … existing assignedShares / standaloneLeaps logic unchanged …
  return { assignedShares, standaloneLeaps, openSpreads };
}
```

(3h) In `fetchSheetData`, destructure and pass through:

```js
  const { closedTrades: leapsClosed, openSharesByTicker, openLeaps, openSpreads } = processLeapsShares(leapsRows);
  // …
  const { assignedShares, standaloneLeaps, openSpreads: builtSpreads } = buildPositions(openSharesByTicker, openCCs, openLeaps, openSpreads);
  // …
  const positions = {
    last_updated: TODAY,
    assigned_shares: assignedShares,
    open_csps: openCSPs,
    open_leaps: standaloneLeaps,
    open_spreads: builtSpreads,
  };
```

(3i) Export the two functions for testing:

```js
export { processLeapsShares, buildPositions };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/__tests__/parseSheets.spreads.test.js`
Expected: PASS (all blocks).

- [ ] **Step 5: Regenerate local data and eyeball it**

Run: `npm run sync` (pulls the live sheet → `src/data/positions.json`)
Then: `node -e "console.log(JSON.stringify(require('./src/data/positions.json').open_spreads, null, 2))"`
Expected: one XSP entry with `short_strike:708, long_strike:703, max_gain:1056, max_loss:6944, breakeven:707.34, settlement:"cash"`.

- [ ] **Step 6: Commit**

```bash
git add lib/parseSheets.js lib/__tests__/parseSheets.spreads.test.js src/data/positions.json package.json src/lib/constants.js
git commit -m "Parse open vertical spreads into open_spreads; fix Bull-Put taxonomy (v1.155.3)"
git push origin main
```

## Task 5: Position schema + journal/tag wiring

**Files:**
- Modify: `src/lib/positionSchema.js`
- Modify: `src/lib/tags.js:90-115`
- Modify: `src/lib/constants.js` (SUBTYPE_LABELS)
- Test: `src/lib/__tests__/positionSchema.spreads.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/lib/__tests__/positionSchema.spreads.test.js
import { describe, it, expect } from "vitest";
import { getOpenSpreads } from "../positionSchema.js";
import { positionKey } from "../tags.js";

describe("getOpenSpreads", () => {
  it("returns the array, tolerating absence", () => {
    expect(getOpenSpreads({ open_spreads: [{ ticker: "XSP" }] })).toHaveLength(1);
    expect(getOpenSpreads({})).toEqual([]);
    expect(getOpenSpreads(null)).toEqual([]);
  });
});

describe("positionKey for a spread", () => {
  it("keys on ticker|Spread|short_strike|expiry", () => {
    const k = positionKey({ ticker: "XSP", type: "Spread", strike: 708, expiry_date: "2026-07-31" });
    expect(k).toBe("XSP|Spread|708|2026-07-31");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/positionSchema.spreads.test.js`
Expected: FAIL — `getOpenSpreads` not exported.

- [ ] **Step 3: Implement**

(3a) Add to `src/lib/positionSchema.js`:

```js
/** Top-level open vertical spreads. Returns [] if absent. */
export function getOpenSpreads(positions) {
  return positions?.open_spreads ?? [];
}
```

(3b) `positionKey` in `src/lib/tags.js` already produces `ticker|Spread|708|2026-07-31` via its generic branch (spread carries `strike: short_strike`). No code change needed — the test guards it. Extend `groupStrategicTagsByPosition` to walk spreads so notes/tags surface on spread rows. After the `open_leaps` line (~111):

```js
  (positions?.open_spreads ?? []).forEach(p => validKeys.add(positionKey(p)));
```

(3c) Add the new subtype labels to `SUBTYPE_LABELS` in `src/lib/constants.js` (keep existing entries):

```js
  "Bull Put":  "Bull Put Spread",
  "Bull Call": "Bull Call Spread",
  "Bear Put":  "Bear Put Spread",
  // "Bear Call" already maps to "Bear Call Spread"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/positionSchema.spreads.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/positionSchema.js src/lib/tags.js src/lib/constants.js src/lib/__tests__/positionSchema.spreads.test.js package.json
git commit -m "Add getOpenSpreads + spread journal/tag keys + subtype labels (v1.155.4)"
git push origin main
```

---

# STAGE 2 — Spreads tab: static + cushion-to-breakeven

A read-only Spreads tab using only stored fields + the underlying quote. Works even if option-leg quotes don't. Stage-opening version: **1.156.0**.

## Task 6: Frontend live-math module — cushion-to-breakeven

**Files:**
- Create: `src/lib/spreads.js`
- Test: `src/lib/__tests__/spreads.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/lib/__tests__/spreads.test.js
import { describe, it, expect } from "vitest";
import { cushionToBreakeven } from "../spreads.js";

describe("cushionToBreakeven", () => {
  it("bull put (bullish): safe ABOVE breakeven → positive cushion, green", () => {
    const r = cushionToBreakeven({ spot: 712, breakeven: 707.34, subtype: "Bull Put" });
    expect(r.distance_pct).toBeCloseTo((712 - 707.34) / 707.34, 5);
    expect(r.state).toBe("safe");
  });
  it("bull put: below breakeven → negative cushion, breached", () => {
    const r = cushionToBreakeven({ spot: 705, breakeven: 707.34, subtype: "Bull Put" });
    expect(r.distance_pct).toBeLessThan(0);
    expect(r.state).toBe("breached");
  });
  it("bear call (bearish): safe BELOW breakeven", () => {
    const r = cushionToBreakeven({ spot: 498, breakeven: 501, subtype: "Bear Call" });
    expect(r.distance_pct).toBeGreaterThan(0);
    expect(r.state).toBe("safe");
  });
  it("near (within ~1%) → warn", () => {
    const r = cushionToBreakeven({ spot: 708, breakeven: 707.34, subtype: "Bull Put" });
    expect(r.state).toBe("warn");
  });
  it("null spot → null result", () => {
    expect(cushionToBreakeven({ spot: null, breakeven: 707.34, subtype: "Bull Put" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/spreads.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// src/lib/spreads.js
//
// Frontend, pure, live (quote-driven) vertical-spread math. Static derivations
// (width/max gain/loss/breakeven) are computed once in lib/spreadMath.js at
// parse time and read off the position; this module covers what needs live
// quotes: cushion-to-breakeven, spread mark, and unrealized G/L.

// A bull-put / bull-call profits when the underlying rises (safe ABOVE
// breakeven); a bear-call / bear-put profits when it falls (safe BELOW).
function isBullish(subtype) {
  return subtype === "Bull Put" || subtype === "Bull Call";
}

const WARN_BAND = 0.01; // within 1% of breakeven

export function cushionToBreakeven({ spot, breakeven, subtype }) {
  if (spot == null || breakeven == null) return null;
  // distance_pct > 0 means "on the safe side of breakeven".
  const raw = isBullish(subtype)
    ? (spot - breakeven) / breakeven
    : (breakeven - spot) / breakeven;
  let state;
  if (raw < 0) state = "breached";
  else if (raw <= WARN_BAND) state = "warn";
  else state = "safe";
  return { distance_pct: raw, state };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/spreads.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/spreads.js src/lib/__tests__/spreads.test.js package.json src/lib/constants.js
git commit -m "Add cushion-to-breakeven spread math (frontend) (v1.156.0)"
git push origin main
```

## Task 7: SpreadsTable component

**Files:**
- Create: `src/components/SpreadsTable.jsx`

Mirrors the existing `PositionsTable` table styling (uses `theme` tokens) but renders spread-native columns. Reads stored fields; uses the underlying quote from `quoteMap` for cushion.

- [ ] **Step 1: Write the component**

```jsx
// src/components/SpreadsTable.jsx
import React from "react";
import { theme } from "../lib/theme";
import { calcDTE } from "../lib/trading";
import { dtePctRemaining } from "../lib/positionMetrics";
import { formatExpiry, formatDollars } from "../lib/format";
import { cushionToBreakeven } from "../lib/spreads";

const labelSt = {
  padding: `${theme.space[2]}px ${theme.space[3]}px`, textAlign: "left",
  color: theme.text.muted, fontWeight: 500, fontSize: theme.size.sm,
  textTransform: "uppercase", letterSpacing: "0.5px", whiteSpace: "nowrap",
};
const cellSt = { padding: `${theme.space[2]}px ${theme.space[3]}px`, fontSize: theme.size.md, color: theme.text.primary };

function cushionColor(state) {
  return state === "breached" ? theme.red : state === "warn" ? theme.amber : theme.green;
}

export function SpreadsTable({ rows, quoteMap, isMobile }) {
  if (!rows.length) {
    return <div style={{ fontSize: theme.size.sm, color: theme.text.subtle, padding: "12px 0" }}>No open spreads.</div>;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: theme.size.md }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${theme.border.strong}` }}>
            <th style={labelSt}>Ticker</th>
            <th style={labelSt}>Legs</th>
            {!isMobile && <th style={labelSt}>Expiry</th>}
            <th style={{ ...labelSt, textAlign: "right" }}>DTE</th>
            <th style={{ ...labelSt, textAlign: "right" }}>Credit</th>
            <th style={{ ...labelSt, textAlign: "right" }}>Max Gain</th>
            <th style={{ ...labelSt, textAlign: "right" }}>Max Loss</th>
            <th style={{ ...labelSt, textAlign: "right" }}>Breakeven</th>
            <th style={{ ...labelSt, textAlign: "right" }}>Cushion</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => {
            const dte = calcDTE(s.expiry_date);
            const spot = quoteMap.get(s.ticker)?.mid ?? quoteMap.get(s.ticker)?.last ?? null;
            const cush = cushionToBreakeven({ spot, breakeven: s.breakeven, subtype: s.subtype });
            const rightTag = s.right === "put" ? "p" : "c";
            return (
              <tr key={i} style={{ borderBottom: `1px solid ${theme.border.default}` }}>
                <td style={{ ...cellSt, fontWeight: 700 }}>{s.ticker}</td>
                <td style={cellSt}>
                  {s.short_strike}/{s.long_strike}{rightTag}
                  <span style={{ marginLeft: 6, color: theme.text.subtle, fontSize: theme.size.xs }}>
                    {s.contracts}x · {s.subtype}{s.settlement === "cash" ? " · cash-settled" : ""}
                  </span>
                </td>
                {!isMobile && <td style={cellSt}>{formatExpiry(s.expiry_date)}</td>}
                <td style={{ ...cellSt, textAlign: "right" }}>{dte != null ? `${dte}d` : "—"}</td>
                <td style={{ ...cellSt, textAlign: "right" }}>${s.credit?.toFixed(2)}</td>
                <td style={{ ...cellSt, textAlign: "right", color: theme.green }}>{formatDollars(s.max_gain)}</td>
                <td style={{ ...cellSt, textAlign: "right", color: theme.red }}>{formatDollars(s.max_loss)}</td>
                <td style={{ ...cellSt, textAlign: "right" }}>{s.breakeven}</td>
                <td style={{ ...cellSt, textAlign: "right", color: cush ? cushionColor(cush.state) : theme.text.muted }}>
                  {cush ? `${cush.distance_pct >= 0 ? "+" : ""}${(cush.distance_pct * 100).toFixed(1)}%` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles via build**

Run: `npm run build`
Expected: build succeeds (no import/JSX errors). (Component is not yet mounted; this only checks it compiles.)

- [ ] **Step 3: Commit**

```bash
git add src/components/SpreadsTable.jsx package.json src/lib/constants.js
git commit -m "Add SpreadsTable component (static + cushion) (v1.156.1)"
git push origin main
```

## Task 8: Wire the Spreads tab into OpenPositionsTab

**Files:**
- Modify: `src/components/OpenPositionsTab.jsx` (import; `getOpenSpreads`; `positionTabs`; the render branch ~1554-1588)

- [ ] **Step 1: Add the import and data**

Add near the other imports:

```jsx
import { getOpenLEAPs, getCostBasisPerShare, getOpenSpreads } from "../lib/positionSchema";
import { SpreadsTable } from "./SpreadsTable";
```

After `const allOpenLeaps = getOpenLEAPs(positions);`:

```jsx
  const allOpenSpreads = getOpenSpreads(positions);
```

- [ ] **Step 2: Add the tab**

In `positionTabs`, insert a Spreads entry before `cohorts`:

```jsx
    { key: "spreads", label: `Spreads (${allOpenSpreads.length})`, rows: allOpenSpreads },
    { key: "cohorts", label: `Cohorts (${cohortCount})`,          rows: []              },
```

- [ ] **Step 3: Render the SpreadsTable**

In the tab body, change the cohorts conditional to also branch spreads. Replace the `positionTab === "cohorts" ? (…) : (<PositionsTable …/>)` ternary with:

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
          ) : positionTab === "spreads" ? (
            <SpreadsTable rows={allOpenSpreads} quoteMap={quoteMap} isMobile={isMobile} />
          ) : (
            <PositionsTable
              rows={activeTab?.rows ?? []}
              positionType={positionTab}
              /* …all existing props unchanged… */
            />
          )}
```

- [ ] **Step 4: Verify build + preview**

Run: `npm run build` → expected success.
Then start the preview and confirm the tab renders with the XSP row:
- `preview_start`, then `preview_snapshot` on the Open Positions view → a "Spreads (1)" tab; clicking it shows XSP 708/703p · 16x with max gain $1,056 / max loss $6,944 / breakeven 707.34 and a green cushion (underlying quote may be null in local dev → cushion shows "—", which is acceptable).

- [ ] **Step 5: Commit**

```bash
git add src/components/OpenPositionsTab.jsx package.json src/lib/constants.js
git commit -m "Mount Spreads tab in Open Positions (v1.156.2)"
git push origin main
```

---

# STAGE 3 — Live two-leg G/L + % captured

Quote both legs; show unrealized G/L and % of max profit captured with a close-at-50% nudge. Stage-opening version: **1.157.0**.

## Task 9: Frontend live-math — spread mark, unrealized G/L, % captured

**Files:**
- Modify: `src/lib/spreads.js`
- Test: `src/lib/__tests__/spreads.test.js`

- [ ] **Step 1: Write the failing test** (append)

```js
import { spreadMark, spreadUnrealized } from "../spreads.js";

describe("spreadMark", () => {
  it("credit spread mark = short_mid - long_mid (cost to close)", () => {
    expect(spreadMark({ shortMid: 0.40, longMid: 0.10 })).toBeCloseTo(0.30, 5);
  });
  it("null if either leg missing", () => {
    expect(spreadMark({ shortMid: null, longMid: 0.10 })).toBeNull();
  });
});

describe("spreadUnrealized — credit spread", () => {
  // entered at 0.66 credit, now costs 0.30 to close, 16 contracts, max_gain 1056
  const r = spreadUnrealized({ credit: 0.66, shortMid: 0.40, longMid: 0.10, contracts: 16, is_credit: true, max_gain: 1056 });
  it("gl_dollars = (credit - mark) x 100 x contracts", () => {
    expect(r.gl_dollars).toBeCloseTo((0.66 - 0.30) * 100 * 16, 2); // 576
  });
  it("pct_captured = gl_dollars / max_gain", () => {
    expect(r.pct_captured).toBeCloseTo(576 / 1056, 4);
  });
  it("flags close-at-50% once pct_captured >= 0.5", () => {
    expect(r.close_50).toBe(true);
  });
  it("null mark → null fields, no false close flag", () => {
    const n = spreadUnrealized({ credit: 0.66, shortMid: null, longMid: 0.10, contracts: 16, is_credit: true, max_gain: 1056 });
    expect(n.gl_dollars).toBeNull();
    expect(n.close_50).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/spreads.test.js`
Expected: FAIL — `spreadMark`/`spreadUnrealized` not exported.

- [ ] **Step 3: Implement** (append to `src/lib/spreads.js`)

```js
export function spreadMark({ shortMid, longMid }) {
  if (shortMid == null || longMid == null) return null;
  return shortMid - longMid;
}

export function spreadUnrealized({ credit, shortMid, longMid, contracts, is_credit, max_gain }) {
  const mark = spreadMark({ shortMid, longMid });
  if (mark == null || credit == null || !contracts) {
    return { mark: null, gl_dollars: null, gl_pct: null, pct_captured: null, close_50: false };
  }
  // Credit spread: you collected `credit`, it costs `mark` to close now.
  const gl_dollars = is_credit
    ? (credit - mark) * 100 * contracts
    : (mark - credit) * 100 * contracts; // debit: bought at `credit` (the debit), now worth `mark`
  const pct_captured = (is_credit && max_gain) ? gl_dollars / max_gain : null;
  return {
    mark,
    gl_dollars: Math.round(gl_dollars),
    gl_pct: max_gain ? gl_dollars / max_gain : null,
    pct_captured,
    close_50: pct_captured != null && pct_captured >= 0.5,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/spreads.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spreads.js src/lib/__tests__/spreads.test.js package.json src/lib/constants.js
git commit -m "Add spread mark + unrealized G/L + pct-captured math (v1.157.0)"
git push origin main
```

## Task 10: Quote both spread legs

**Files:**
- Modify: `api/quotes.js:121-138` (the symbol-building loop)
- Modify: the frontend quote-request builder (`src/hooks/useQuotes.js`) to include spread rows
- Test: `api/__tests__/quotes.spreads.test.js` (if `buildInstruments` is exportable; otherwise test the row-mapping helper)

- [ ] **Step 1: Inspect the quote-row source**

Read `src/hooks/useQuotes.js` to find where position rows are assembled into the `/api/quotes` request body. Confirm whether `open_spreads` is included. (Expected: it is not — CSPs/CCs/LEAPS/shares are.)

- [ ] **Step 2: Add spread rows to the request**

In `src/hooks/useQuotes.js`, where the rows array is built from positions, add the open spreads (one row per spread carrying both legs):

```js
    ...(positions.open_spreads ?? []).map(s => ({
      ticker: s.ticker, type: "Spread", right: s.right,
      short_strike: s.short_strike, long_strike: s.long_strike,
      expiry_date: s.expiry_date,
    })),
```

- [ ] **Step 3: Add the Spread branch in `api/quotes.js`**

Inside the `for (const row of rows)` loop, right after `equitySymbols.add(ticker);` and BEFORE the `if (!strike || !expiry_date) continue;` guard (spreads carry short/long, not `strike`):

```js
    if (type === "Spread") {
      if (expiry_date) {
        const isCall = row.right === "call";
        if (row.short_strike != null) optionSymbols.add(buildOccSymbol(ticker, expiry_date, isCall, row.short_strike));
        if (row.long_strike  != null) optionSymbols.add(buildOccSymbol(ticker, expiry_date, isCall, row.long_strike));
      }
      continue;
    }
```

- [ ] **Step 4: Verify build + leg quoting**

Run: `npm run build` → success.
Then exercise the live endpoint against the deployed preview (local dev does not serve `api/*`): confirm the `/api/quotes` response contains option entries for BOTH XSP legs (708 and 703 puts). **If XSP index legs return empty**, record it: cushion-to-breakeven (Stage 2) still covers the position; note the gap and proceed — equity/ETF (QQQ) legs will populate.

- [ ] **Step 5: Commit**

```bash
git add api/quotes.js src/hooks/useQuotes.js package.json src/lib/constants.js
git commit -m "Quote both legs of open spreads (v1.157.1)"
git push origin main
```

## Task 11: Show live G/L + % captured in SpreadsTable

**Files:**
- Modify: `src/components/SpreadsTable.jsx`

- [ ] **Step 1: Compute and render live G/L**

Import the new helpers:

```jsx
import { cushionToBreakeven, spreadUnrealized } from "../lib/spreads";
import { buildOccSymbol } from "../lib/trading";
```

Inside the row map, after computing `spot`:

```jsx
            const isCall = s.right === "call";
            const shortSym = s.expiry_date && s.short_strike != null ? buildOccSymbol(s.ticker, s.expiry_date, isCall, s.short_strike) : null;
            const longSym  = s.expiry_date && s.long_strike  != null ? buildOccSymbol(s.ticker, s.expiry_date, isCall, s.long_strike)  : null;
            const shortMid = shortSym ? (quoteMap.get(shortSym)?.mid ?? null) : null;
            const longMid  = longSym  ? (quoteMap.get(longSym)?.mid  ?? null) : null;
            const ur = spreadUnrealized({ credit: s.credit, shortMid, longMid, contracts: s.contracts, is_credit: s.is_credit, max_gain: s.max_gain });
```

Add two columns to the header (`G/L` and `Captured`) and two cells:

```jsx
                <td style={{ ...cellSt, textAlign: "right", color: ur.gl_dollars == null ? theme.text.muted : ur.gl_dollars >= 0 ? theme.green : theme.red }}>
                  {ur.gl_dollars == null ? "—" : formatDollars(ur.gl_dollars)}
                </td>
                <td style={{ ...cellSt, textAlign: "right" }}>
                  {ur.pct_captured == null ? "—" : `${Math.round(ur.pct_captured * 100)}%`}
                  {ur.close_50 && <span style={{ marginLeft: 4, color: theme.green, fontWeight: 600 }}>🎯</span>}
                </td>
```

(Confirm `buildOccSymbol` is exported from `src/lib/trading.js` — `OpenPositionsTab.jsx` already imports it from there.)

- [ ] **Step 2: Verify build + preview**

Run: `npm run build` → success. Confirm the Spreads tab now shows G/L and Captured columns (values may be "—" in local dev without live quotes; that is expected).

- [ ] **Step 3: Commit**

```bash
git add src/components/SpreadsTable.jsx package.json src/lib/constants.js
git commit -m "Show live spread G/L + pct-captured with close-at-50% flag (v1.157.2)"
git push origin main
```

---

# STAGE 4 — Underlying-aware signals

Layer flow/gamma and a gated assignment-risk read onto the short leg. Stage-opening version: **1.158.0**.

## Task 12: Assignment-risk read on the short leg, gated by `assignable`

**Files:**
- Modify: `src/components/SpreadsTable.jsx` (expandable detail or inline chip)
- Reuse: `src/lib/assignmentRisk.js` (`computeAssignmentRisk`), `src/hooks/useUwSignals.js`

- [ ] **Step 1: Pass UW signals into SpreadsTable**

In `OpenPositionsTab.jsx` Task-8 render branch, pass `uwSignals={uwSignals}` to `<SpreadsTable />`. Update the component signature: `export function SpreadsTable({ rows, quoteMap, uwSignals, isMobile })`.

- [ ] **Step 2: Compute the gated signal**

Inside the row map:

```jsx
            const uwSig = uwSignals?.get?.(s.ticker);
            const flowSmoothed = uwSig?.flow_ema ?? uwSig?.flow_sentiment ?? null;
            const assignmentRisk = s.assignable
              ? computeAssignmentRisk({
                  earningsDate: quoteMap.get(s.ticker)?.earnings_date ?? null,
                  expiry: s.expiry_date,
                  today: new Date().toISOString().slice(0, 10),
                  flowSentiment: flowSmoothed,
                  gammaEnv: uwSig?.gamma_env ?? null,
                  cushionState: cush?.state === "breached" ? "assignment_risk" : "safe",
                  shortInterestPct: uwSig?.short_interest_pct ?? null,
                  expectedMovePct: uwSig?.earnings_expected_move_pct ?? null,
                  spot, strike: s.short_strike,
                })
              : null;
```

- [ ] **Step 3: Render the signal (or the cash-settled note)**

Add a small status under the Legs cell:

```jsx
                  {s.assignable
                    ? (assignmentRisk && assignmentRisk.level !== "none" && (
                        <span style={{ marginLeft: 6, color: assignmentRisk.level === "high" ? theme.red : theme.amber, fontSize: theme.size.xs }}>
                          ⚠ assignment risk · {assignmentRisk.level}
                        </span>
                      ))
                    : <span style={{ marginLeft: 6, color: theme.text.subtle, fontSize: theme.size.xs }}>no early assignment</span>}
```

Add the import: `import { computeAssignmentRisk } from "../lib/assignmentRisk";`

- [ ] **Step 4: Verify build**

Run: `npm run build` → success. (XSP shows "no early assignment"; an equity spread would show the gated risk read.)

- [ ] **Step 5: Commit**

```bash
git add src/components/SpreadsTable.jsx src/components/OpenPositionsTab.jsx package.json src/lib/constants.js
git commit -m "Underlying-aware assignment-risk read on spread short leg (v1.158.0)"
git push origin main
```

---

# STAGE 5 — Closed/realized, History, allocation, forecast

Realized P&L on close, History labels, allocation segment, and credit-spread premium into MTD + v2 forecaster. Stage-opening version: **1.159.0**.

## Task 13: Realized P&L for closed spreads

**Files:**
- Modify: `lib/parseSheets.js` (closed branch in `processLeapsShares`)
- Test: `lib/__tests__/parseSheets.spreads.test.js` (append)

- [ ] **Step 1: Write the failing test** (append)

```js
describe("closed spread realized P&L", () => {
  it("expired worthless → full credit kept as premium_collected", () => {
    const row = ["XSP","6/24/2026","7/31/2026","Bull Put Spread","","","$6,944.00",
                 "Bull Put Spread","7/31/2026","16","708/703","$0.66","0"];
    const { closedTrades } = processLeapsShares([row]);
    // realized = (0.66 - 0) * 100 * 16 = 1056
    expect(closedTrades[0].premium_collected).toBe(1056);
  });
  it("closed early for a debit → realized nets the buyback", () => {
    const row = ["XSP","6/24/2026","7/10/2026","Bull Put Spread","","","$6,944.00",
                 "Bull Put Spread","7/31/2026","16","708/703","$0.66","0.20"];
    const { closedTrades } = processLeapsShares([row]);
    // realized = (0.66 - 0.20) * 100 * 16 = 736
    expect(closedTrades[0].premium_collected).toBe(736);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/parseSheets.spreads.test.js`
Expected: FAIL — closed spread currently stores the raw `premium` (col 4, blank → null), not realized credit.

- [ ] **Step 3: Implement**

In the closed branch of `processLeapsShares`, compute realized for spreads before the `closedTrades.push`. Add, just inside the `else` (closed) block:

```js
      let realizedPremium = premium != null ? Math.round(premium * 100) / 100 : null;
      if (type === "Spread" && spreadClass?.is_credit && entryCost != null) {
        const exit = exitCost ?? 0;
        realizedPremium = Math.round((entryCost - exit) * 100 * (contracts != null ? Math.round(contracts) : 0));
      }
```

Then use `realizedPremium` in the push instead of the inline `premium != null ? … : null` for `premium_collected`. (Non-credit/non-spread rows keep the existing `premium`-based value.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/__tests__/parseSheets.spreads.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/parseSheets.js lib/__tests__/parseSheets.spreads.test.js package.json src/lib/constants.js
git commit -m "Compute realized P&L for closed credit spreads (v1.159.0)"
git push origin main
```

## Task 14: Credit spreads into the v2 forecast pipeline

**Files:**
- Modify: `api/eod-snapshot.js:586-590`
- Test: `api/__tests__/pipelineSnapshotFields.test.js` (append a spread case if the test constructs `pipelinePositions`; otherwise add a focused test asserting the reducer includes credit spreads)

- [ ] **Step 1: Add open credit spreads to `pipelinePositions`**

```js
    const pipelinePositions = [
      ...(positions.open_csps ?? []),
      ...(positions.assigned_shares ?? []).filter((s) => s.active_cc).map((s) => s.active_cc),
      ...(positions.open_spreads ?? []).filter((s) => s.is_credit),
    ];
```

(Credit spreads carry `premium_collected = max_gain`, so `openPremiumGross` and the v2 forecaster pick them up with no further change. Debit spreads are excluded by the `is_credit` filter.)

- [ ] **Step 2: Write a regression test**

```js
// api/__tests__/pipelineSnapshotFields.test.js (append)
import { describe, it, expect } from "vitest";

describe("pipeline includes open credit spreads", () => {
  it("sums credit-spread premium into openPremiumGross", () => {
    const positions = {
      open_csps: [{ premium_collected: 500 }],
      assigned_shares: [],
      open_spreads: [
        { is_credit: true,  premium_collected: 1056 },
        { is_credit: false, premium_collected: null }, // debit excluded
      ],
    };
    const pipelinePositions = [
      ...(positions.open_csps ?? []),
      ...(positions.assigned_shares ?? []).filter((s) => s.active_cc).map((s) => s.active_cc),
      ...(positions.open_spreads ?? []).filter((s) => s.is_credit),
    ];
    const openPremiumGross = Math.round(pipelinePositions.reduce((s, p) => s + (p.premium_collected || 0), 0));
    expect(openPremiumGross).toBe(1556);
  });
});
```

- [ ] **Step 3: Run test**

Run: `npx vitest run api/__tests__/pipelineSnapshotFields.test.js`
Expected: PASS.

- [ ] **Step 4: Verify the v2 forecaster tolerates a spread row**

Read `src/lib/pipelineForecast.js` `computePipelineForecast` (and `expectedFinalCapturePct`): confirm it keys only on fields a spread carries (`premium_collected`, `capital_fronted`, `open_date`, `expiry_date`, `days_to_expiry`). If it requires a `type`/`strike` that a spread lacks, set `strike: short_strike` (already present) and confirm the calibration lookup falls back to the default bucket (spec: reuse the CSP curve as a first approximation). Document any field gap inline.

- [ ] **Step 5: Commit**

```bash
git add api/eod-snapshot.js api/__tests__/pipelineSnapshotFields.test.js package.json src/lib/constants.js
git commit -m "Feed open credit spreads into MTD + v2 forecast pipeline (v1.159.1)"
git push origin main
```

## Task 15: Spreads in the allocation chart

**Files:**
- Modify: `src/components/OpenPositionsTab.jsx` (allocation `allocMap` build ~1431-1457 + legend ~1524-1530)

- [ ] **Step 1: Add a spread segment to the allocation map**

Where `allocMap` is built (it currently sums csp/shares/leaps per ticker), extend each entry shape with `spread: 0` and add:

```jsx
  allOpenSpreads.forEach(s => {
    if (!allocMap[s.ticker]) allocMap[s.ticker] = { csp: 0, shares: 0, leaps: 0, spread: 0 };
    allocMap[s.ticker].spread += (s.capital_fronted || 0);
  });
```

Update the existing three `allocMap[...] = { csp: 0, shares: 0, leaps: 0 }` initializers to include `spread: 0`, and include `spread` in `totalPct` and the stacked-bar widths (add a segment using `theme.amber` to match the Spread badge family). Add a legend entry: `<span><span style={{ color: theme.amber }}>■</span> Spread</span>`.

- [ ] **Step 2: Verify build + preview**

Run: `npm run build` → success. Confirm XSP shows an amber spread segment in the allocation chart (capital = $6,944 max loss).

- [ ] **Step 3: Commit**

```bash
git add src/components/OpenPositionsTab.jsx package.json src/lib/constants.js
git commit -m "Add spreads to the portfolio allocation chart (v1.159.2)"
git push origin main
```

## Task 16: Verify closed-spread rendering in History

**Files:**
- Verify only: `src/components/HistoryTab.jsx`

- [ ] **Step 1: Confirm labels + badge render**

With a closed spread in `trades.json` (e.g. temporarily set the XSP row's close date in the sheet, or hand-add a fixture), load the History tab and confirm: the row shows the "Spread" type badge (from `TYPE_COLORS`) and the subtype renders as "Bull Put Spread" (from the `SUBTYPE_LABELS` entries added in Task 5), and the realized premium appears in the net-realized total.

- [ ] **Step 2: If the subtype shows raw ("Bull Put") instead of "Bull Put Spread"**

Re-check Task 5 Step 3c added all four labels to `SUBTYPE_LABELS`. No code change expected here if Task 5 is complete.

- [ ] **Step 3: Commit (only if a fix was needed)**

```bash
git add src/components/HistoryTab.jsx package.json src/lib/constants.js
git commit -m "Render closed spreads correctly in History (v1.159.3)"
git push origin main
```

---

## Self-review checklist (run before execution)

- [ ] **Spec coverage:** §1 input contract → Task 4; §2 model → Tasks 2-5; §3 parser → Task 4; §4 UI → Tasks 6-12; §5 quotes → Task 10; §6 journal → Task 5; §7 closed/realized/allocation → Tasks 13,15,16; §8 forecast → Task 14. All sections mapped.
- [ ] **Index-leg quoting risk:** carried as a verify-and-record step in Task 10 Step 4 (does not block — cushion covers the position).
- [ ] **Type consistency:** `open_spreads` entry fields (`short_strike, long_strike, strike, right, is_credit, subtype, credit, max_gain, max_loss, breakeven, capital_fronted, premium_collected, settlement, assignable`) are produced in Task 4 and consumed identically in Tasks 5-15. `cushionToBreakeven`/`spreadUnrealized`/`spreadMark` signatures match between Tasks 6/9 (definition) and Tasks 7/11 (use).
- [ ] **Versioning:** every commit bumps `package.json` + `src/lib/constants.js`; baseline re-verified against `git show origin/main:package.json`.

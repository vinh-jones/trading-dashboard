# Trading Dashboard — Build Spec (v1 Simplified)

This document is a spec for building a simplified version of a personal options trading dashboard. It's written so that you can hand it directly to Claude Code and have it start building. Screenshots of the UI are included alongside this doc.

---

## Before You Start: Prerequisites

You need these tools set up before Claude Code can help you build anything. If you haven't done this yet, do it first:

1. **Node.js** (v18 or higher) — download from nodejs.org
2. **Git** — download from git-scm.com
3. **A GitHub account** — github.com (free)
4. **Claude Code** — install via `npm install -g @anthropic-ai/claude-code` in your terminal
5. **A Vercel account** — vercel.com (free tier is fine)

### Hello World First

Before starting this project, verify your setup works by building a tiny app:

> "Create a new React + Vite app called `hello-world`, add a heading that says 'Hello World', push it to GitHub, and deploy it to Vercel."

If Claude Code can do that end-to-end, you're ready for this project.

---

## What We're Building

A personal options trading dashboard that reads data from a Google Sheet and displays it across four views:

1. **Header bar** — account summary (free cash, month-to-date premium, monthly target progress)
2. **Open Positions tab** — portfolio allocation chart + assigned shares cards + open puts table
3. **Monthly Calendar tab** — calendar heatmap of daily premiums + pipeline panel
4. **YTD Summary tab** — annual breakdown by ticker and trade type

### What's explicitly OUT of scope for v1

- Live stock price quotes (no API calls to get current prices)
- Gain/Loss calculations on open positions (requires live prices)
- Roll analysis ("Check Rolls" feature)
- Live VIX feed
- Journal tab
- Radar tab
- Any user authentication
- A database (Supabase or otherwise) — we'll read directly from Google Sheets

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Frontend framework | React 18 | Component-based UI |
| Build tool | Vite | Fast dev server, simple config |
| Styling | Inline `style={{}}` objects | No CSS files, no Tailwind — just JS objects |
| Data source | Google Sheets (CSV export) | No backend needed in v1 |
| Deployment | Vercel | Free, works great with Vite |

No backend, no database, no auth. The app fetches a Google Sheet CSV directly from the browser.

---

## Data Source: Google Sheets

The app reads from a Google Sheets spreadsheet that tracks all trades. The spreadsheet has three tabs, each published as a public CSV URL.

### How to publish your sheet as CSV

In Google Sheets: **File → Share → Publish to web → select a tab → CSV → Publish**. Copy the URL — it looks like:

```
https://docs.google.com/spreadsheets/d/e/LONG_ID/pub?gid=TAB_ID&single=true&output=csv
```

You'll need three of these URLs (one per tab):
- **CSP tab** — tracks cash-secured puts and covered calls
- **LEAPS/Shares tab** — tracks assigned shares and LEAPS positions
- **Allocations tab** — tracks account-level data (free cash, account value, etc.)

Store these URLs in a `.env` file:

```
VITE_SHEET_CSP_URL=https://docs.google.com/...
VITE_SHEET_LEAPS_URL=https://docs.google.com/...
VITE_SHEET_ALLOC_URL=https://docs.google.com/...
```

---

## Data Model

### What columns exist in each tab

#### CSP Tab (cash-secured puts & covered calls)
Each row is one trade (open or closed).

| Column Index | Field | Example | Notes |
|---|---|---|---|
| 0 | ticker | `PLTR` | Stock symbol |
| 1 | transaction | `Put` / `Call` | Put = CSP, Call = CC |
| 2 | open_date | `2026-01-15` | When position was opened |
| 3 | expiry_date | `2026-02-21` | Option expiration date |
| 4 | close_date | `2026-02-10` | Blank if still open |
| 5 | days_held | `26` | Blank if still open |
| 6 | contracts | `5` | Number of contracts |
| 8 | strike | `120` | Strike price |
| 13 | delta | `0.20` | Delta at open |
| 14 | entry_cost | `2.50` | Premium received per share at open |
| 15 | exit_cost | `0.50` | Premium paid to close (blank if open/expired) |
| 16 | premium | `1000` | Total premium collected (contracts × entry × 100, rounded) |
| 17 | kept_pct | `80` | % of premium kept (blank if open) |
| 18 | capital_fronted | `60000` | Cash secured (strike × contracts × 100) |
| 19 | roi | `1.67` | ROI % (blank if open) |
| 23 | action | `Expired` / `Assigned` / blank | Blank means still open |

**How to detect open vs. closed:** `close_date` is blank → open position.
**How to detect type:** `transaction === "Put"` → CSP, `transaction === "Call"` → CC.

#### LEAPS/Shares Tab
Each row is one position or lot.

| Column Index | Field | Example | Notes |
|---|---|---|---|
| 0 | ticker | `PLTR` | Stock symbol |
| 1 | open_date | `2025-06-01` | |
| 2 | close_date | `2026-04-01` | Blank if open |
| 3 | description | `Shares (300, $175)` | Human-readable lot description |
| 4 | premium | `52500` | P&L or cost |
| 5 | notes | | Free text |
| 6 | capital | `52500` | Capital deployed |
| 7 | type | `ASSIGNED SHARES` / `LEAPS` / `Bear Call Spread` | Position type |
| 8 | expiry_date | `2027-01-17` | For LEAPS only |
| 9 | contracts | `3` | For LEAPS only |
| 10 | strike | `200` | For LEAPS only |
| 11 | entry_cost | `15.00` | For LEAPS only |
| 12 | exit_cost | | For LEAPS only |

**How to detect open vs. closed:** `close_date` is blank → open position.
**Assigned shares:** `type === "ASSIGNED SHARES"`. Multiple rows with the same ticker = multiple lots.

#### Allocations Tab
This tab has labeled rows (not a standard column-per-field format). The row where column 0 = `"CASH"` contains:

| Column Index | Field | Example |
|---|---|---|
| 4 | free_cash_dollars | `101451` |
| 8 | free_cash_pct | `11.6` (not 0.116) |

Other important values you'll hardcode or allow the user to set:
- `account_value` — total portfolio value
- `monthly_targets.baseline` — e.g., `15000`
- `monthly_targets.stretch` — e.g., `25000`
- `month_to_date_premium` — sum of all closed trades this month (compute from CSP tab)

### Computed values

These are derived from the raw sheet data, not stored directly:

```
// MTD premium: sum of premium for closed trades where close_date is in current month
mtd_premium = closed_trades
  .filter(t => t.close_date is in current month/year)
  .reduce((sum, t) => sum + t.premium, 0)

// Pipeline: sum of open CSP and CC premiums
pipeline_gross = open_positions
  .filter(p => p.type === "CSP" || p.type === "CC")
  .reduce((sum, p) => sum + p.premium, 0)

// Days to expiry
dte = daysBetween(today, expiry_date)

// % DTE left
pct_dte_left = (dte / original_dte) × 100
  where original_dte = daysBetween(open_date, expiry_date)
```

---

## Component Specs

### 1. Header Bar

Displayed at the top of every page. Dark background, monospace font throughout.

**Left side — key metrics (left to right):**

| Metric | Label | Format | Source |
|---|---|---|---|
| Free Cash | `FREE CASH` | `$101,451 (11.6%)` | Allocations tab, CASH row |
| MTD Premium | `MTD PREMIUM` | `$4,239` | Computed from closed trades |
| Pipeline | `PIPELINE` | `$12,052` gross, `$7,231 est.` below | Computed from open positions |
| Monthly progress bar | `Monthly target` | Progress bar with baseline + stretch markers | Compare MTD + pipeline_est to targets |

**Right side:**
- A **Sync Sheet** button that re-fetches the Google Sheets CSV and refreshes the app state

**Pipeline estimated** = `pipeline_gross × 0.60` (assume 60% capture rate for v1; the full app lets the user adjust this)

**Monthly progress bar:** show a horizontal bar where:
- Bar fill = `(mtd_premium + pipeline_est) / monthly_targets.stretch`
- Mark the baseline threshold with a vertical line
- Mark the stretch threshold at the right edge
- Show `$15.0k baseline · $25k stretch` as a label

---

### 2. Open Positions Tab

Three sections stacked vertically.

#### Section A: Portfolio Allocation Chart

A horizontal stacked bar chart. One row per ticker. Each bar shows capital deployed broken into three segments:

| Segment | Color | Source |
|---|---|---|
| Shares | Teal/green | Sum of capital across all `ASSIGNED SHARES` lots for that ticker |
| LEAPS | Gold/amber | Sum of capital across open `LEAPS` positions for that ticker |
| CSP | Blue | Sum of `capital_fronted` for open `CSP` positions for that ticker |

**Percentage label** (right side of each bar): `(total_capital_for_ticker / account_value) × 100`

Two vertical reference lines:
- At 10% — subtle line
- At 15% — red/orange line (concentration warning)

Sort rows by total capital descending.

#### Section B: Open Cash-Secured Puts Table

A simple table. One row per open position where `type === "CSP"`.

Columns: `TICKER | STRIKE | EXPIRY | DTE | % DTE LEFT | PREMIUM | (skip G/L for v1)`

- **DTE** — days between today and expiry_date
- **% DTE LEFT** — color-coded:
  - Green (>50%) — lots of time left
  - Amber (25–50%) — approaching
  - Red (<25%) — near expiry
- **PREMIUM** — green text, dollar formatted
- Sort by DTE ascending (soonest expiring first)

#### Section C: Assigned Shares Cards

A grid of cards (3 columns on desktop, 1 on mobile). One card per ticker that has `ASSIGNED SHARES` rows.

Each card shows:
- **Ticker** (large, bold, top left)
- **Cost basis total** (top right) — sum of `capital` across all lots for that ticker
- **Lot breakdown** — one line per lot showing the `description` field (e.g., `Shares (300, $175) — $52,500`)
- **Active Covered Call** — if there's an open position for this ticker where `type === "CC"`, show a green badge with:
  - Strike, contracts, premium, DTE, expiry date
  - Label: `ACTIVE CC`
- If no open CC exists: show a red badge `NO ACTIVE CC`

---

### 3. Monthly Calendar Tab

Two sections: a pipeline panel on top, a calendar grid below.

#### Pipeline Panel

Shows the current month's premium status:

| Row | Label | Value |
|---|---|---|
| Gross Open | All open positions' premium | Sum of open CSP + CC premiums |
| Expected (60%) | Estimated capture | Gross × 0.60 |
| MTD Collected | Premium already closed | Sum of closed trades this month |
| Implied Total | Best estimate for month-end | MTD + Expected |
| Gap to Baseline | How far from target | `baseline - implied_total` (show in red if negative, green if ahead) |

#### Month Selector

Tabs for each month (Jan, Feb, Mar, Apr, etc.). Clicking a tab switches the calendar to that month and shows that month's total premium closed.

#### Calendar Grid

7 columns (Mon–Sun) + 1 column for weekly totals. Rows = weeks.

Each day cell:
- **Background color** — heatmap: darker green = higher premium that day. Scale intensity relative to the highest-premium day in the month.
- **Premium total** — dollar amount of premiums closed that day
- **Trade count** — small secondary label (e.g., `3 trades`)
- **Expiry marker** — if any open position expires on that day, show a small flag icon (⚑) or colored dot
- Clicking a day shows a panel with the individual trades for that day

Weekly total column (rightmost):
- Sum of premiums for that week

**Which trades appear on which day:**
- Closed trades → appear on `close_date`
- Expired trades → appear on `expiry_date` (if `action === "Expired"`)

---

### 4. YTD Summary Tab

Scope: January 1 of the current year through today.

#### Type Filter Pills

A row of clickable pill buttons: `ALL | CSP | CC | LEAPS | Shares | Spread`

Each pill shows:
- Trade count
- Total premium for that type

Clicking a pill filters the ticker chart and trade table below.

#### Ticker Bar Chart

One card per ticker, sorted by total YTD premium descending.

Each card shows:
- **Ticker** + **total premium** (green if positive)
- **Monthly mini-bars** — one small bar per month showing that month's premium from this ticker
- **Trade count**

#### Trade Table

A sortable table of all trades matching the current filter.

Columns: `TICKER | TYPE | STRIKE | CONTRACTS | OPENED | CLOSED | DAYS | PREMIUM | KEPT %`

- **PREMIUM** — green if positive, red if negative
- **KEPT %** — how much of the original premium was kept (100% = expired worthless, which is ideal)
- Sort by close_date descending (most recent first) by default

---

## App Architecture

### File Structure

```
my-trading-dashboard/
├── public/
├── src/
│   ├── App.jsx              ← root component, fetches data, holds state
│   ├── main.jsx             ← Vite entry point
│   ├── lib/
│   │   ├── parseSheets.js   ← fetches CSV URLs, parses into data objects
│   │   └── utils.js         ← date helpers, number formatting
│   └── components/
│       ├── AccountBar.jsx   ← header bar
│       ├── OpenPositionsTab.jsx
│       ├── CalendarTab.jsx
│       └── SummaryTab.jsx
├── .env                     ← VITE_SHEET_* URLs (never commit this)
├── .env.example             ← commit this, with placeholder values
├── index.html
├── package.json
└── vite.config.js
```

### Data Flow

```
Google Sheets (3 CSV tabs)
    ↓  fetched via browser fetch() on app load
parseSheets.js
    ↓  returns: { trades, positions, account }
App.jsx (holds state, passes via props)
    ↓
├── AccountBar   (account, trades)
├── OpenPositionsTab   (positions, account)
├── CalendarTab   (trades, account)
└── SummaryTab   (trades)
```

### parseSheets.js — What it needs to do

```javascript
// Fetch a CSV URL and parse it into an array of row arrays
async function fetchCsv(url) {
  const res = await fetch(url)
  const text = await res.text()
  // parse CSV rows — handle commas inside quoted strings
  return rows  // string[][]
}

// Main entry point
export async function fetchAllData() {
  const [cspRows, leapsRows, allocRows] = await Promise.all([
    fetchCsv(import.meta.env.VITE_SHEET_CSP_URL),
    fetchCsv(import.meta.env.VITE_SHEET_LEAPS_URL),
    fetchCsv(import.meta.env.VITE_SHEET_ALLOC_URL),
  ])

  const trades = parseTrades(cspRows, leapsRows)
  const positions = parsePositions(cspRows, leapsRows)
  const account = parseAccount(allocRows, trades)

  return { trades, positions, account }
}
```

**Key parsing rules:**
- Skip header row (row index 0)
- Skip rows where col 0 is empty
- Parse dates as `YYYY-MM-DD` strings; compare with `new Date()`
- Parse numbers by stripping `$`, `%`, commas first, then `parseFloat()`
- A CSP row is "open" when col 4 (close_date) is blank
- A LEAPS/Shares row is "open" when col 2 (close_date) is blank

### App.jsx — Structure

```jsx
function App() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState("positions")

  async function syncData() {
    setLoading(true)
    const result = await fetchAllData()
    setData(result)
    setLoading(false)
  }

  useEffect(() => { syncData() }, [])

  if (loading) return <div>Loading...</div>

  return (
    <div style={{ background: "#0d0d0d", minHeight: "100vh", color: "#e0e0e0" }}>
      <AccountBar account={data.account} onSync={syncData} />
      <TabBar active={activeTab} onChange={setActiveTab} />
      {activeTab === "positions" && <OpenPositionsTab positions={data.positions} account={data.account} />}
      {activeTab === "calendar" && <CalendarTab trades={data.trades} account={data.account} />}
      {activeTab === "summary" && <SummaryTab trades={data.trades} />}
    </div>
  )
}
```

---

## Visual Design Notes

- **Background:** near-black (`#0d0d0d` or `#111`)
- **Surface cards:** slightly lighter (`#1a1a1a` or `#1e1e1e`)
- **Font:** monospace throughout (`font-family: 'JetBrains Mono', 'Fira Code', monospace`)
- **Text hierarchy:** white for primary values, gray for labels
- **Positive values (premium, profit):** green (`#4caf50` or similar)
- **Negative values / warnings:** red (`#f44336` or similar)
- **Active CC badge:** green background
- **No CC badge:** red/dark background
- **All spacing on a 4px grid** (4, 8, 12, 16, 20, 24px)
- **Borders:** subtle, `1px solid rgba(255,255,255,0.08)`

Screenshots of the actual UI are attached alongside this document for visual reference.

---

## Prompt to Get Claude Code Started

Once you have your prerequisites set up and your Google Sheet published as CSV, paste this into Claude Code:

> I want to build a personal options trading dashboard. Please read the file `FRIEND_SPEC.md` in this directory — it has the full spec. Start by scaffolding the project (React + Vite), setting up the file structure, and implementing `parseSheets.js` to fetch and parse my Google Sheets CSV data. The three sheet URLs are in my `.env` file. After parsing works, move to the AccountBar component, then OpenPositionsTab, then CalendarTab, then SummaryTab.

Then share the screenshots alongside it so Claude Code can see what the UI should look like.

#!/usr/bin/env node
/**
 * sync.js — Pull Google Sheets → src/data/*.json
 *
 * Usage:
 *   node sync.js          (one-shot)
 *   npm run sync          (same, via package.json script)
 *
 * What it does:
 *   1. Fetches three published CSV tabs from your Google Sheet
 *   2. Parses them per the column mapping in SHEETS_MAPPING_SPEC.md
 *   3. Writes trades.json, positions.json, and account.json to src/data/
 *   4. Vite's HMR detects the file changes and auto-refreshes your browser
 *
 * Fields that can't be derived from the sheet (free_cash_est, vix_current)
 * are preserved from the existing account.json so you don't lose them.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR   = join(__dirname, "src", "data");
const TODAY      = new Date().toISOString().slice(0, 10);
const NOW        = new Date();

// ─── SHEET URLs ────────────────────────────────────────────────────────────

const CSP_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQLuYoqaPOxDPDCpw8re2P2KhVw9g3doBOMgsbL0VW9WjCPw4fsTx_DaB6pu0CwXNITSg9qKisheRPb/pub?gid=0&single=true&output=csv";
const LEAPS_URL  = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQLuYoqaPOxDPDCpw8re2P2KhVw9g3doBOMgsbL0VW9WjCPw4fsTx_DaB6pu0CwXNITSg9qKisheRPb/pub?gid=1568395393&single=true&output=csv";
const ALLOC_URL  = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQLuYoqaPOxDPDCpw8re2P2KhVw9g3doBOMgsbL0VW9WjCPw4fsTx_DaB6pu0CwXNITSg9qKisheRPb/pub?gid=1249321251&single=true&output=csv";

// ─── CSV PARSER ─────────────────────────────────────────────────────────────
// Handles quoted fields (including commas and newlines inside quotes).

function parseCSV(text) {
  const rows = [];
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let cur = "", inQ = false, row = [];

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === '"') {
      // Escaped quote inside quoted field
      if (inQ && normalized[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === "," && !inQ) {
      row.push(cur); cur = "";
    } else if (ch === "\n" && !inQ) {
      row.push(cur); cur = "";
      if (row.some(f => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      cur += ch;
    }
  }
  // Last field/row
  row.push(cur);
  if (row.some(f => f.trim() !== "")) rows.push(row);

  return rows;
}

// ─── VALUE PARSERS ──────────────────────────────────────────────────────────

/**
 * Parses date strings from Google Sheets CSV.
 * Handles: "11/7/25", "11/28/2025", "1/12/2025"
 * Returns "YYYY-MM-DD" or null.
 */
function parseDate(s) {
  if (!s?.trim()) return null;
  const clean = s.trim();
  // M/D/YY or M/D/YYYY
  const m = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const mo = m[1].padStart(2, "0");
    const dy = m[2].padStart(2, "0");
    const yr = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${yr}-${mo}-${dy}`;
  }
  // YYYY-MM-DD passthrough
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  return null;
}

/**
 * Strips $, commas, spaces, % and parses as float.
 * Returns null for empty, #DIV/0!, or non-numeric strings.
 */
function parseNum(s) {
  if (!s?.trim()) return null;
  const clean = s.trim().replace(/[$,\s]/g, "");
  if (clean === "" || clean === "#DIV/0!" || clean === "#N/A") return null;
  const n = parseFloat(clean.replace(/%$/, ""));
  return isNaN(n) ? null : n;
}

function parseInt2(s) {
  const n = parseNum(s);
  return n != null ? Math.round(n) : null;
}

/**
 * Parses kept_pct.
 * Sheet delivers "70.59%" → 0.7059
 * Also handles decimal form "0.7059" in case formatting changes.
 */
function parseKeptPct(s) {
  if (!s?.trim()) return null;
  const clean = s.trim();
  if (clean.endsWith("%")) {
    const n = parseFloat(clean);
    return isNaN(n) ? null : Math.round(n * 10000) / 1000000; // e.g. 70.59% → 0.7059
  }
  const n = parseFloat(clean);
  // If absolute value > 1, assume it's a whole percentage (e.g. 70.59)
  if (!isNaN(n)) return Math.abs(n) > 1 ? n / 100 : n;
  return null;
}

function calcDTE(expiryISO) {
  if (!expiryISO) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryISO + "T00:00:00");
  return Math.max(0, Math.ceil((expiry - today) / 86400000));
}

/** Safe column accessor — trims whitespace, returns "" for missing cols. */
function col(row, i) { return (row[i] ?? "").trim(); }

// ─── CSP TAB PROCESSOR ──────────────────────────────────────────────────────
// No header row. Data starts at row 0.
// Puts → type:"CSP"   Calls → type:"CC"

function processCSP(rows) {
  const closedTrades = [];
  const openCSPs     = [];   // open Puts
  const openCCs      = [];   // open Calls (for active_cc in assigned_shares)

  for (const row of rows) {
    const ticker = col(row, 0);

    // Skip blank rows, header-like rows, or numeric-only cells
    if (!ticker || !isNaN(Number(ticker))) continue;
    // Skip any row that looks like a section header
    if (ticker.toLowerCase() === "ticker") continue;

    const transaction = col(row, 1);            // "Put" or "Call"
    const openDate    = parseDate(col(row, 2));
    const expiryDate  = parseDate(col(row, 3));
    const earlyClose  = parseDate(col(row, 4)); // blank if not closed early
    const daysHeld    = parseInt2(col(row, 5));
    const contracts   = parseInt2(col(row, 6));
    const strike      = parseNum(col(row, 8));
    const premium     = parseInt2(col(row, 16));
    const keptPct     = parseKeptPct(col(row, 17));
    const capital     = parseInt2(col(row, 18));
    const action      = col(row, 23);           // "Buy to Close" | "Assigned" | "Expired Worthless" | ""

    const type   = transaction === "Call" ? "CC" : "CSP";
    const isOpen = !earlyClose && !action;

    if (isOpen) {
      const rec = {
        ticker, type, strike, contracts,
        open_date:       openDate,
        expiry_date:     expiryDate,
        days_to_expiry:  calcDTE(expiryDate),
        premium_collected: premium,
        capital_fronted:   capital,
        source: "Ryan",
        notes:  "",
      };
      if (type === "CSP") openCSPs.push(rec);
      else                openCCs.push(rec);
    } else {
      // Determine subtype
      let subtype = "Close";
      if (action === "Assigned")          subtype = "Assigned";
      else if (action === "Expired Worthless") subtype = "Expired";

      // close_date: early close date if present, else expiry (for assigned/expired)
      const closeDate = earlyClose || expiryDate;

      closedTrades.push({
        ticker, type, subtype, strike, contracts,
        open_date:         openDate,
        close_date:        closeDate,
        expiry_date:       expiryDate,
        days_held:         daysHeld,
        premium_collected: premium,
        kept_pct:          keptPct,
        capital_fronted:   capital,
        source: "Ryan",
        notes:  "",
      });
    }
  }

  return { closedTrades, openCSPs, openCCs };
}

// ─── LEAPS/SHARES TAB PROCESSOR ─────────────────────────────────────────────
// Row 0 is a pseudo-header ("4, Entry Date, ...") — skipped by numeric ticker check.
// Columns: A=ticker, B=open_date, C=close_date, D=description, E=premium, F=notes, G=capital

function processLeapsShares(rows) {
  const closedTrades        = [];
  const openSharesByTicker  = {}; // { "HOOD": [{ description, fronted }] }
  const openLeaps           = [];

  for (const row of rows) {
    const rawTicker = col(row, 0);
    if (!rawTicker || !isNaN(Number(rawTicker))) continue;
    if (rawTicker.toLowerCase() === "ticker") continue;

    // Always use first word as ticker (handles "QQQ Bear Debit Spread" → "QQQ")
    const ticker    = rawTicker.split(/\s+/)[0];
    const openDate  = parseDate(col(row, 1));
    const closeDate = parseDate(col(row, 2));
    const desc      = col(row, 3);
    const premium   = parseNum(col(row, 4));   // may have $ prefix and be negative
    const notes     = col(row, 5);
    const capital   = parseNum(col(row, 6));   // may have $ prefix

    // ── Type detection ──
    let type, subtype;
    if (ticker === "SPAXX") {
      type = "Interest"; subtype = "Interest";
    } else if (desc.includes("Spread") || desc.includes("Bear")) {
      type    = "Spread";
      subtype = desc.includes("Debit") ? "Bear Debit" : "Bear Call";
    } else if (desc.includes("Shares")) {
      type    = "Shares";
      subtype = closeDate ? "Sold" : "Held";
    } else {
      // LEAPS, Calls, or anything else
      type    = "LEAPS";
      subtype = closeDate ? "Close" : "Held";
    }

    const isOpen = !closeDate;

    if (isOpen) {
      if (type === "Shares") {
        if (!openSharesByTicker[ticker]) openSharesByTicker[ticker] = [];
        openSharesByTicker[ticker].push({
          description: desc,
          fronted:     capital != null ? Math.round(capital) : null,
        });
      } else if (type === "LEAPS") {
        openLeaps.push({
          ticker, type: "LEAPS", subtype: "Held",
          description:     desc,
          open_date:       openDate,
          capital_fronted: capital != null ? Math.round(capital) : null,
          source: "Ryan",
          notes:  notes || "",
        });
      }
      // Interest rows are never open; Spreads are typically closed quickly — treat as closed if open_date exists
    } else {
      const daysHeld = openDate && closeDate
        ? Math.ceil((new Date(closeDate) - new Date(openDate)) / 86400000)
        : null;

      const premiumRounded = premium != null
        ? Math.round(premium * 100) / 100
        : null;
      const capitalRounded = capital != null
        ? Math.round(capital * 100) / 100
        : null;

      closedTrades.push({
        ticker, type, subtype,
        strike:            null,
        contracts:         null,
        description:       desc || null,
        open_date:         openDate,
        close_date:        closeDate,
        expiry_date:       null,
        days_held:         daysHeld,
        premium_collected: premiumRounded,
        kept_pct:          null,
        capital_fronted:   capitalRounded,
        source: ticker === "SPAXX" ? "System" : "Ryan",
        notes:  notes || "",
      });
    }
  }

  return { closedTrades, openSharesByTicker, openLeaps };
}

// ─── BUILD positions.json ────────────────────────────────────────────────────

function buildPositions(openSharesByTicker, openCCs, openLeaps) {
  const assignedTickers = new Set(Object.keys(openSharesByTicker));

  const assignedShares = Object.entries(openSharesByTicker).map(([ticker, positions]) => {
    const costBasis   = positions.reduce((s, p) => s + (p.fronted || 0), 0);
    const activeCC    = openCCs.find(cc => cc.ticker === ticker) || null;
    const tickerLeaps = openLeaps.filter(l => l.ticker === ticker);

    return {
      ticker,
      cost_basis_total: Math.round(costBasis),
      positions,
      active_cc:   activeCC,
      open_leaps:  tickerLeaps,
      notes: "",
    };
  });

  // Standalone LEAPS — not attached to any assigned-shares ticker
  const standaloneLeaps = openLeaps.filter(l => !assignedTickers.has(l.ticker));

  return { assignedShares, standaloneLeaps };
}

// ─── FETCH HELPER ────────────────────────────────────────────────────────────

async function fetchCSV(url, label) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  return res.text();
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("⟳  Fetching from Google Sheets...");

  const [cspText, leapsText, allocText] = await Promise.all([
    fetchCSV(CSP_URL,   "CSP tab"),
    fetchCSV(LEAPS_URL, "LEAPSShares tab"),
    fetchCSV(ALLOC_URL, "Allocations tab"),
  ]);

  console.log("   Parsing...");

  const cspRows   = parseCSV(cspText);
  const leapsRows = parseCSV(leapsText);
  const allocRows = parseCSV(allocText);

  // ── Process tabs ──
  const { closedTrades: cspClosed, openCSPs, openCCs }           = processCSP(cspRows);
  const { closedTrades: leapsClosed, openSharesByTicker, openLeaps } = processLeapsShares(leapsRows);

  // ── trades.json — all closed records sorted by close_date ──
  const allClosed = [...cspClosed, ...leapsClosed].sort((a, b) => {
    if (!a.close_date && !b.close_date) return 0;
    if (!a.close_date) return 1;
    if (!b.close_date) return -1;
    return a.close_date.localeCompare(b.close_date);
  });

  // ── MTD premium (auto-calculated from closed trades) ──
  const curYear  = NOW.getFullYear();
  const curMonth = NOW.getMonth() + 1;
  const mtdPremium = Math.round(
    allClosed
      .filter(t => {
        if (!t.close_date) return false;
        const [y, m] = t.close_date.split("-").map(Number);
        return y === curYear && m === curMonth;
      })
      .reduce((s, t) => s + (t.premium_collected || 0), 0)
  );

  // ── positions.json ──
  const { assignedShares, standaloneLeaps } = buildPositions(openSharesByTicker, openCCs, openLeaps);

  // ── account.json — preserve manually-entered fields ──
  let existing = {};
  const accPath = join(DATA_DIR, "account.json");
  if (existsSync(accPath)) {
    try { existing = JSON.parse(readFileSync(accPath, "utf8")); } catch { /* start fresh */ }
  }

  // Account value from Allocations tab row 0, col B: "TOTAL CASH, $875,131.25, ..."
  const accountValue = parseNum(col(allocRows[0] ?? [], 1));

  const accountJson = {
    last_updated:    TODAY,
    account_value:   accountValue ?? existing.account_value ?? null,
    cost_basis:      accountValue ?? existing.cost_basis ?? null,
    // ↓ manual fields — preserved from existing file, NOT overwritten by sync
    free_cash_est:      existing.free_cash_est      ?? null,
    free_cash_pct_est:  existing.free_cash_pct_est  ?? null,
    vix_current:        existing.vix_current        ?? null,
    vix_band:           existing.vix_band           ?? null,
    monthly_targets:    existing.monthly_targets    ?? { baseline: 15000, stretch: 25000 },
    // ↓ auto-calculated
    month_to_date_premium: mtdPremium,
    year:          curYear,
    current_month: curMonth,
    notes: existing.notes ?? "Update free_cash_est + free_cash_pct_est manually from Fidelity.",
  };

  // ── Write files ──
  const tradesJson = { trades: allClosed };

  const positionsJson = {
    last_updated:    TODAY,
    assigned_shares: assignedShares,
    open_csps:       openCSPs,
    open_leaps:      standaloneLeaps,
  };

  writeFileSync(join(DATA_DIR, "trades.json"),    JSON.stringify(tradesJson,    null, 2));
  writeFileSync(join(DATA_DIR, "positions.json"), JSON.stringify(positionsJson, null, 2));
  writeFileSync(join(DATA_DIR, "account.json"),   JSON.stringify(accountJson,   null, 2));

  // ── Summary ──
  const openCspCount   = openCSPs.length;
  const assignedCount  = assignedShares.length;
  const leapsCount     = standaloneLeaps.length;

  console.log(`\n✓  trades.json     — ${allClosed.length} closed trades`);
  console.log(`✓  positions.json  — ${assignedCount} assigned tickers · ${openCspCount} open CSPs · ${leapsCount} standalone LEAPS`);
  console.log(`✓  account.json    — $${accountValue?.toLocaleString() ?? "?"} account value · $${mtdPremium.toLocaleString()} MTD premium`);
  console.log(`\n   Vite will hot-reload your browser automatically.\n`);
}

main().catch(err => {
  console.error("\n✗  Sync failed:", err.message);
  process.exit(1);
});

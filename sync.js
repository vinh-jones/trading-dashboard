#!/usr/bin/env node
/**
 * sync.js — Pull Google Sheets → src/data/*.json
 *
 * Usage:
 *   node sync.js          (one-shot)
 *   npm run sync          (same, via package.json script)
 *
 * What it does:
 *   1. Calls fetchSheetData() from lib/parseSheets.js (shared with api/data.js)
 *   2. Preserves manually-entered fields (free_cash_est, vix_current, etc.) from
 *      the existing account.json so you don't lose them on sync.
 *   3. Writes trades.json, positions.json, and account.json to src/data/
 *   4. Vite's HMR detects the file changes and auto-refreshes your browser.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchSheetData } from "./lib/parseSheets.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = join(__dirname, "src", "data");

async function main() {
  console.log("⟳  Fetching from Google Sheets...");

  const { trades, positions, account } = await fetchSheetData();

  // ── Preserve manual fields from existing account.json ──
  // These fields are not in the spreadsheet and must be updated by hand.
  let existing = {};
  const accPath = join(DATA_DIR, "account.json");
  if (existsSync(accPath)) {
    try { existing = JSON.parse(readFileSync(accPath, "utf8")); } catch { /* start fresh */ }
  }

  const accountJson = {
    ...account,
    // ↓ manual fields — preserved from existing file, NOT overwritten by sync
    // free_cash_est + free_cash_pct_est now come from the sheet (Allocations I7), not preserved here
    vix_current:     existing.vix_current     ?? null,
    vix_band:        existing.vix_band        ?? null,
    monthly_targets: existing.monthly_targets ?? { baseline: 15000, stretch: 25000 },
    notes: existing.notes ?? "",
  };

  // ── Write files ──
  writeFileSync(join(DATA_DIR, "trades.json"),    JSON.stringify({ trades },   null, 2));
  writeFileSync(join(DATA_DIR, "positions.json"), JSON.stringify(positions,    null, 2));
  writeFileSync(join(DATA_DIR, "account.json"),   JSON.stringify(accountJson,  null, 2));

  // ── Summary ──
  const { assigned_shares, open_csps, open_leaps } = positions;
  console.log(`\n✓  trades.json     — ${trades.length} closed trades`);
  console.log(`✓  positions.json  — ${assigned_shares.length} assigned tickers · ${open_csps.length} open CSPs · ${open_leaps.length} standalone LEAPS`);
  console.log(`✓  account.json    — $${account.account_value?.toLocaleString() ?? "?"} account value · $${account.month_to_date_premium?.toLocaleString() ?? "0"} MTD premium`);
  console.log(`\n   Vite will hot-reload your browser automatically.\n`);
}

main().catch(err => {
  console.error("\n✗  Sync failed:", err.message);
  process.exit(1);
});

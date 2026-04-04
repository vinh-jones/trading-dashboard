/**
 * lib/parseSheets.js — shared Google Sheets CSV fetch + parse logic
 *
 * Imported by:
 *   sync.js      (writes JSON files locally, triggers Vite HMR)
 *   api/data.js  (Vercel serverless function, returns JSON over HTTP)
 */

const CSP_URL   = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQLuYoqaPOxDPDCpw8re2P2KhVw9g3doBOMgsbL0VW9WjCPw4fsTx_DaB6pu0CwXNITSg9qKisheRPb/pub?gid=0&single=true&output=csv";
const LEAPS_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQLuYoqaPOxDPDCpw8re2P2KhVw9g3doBOMgsbL0VW9WjCPw4fsTx_DaB6pu0CwXNITSg9qKisheRPb/pub?gid=1568395393&single=true&output=csv";
const ALLOC_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQLuYoqaPOxDPDCpw8re2P2KhVw9g3doBOMgsbL0VW9WjCPw4fsTx_DaB6pu0CwXNITSg9qKisheRPb/pub?gid=1249321251&single=true&output=csv";

// ─── CSV PARSER ─────────────────────────────────────────────────────────────

function parseCSV(text) {
  const rows = [];
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let cur = "", inQ = false, row = [];
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === '"') {
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
  row.push(cur);
  if (row.some(f => f.trim() !== "")) rows.push(row);
  return rows;
}

// ─── VALUE PARSERS ──────────────────────────────────────────────────────────

function parseDate(s) {
  if (!s?.trim()) return null;
  const clean = s.trim();
  const m = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const mo = m[1].padStart(2, "0");
    const dy = m[2].padStart(2, "0");
    const yr = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${yr}-${mo}-${dy}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  return null;
}

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

function parseKeptPct(s) {
  if (!s?.trim()) return null;
  const clean = s.trim();
  if (clean.endsWith("%")) {
    const n = parseFloat(clean);
    return isNaN(n) ? null : Math.round(n * 10000) / 1000000;
  }
  const n = parseFloat(clean);
  if (!isNaN(n)) return Math.abs(n) > 1 ? n / 100 : n;
  return null;
}

function calcDTE(expiryISO) {
  if (!expiryISO) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryISO + "T00:00:00");
  return Math.max(0, Math.ceil((expiry - today) / 86400000));
}

function col(row, i) { return (row[i] ?? "").trim(); }

// ─── CSP TAB ────────────────────────────────────────────────────────────────

function processCSP(rows) {
  const closedTrades = [], openCSPs = [], openCCs = [];
  for (const row of rows) {
    const ticker = col(row, 0);
    if (!ticker || !isNaN(Number(ticker)) || ticker.toLowerCase() === "ticker") continue;
    const transaction = col(row, 1);
    const openDate    = parseDate(col(row, 2));
    const expiryDate  = parseDate(col(row, 3));
    const earlyClose  = parseDate(col(row, 4));
    const daysHeld    = parseInt2(col(row, 5));
    const contracts   = parseInt2(col(row, 6));
    const strike      = parseNum(col(row, 8));
    const premium     = parseInt2(col(row, 16));
    const keptPct     = parseKeptPct(col(row, 17));
    const capital     = parseInt2(col(row, 18));
    const action      = col(row, 23);
    const type        = transaction === "Call" ? "CC" : "CSP";
    const isOpen      = !earlyClose && !action;
    if (isOpen) {
      const rec = { ticker, type, strike, contracts, open_date: openDate, expiry_date: expiryDate, days_to_expiry: calcDTE(expiryDate), premium_collected: premium, capital_fronted: capital, source: "Ryan", notes: "" };
      if (type === "CSP") openCSPs.push(rec); else openCCs.push(rec);
    } else {
      let subtype = "Close";
      if (action === "Assigned")           subtype = "Assigned";
      else if (action === "Expired Worthless") subtype = "Expired";
      closedTrades.push({ ticker, type, subtype, strike, contracts, open_date: openDate, close_date: earlyClose || expiryDate, expiry_date: expiryDate, days_held: daysHeld, premium_collected: premium, kept_pct: keptPct, capital_fronted: capital, source: "Ryan", notes: "" });
    }
  }
  return { closedTrades, openCSPs, openCCs };
}

// ─── LEAPS/SHARES TAB ───────────────────────────────────────────────────────

function processLeapsShares(rows) {
  const closedTrades = [], openSharesByTicker = {}, openLeaps = [];
  for (const row of rows) {
    const rawTicker = col(row, 0);
    if (!rawTicker || !isNaN(Number(rawTicker)) || rawTicker.toLowerCase() === "ticker") continue;
    const ticker    = rawTicker.split(/\s+/)[0];
    const openDate  = parseDate(col(row, 1));
    const closeDate = parseDate(col(row, 2));
    const desc      = col(row, 3);
    const premium   = parseNum(col(row, 4));
    const notes     = col(row, 5);
    const capital   = parseNum(col(row, 6));
    let type, subtype;
    if (ticker === "SPAXX") { type = "Interest"; subtype = "Interest"; }
    else if (desc.includes("Spread") || desc.includes("Bear")) { type = "Spread"; subtype = desc.includes("Debit") ? "Bear Debit" : "Bear Call"; }
    else if (desc.includes("Shares")) { type = "Shares"; subtype = closeDate ? "Sold" : "Held"; }
    else { type = "LEAPS"; subtype = closeDate ? "Close" : "Held"; }
    const isOpen = !closeDate;
    if (isOpen) {
      if (type === "Shares") {
        if (!openSharesByTicker[ticker]) openSharesByTicker[ticker] = [];
        openSharesByTicker[ticker].push({ description: desc, fronted: capital != null ? Math.round(capital) : null });
      } else if (type === "LEAPS") {
        openLeaps.push({ ticker, type: "LEAPS", subtype: "Held", description: desc, open_date: openDate, capital_fronted: capital != null ? Math.round(capital) : null, source: "Ryan", notes: notes || "" });
      }
    } else {
      const daysHeld = openDate && closeDate ? Math.ceil((new Date(closeDate) - new Date(openDate)) / 86400000) : null;
      closedTrades.push({ ticker, type, subtype, strike: null, contracts: null, description: desc || null, open_date: openDate, close_date: closeDate, expiry_date: null, days_held: daysHeld, premium_collected: premium != null ? Math.round(premium * 100) / 100 : null, kept_pct: null, capital_fronted: capital != null ? Math.round(capital * 100) / 100 : null, source: ticker === "SPAXX" ? "System" : "Ryan", notes: notes || "" });
    }
  }
  return { closedTrades, openSharesByTicker, openLeaps };
}

// ─── BUILD POSITIONS ────────────────────────────────────────────────────────

function buildPositions(openSharesByTicker, openCCs, openLeaps) {
  const assignedTickers = new Set(Object.keys(openSharesByTicker));
  const assignedShares  = Object.entries(openSharesByTicker).map(([ticker, positions]) => ({
    ticker,
    cost_basis_total: Math.round(positions.reduce((s, p) => s + (p.fronted || 0), 0)),
    positions,
    active_cc:   openCCs.find(cc => cc.ticker === ticker) || null,
    open_leaps:  openLeaps.filter(l => l.ticker === ticker),
    notes: "",
  }));
  const standaloneLeaps = openLeaps.filter(l => !assignedTickers.has(l.ticker));
  return { assignedShares, standaloneLeaps };
}

// ─── MAIN EXPORT ────────────────────────────────────────────────────────────

/**
 * Fetches all three Google Sheets tabs and returns parsed data.
 * Returns: { trades: [...], positions: {...}, account: {...} }
 *
 * Note: account does NOT include free_cash_est / vix_current — those are
 * manual fields. Callers should merge with existing account data to preserve them.
 */
export async function fetchSheetData() {
  const now     = new Date();
  const TODAY   = now.toISOString().slice(0, 10);
  const curYear = now.getFullYear();
  const curMonth= now.getMonth() + 1;

  const [cspText, leapsText, allocText] = await Promise.all([
    fetch(CSP_URL,   { redirect: "follow" }).then(r => { if (!r.ok) throw new Error(`CSP tab: HTTP ${r.status}`);   return r.text(); }),
    fetch(LEAPS_URL, { redirect: "follow" }).then(r => { if (!r.ok) throw new Error(`LEAPS tab: HTTP ${r.status}`); return r.text(); }),
    fetch(ALLOC_URL, { redirect: "follow" }).then(r => { if (!r.ok) throw new Error(`Alloc tab: HTTP ${r.status}`); return r.text(); }),
  ]);

  const cspRows   = parseCSV(cspText);
  const leapsRows = parseCSV(leapsText);
  const allocRows = parseCSV(allocText);

  const { closedTrades: cspClosed, openCSPs, openCCs }                  = processCSP(cspRows);
  const { closedTrades: leapsClosed, openSharesByTicker, openLeaps }     = processLeapsShares(leapsRows);

  const trades = [...cspClosed, ...leapsClosed].sort((a, b) => {
    if (!a.close_date && !b.close_date) return 0;
    if (!a.close_date) return 1;
    if (!b.close_date) return -1;
    return a.close_date.localeCompare(b.close_date);
  });

  const mtdPremium = Math.round(
    trades
      .filter(t => { if (!t.close_date) return false; const [y, m] = t.close_date.split("-").map(Number); return y === curYear && m === curMonth; })
      .reduce((s, t) => s + (t.premium_collected || 0), 0)
  );

  const { assignedShares, standaloneLeaps } = buildPositions(openSharesByTicker, openCCs, openLeaps);

  const accountValue   = parseNum(col(allocRows[0] ?? [], 1));
  // Find the CASH row dynamically (blank rows are skipped by parseCSV, so index is not reliable)
  const freeCashRow    = allocRows.find(r => col(r, 0).toLowerCase() === "cash") ?? [];
  const freeCashEst    = parseNum(col(freeCashRow, 4));
  const freeCashPctRaw = parseNum(col(freeCashRow, 8));   // arrives as 5.90, not 0.059
  const freeCashPctEst = freeCashPctRaw != null ? freeCashPctRaw / 100 : null;

  const account = {
    last_updated:          TODAY,
    account_value:         accountValue,
    cost_basis:            accountValue,
    free_cash_est:         freeCashEst,
    free_cash_pct_est:     freeCashPctEst,
    // vix_current, vix_band, monthly_targets, notes are NOT included — callers preserve them
    month_to_date_premium: mtdPremium,
    year:                  curYear,
    current_month:         curMonth,
  };

  const positions = {
    last_updated:    TODAY,
    assigned_shares: assignedShares,
    open_csps:       openCSPs,
    open_leaps:      standaloneLeaps,
  };

  return { trades, positions, account };
}

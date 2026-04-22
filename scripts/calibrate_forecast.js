#!/usr/bin/env node
/**
 * Pipeline Forecast v2 — calibration script.
 *
 * Re-run monthly to recalibrate capture rates against latest closed trades.
 * Reads wheel-trade CSVs (Public.com export + prior-brokerage history),
 * buckets closed trades per spec, and emits SQL to upsert into
 * forecast_calibration.
 *
 * Usage:
 *   node scripts/calibrate_forecast.js <csv_path> [<csv_path> ...]
 *
 * Example:
 *   node scripts/calibrate_forecast.js data/public-trades.csv data/prior-brokerage.csv
 *
 * Output:
 *   - Console report (buckets, n, mean, std, vs spec)
 *   - SQL upsert statements on stdout, ready to pipe into psql
 *
 * See docs/pipeline_forecast_v2_backtest.md for methodology + limitations.
 *
 * FUTURE: once position_daily_state has 3+ months of data, switch data
 * source from closed-trade CSVs to that table so calibration answers
 * "of positions ever in state X, what was final realization?" — which
 * closed-trade data cannot answer (tautological for in-band buckets).
 */

import fs from 'node:fs';
import path from 'node:path';

// Spec starting values (fallback when n<5 or bucket is tautological)
const SPEC_START = {
  csp: {
    profit_60_plus:         0.60,
    profit_40_60_dte_high:  0.65,
    profit_40_60_dte_low:   0.70,  // new spec gap patch
    profit_20_plus_dte_low: 0.90,
    profit_20_40_dte_high:  0.58,  // new spec gap patch
    profit_low_dte_low:     0.93,
    profit_low_dte_high:    0.55,
  },
  cc: {
    profit_80_plus:              0.85,
    profit_60_plus_dte_low:      0.85,
    dte_very_low:                0.92,
    default:                     0.75,
    below_cost_strike_near:      0.20,
    strike_near_non_below_cost:  0.50,
  },
};

// Buckets where closed-trade data is tautological — keep spec value even if n>=5
// Buckets that are "closed-in-band" — the observed mean is a function of the
// selection criterion, not a true expected realization. Keep spec starting
// values until position_daily_state enables trajectory-based calibration.
const TAUTOLOGICAL = new Set([
  'csp.profit_40_60_dte_high',
  'csp.profit_40_60_dte_low',      // new spec gap, also tautological
  'csp.profit_20_plus_dte_low',
  'csp.profit_20_40_dte_high',     // new spec gap, also tautological
  'csp.profit_low_dte_high',
  'csp.profit_low_dte_low',
  'cc.dte_very_low',
  'cc.default',
]);

function parseCSVLine(line) {
  const out = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur); return out;
}
function parseDate(s) {
  if (!s?.trim()) return null;
  const p = s.trim().split('/');
  if (p.length !== 3) return null;
  let [m, d, y] = p.map(x => parseInt(x, 10));
  if (y < 100) y += 2000;
  return new Date(Date.UTC(y, m - 1, d));
}
function daysBetween(a, b) { return Math.round((b - a) / 86400000); }
function parseNum(s) {
  if (s == null) return null;
  const c = String(s).replace(/[",\s$%]/g, '').trim();
  if (c === '' || c === '#DIV/0!') return null;
  const n = parseFloat(c);
  return isNaN(n) ? null : n;
}

function loadCSV(file) {
  const rows = [];
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim());
  const header = parseCSVLine(lines[0]);
  const idx = {};
  header.forEach((h, i) => idx[h.trim()] = i);
  const tickerCol = idx['Column 1'] !== undefined ? idx['Column 1'] : idx['Ticker'];

  for (let i = 1; i < lines.length; i++) {
    const c = parseCSVLine(lines[i]);
    const txn = c[idx['Transaction']];
    if (txn !== 'Put' && txn !== 'Call') continue;
    const action = (c[idx['Action']] || '').trim();
    if (!action) continue;                        // still open
    const execDate = parseDate(c[idx['Execution Date']]);
    const expDate = parseDate(c[idx['Expiration Date']]);
    const closeDate = parseDate(c[idx['Early Close Date']]);
    const premiumKept = parseNum(c[idx['Premium kept']]);
    const btc = parseNum(c[idx['Buy to close']]);
    const premPerShare = parseNum(c[idx['Premium per share']]);

    let cap;
    if (['Assigned', 'Early Assignment', 'Expired Worthless'].includes(action)) cap = 1.0;
    else if (premiumKept !== null) cap = premiumKept / 100;
    else if (premPerShare && btc !== null) cap = (premPerShare - btc) / premPerShare;
    if (cap === undefined || cap === null || isNaN(cap)) continue;

    const dte = closeDate && expDate
      ? daysBetween(closeDate, expDate)
      : (['Assigned', 'Expired Worthless'].includes(action) ? 0 : null);

    rows.push({
      ticker: c[tickerCol]?.trim(),
      type: txn === 'Put' ? 'csp' : 'cc',
      execDate, closeDate, expDate,
      cap, dte, action,
      sourceFile: path.basename(file),
    });
  }
  return rows;
}

function cspBucket(r) {
  const p = r.cap, dte = r.dteAtClose = r.dte;
  if (p >= 0.60) return 'profit_60_plus';
  if (p >= 0.40 && p < 0.60 && dte != null && dte > 10)  return 'profit_40_60_dte_high';
  if (p >= 0.40 && p < 0.60 && dte != null && dte <= 10) return 'profit_40_60_dte_low';
  if (p >= 0.20 && p < 0.40 && dte != null && dte > 10)  return 'profit_20_40_dte_high';
  if (p >= 0.20 && dte != null && dte <= 10)             return 'profit_20_plus_dte_low';
  if (p < 0.20 && dte != null && dte <= 10)              return 'profit_low_dte_low';
  if (p < 0.20 && dte != null && dte > 10)               return 'profit_low_dte_high';
  return 'unclassified';
}
function ccBucket(r) {
  const p = r.cap, dte = r.dte;
  if (p >= 0.80) return 'profit_80_plus';
  if (p >= 0.60 && dte != null && dte <= 5) return 'profit_60_plus_dte_low';
  if (dte != null && dte <= 3) return 'dte_very_low';
  return 'default';
}

function stats(arr) {
  if (!arr.length) return null;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const sq = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
  const std = Math.sqrt(sq);
  const sorted = [...arr].sort((a, b) => a - b);
  return {
    n: arr.length,
    mean: +mean.toFixed(4),
    median: +sorted[Math.floor(sorted.length / 2)].toFixed(4),
    std: +std.toFixed(4),
  };
}

function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('Usage: node scripts/calibrate_forecast.js <csv> [<csv> ...]');
    process.exit(1);
  }

  const all = [];
  for (const f of files) all.push(...loadCSV(f));
  const dates = all.map(r => r.execDate).filter(Boolean).sort((a, b) => a - b);

  // Group by bucket
  const cspGroups = {}, ccGroups = {};
  for (const r of all) {
    if (r.type === 'csp') {
      const b = cspBucket(r);
      (cspGroups[b] ||= []).push(r.cap);
    } else {
      const b = ccBucket(r);
      (ccGroups[b] ||= []).push(r.cap);
    }
  }

  // Report
  console.error(`# Calibration — ${all.length} closed trades (${all.filter(r=>r.type==='csp').length} CSP, ${all.filter(r=>r.type==='cc').length} CC)`);
  if (dates.length) console.error(`# Range: ${dates[0].toISOString().slice(0,10)} → ${dates[dates.length-1].toISOString().slice(0,10)}`);
  console.error();

  function resolveCal(pt, bucket, s) {
    const key = `${pt}.${bucket}`;
    const start = SPEC_START[pt]?.[bucket];
    if (!s || s.n < 5) return { value: start, reason: s ? `n<5, keep start` : 'no data, keep start' };
    if (TAUTOLOGICAL.has(key)) return { value: start, reason: `tautological, keep start (observed ${s.mean})` };
    return { value: s.mean, reason: `CALIBRATED n=${s.n}` };
  }

  const today = new Date().toISOString().slice(0, 10);
  const allBuckets = [
    ...Object.keys(SPEC_START.csp).map(b => ['csp', b]),
    ...Object.keys(SPEC_START.cc).map(b => ['cc', b]),
  ];

  console.error('position_type | bucket                    | n   | observed | applied | reason');
  console.error('--------------|---------------------------|-----|----------|---------|------');
  const sqlRows = [];
  for (const [pt, b] of allBuckets) {
    const groups = pt === 'csp' ? cspGroups : ccGroups;
    const s = stats(groups[b] || []);
    const { value, reason } = resolveCal(pt, b, s);
    const obs = s ? s.mean.toFixed(3) : '—';
    const n = s ? s.n : 0;
    console.error(`${pt.padEnd(13)} | ${b.padEnd(25)} | ${String(n).padStart(3)} | ${obs.padStart(8)} | ${value.toFixed(2).padStart(7)} | ${reason}`);
    const notes = `${reason}; observed n=${n}${s ? `, mean=${s.mean}, std=${s.std}` : ''}`;
    sqlRows.push({ pt, bucket: b, value, n, notes });
  }

  // Emit SQL on stdout
  console.log('-- Generated by scripts/calibrate_forecast.js on ' + today);
  console.log('insert into public.forecast_calibration');
  console.log('  (position_type, bucket, calibrated_capture, sample_size, calibration_date, notes)');
  console.log('values');
  const values = sqlRows.map(r => {
    const notes = r.notes.replace(/'/g, "''");
    return `  ('${r.pt}', '${r.bucket}', ${r.value}, ${r.n}, '${today}', '${notes}')`;
  });
  console.log(values.join(',\n'));
  console.log('on conflict (position_type, bucket, calibration_date) do update');
  console.log('set calibrated_capture = excluded.calibrated_capture,');
  console.log('    sample_size        = excluded.sample_size,');
  console.log('    notes              = excluded.notes;');
}

main();

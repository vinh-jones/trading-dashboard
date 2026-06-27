/**
 * api/_lib/snapshotRisk.js
 *
 * Server-side risk-unit block for the intraday + EOD snapshot payloads, so the
 * same descriptive-only numbers the Risk tab shows are available to drop into
 * an analysis. Self-contained: given a Supabase client + reshaped positions, it
 * fetches exactly the quotes (with delta) and betas the engine needs, runs the
 * shared pure engine, and returns { risk (structured), text (compact blob) }.
 *
 * Imports the pure engine from src/lib (same pattern the snapshots already use
 * for vixBand / cushionBreach). DESCRIPTIVE-ONLY — no decision authority.
 */

import { computeRiskUnits, buildRiskLegs, heldTickers } from "../../src/lib/riskEngine.js";
import { buildOccSymbol } from "./occ.js";

const FAMILY_LABEL = { CSP: "CSP", CC: "CC", LEAP: "LEAPS", SHARES: "Shares", SPREAD: "Spread" };

const r2 = (n, d = 2) =>
  (n == null || !Number.isFinite(n)) ? null : Math.round(n * 10 ** d) / 10 ** d;

const fmt$ = (n) => {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  const body = a >= 1000 ? `$${(a / 1000).toFixed(1)}k` : `$${a.toFixed(0)}`;
  return n < 0 ? `-${body}` : body;
};
const sgn$ = (n) => (n == null ? "—" : (n >= 0 ? "+" : "") + fmt$(n));

// Symbols the engine will look up: every underlying + an OCC symbol per option leg.
function riskQuoteSymbols(positions, todayIso) {
  const legs = buildRiskLegs(positions, { getQuote: () => undefined, getBeta: () => null, todayIso });
  const equities = new Set();
  const options = new Set();
  for (const leg of legs) {
    if (leg.ticker) equities.add(leg.ticker);
    if (leg.kind !== "SHARES" && leg.strike != null && leg.expiry && leg.right) {
      options.add(buildOccSymbol(leg.ticker, leg.expiry, leg.right === "call", leg.strike));
    }
  }
  return [...equities, ...options];
}

function buildRiskText(agg, accountValue) {
  const pctStr = accountValue
    ? ` (${((agg.netBetaWeightedDelta / accountValue) * 100).toFixed(1)}% of account)`
    : "";
  const top = agg.perPosition.slice(0, 3)
    .map((p) => `${p.ticker}${p.strike ? ` ${p.strike}` : ""} ${sgn$(p.betaWeightedDelta)}`)
    .join(" · ");
  const lines = [
    "RISK UNITS (descriptive-only — measures risk, no decision authority)",
    "─".repeat(40),
    `Beta-weighted delta: ${sgn$(agg.netBetaWeightedDelta)} per +1% SPX${pctStr}`,
    `Net vega: ${sgn$(agg.netVega)} per +1 IV pt (${agg.netVega < 0 ? "short vol" : "long vol"})`,
    `Net theta: ${sgn$(agg.netTheta)} per day`,
  ];
  if (top) lines.push(`Top directional: ${top}`);
  lines.push(`Coverage: ${agg.coverage.covered}/${agg.coverage.total} legs`);
  return lines.join("\n");
}

export async function buildSnapshotRisk(supabase, positions, { todayIso, accountValue = null }) {
  const symbols = riskQuoteSymbols(positions, todayIso);
  const tickers = heldTickers(positions);

  const [quotesRes, fundRes] = await Promise.allSettled([
    symbols.length
      ? supabase.from("quotes").select("symbol, last, mid, iv, delta").in("symbol", symbols)
      : Promise.resolve({ data: [] }),
    tickers.length
      ? supabase.from("fundamentals").select("ticker, beta").in("ticker", tickers)
      : Promise.resolve({ data: [] }),
  ]);

  const quoteRows = quotesRes.status === "fulfilled" ? (quotesRes.value.data ?? []) : [];
  const quoteMap = new Map(quoteRows.map((q) => [q.symbol, q]));
  const betaMap = {};
  if (fundRes.status === "fulfilled") for (const f of (fundRes.value.data ?? [])) betaMap[f.ticker] = f.beta;

  const ctx = {
    getQuote: (s) => quoteMap.get(s),
    getBeta:  (t) => (betaMap[t] ?? null),
    todayIso,
  };
  const { aggregate: agg, grid } = computeRiskUnits(positions, ctx);

  const risk = {
    descriptive_only: true,
    units: {
      net_beta_weighted_delta_per_1pct_spx: r2(agg.netBetaWeightedDelta),
      net_vega_per_iv_point: r2(agg.netVega),
      net_theta_per_day: r2(agg.netTheta),
      beta_weighted_delta_pct_of_account: accountValue ? r2(agg.netBetaWeightedDelta / accountValue, 4) : null,
    },
    by_family: Object.fromEntries(Object.entries(agg.byFamily).map(([k, v]) => [
      FAMILY_LABEL[k] || k,
      { beta_weighted_delta: r2(v.betaWeightedDelta), vega: r2(v.vega), capital: r2(v.capital) },
    ])),
    positions: agg.perPosition.map((p) => ({
      kind: FAMILY_LABEL[p.kind] || p.kind, ticker: p.ticker, strike: p.strike ?? null, expiry: p.expiry ?? null,
      beta_weighted_delta: r2(p.betaWeightedDelta), vega: r2(p.vegaDollars), theta: r2(p.thetaDollars),
      capital: r2(p.capital), beta_assumed: p.betaAssumed,
    })),
    scenario_grid: {
      spx_shocks_pct: grid.map((row) => row.spxShock),
      iv_shocks_pts: grid[0]?.cells.map((c) => c.ivShock) ?? [],
      pnl_rows_spx_cols_iv: grid.map((row) => row.cells.map((c) => r2(c.pnl))),
    },
    coverage: agg.coverage,
  };

  return { risk, text: buildRiskText(agg, accountValue) };
}

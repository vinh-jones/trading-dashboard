// Risk-Unit engine (v2, Phase 1) — the "second denominator" alongside capital.
//
// Measures portfolio risk from greeks instead of guessed coefficients. Two
// exposure denominators + a scenario grid, all descriptive-only:
//
//   • beta-weighted delta-dollars  → directional risk ($ P&L per 1% SPX move)
//   • net vega                     → volatility risk  ($ P&L per +1 IV point)
//   • scenario grid                → price × vol shock revaluation (the readout)
//
// Greeks come from the live quote where present (delta, dividend-aware) with
// Black-Scholes filling gamma/vega/theta from the quote's IV (the quotes table
// stores only delta+iv). Every function is pure and null-safe; an uncovered leg
// (no spot/IV) is excluded from aggregates and surfaced in `coverage`, never
// silently counted as zero.
//
// NOT in Phase 1: covariance/CVaR, factor models, risk budgeting. The scenario
// grid's beta-scaled common shock is a *proxy* for co-movement, not the real
// correlation term — see the v2 spec.

import { bsGreeks } from "./greeks.js";
import { bsCallPrice, bsPutPrice, RISK_FREE_RATE } from "./blackScholes.js";
import {
  getOpenCSPs, getOpenCCs, getOpenLEAPs, getOpenSpreads,
  getAssignedShares, getTotalShareCount, leapCapital,
} from "./positionSchema.js";
import { buildOccSymbol } from "./trading.js";

const DAY_MS = 86400000;

// Default scenario-grid shocks (rows = SPX %, cols = IV points). Per v2 spec §10.
export const DEFAULT_SPX_SHOCKS = [-8, -5, -3, 0, 3];
export const DEFAULT_IV_SHOCKS  = [-5, 0, 5, 10];

// Distinct underlying tickers across all open positions (CSP/CC/LEAP/shares/spread).
export function heldTickers(positions) {
  const set = new Set();
  for (const p of getOpenCSPs(positions))       if (p.ticker)  set.add(p.ticker);
  for (const c of getOpenCCs(positions))        if (c.ticker)  set.add(c.ticker);
  for (const l of getOpenLEAPs(positions))      if (l.ticker)  set.add(l.ticker);
  for (const s of getAssignedShares(positions)) if (s.ticker)  set.add(s.ticker);
  for (const sp of getOpenSpreads(positions))   if (sp.ticker) set.add(sp.ticker);
  return [...set];
}

// ── Beta shrinkage (Blume): pull two-thirds toward the market beta of 1.0. ───
// Fixes static raw beta and the "beta converges toward 1 in a crisis" concern.
export function adjBeta(rawBeta) {
  if (rawBeta == null || !Number.isFinite(rawBeta)) return 1.0; // assumed market
  return 0.67 * rawBeta + 0.33;
}

// ── Per-leg dollar greeks ────────────────────────────────────────────────────
// Returns null for an uncovered leg. `sign` is +1 long / −1 short; the live
// quote delta is already signed by right (puts negative), so position delta =
// sign × delta. Short puts → +delta/−vega/+theta; long calls → +delta/+vega/
// −theta — the LEAP-vs-CSP distinction as a sign flip, not a coefficient.
export function legRisk(leg, r = RISK_FREE_RATE) {
  if (!leg?.covered) return null;

  if (leg.kind === "SHARES") {
    return {
      positionDelta:     leg.sign * leg.shares,
      betaWeightedDelta: leg.sign * leg.shares * leg.spot * 0.01 * leg.betaAdj, // $/1% SPX
      vegaDollars:       0,
      thetaDollars:      0,
    };
  }

  const g = bsGreeks({ S: leg.spot, K: leg.strike, T: leg.T, iv: leg.iv, r, right: leg.right });
  if (!g) return null;
  const delta = leg.quoteDelta != null ? leg.quoteDelta : g.delta; // prefer live delta
  const qty = 100 * leg.contracts;
  return {
    positionDelta:     leg.sign * delta * qty,
    betaWeightedDelta: leg.sign * delta * qty * leg.spot * 0.01 * leg.betaAdj, // $/1% SPX
    vegaDollars:       leg.sign * g.vega  * qty, // $ per +1 IV point
    thetaDollars:      leg.sign * g.theta * qty, // $ per calendar day
  };
}

// ── Scenario revaluation ─────────────────────────────────────────────────────
// P&L of one leg under a common SPX shock (beta-scaled per name) + an IV shock.
// Full revaluation, BS-to-BS so model error cancels; time held fixed (an
// instantaneous shock, not a decay path). Returns 0 for an uncovered leg.
export function legPnlUnderShock(leg, spxShockPct, ivShockPts, r = RISK_FREE_RATE) {
  if (!leg?.covered) return 0;
  const move    = (spxShockPct / 100) * leg.betaAdj; // high-beta names move more
  const newSpot = leg.spot * (1 + move);

  if (leg.kind === "SHARES") {
    return leg.sign * leg.shares * (newSpot - leg.spot);
  }

  const newIv  = Math.max(leg.iv + ivShockPts / 100, 0.0001);
  const priceFn = leg.right === "call" ? bsCallPrice : bsPutPrice;
  const cur     = priceFn(leg.spot, leg.strike, leg.T, r, leg.iv);
  const shocked = priceFn(newSpot,  leg.strike, leg.T, r, newIv);
  return leg.sign * (shocked - cur) * 100 * leg.contracts;
}

// Grid of total portfolio P&L across every (SPX shock × IV shock) pair.
export function scenarioGrid(legs, spxShocks = DEFAULT_SPX_SHOCKS, ivShocks = DEFAULT_IV_SHOCKS, r = RISK_FREE_RATE) {
  return spxShocks.map(spx => ({
    spxShock: spx,
    cells: ivShocks.map(ivp => ({
      ivShock: ivp,
      pnl: legs.reduce((sum, leg) => sum + legPnlUnderShock(leg, spx, ivp, r), 0),
    })),
  }));
}

// ── Portfolio aggregation ────────────────────────────────────────────────────
// Two denominators + net theta, a by-family rollup (risk % vs capital %), the
// per-position breakdown, and an honest coverage report.
export function aggregateRisk(legs, r = RISK_FREE_RATE) {
  const perPosition = [];
  let netBetaWeightedDelta = 0, netVega = 0, netTheta = 0;
  const family = {};      // kind → { betaWeightedDelta, vega, capital }
  let coveredCount = 0;
  const uncovered = [];
  let totalCapital = 0;

  for (const leg of legs) {
    totalCapital += leg.capital || 0;
    const fam = (family[leg.kind] ??= { betaWeightedDelta: 0, vega: 0, capital: 0 });
    fam.capital += leg.capital || 0;

    const risk = legRisk(leg, r);
    if (!risk) { uncovered.push({ kind: leg.kind, ticker: leg.ticker, reason: leg.uncoveredReason || "no spot/IV" }); continue; }

    coveredCount++;
    netBetaWeightedDelta += risk.betaWeightedDelta;
    netVega  += risk.vegaDollars;
    netTheta += risk.thetaDollars;
    fam.betaWeightedDelta += risk.betaWeightedDelta;
    fam.vega += risk.vegaDollars;
    perPosition.push({
      kind: leg.kind, ticker: leg.ticker, strike: leg.strike, expiry: leg.expiry,
      betaAssumed: !!leg.betaAssumed, ...risk, capital: leg.capital || 0,
    });
  }

  perPosition.sort((a, b) => Math.abs(b.betaWeightedDelta) - Math.abs(a.betaWeightedDelta));

  return {
    netBetaWeightedDelta, netVega, netTheta,
    byFamily: family,
    perPosition,
    totalCapital,
    coverage: { covered: coveredCount, total: legs.length, uncovered },
  };
}

// ── Position normalization: positions object → flat risk legs ────────────────
// Pure: dependencies (live quotes, betas, today) are injected, so this is unit-
// testable with plain stubs. getQuote(symbol) returns a quote row or undefined;
// getBeta(ticker) returns raw beta or null.
function dteYears(expiryIso, todayIso) {
  if (!expiryIso) return null;
  const days = Math.round((Date.parse(`${expiryIso}T00:00:00Z`) - Date.parse(`${todayIso}T00:00:00Z`)) / DAY_MS);
  return days / 365;
}

function optionLeg(kind, ticker, right, sign, pos, capital, ctx) {
  const { getQuote, getBeta, todayIso } = ctx;
  const eq    = getQuote(ticker);
  const spot  = eq?.last ?? eq?.mid ?? null;
  const occ   = buildOccSymbol(ticker, pos.expiry_date, right === "call", pos.strike);
  const oq    = getQuote(occ);
  const iv    = oq?.iv ?? null;
  const T     = dteYears(pos.expiry_date, todayIso);
  const rawBeta = getBeta(ticker);

  let uncoveredReason = null;
  if (spot == null) uncoveredReason = "no underlying quote";
  else if (T == null || T <= 0) uncoveredReason = "expired/no expiry";
  else if (iv == null) uncoveredReason = "no IV";

  return {
    kind, ticker, right, contracts: pos.contracts ?? 0, strike: pos.strike,
    expiry: pos.expiry_date, T, spot, iv, quoteDelta: oq?.delta ?? null,
    sign, betaAdj: adjBeta(rawBeta), betaAssumed: rawBeta == null,
    capital: capital ?? 0,
    covered: uncoveredReason == null, uncoveredReason,
  };
}

export function buildRiskLegs(positions, ctx) {
  const legs = [];

  for (const p of getOpenCSPs(positions))   legs.push(optionLeg("CSP",  p.ticker, "put",  -1, p, p.capital_fronted, ctx));
  for (const c of getOpenCCs(positions))    legs.push(optionLeg("CC",   c.ticker, "call", -1, c, 0,                ctx)); // capital sits in shares
  for (const l of getOpenLEAPs(positions))  legs.push(optionLeg("LEAP", l.ticker, "call", +1, l, leapCapital(l),   ctx));

  for (const s of getAssignedShares(positions)) {
    const shares  = getTotalShareCount(s);
    const eq      = ctx.getQuote(s.ticker);
    const spot    = eq?.last ?? eq?.mid ?? null;
    const rawBeta = ctx.getBeta(s.ticker);
    legs.push({
      kind: "SHARES", ticker: s.ticker, right: null, shares, spot,
      sign: +1, betaAdj: adjBeta(rawBeta), betaAssumed: rawBeta == null,
      capital: s.cost_basis_total ?? 0,
      covered: spot != null && shares > 0,
      uncoveredReason: spot == null ? "no underlying quote" : (shares > 0 ? null : "no shares"),
    });
  }

  for (const sp of getOpenSpreads(positions)) {
    const right = sp.right ?? null;
    if (!right || sp.short_strike == null) continue; // can't value without right/strikes
    legs.push(optionLeg("SPREAD", sp.ticker, right, -1, { ...sp, strike: sp.short_strike }, sp.max_loss ?? sp.capital_fronted, ctx));
    if (sp.long_strike != null) {
      legs.push(optionLeg("SPREAD", sp.ticker, right, +1, { ...sp, strike: sp.long_strike }, 0, ctx));
    }
  }

  return legs;
}

// Convenience: positions + context → everything the Risk tab renders.
export function computeRiskUnits(positions, ctx, opts = {}) {
  const r = opts.r ?? RISK_FREE_RATE;
  const legs = buildRiskLegs(positions, ctx);
  return {
    legs,
    aggregate: aggregateRisk(legs, r),
    grid: scenarioGrid(legs, opts.spxShocks ?? DEFAULT_SPX_SHOCKS, opts.ivShocks ?? DEFAULT_IV_SHOCKS, r),
  };
}

/**
 * api/_lib/computeAssignedShareIncome.js
 *
 * Diagnostic income-capacity & health calc for assigned-share positions.
 * See docs/SPEC_ASSIGNED_SHARES_INCOME_HEALTH_V1.md for the framework.
 *
 * Two regimes per position based on spot vs weighted-avg assignment price:
 *  - At/above assignment → ATM call, ~28 DTE (already monthly)
 *  - Below assignment    → ~9Δ call, next weekly (~7 DTE × 4.33 = monthly)
 *
 * Health bands (hard boundaries, no smoothing):
 *  - distance ≥ -15% → "healthy"
 *  - -25% ≤ distance < -15% → "recovering"
 *  - distance < -25% → "grinding"
 *
 * Returns aggregates + per-position breakdown. Errors on a single ticker
 * (no chain, no spot, etc.) degrade gracefully — that ticker's income is
 * null but the rest of the portfolio still aggregates.
 */

import { parseShareCount } from "../../src/lib/trading.js";
import {
  getPublicAccessToken,
  fetchStockQuote,
  fetchExpirations,
  fetchChain,
  fetchGreeks,
  strikeFromOCC,
  computeMid,
  pickExpiryByDte,
} from "./publicCom.js";

const TARGET_DELTA_BELOW   = 0.09;   // 8-10Δ band, target middle
const DELTA_ON_TARGET_MIN  = 0.05;   // chain-granularity tolerance — flag if outside
const DELTA_ON_TARGET_MAX  = 0.13;
const TARGET_DTE_ABOVE     = 28;     // ATM monthly
const TARGET_DTE_BELOW     = 7;      // weekly grind
const WEEKLY_TO_MONTHLY    = 4.33;
const HEALTHY_FLOOR_PCT    = -0.15;
const RECOVERING_FLOOR_PCT = -0.25;
const STRIKE_BAND_PCT      = 0.30;   // ±30% of spot for greeks query
const MAX_GREEKS_SYMBOLS   = 60;
const CONCURRENCY_LIMIT    = 3;

// ── Position-shape adapters (DB-row variant of src/lib/positionSchema.js) ────

function deriveTotalShares(positionRow) {
  const lots = positionRow?.lots ?? [];
  return lots.reduce((sum, lot) => sum + parseShareCount(lot?.description), 0);
}

function deriveTotalFronted(positionRow) {
  const lots = positionRow?.lots ?? [];
  return lots.reduce((sum, lot) => sum + (lot?.fronted || 0), 0);
}

function deriveAssignmentPrice(positionRow) {
  const shares = deriveTotalShares(positionRow);
  if (!shares) return null;
  return deriveTotalFronted(positionRow) / shares;
}

// ── Sigma-to-breach calc ─────────────────────────────────────────────────────
// expected_move_pct = atm_iv × sqrt(dte / 365)
// sigmas_to_breach  = required_move_pct / expected_move_pct
// where required_move_pct = (strike - spot) / spot. Positive when strike is
// above spot (CC is OTM); negative for ITM active CCs.

function computeSigmasToBreach({ strike, spot, dte, atmIv }) {
  if (atmIv == null || dte == null || dte <= 0 || !spot) return null;
  const expectedMovePct = atmIv * Math.sqrt(dte / 365);
  if (!expectedMovePct) return null;
  const requiredMovePct = (strike - spot) / spot;
  return { requiredMovePct, sigmas: requiredMovePct / expectedMovePct };
}

function findAtmIv(enrichedCalls, spot) {
  let best = null;
  for (const c of enrichedCalls) {
    if (c.iv == null) continue;
    if (!best || Math.abs(c.strike - spot) < Math.abs(best.strike - spot)) best = c;
  }
  return best?.iv ?? null;
}

// ── Health band classifier ───────────────────────────────────────────────────

function healthBand(distancePct) {
  if (distancePct == null) return null;
  if (distancePct >= HEALTHY_FLOOR_PCT) return "healthy";
  if (distancePct >= RECOVERING_FLOOR_PCT) return "recovering";
  return "grinding";
}

// ── Strike selectors ─────────────────────────────────────────────────────────

function findAtmStrike(callRows, spot) {
  if (!callRows.length) return null;
  return callRows.reduce((closest, row) =>
    Math.abs(row.strike - spot) < Math.abs(closest.strike - spot) ? row : closest
  );
}

function findStrikeByDelta(callRows, targetDelta) {
  const withDelta = callRows.filter(r => r.delta != null);
  if (!withDelta.length) return null;
  return withDelta.reduce((closest, row) =>
    Math.abs(row.delta - targetDelta) < Math.abs(closest.delta - targetDelta) ? row : closest
  );
}

// ── Per-position calc ────────────────────────────────────────────────────────

async function computeOnePosition({ token, position, todayISO, ivByTicker, ccByTicker }) {
  const ticker = position.ticker;
  const shares = deriveTotalShares(position);
  const assignmentPrice = deriveAssignmentPrice(position);
  const contractsWriteable = Math.floor(shares / 100);
  const activeCc = position.has_active_cc ? ccByTicker[ticker] : null;

  const base = {
    ticker,
    shares,
    contracts_writeable: contractsWriteable,
    assignment_price: assignmentPrice,
    has_active_cc: !!position.has_active_cc,
    iv_rank: ivByTicker[ticker] ?? null,
  };

  if (!shares || !assignmentPrice) {
    return { ...base, status: "missing_lots", monthly_income: 0 };
  }
  if (contractsWriteable === 0) {
    return { ...base, status: "below_min_lot", monthly_income: 0, note: "fewer than 100 shares" };
  }

  let spot;
  try {
    spot = await fetchStockQuote(token, ticker);
  } catch (err) {
    return { ...base, status: "no_spot", error: err.message, monthly_income: null };
  }
  if (spot == null) {
    return { ...base, status: "no_spot", monthly_income: null };
  }

  const distancePct = (spot - assignmentPrice) / assignmentPrice;
  const band = healthBand(distancePct);

  // Active-CC branch: shares are already committed at a known strike/expiry.
  // Use actual premium scaled to 30 days for income. For sigma-to-breach we
  // need ATM IV at the CC's expiry — fetch chain+greeks for the closest
  // strikes to spot. Skip gracefully on failure (sigma will be null).
  if (activeCc && activeCc.strike != null && activeCc.open_date && activeCc.expiry_date) {
    const openMs   = Date.parse(activeCc.open_date);
    const expiryMs = Date.parse(activeCc.expiry_date);
    const totalDays = Number.isFinite(openMs) && Number.isFinite(expiryMs)
      ? Math.max(1, Math.round((expiryMs - openMs) / 86400000))
      : null;
    const premium = Number(activeCc.premium_collected) || 0;
    const monthlyIncome = totalDays ? (premium * 30 / totalDays) : null;

    let atmIv = null;
    try {
      const ccChain = await fetchChain(token, ticker, activeCc.expiry_date);
      const ccCalls = (ccChain.calls || [])
        .map(row => ({
          osi:    row.instrument?.symbol,
          strike: row.instrument?.symbol ? strikeFromOCC(row.instrument.symbol) : null,
        }))
        .filter(c => c.osi && c.strike != null)
        .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))
        .slice(0, 5);
      if (ccCalls.length) {
        const greekRows = await fetchGreeks(token, ccCalls.map(c => c.osi));
        const enriched = greekRows
          .map(g => {
            const strike = ccCalls.find(c => c.osi === g.symbol)?.strike;
            const iv = g.greeks?.impliedVolatility != null ? Number(g.greeks.impliedVolatility) : null;
            return strike != null && iv != null ? { strike, iv } : null;
          })
          .filter(Boolean);
        atmIv = findAtmIv(enriched, spot);
      }
    } catch (err) {
      console.warn(`[assigned-share-income] active-CC ATM IV fetch failed for ${ticker}:`, err.message);
    }

    const breach = computeSigmasToBreach({
      strike: Number(activeCc.strike),
      spot,
      dte:    activeCc.days_to_expiry,
      atmIv,
    });

    return {
      ...base,
      current_spot:           spot,
      distance_pct:           distancePct,
      health_band:            band,
      regime:                 "active_cc",
      cc_expiry:              activeCc.expiry_date,
      cc_dte:                 activeCc.days_to_expiry ?? null,
      cc_strike:              Number(activeCc.strike),
      cc_delta:               activeCc.delta != null ? Math.abs(Number(activeCc.delta)) : null,
      cc_iv:                  null,
      cc_atm_iv:              atmIv,
      cc_mid:                 null,
      cc_contracts:           activeCc.contracts ?? null,
      cc_premium_collected:   premium,
      cc_term_days:           totalDays,
      cc_required_move_pct:   breach?.requiredMovePct ?? null,
      cc_sigmas_to_breach:    breach?.sigmas ?? null,
      monthly_income:         monthlyIncome != null ? Math.round(monthlyIncome) : null,
      delta_off_target:       false,
      status:                 "ok",
    };
  }

  const aboveAssignment = spot >= assignmentPrice;
  const targetDte = aboveAssignment ? TARGET_DTE_ABOVE : TARGET_DTE_BELOW;

  let expirations;
  try {
    expirations = await fetchExpirations(token, ticker);
  } catch (err) {
    return {
      ...base, current_spot: spot, distance_pct: distancePct, health_band: band,
      status: "no_expirations", error: err.message, monthly_income: null,
    };
  }
  const picked = pickExpiryByDte(expirations, targetDte, todayISO);
  if (!picked) {
    return {
      ...base, current_spot: spot, distance_pct: distancePct, health_band: band,
      status: "no_expiry", monthly_income: null,
    };
  }

  let chain;
  try {
    chain = await fetchChain(token, ticker, picked.expiry);
  } catch (err) {
    return {
      ...base, current_spot: spot, distance_pct: distancePct, health_band: band,
      cc_expiry: picked.expiry, cc_dte: picked.dte,
      status: "no_chain", error: err.message, monthly_income: null,
    };
  }

  const minK = spot * (1 - STRIKE_BAND_PCT);
  const maxK = spot * (1 + STRIKE_BAND_PCT);
  const calls = (chain.calls || [])
    .map(row => ({
      osi:    row.instrument?.symbol,
      strike: row.instrument?.symbol ? strikeFromOCC(row.instrument.symbol) : null,
      bid:    row.bid != null ? Number(row.bid) : null,
      ask:    row.ask != null ? Number(row.ask) : null,
    }))
    .filter(c => c.osi && c.strike != null && c.strike >= minK && c.strike <= maxK)
    .sort((a, b) => a.strike - b.strike);

  if (!calls.length) {
    return {
      ...base, current_spot: spot, distance_pct: distancePct, health_band: band,
      cc_expiry: picked.expiry, cc_dte: picked.dte,
      status: "empty_call_chain", monthly_income: null,
    };
  }

  // Cap symbols for greeks query. Window depends on regime:
  //  - above_assignment (ATM monthly): center on spot, balanced both sides
  //  - below_assignment (9Δ weekly): bias upward — we only ever pick OTM
  //    calls above spot, so spending half the budget on strikes < spot
  //    wastes coverage. Keep a small below-spot tail (~1/6) to anchor the
  //    delta curve, the rest above. Fixes cases like HOOD where dense $1
  //    spacing pushed the true 9Δ strike outside a centered 30-symbol window.
  let greekSymbols = calls.map(c => c.osi);
  if (greekSymbols.length > MAX_GREEKS_SYMBOLS) {
    const spotIdx = calls.reduce((closest, c, i) =>
      Math.abs(c.strike - spot) < Math.abs(calls[closest].strike - spot) ? i : closest, 0);
    const offsetFromSpot = aboveAssignment
      ? Math.floor(MAX_GREEKS_SYMBOLS / 2)
      : Math.floor(MAX_GREEKS_SYMBOLS / 6);
    const start = Math.max(
      0,
      Math.min(calls.length - MAX_GREEKS_SYMBOLS, spotIdx - offsetFromSpot)
    );
    greekSymbols = calls.slice(start, start + MAX_GREEKS_SYMBOLS).map(c => c.osi);
  }

  let greekRows;
  try {
    greekRows = await fetchGreeks(token, greekSymbols);
  } catch (err) {
    greekRows = [];  // delta unavailable — ATM regime can still proceed; 9Δ regime will fail
    console.warn(`[assigned-share-income] greeks failed for ${ticker}:`, err.message);
  }
  const greekBy = {};
  for (const g of greekRows) {
    greekBy[g.symbol] = {
      delta: g.greeks?.delta != null ? Math.abs(Number(g.greeks.delta)) : null,
      iv:    g.greeks?.impliedVolatility != null ? Number(g.greeks.impliedVolatility) : null,
    };
  }

  const enriched = calls.map(c => ({
    strike: c.strike,
    bid:    c.bid,
    ask:    c.ask,
    mid:    computeMid(c.bid, c.ask),
    delta:  greekBy[c.osi]?.delta ?? null,
    iv:     greekBy[c.osi]?.iv    ?? null,
    osi:    c.osi,
  }));

  const chosen = aboveAssignment
    ? findAtmStrike(enriched, spot)
    : findStrikeByDelta(enriched, TARGET_DELTA_BELOW);

  if (!chosen || chosen.mid == null) {
    return {
      ...base, current_spot: spot, distance_pct: distancePct, health_band: band,
      cc_expiry: picked.expiry, cc_dte: picked.dte,
      status: chosen ? "no_premium" : "no_strike_match",
      monthly_income: null,
    };
  }

  const perContractPremium = chosen.mid * 100 * contractsWriteable;
  const monthlyIncome = aboveAssignment
    ? perContractPremium
    : perContractPremium * WEEKLY_TO_MONTHLY;

  // Below-assignment regime targets ~9Δ. Flag when chain granularity forces
  // a strike well outside the 5-13Δ band — those positions contribute more
  // to income capacity than the spec's "low-risk grind" assumption implies.
  // Above-assignment regime is ATM, no delta gate.
  const deltaOffTarget = !aboveAssignment && (
    chosen.delta == null ||
    chosen.delta < DELTA_ON_TARGET_MIN ||
    chosen.delta > DELTA_ON_TARGET_MAX
  );

  const atmIv = findAtmIv(enriched, spot);
  const breach = computeSigmasToBreach({
    strike: chosen.strike,
    spot,
    dte:    picked.dte,
    atmIv,
  });

  return {
    ...base,
    current_spot: spot,
    distance_pct: distancePct,
    health_band:  band,
    regime:       aboveAssignment ? "above_assignment" : "below_assignment",
    cc_expiry:    picked.expiry,
    cc_dte:       picked.dte,
    cc_strike:    chosen.strike,
    cc_delta:     chosen.delta,
    cc_iv:        chosen.iv,
    cc_atm_iv:    atmIv,
    cc_mid:       chosen.mid,
    cc_required_move_pct: breach?.requiredMovePct ?? null,
    cc_sigmas_to_breach:  breach?.sigmas ?? null,
    monthly_income:    Math.round(monthlyIncome),
    delta_off_target:  deltaOffTarget,
    status: "ok",
  };
}

// ── Concurrency-limited mapper ───────────────────────────────────────────────

async function mapWithLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        out[i] = await fn(items[i], i);
      } catch (err) {
        out[i] = { __error: err.message };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * @param {object} params
 * @param {object} params.supabase
 * @param {Array}  params.positions  - rows from `positions` table
 * @param {string} params.todayISO   - YYYY-MM-DD
 * @returns {Promise<{ aggregate, per_position, errors, fetched_at }>}
 */
export async function computeAssignedShareIncome({ supabase, positions, todayISO }) {
  const assigned = (positions || []).filter(p => p.position_type === "assigned_shares");

  // Active CCs are stored as separate rows (position_type=open_csp, type=CC),
  // keyed by ticker. Index them so the per-position calc can swap actual
  // strike/premium in for tickers where shares are already committed.
  const ccByTicker = {};
  for (const p of positions || []) {
    if (p.position_type === "open_csp" && p.type === "CC" && p.ticker) {
      ccByTicker[p.ticker] = p;
    }
  }

  // IV rank from quotes table (same source as Conviction Factors / Radar surface),
  // populated via api/ingest-iv.js on ~15min cadence. Keyed on `symbol`.
  const tickers = assigned.map(p => p.ticker);
  const ivByTicker = {};
  if (tickers.length) {
    const { data: quoteRows } = await supabase
      .from("quotes")
      .select("symbol, iv_rank")
      .in("symbol", tickers);
    for (const r of quoteRows || []) {
      if (r.iv_rank != null) ivByTicker[r.symbol] = Math.round(Number(r.iv_rank));
    }
  }

  const token = await getPublicAccessToken(supabase);

  const perPosition = await mapWithLimit(assigned, CONCURRENCY_LIMIT, (p) =>
    computeOnePosition({ token, position: p, todayISO, ivByTicker, ccByTicker })
  );

  // Aggregate by health band. Two income totals:
  //  - total_monthly_income: every position's income, raw
  //  - total_monthly_income_on_target: excludes below-assignment positions
  //    where the chain didn't offer a true ~9Δ strike (chosen delta is way
  //    off). Those positions are real premium opportunities but at higher
  //    assignment risk than the spec's grind assumption — separating them
  //    keeps the headline number honest.
  const aggregate = {
    total_monthly_income: 0,
    total_monthly_income_on_target: 0,
    delta_off_target_count: 0,
    healthy:      { count: 0, monthly_income: 0 },
    recovering:   { count: 0, monthly_income: 0 },
    grinding:     { count: 0, monthly_income: 0 },
    unclassified: { count: 0, monthly_income: 0 },
  };

  const errors = [];
  for (const row of perPosition) {
    if (row.__error) {
      errors.push(row.__error);
      continue;
    }
    const inc = Number(row.monthly_income) || 0;
    aggregate.total_monthly_income += inc;
    if (!row.delta_off_target) aggregate.total_monthly_income_on_target += inc;
    if (row.delta_off_target)  aggregate.delta_off_target_count += 1;
    const bucket = row.health_band && aggregate[row.health_band] ? row.health_band : "unclassified";
    aggregate[bucket].count += 1;
    aggregate[bucket].monthly_income += inc;
  }

  aggregate.total_monthly_income           = Math.round(aggregate.total_monthly_income);
  aggregate.total_monthly_income_on_target = Math.round(aggregate.total_monthly_income_on_target);
  aggregate.healthy.monthly_income         = Math.round(aggregate.healthy.monthly_income);
  aggregate.recovering.monthly_income      = Math.round(aggregate.recovering.monthly_income);
  aggregate.grinding.monthly_income        = Math.round(aggregate.grinding.monthly_income);
  aggregate.unclassified.monthly_income    = Math.round(aggregate.unclassified.monthly_income);

  return {
    aggregate,
    per_position: perPosition.filter(r => !r.__error),
    errors,
    fetched_at: new Date().toISOString(),
  };
}

/**
 * api/_lib/computeCcWritability.js
 *
 * Covered-call writability monitor — data orchestration.
 * Spec: docs/spec_cc_writability_alert_v1.md · math: src/lib/ccWritability.js
 *
 * The CSP side has a cushion monitor computed on every snapshot. This is the
 * covered-call counterpart: for every uncovered assigned position, is a call
 * struck at or above gross basis paying enough right now to be worth writing?
 *
 * COST SHAPE (spec §2.5). The alert runs on the 30-minute intraday cron, and
 * pulling an option chain per ticker per run is not affordable. So it runs in
 * two passes:
 *
 *   1. MODELED SCREEN — Black-Scholes off a per-expiry IV curve that is
 *      refreshed once per DAY per ticker (api/_lib/ivTermStructure.js). Cheap
 *      enough to run every cron tick. Marked `priced_from: 'model'`.
 *   2. CHAIN PASS — for any ticker the screen puts at AMBER or RED, and for any
 *      ticker the screen cannot price, pull the real chain. The in-scope set is
 *      3-5 tickers, so this is bounded, and precision only matters near the
 *      boundary. Marked `priced_from: 'chain'`.
 *
 * Two hard rules the passes must respect:
 *   - NEVER one ticker-level IV across the ladder. Each rung carries its own
 *     IV, modeled or measured (spec §2.2a: a flat IV read IREN's 7d rung at
 *     31.4% when the chain said 76.1%).
 *   - NEVER approximate a rung whose window contains an earnings date, and
 *     never approximate the strike ladder. Those are chain-or-unpriced.
 *
 * A push is only ever raised off chain-priced rungs. Liquidity cannot be known
 * from a model, and §3.4 forbids pushing on an untradeable contract.
 */

import { parseShareCount } from "../../src/lib/trading.js";
import { bsCallPrice, RISK_FREE_RATE } from "../../src/lib/blackScholes.js";
import { bsGreeks } from "../../src/lib/greeks.js";
import {
  getPublicAccessToken,
  fetchStockQuote,
  fetchExpirations,
  fetchChain,
  fetchGreeks,
  strikeFromOCC,
} from "./publicCom.js";
import { loadIvTermStructure, ivForExpiry } from "./ivTermStructure.js";
import {
  DTE_LADDER,
  pickBasisStrike,
  ladderStrikes,
  buildContract,
  buildRung,
  summarizeTicker,
  decomposeEventMove,
  tradingDaysBetween,
} from "../../src/lib/ccWritability.js";

const CHAIN_META_PREFIX  = "cc_writability_chain_meta:";
const CHAIN_META_TTL_MS  = 24 * 60 * 60 * 1000;
const OVERRIDES_KEY      = "cc_writability_overrides";
const IV_PCTILE_DAYS     = 90;
const DEFAULT_BUDGET_MS  = 45_000;
const MIN_SHARES_PER_CC  = 100;

// ── Position-shape adapters (DB-row variant, mirrors computeAssignedShareIncome) ──

function deriveTotalShares(row) {
  return (row?.lots ?? []).reduce((sum, lot) => sum + parseShareCount(lot?.description), 0);
}

function deriveTotalFronted(row) {
  return (row?.lots ?? []).reduce((sum, lot) => sum + (lot?.fronted || 0), 0);
}

/**
 * Gross basis — capital fronted per share, blended across lots (spec §2.1).
 * IREN is 400 @ $55 + 400 @ $45 = $40,000 / 800 = $50.00. This is the
 * ASSIGNMENT price, deliberately not net of premium collected.
 */
function deriveGrossBasis(row) {
  const shares = deriveTotalShares(row);
  if (!shares) return null;
  return deriveTotalFronted(row) / shares;
}

function dteBetween(fromISO, toISO) {
  const a = new Date(`${fromISO}T00:00:00Z`).getTime();
  const b = new Date(`${toISO}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Nearest listed expiry to each ladder target (7/14/21/28/35/45/60).
 * Two targets can land on the same expiry when a name has sparse weeklies; the
 * closer target keeps it so the ladder never double-counts one contract.
 */
export function pickLadderExpiries(expirations, todayISO) {
  const candidates = (expirations ?? [])
    .map(e => ({ expiry: e, dte: dteBetween(todayISO, e) }))
    .filter(c => c.dte != null && c.dte > 0)
    .sort((a, b) => a.dte - b.dte);
  if (!candidates.length) return [];

  const byExpiry = new Map();
  for (const target of DTE_LADDER) {
    const best = candidates.reduce((a, b) =>
      Math.abs(b.dte - target) < Math.abs(a.dte - target) ? b : a
    );
    const existing = byExpiry.get(best.expiry);
    if (!existing || Math.abs(best.dte - target) < Math.abs(best.dte - existing.target_dte)) {
      byExpiry.set(best.expiry, { target_dte: target, expiry: best.expiry, dte: best.dte });
    }
  }
  return [...byExpiry.values()].sort((a, b) => a.dte - b.dte);
}

// ── Cached chain metadata (expiries + listed strike grid) ───────────────────

async function loadChainMeta(supabase, token, ticker, todayISO, spot) {
  const key = `${CHAIN_META_PREFIX}${ticker}`;
  try {
    const { data } = await supabase
      .from("app_cache").select("value, expires_at").eq("key", key).maybeSingle();
    if (data?.value && data.expires_at && new Date(data.expires_at).getTime() > Date.now()) {
      const parsed = typeof data.value === "string" ? JSON.parse(data.value) : data.value;
      if (parsed?.expirations?.length && parsed?.strikes?.length) return parsed;
    }
  } catch (err) {
    console.warn(`[ccWritability] chain-meta read failed for ${ticker}:`, err.message);
  }

  const expirations = await fetchExpirations(token, ticker);
  const ladder = pickLadderExpiries(expirations, todayISO);
  if (!ladder.length) return null;

  // One chain fetch purely to learn the listed strike grid. Strikes move only
  // when the exchange adds them, so daily is plenty.
  const probe = await fetchChain(token, ticker, ladder[0].expiry);
  const strikes = [...new Set((probe.calls || [])
    .map(r => (r.instrument?.symbol ? strikeFromOCC(r.instrument.symbol) : null))
    .filter(s => s != null))].sort((a, b) => a - b);
  if (!strikes.length) return null;

  const payload = { ticker, expirations, strikes, spot_at_fetch: spot ?? null, fetched_at: new Date().toISOString() };
  try {
    await supabase.from("app_cache").upsert({
      key, value: JSON.stringify(payload),
      expires_at: new Date(Date.now() + CHAIN_META_TTL_MS).toISOString(),
    });
  } catch (err) {
    console.warn(`[ccWritability] chain-meta write failed for ${ticker}:`, err.message);
  }
  return payload;
}

// ── Chain row adapters ──────────────────────────────────────────────────────

// Public.com does not document an open-interest field on the option-chain row
// and the shape has varied; read every spelling we have seen and fall back to
// null. Unknown OI degrades liquidity marking to spread-only (contractLiquidity
// treats null OI as "unknown", not "thin") rather than flagging everything.
function readOpenInterest(row) {
  const v = row?.openInterest ?? row?.open_interest ?? row?.oi ?? row?.openInterestValue ?? null;
  const n = v != null ? Number(v) : null;
  return Number.isFinite(n) ? n : null;
}

function adaptCallRows(chain) {
  return (chain.calls || [])
    .map(row => {
      const osi = row.instrument?.symbol;
      return osi ? {
        osi,
        strike:        strikeFromOCC(osi),
        bid:           row.bid != null ? Number(row.bid) : null,
        ask:           row.ask != null ? Number(row.ask) : null,
        open_interest: readOpenInterest(row),
      } : null;
    })
    .filter(c => c && c.strike != null)
    .sort((a, b) => a.strike - b.strike);
}

// ── Per-ticker evaluation ───────────────────────────────────────────────────

async function priceRungsFromChain({
  token, ticker, ladder, kBasisHint, grossBasis, shares, contracts,
  earningsDate, earningsOverride, todayISO, deadline, strikesHint,
}) {
  const rungs = [];
  let kBasis = kBasisHint;

  for (const step of ladder) {
    if (Date.now() > deadline) {
      rungs.push(buildRung({
        ...step, basisContract: { strike: kBasis, priced_from: "unpriced" },
        grossBasis, earnings_date: earningsDate, earnings_override: earningsOverride,
        todayISO,
      }));
      continue;
    }

    let calls;
    try {
      calls = adaptCallRows(await fetchChain(token, ticker, step.expiry));
    } catch (err) {
      console.warn(`[ccWritability] chain ${ticker} ${step.expiry} failed:`, err.message);
      rungs.push(buildRung({
        ...step, basisContract: { strike: kBasis, priced_from: "unpriced" },
        grossBasis, earnings_date: earningsDate, earnings_override: earningsOverride,
        todayISO,
      }));
      continue;
    }

    const listed = calls.map(c => c.strike);
    kBasis = pickBasisStrike(listed.length ? listed : (strikesHint ?? []), grossBasis) ?? kBasis;
    const wanted = ladderStrikes(listed, kBasis);
    const rows   = wanted.map(k => calls.find(c => c.strike === k)).filter(Boolean);

    // Greeks for K_basis plus the reported ladder — 5 symbols, one call.
    let greekBy = {};
    try {
      const greekRows = await fetchGreeks(token, rows.map(r => r.osi));
      for (const g of greekRows) {
        greekBy[g.symbol] = {
          delta: g.greeks?.delta != null ? Math.abs(Number(g.greeks.delta)) : null,
          iv:    g.greeks?.impliedVolatility != null ? Number(g.greeks.impliedVolatility) : null,
        };
      }
    } catch (err) {
      console.warn(`[ccWritability] greeks ${ticker} ${step.expiry} failed:`, err.message);
    }

    const contractsAt = rows.map(r => buildContract({
      strike: r.strike, bid: r.bid, ask: r.ask,
      delta:  greekBy[r.osi]?.delta ?? null,
      iv:     greekBy[r.osi]?.iv ?? null,
      open_interest: r.open_interest,
      dte: step.dte, grossBasis, shares, contracts, priced_from: "chain",
    }));

    const basisContract = contractsAt.find(c => c.strike === kBasis)
      ?? { strike: kBasis, priced_from: "unpriced" };

    rungs.push(buildRung({
      ...step,
      basisContract,
      ladder: contractsAt,
      grossBasis,
      earnings_date: earningsDate,
      earnings_override: earningsOverride,
      todayISO,
    }));
  }

  return { rungs, kBasis };
}

function priceRungsFromModel({
  curve, ladder, kBasis, spot, grossBasis, shares, contracts,
  earningsDate, earningsOverride, todayISO,
}) {
  return ladder.map(step => {
    const iv = ivForExpiry(curve, step.expiry, step.dte, todayISO);

    // §2.5: never approximate a rung whose window contains an earnings date.
    // The event is most of the front-week premium precisely when it matters,
    // and a model that misses it is wrong in the direction that fires alerts.
    const crossesEarnings = Boolean(
      earningsDate && earningsDate <= step.expiry && earningsDate >= todayISO
    );

    if (iv == null || spot == null || crossesEarnings) {
      return buildRung({
        ...step,
        basisContract: { strike: kBasis, priced_from: "unpriced" },
        grossBasis, earnings_date: earningsDate, earnings_override: earningsOverride, todayISO,
      });
    }

    const T   = step.dte / 365;
    const mid = bsCallPrice(spot, kBasis, T, RISK_FREE_RATE, iv);
    const g   = bsGreeks({ S: spot, K: kBasis, T, iv, right: "call" });

    return buildRung({
      ...step,
      // No bid/ask from a model, so spread and OI stay null and the rung is
      // never marked liquid OR illiquid on made-up quotes.
      basisContract: buildContract({
        strike: kBasis, bid: null, ask: null, mid,
        delta: g?.delta ?? null, iv, open_interest: null,
        dte: step.dte, grossBasis, shares, contracts, priced_from: "model",
      }),
      ladder: [],   // §3.2: never approximate the strike ladder
      grossBasis, earnings_date: earningsDate, earnings_override: earningsOverride, todayISO,
    });
  });
}

/**
 * Event-move decomposition off the two shortest chain-priced rungs that both
 * sit after the earnings date (spec §2.2a). Both must contain the event for
 * its variance to cancel out of the pair.
 */
function eventMoveFromRungs(rungs, earningsDate, spot, todayISO) {
  if (!earningsDate || earningsDate < todayISO) return null;
  const after = rungs
    .filter(r => r.priced_from === "chain" && r.iv != null && r.expiry >= earningsDate)
    .sort((a, b) => a.dte - b.dte);
  if (after.length < 2) return null;
  return decomposeEventMove({
    nearIv: after[0].iv, nearDte: after[0].dte,
    farIv:  after[1].iv, farDte:  after[1].dte,
    spot,
  });
}

// ── Shadow instrumentation (§8.2) ───────────────────────────────────────────

/**
 * The ticker's current IV rank as a percentile of its own trailing 90 days.
 *
 * §8.1 killed the absolute iv_rank gate: three names in three sectors moved
 * together at r ≈ 0.95, so an absolute cut is a market-wide regime filter in
 * disguise. This self-relative version is the one plausible survivor, and it is
 * logged ONLY — it cannot suppress an alert or change a tier.
 */
function pctileWithin(series, value) {
  const xs = series.filter(v => v != null && Number.isFinite(v));
  if (!xs.length || value == null) return null;
  const below = xs.filter(v => v <= value).length;
  return Math.round((below / xs.length) * 1000) / 1000;
}

// ── Main entry point ────────────────────────────────────────────────────────

/**
 * @param {object}  params
 * @param {object}  params.supabase
 * @param {Array}   params.positions  - rows from the `positions` table
 * @param {string}  params.todayISO   - YYYY-MM-DD
 * @param {number} [params.budgetMs]  - wall-clock ceiling for chain work
 * @returns {Promise<{per_position, in_scope, fetched_at, errors}>}
 */
export async function computeCcWritability({ supabase, positions, todayISO, budgetMs = DEFAULT_BUDGET_MS }) {
  const deadline = Date.now() + budgetMs;
  const errors   = [];

  // ── Scope: open assigned shares with no active CC. Derived per run, so
  // writing a call removes the ticker on the next tick with no bookkeeping.
  const inScope = (positions || []).filter(p =>
    p.position_type === "assigned_shares" && !p.has_active_cc && deriveTotalShares(p) > 0
  );
  if (!inScope.length) {
    return { per_position: [], in_scope: [], fetched_at: new Date().toISOString(), errors };
  }

  const tickers = inScope.map(p => p.ticker);

  // ── Context loads (all fail-soft) ──────────────────────────────────────────
  const quoteByTicker = {};
  try {
    const { data } = await supabase
      .from("quotes")
      .select("symbol, mid, last, iv, iv_rank, bb_position, earnings_date, earnings_meta")
      .in("symbol", tickers);
    for (const q of data ?? []) quoteByTicker[q.symbol] = q;
  } catch (err) {
    errors.push(`quotes: ${err.message}`);
  }

  const ivHistory = {};
  try {
    const since = new Date(Date.now() - IV_PCTILE_DAYS * 86_400_000).toISOString();
    const { data } = await supabase
      .from("iv_snapshots")
      .select("ticker, iv_rank, captured_at")
      .in("ticker", tickers)
      .gte("captured_at", since);
    for (const row of data ?? []) {
      if (row.iv_rank == null) continue;
      (ivHistory[row.ticker] ??= []).push(Number(row.iv_rank));
    }
  } catch (err) {
    errors.push(`iv_snapshots: ${err.message}`);
  }

  let overrides = {};
  try {
    const { data } = await supabase
      .from("app_cache").select("value").eq("key", OVERRIDES_KEY).maybeSingle();
    if (data?.value) overrides = typeof data.value === "string" ? JSON.parse(data.value) : data.value;
  } catch (err) {
    errors.push(`overrides: ${err.message}`);
  }

  // §4.5 — an order placed today on this ticker means the decision is already
  // made; alerting on it is noise on a settled question.
  const orderedToday = new Set();
  for (const p of positions || []) {
    if (p.open_date === todayISO && p.ticker) orderedToday.add(p.ticker);
  }
  try {
    const { data } = await supabase
      .from("trades")
      .select("ticker, open_date, close_date")
      .in("ticker", tickers)
      .or(`open_date.eq.${todayISO},close_date.eq.${todayISO}`);
    for (const t of data ?? []) if (t.ticker) orderedToday.add(t.ticker);
  } catch (err) {
    errors.push(`trades: ${err.message}`);
  }

  let token = null;
  try {
    token = await getPublicAccessToken(supabase);
  } catch (err) {
    errors.push(`public.com auth: ${err.message}`);
  }

  // ── Per ticker. Sequential by design: the upstream feeds rate-limit, and a
  // parallel burst across 3-5 tickers x 7 expiries is exactly the shape that
  // trips them.
  const per_position = [];

  for (const position of inScope) {
    const ticker     = position.ticker;
    const shares     = deriveTotalShares(position);
    const grossBasis = deriveGrossBasis(position);
    const contracts  = Math.floor(shares / MIN_SHARES_PER_CC);
    const quote      = quoteByTicker[ticker] ?? {};
    const ivRank     = quote.iv_rank != null ? Number(quote.iv_rank) : null;

    const base = {
      ticker, spot: null, gross_basis: grossBasis, shares, contracts, k_basis: null,
      rungs: [],
      iv: quote.iv != null ? Number(quote.iv) : null,
      iv_rank: ivRank,
      iv_rank_pctile_90d: pctileWithin(ivHistory[ticker] ?? [], ivRank),
      bb_position: quote.bb_position != null ? Number(quote.bb_position) : null,
      earnings_date: quote.earnings_date ?? null,
    };

    if (!grossBasis || contracts < 1) {
      per_position.push(summarizeTicker({
        ...base,
        status: contracts < 1 ? "below_min_lot" : "missing_lots",
        note: contracts < 1 ? "fewer than 100 shares" : "no lot capital recorded",
      }));
      continue;
    }

    let spot = quote.mid != null ? Number(quote.mid)
             : quote.last != null ? Number(quote.last)
             : null;

    if (spot == null && token) {
      try {
        spot = await fetchStockQuote(token, ticker);
      } catch (err) {
        errors.push(`${ticker} spot: ${err.message}`);
      }
    }
    if (spot == null) {
      per_position.push(summarizeTicker({ ...base, status: "no_spot" }));
      continue;
    }

    const earningsDate     = quote.earnings_date ?? null;
    const earningsOverride = Boolean(overrides?.[ticker]?.ignore_earnings);

    if (!token) {
      per_position.push(summarizeTicker({ ...base, spot, status: "no_market_data" }));
      continue;
    }

    let meta;
    try {
      meta = await loadChainMeta(supabase, token, ticker, todayISO, spot);
    } catch (err) {
      errors.push(`${ticker} chain meta: ${err.message}`);
    }
    if (!meta) {
      per_position.push(summarizeTicker({ ...base, spot, status: "no_chain_meta" }));
      continue;
    }

    const ladder = pickLadderExpiries(meta.expirations, todayISO);
    const kBasis = pickBasisStrike(meta.strikes, grossBasis);
    if (!ladder.length || kBasis == null) {
      per_position.push(summarizeTicker({
        ...base, spot, status: "no_basis_strike",
        note: kBasis == null ? "no listed strike at or above gross basis" : "no listed expiries",
      }));
      continue;
    }

    // Pass 1 — modeled screen off the daily per-expiry IV curve.
    const curve = await loadIvTermStructure(supabase, ticker, { todayISO });
    let rungs = curve
      ? priceRungsFromModel({
          curve, ladder, kBasis, spot, grossBasis, shares, contracts,
          earningsDate, earningsOverride, todayISO,
        })
      : ladder.map(step => buildRung({
          ...step, basisContract: { strike: kBasis, priced_from: "unpriced" },
          grossBasis, earnings_date: earningsDate, earnings_override: earningsOverride, todayISO,
        }));

    let modeled = summarizeTicker({ ...base, spot, k_basis: kBasis, rungs });

    // Pass 2 — escalate to the real chain when the screen says we are at or
    // near the boundary, or when it could not price the ladder at all.
    const needsChain = modeled.tier != null || rungs.some(r => r.unpriced);
    let priced_from = "model";

    if (needsChain) {
      try {
        const chained = await priceRungsFromChain({
          token, ticker, ladder, kBasisHint: kBasis, grossBasis, shares, contracts,
          earningsDate, earningsOverride, todayISO, deadline, strikesHint: meta.strikes,
        });
        if (chained.rungs.some(r => r.priced_from === "chain")) {
          rungs = chained.rungs;
          priced_from = "chain";
        }
      } catch (err) {
        errors.push(`${ticker} chain: ${err.message}`);
      }
    }

    const summary = summarizeTicker({
      ...base,
      spot,
      k_basis: rungs.find(r => r.strike != null)?.strike ?? kBasis,
      rungs,
      event_move_implied: eventMoveFromRungs(rungs, earningsDate, spot, todayISO),
      status: "ok",
    });

    // A push must rest on measured quotes: liquidity is unknowable from a model,
    // and §3.4 forbids pushing on a contract nobody can transact in.
    const modelOnly   = priced_from !== "chain";
    const orderToday  = orderedToday.has(ticker);
    const pushBlocked =
      modelOnly  ? "modeled_only" :
      orderToday ? "order_placed_today" :
      !summary.pushable ? (summary.suppressed_rung_count ? "earnings_suppressed" : null) :
      null;

    per_position.push({
      ...summary,
      priced_from,
      pushable: summary.pushable && !modelOnly && !orderToday,
      push_blocked_reason: pushBlocked,
    });
  }

  return { per_position, in_scope: tickers, fetched_at: new Date().toISOString(), errors };
}

/**
 * Shadow log (§8.2 / acceptance 12) — one row per in-scope ticker per run,
 * firing or not. The non-firing baseline is the whole point: without it the
 * pre-registered `iv_rank_pctile_90d` hypothesis can never be tested, because
 * a log of only the alerts that fired is conditioned on the outcome.
 *
 * Fails soft — a logging outage must never break the alert path.
 */
export async function writeCcWritabilityShadowLog({ supabase, payload, todayISO }) {
  const rows = (payload?.per_position ?? []).map(p => ({
    ticker:                   p.ticker,
    log_date:                 todayISO,
    tier:                     p.tier,
    status:                   p.status,
    spot:                     p.spot,
    gross_basis:              p.gross_basis,
    k_basis:                  p.k_basis,
    iv:                       p.iv,
    iv_rank:                  p.iv_rank,
    iv_rank_pctile_90d:       p.iv_rank_pctile_90d,
    bb_position:              p.bb_position,
    best_rate_rung:           p.best_rate_rung,
    shortest_qualifying_rung: p.shortest_qualifying_rung,
    qualifying_rung_count:    p.qualifying_rung_count,
    suppressed_rung_count:    p.suppressed_rung_count,
    pushable:                 p.pushable ?? false,
    priced_from:              p.priced_from ?? null,
    payload:                  p,
  }));
  if (!rows.length) return { written: 0 };

  try {
    const { error } = await supabase.from("cc_writability_log").insert(rows);
    if (error) throw error;
    return { written: rows.length };
  } catch (err) {
    console.warn("[ccWritability] shadow log write failed:", err.message);
    return { written: 0, error: err.message };
  }
}

/**
 * §4.2 re-arm floor. `alert_state` already gives fire-once-per-crossing; this
 * adds the 5-trading-day minimum on top, so a genuine re-cross two days later
 * still stays quiet. Reads the last recorded push out of `sent_alerts` — no
 * parallel mechanism, per §4.
 */
export const CC_WRITABILITY_ALERT_PREFIX = "cc-writable-";
export const REARM_TRADING_DAYS = 5;

export function ccWritabilityAlertId(ticker) {
  return `${CC_WRITABILITY_ALERT_PREFIX}${ticker}`;
}

export async function loadRecentlyPushedTickers({ supabase, tickers, todayISO }) {
  const recent = new Set();
  if (!tickers?.length) return recent;
  try {
    const { data } = await supabase
      .from("sent_alerts")
      .select("alert_id, sent_date")
      .in("alert_id", tickers.map(ccWritabilityAlertId));
    for (const row of data ?? []) {
      const elapsed = tradingDaysBetween(row.sent_date, todayISO);
      if (elapsed != null && elapsed < REARM_TRADING_DAYS) {
        recent.add(row.alert_id.slice(CC_WRITABILITY_ALERT_PREFIX.length));
      }
    }
  } catch (err) {
    console.warn("[ccWritability] re-arm read failed:", err.message);
  }
  return recent;
}

/** Record a push so the re-arm floor can see it on later runs. */
export async function recordCcWritabilityPush({ supabase, ticker, title, todayISO }) {
  try {
    await supabase.from("sent_alerts").upsert({
      alert_id:  ccWritabilityAlertId(ticker),
      sent_date: todayISO,
      title:     title ?? `${ticker} CC writable`,
    }, { onConflict: "alert_id,sent_date" });
  } catch (err) {
    console.warn(`[ccWritability] sent_alerts write failed for ${ticker}:`, err.message);
  }
}

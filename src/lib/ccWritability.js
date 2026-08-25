/**
 * src/lib/ccWritability.js
 *
 * Covered-call writability — pure math and gating.
 * Spec: docs/spec_cc_writability_alert_v1.md
 *
 * The CSP side has cushionBreach.js; this is its covered-call counterpart.
 * It answers one question per uncovered assigned position: is a call struck at
 * or above gross basis paying enough right now to be worth writing?
 *
 * THE GATE IS ONE NUMBER: annualized RoR at K_basis >= ROR_ANN_MIN. Nothing
 * else gates. Delta and IV rank are payload fields — see spec §2.3 and §8 for
 * the backtests that killed both as gates. If you are adding a threshold here,
 * re-read those sections first.
 *
 * Two things this module deliberately does NOT do:
 *   - It never assumes a ladder shape. The DTE ladder is a shallow U under a
 *     flat term structure (§2.2) and monotone decreasing around an event
 *     (§2.2a). Both are real; every rung is evaluated and the best rate is
 *     whatever it measures, never whatever the shape predicts.
 *   - It never takes one IV and spreads it across the ladder. Each rung carries
 *     its own IV. A ticker-level IV mispriced IREN's 7d rung by 45 annualized
 *     points on the acceptance fixture.
 */

import { bsCallPrice, RISK_FREE_RATE } from "./blackScholes.js";

// ── Tunables ────────────────────────────────────────────────────────────────

export const ROR_ANN_MIN = 30;          // % annualized, the entire gate
export const DTE_LADDER  = [7, 14, 21, 28, 35, 45, 60];
export const AMBER_BAND_PCT = 0.05;     // spot within 5% of qualifying → AMBER

// Liquidity marks (§3.4). A qualifying rate on an untradeable strike is a
// false positive, so these fence selection and pushes — never qualification.
export const SPREAD_ILLIQUID_PCT = 0.10;
export const OI_ILLIQUID_MIN     = 500;

// Strike ladder (§3.2): K_basis plus the next 4 LISTED strikes. Increments
// vary by name and by price level, so this walks the listed grid rather than
// adding fixed offsets.
export const LADDER_STRIKES_ABOVE = 4;

const DAYS_PER_YEAR = 365;

// ── Small helpers ───────────────────────────────────────────────────────────

function num(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round(v, places) {
  if (v == null) return null;
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

export function computeMid(bid, ask) {
  const b = num(bid);
  const a = num(ask);
  if (b == null || a == null) return null;
  return (b + a) / 2;
}

/**
 * K_basis — the lowest LISTED strike at or above gross basis (§2.1).
 * Gross basis is the assignment price, not net of premium; a strike below it
 * is a below-basis CC, which is a different instrument with opposite intent
 * and out of scope for this alert entirely (§6).
 */
export function pickBasisStrike(listedStrikes, grossBasis) {
  const basis = num(grossBasis);
  if (basis == null) return null;
  const at_or_above = (listedStrikes ?? [])
    .map(num)
    .filter(k => k != null && k >= basis)
    .sort((a, b) => a - b);
  return at_or_above.length ? at_or_above[0] : null;
}

/** K_basis plus the next N listed strikes above it, in ascending order. */
export function ladderStrikes(listedStrikes, kBasis, count = LADDER_STRIKES_ABOVE) {
  const k = num(kBasis);
  if (k == null) return [];
  const sorted = [...new Set((listedStrikes ?? []).map(num).filter(s => s != null && s >= k))]
    .sort((a, b) => a - b);
  return sorted.slice(0, count + 1);
}

/**
 * Trading days between two ISO dates, exclusive of `from`, inclusive of `to`.
 * Weekend-aware only — market holidays are NOT modeled, so this can overstate
 * elapsed trading days by at most a couple of days across a holiday week. The
 * only consumer is the §4.2 re-arm floor, where erring toward "not yet re-armed"
 * would be the harmful direction and erring the other way costs one early alert.
 */
export function tradingDaysBetween(fromISO, toISO) {
  if (!fromISO || !toISO) return null;
  const from = new Date(`${fromISO}T00:00:00Z`);
  const to   = new Date(`${toISO}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  let count = 0;
  const cursor = new Date(from);
  while (cursor < to) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

// ── Liquidity ───────────────────────────────────────────────────────────────

/**
 * Spread as a fraction of mid, plus the illiquid mark (§3.4).
 *
 * Unknown OI does not by itself make a contract illiquid — the mark would then
 * fire on every contract whenever the feed omits the field, which reads as
 * "nothing is tradeable" rather than "we don't know". Spread still applies, and
 * `open_interest: null` stays visible in the payload.
 */
export function contractLiquidity({ bid, ask, mid, open_interest }) {
  const m  = num(mid) ?? computeMid(bid, ask);
  const b  = num(bid);
  const a  = num(ask);
  const oi = num(open_interest);

  const spread_pct = (b != null && a != null && m != null && m > 0)
    ? (a - b) / m
    : null;

  const wide     = spread_pct != null && spread_pct > SPREAD_ILLIQUID_PCT;
  const thin     = oi != null && oi < OI_ILLIQUID_MIN;
  const illiquid = Boolean(wide || thin);

  return { spread_pct: round(spread_pct, 4), open_interest: oi, illiquid };
}

// ── Rate math ───────────────────────────────────────────────────────────────

/**
 * Annualized return on the SHARE capital fronted, not on the strike.
 *   ror_pct       = premium / (gross_basis x shares)
 *   ror_annualized = ror_pct x 365 / dte
 * Measuring against gross basis is what makes rungs comparable across tenors
 * and strikes: the denominator is the capital actually tied up in the position.
 */
export function annualizedRorPct({ premium, capital, dte }) {
  const p = num(premium);
  const c = num(capital);
  const d = num(dte);
  if (p == null || c == null || d == null || c <= 0 || d <= 0) return null;
  return (p / c) * (DAYS_PER_YEAR / d) * 100;
}

/**
 * One priced contract at one strike and one expiry.
 *
 * `ror_annualized` is computed from the mid and `ror_annualized_bid` from the
 * bid; §3.4 requires both, because on a wide strike the mid is a rate nobody
 * can actually transact at.
 *
 * Above K_basis, `ror_annualized` is informational only — the gate reads the
 * K_basis rung and nothing else (§2, §3.2).
 */
export function buildContract({
  strike, bid, ask, mid, delta, iv, open_interest,
  dte, grossBasis, shares, contracts, priced_from = "chain",
}) {
  const k       = num(strike);
  const m       = num(mid) ?? computeMid(bid, ask);
  const basis   = num(grossBasis);
  const sh      = num(shares);
  const ct      = num(contracts);
  const liq     = contractLiquidity({ bid, ask, mid: m, open_interest });
  const capital = (basis != null && sh != null) ? basis * sh : null;

  const premium     = (m  != null && ct != null) ? m  * 100 * ct : null;
  const premium_bid = (num(bid) != null && ct != null) ? num(bid) * 100 * ct : null;

  // Appreciation captured if the call is assigned. Zero at K_basis when basis
  // sits exactly on a listed strike — that is the whole point of §3.2, and a
  // nonzero value there means spot has been substituted for basis somewhere.
  const gain_if_assigned = (k != null && basis != null && sh != null)
    ? (k - basis) * sh
    : null;
  const total_if_assigned = (gain_if_assigned != null && premium != null)
    ? gain_if_assigned + premium
    : null;

  return {
    strike:                k,
    bid:                   num(bid),
    ask:                   num(ask),
    mid:                   round(m, 4),
    spread_pct:            liq.spread_pct,
    open_interest:         liq.open_interest,
    illiquid:              liq.illiquid,
    delta:                 num(delta),
    iv:                    num(iv),
    premium:               round(premium, 2),
    ror_pct:               round(premium != null && capital ? (premium / capital) * 100 : null, 4),
    ror_annualized:        round(annualizedRorPct({ premium,     capital, dte }), 2),
    ror_annualized_bid:    round(annualizedRorPct({ premium: premium_bid, capital, dte }), 2),
    gain_if_assigned:      round(gain_if_assigned, 2),
    total_if_assigned:     round(total_if_assigned, 2),
    return_on_capital_pct: round(total_if_assigned != null && capital ? (total_if_assigned / capital) * 100 : null, 4),
    priced_from,
  };
}

/**
 * Spot that would put the K_basis contract exactly at the gate, holding this
 * rung's IV fixed. Drives the AMBER band and doubles as the "how far away is
 * this" number in the payload.
 *
 * Bisection rather than a closed form: BS call price is strictly increasing in
 * spot, so this converges, and it stays correct if the pricing model is ever
 * swapped. Returns null when the target premium is unreachable at any spot the
 * search covers.
 */
export function spotRequiredForGate({
  strike, dte, iv, grossBasis, rorAnnMin = ROR_ANN_MIN, r = RISK_FREE_RATE,
}) {
  const k     = num(strike);
  const d     = num(dte);
  const vol   = num(iv);
  const basis = num(grossBasis);
  if (k == null || d == null || vol == null || basis == null) return null;
  if (d <= 0 || vol <= 0 || k <= 0 || basis <= 0) return null;

  // Premium per share the gate demands: ror_ann = (prem_ps / basis) x 365/dte.
  const targetPerShare = (rorAnnMin / 100) * (d / DAYS_PER_YEAR) * basis;
  const T = d / DAYS_PER_YEAR;

  let lo = 0.01;
  let hi = k * 10;
  if (bsCallPrice(hi, k, T, r, vol) < targetPerShare) return null;
  if (bsCallPrice(lo, k, T, r, vol) > targetPerShare) return round(lo, 4);

  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (bsCallPrice(mid, k, T, r, vol) < targetPerShare) lo = mid;
    else hi = mid;
  }
  return round((lo + hi) / 2, 4);
}

/**
 * Two-point variance decomposition off adjacent rungs (§2.2a).
 *
 * Both expiries must sit AFTER the event, so the event variance is common to
 * both and cancels:
 *   sigma_near^2 T_near = sigma_base^2 T_near + V
 *   sigma_far^2  T_far  = sigma_base^2 T_far  + V
 *   => sigma_base^2 = (sigma_far^2 T_far - sigma_near^2 T_near) / (T_far - T_near)
 *      V            = sigma_near^2 T_near - sigma_base^2 T_near
 *
 * Carrying this makes the event-driven share of a rich front-week rate visible
 * instead of letting it read as base richness. Returns null when the pair
 * implies a non-positive base variance or event variance — a real term
 * structure can do that, and a made-up number is worse than none.
 */
export function decomposeEventMove({ nearIv, nearDte, farIv, farDte, spot }) {
  const sn = num(nearIv);
  const sf = num(farIv);
  const tn = num(nearDte);
  const tf = num(farDte);
  const s  = num(spot);
  if (sn == null || sf == null || tn == null || tf == null) return null;
  if (sn <= 0 || sf <= 0 || tn <= 0 || tf <= tn) return null;

  const Tn = tn / DAYS_PER_YEAR;
  const Tf = tf / DAYS_PER_YEAR;
  const varNear = sn * sn * Tn;
  const varFar  = sf * sf * Tf;

  const baseVarAnnual = (varFar - varNear) / (Tf - Tn);
  if (!(baseVarAnnual > 0)) return null;

  const eventVar = varNear - baseVarAnnual * Tn;
  if (!(eventVar > 0)) return null;

  const base_iv        = Math.sqrt(baseVarAnnual);
  const event_move_pct = Math.sqrt(eventVar);

  return {
    base_iv:        round(base_iv, 4),
    event_move_pct: round(event_move_pct, 4),
    down_level:     s != null ? round(s * (1 - event_move_pct), 2) : null,
    up_level:       s != null ? round(s * (1 + event_move_pct), 2) : null,
    from_dtes:      [tn, tf],
  };
}

// ── Rung assembly ───────────────────────────────────────────────────────────

/**
 * One ladder rung: the K_basis contract that gates, plus the reported strike
 * ladder above it.
 *
 * `qualifies` reads the K_basis mid rate and nothing else. Liquidity and
 * earnings suppression are carried alongside and applied at selection time
 * (§3.4, §4.4) so that a suppressed-but-qualifying rung stays visible in the
 * payload rather than vanishing from it — the number Vinh is deciding against
 * has to be on screen even when the alert is deliberately silent.
 */
export function buildRung({
  target_dte, expiry, dte, basisContract, ladder = [],
  earnings_date = null, earnings_override = false, grossBasis,
  todayISO = null, rorAnnMin = ROR_ANN_MIN,
}) {
  const priced   = basisContract?.priced_from ?? "unpriced";
  const rate     = basisContract?.ror_annualized ?? null;
  const unpriced = priced === "unpriced" || rate == null;

  // Forward-looking only: quotes.earnings_date is the NEXT report, but a stale
  // row can leave a past date sitting there, and suppressing rungs against an
  // event that already happened would silence the alert indefinitely.
  const earnings_before_expiry = Boolean(
    earnings_date && expiry && isValidDate(earnings_date) &&
    earnings_date <= expiry &&
    (todayISO == null || earnings_date >= todayISO)
  );

  const qualifies = !unpriced && rate >= rorAnnMin;

  const spot_required = (!unpriced && basisContract?.iv != null)
    ? spotRequiredForGate({
        strike: basisContract.strike, dte, iv: basisContract.iv, grossBasis, rorAnnMin,
      })
    : null;

  return {
    target_dte,
    expiry,
    dte,
    priced_from: priced,
    unpriced,
    qualifies,
    spot_required,
    earnings_date,
    earnings_before_expiry,
    suppressed: Boolean(earnings_before_expiry && !earnings_override),
    suppressed_reason: earnings_before_expiry && !earnings_override ? "earnings_in_window" : null,
    // K_basis contract fields are lifted onto the rung so a consumer reading a
    // rung never has to know the ladder exists.
    strike:             basisContract?.strike ?? null,
    bid:                basisContract?.bid ?? null,
    ask:                basisContract?.ask ?? null,
    mid:                basisContract?.mid ?? null,
    delta:              basisContract?.delta ?? null,
    iv:                 basisContract?.iv ?? null,
    open_interest:      basisContract?.open_interest ?? null,
    spread_pct:         basisContract?.spread_pct ?? null,
    illiquid:           basisContract?.illiquid ?? null,
    premium:            basisContract?.premium ?? null,
    ror_pct:            basisContract?.ror_pct ?? null,
    ror_annualized:     rate,
    ror_annualized_bid: basisContract?.ror_annualized_bid ?? null,
    gain_if_assigned:   basisContract?.gain_if_assigned ?? null,
    total_if_assigned:  basisContract?.total_if_assigned ?? null,
    strike_ladder:      ladder,
  };
}

// A date that fails to parse must not silently suppress a rung forever.
function isValidDate(iso) {
  return !Number.isNaN(new Date(`${iso}T00:00:00Z`).getTime());
}

// ── Selection + tiering ─────────────────────────────────────────────────────

/** Rungs eligible to be named in a push: qualifying, liquid, not suppressed. */
function pushableRungs(rungs) {
  return rungs.filter(r => r.qualifies && !r.illiquid && !r.suppressed);
}

/**
 * The furthest-out tradeable strike above K_basis on a rung — the one that
 * keeps the most appreciation while still being writable at a real price.
 *
 * This is a mechanical pick (highest total-if-assigned among liquid strikes
 * strictly above K_basis), NOT a recommendation. §3.3: what separates strikes
 * is preference about outcome shape, not edge, and that is Vinh's call. The
 * payload reports the whole ladder; this field only saves him scanning it.
 */
export function bestUpsideStrike(rung) {
  const above = (rung?.strike_ladder ?? []).filter(c =>
    c.strike != null && rung.strike != null && c.strike > rung.strike && !c.illiquid
  );
  if (!above.length) return null;
  return above.reduce((best, c) =>
    (c.total_if_assigned ?? -Infinity) > (best.total_if_assigned ?? -Infinity) ? c : best
  );
}

/**
 * Assemble one ticker's payload from priced rungs.
 *
 * Tier (§2.4):
 *   RED   — at least one rung qualifies at K_basis
 *   AMBER — none qualify, but spot is within 5% of the qualifying spot on some rung
 *
 * Tier is computed BEFORE suppression, so the dashboard still shows RED on a
 * position that is deliberately being held through a print; `pushable` is what
 * gates the push. That split is §7's acceptance case: IREN qualifies at every
 * rung and pushes on none of them.
 */
export function summarizeTicker({
  ticker, spot, gross_basis, shares, contracts, k_basis, rungs = [],
  iv = null, iv_rank = null, iv_rank_pctile_90d = null, bb_position = null,
  earnings_date = null, event_move_implied = null, status = "ok", note = null,
}) {
  const priced     = rungs.filter(r => !r.unpriced);
  const qualifying = priced.filter(r => r.qualifies);

  // Selection excludes illiquid contracts entirely (§3.4). A 20%-spread rung
  // being "best rate" is how a false positive becomes a push.
  const liquidQualifying = qualifying.filter(r => !r.illiquid);

  const best_rate_rung = liquidQualifying.length
    ? liquidQualifying.reduce((b, r) => (r.ror_annualized > b.ror_annualized ? r : b))
    : null;

  const shortest_qualifying_rung = liquidQualifying.length
    ? liquidQualifying.reduce((b, r) => (r.dte < b.dte ? r : b))
    : null;

  // A ladder does not always sit at ONE strike. K_basis is "the lowest listed
  // strike >= gross basis" (§2.1), and listed grids differ by expiry — LRCX
  // quotes $2.50 increments on its weeklies but $10 on the 10/16 monthly, so
  // the front rungs price at $325 and the back rung at $330. Selection is
  // correct in both cases, but the rates are then NOT comparable rung to rung,
  // and a rung above gross basis no longer returns zero appreciation. Surface
  // that rather than letting one header strike speak for the whole ladder.
  const rungStrikes = [...new Set(priced.map(r => r.strike).filter(s => s != null))]
    .sort((a, b) => a - b);

  const near = priced.filter(r =>
    !r.qualifies && r.spot_required != null && spot != null &&
    spot >= r.spot_required * (1 - AMBER_BAND_PCT)
  );

  let tier = null;
  if (qualifying.length)  tier = "RED";
  else if (near.length)   tier = "AMBER";

  const pushable = pushableRungs(rungs);
  const push_rung = pushable.length
    ? pushable.reduce((b, r) => (r.dte < b.dte ? r : b))
    : null;

  return {
    ticker,
    status,
    note,
    spot,
    gross_basis,
    k_basis,
    // The distinct strikes the ladder actually priced at. Equal endpoints mean
    // one strike throughout; `k_basis_varies` is the flag consumers should read
    // before comparing rates across rungs.
    k_basis_min:    rungStrikes.length ? rungStrikes[0] : k_basis,
    k_basis_max:    rungStrikes.length ? rungStrikes[rungStrikes.length - 1] : k_basis,
    k_basis_varies: rungStrikes.length > 1,
    shares,
    contracts,
    capital: gross_basis != null && shares != null ? round(gross_basis * shares, 2) : null,
    tier,
    // Push-worthiness is narrower than the tier: liquid, unsuppressed, qualifying.
    pushable:   Boolean(push_rung),
    push_rung:  push_rung ? push_rung.target_dte : null,
    rungs,
    best_rate_rung:             best_rate_rung ? best_rate_rung.target_dte : null,
    shortest_qualifying_rung:   shortest_qualifying_rung ? shortest_qualifying_rung.target_dte : null,
    suppressed_rung_count:      rungs.filter(r => r.suppressed).length,
    qualifying_rung_count:      qualifying.length,
    // Shadow instrumentation (§8) — payload only, never a gate.
    iv,
    iv_rank,
    iv_rank_pctile_90d,
    bb_position,
    earnings_date,
    event_move_implied,
    push_copy: push_rung ? formatPushCopy({ ticker, rung: push_rung }) : null,
  };
}

/**
 * Push copy (§3.4): the shortest qualifying rung, plus the appreciation the
 * furthest tradeable strike above basis would keep.
 *   IREN writable — 28d, $50 $1,744 @ 56.8% ann · or $60 $684 @ D0.15 keeping $8,000 upside
 */
export function formatPushCopy({ ticker, rung }) {
  if (!rung) return null;
  const money = v => `$${Math.round(v).toLocaleString("en-US")}`;
  const head = `${ticker} writable — ${rung.dte}d, $${rung.strike} ${money(rung.premium)} @ ${rung.ror_annualized.toFixed(1)}% ann`;

  const upside = bestUpsideStrike(rung);
  if (!upside || !(upside.gain_if_assigned > 0)) return head;

  const deltaPart = upside.delta != null ? ` @ Δ${upside.delta.toFixed(2)}` : "";
  return `${head} · or $${upside.strike} ${money(upside.premium)}${deltaPart} keeping ${money(upside.gain_if_assigned)} upside`;
}

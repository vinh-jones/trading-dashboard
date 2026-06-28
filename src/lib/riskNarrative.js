// Deterministic, DESCRIPTIVE-ONLY interpretation of risk-unit values for the
// Risk tab. Pure functions map value buckets → plain-English education. These
// explain what a number *means*; they never prescribe an action. Same observe-
// first discipline as the rest of the risk work — a readout is a brake, not a
// green light.

import { getVixBand } from "./vixBand.js";

function fmt$(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  const body = a >= 1000 ? `$${(a / 1000).toFixed(1)}k` : `$${a.toFixed(0)}`;
  return n < 0 ? `-${body}` : body;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Effective portfolio beta implied by net beta-weighted delta ($/1% SPX).
// A book that moved exactly with the market loses 1% of account per 1% SPX, so
// effectiveBeta = (βΔ / account) / 1%.
export function effectiveBeta(netBetaWeightedDelta, accountValue) {
  if (!accountValue) return null;
  return (netBetaWeightedDelta / accountValue) / 0.01;
}

// ── Direction (beta-weighted delta) ──────────────────────────────────────────
export function deltaNarrative(netBWD, accountValue) {
  const beta = effectiveBeta(netBWD, accountValue);
  const dir = netBWD >= 0 ? "long" : "short";
  const b = beta == null ? null : Math.abs(beta);

  let label;
  if (Math.abs(netBWD) < 1) label = "≈ market-neutral";
  else if (b == null)        label = `net ${dir}`;
  else if (b >= 1.3)         label = `strongly net ${dir} · high-beta`;
  else if (b >= 0.7)         label = `net ${dir} · ~market-like`;
  else if (b >= 0.1)         label = `modestly net ${dir}`;
  else                       label = "≈ market-neutral";

  const move = netBWD >= 0 ? "gains" : "loses";
  const betaStr = beta != null ? ` — about ${b.toFixed(1)}× the market${b >= 1.3 ? ", a high-beta tilt" : ""}` : "";
  const plain = `If the S&P rises 1%, the book ${move} ≈ ${fmt$(Math.abs(netBWD))} (and the reverse on a 1% drop)${betaStr}.`;
  const about = "Beta-weighted delta — the book's directional exposure as dollar P&L for a 1% move in the S&P 500. It folds every position's delta and beta into one number. Positive = net long the market.";
  return { label, plain, about };
}

// ── Volatility (net vega) ────────────────────────────────────────────────────
export function vegaNarrative(netVega, vix) {
  const band = getVixBand(vix);
  const mag = Math.abs(netVega);
  const long = netVega > 0;
  const fivePt = fmt$(mag * 5);

  let label;
  if (mag < 50) label = "≈ vega-neutral";
  else label = `${mag >= 500 ? "strongly " : ""}net ${long ? "long" : "short"} vega`;

  const vixStr = band ? ` Current VIX regime: ${band.sentiment}.` : "";
  let plain;
  if (mag < 50) {
    plain = `Long-call (LEAP) vega and short-put vega roughly cancel — little net sensitivity to implied vol.${vixStr}`;
  } else if (long) {
    plain = `Net LONG volatility — unusual for a wheel (short puts are short vega), here outweighed by long-call (LEAP) vega. A +1 IV-point move is worth ≈ ${fmt$(netVega)}; a 5-point IV spike ≈ +${fivePt}. A vol-spike selloff is partly cushioned.${vixStr}`;
  } else {
    plain = `Net SHORT volatility — the classic premium-selling posture. A +1 IV-point move costs ≈ ${fmt$(mag)}; a 5-point IV spike ≈ -${fivePt} against the book.${vixStr}`;
  }
  const about = "Net vega — dollar P&L if implied volatility rises 1 point across the book. Long calls (LEAPs) are long vega; short puts/calls (CSPs/CCs) are short vega. The sign tells you whether the book wants IV up or down.";
  return { label, plain, about };
}

// ── Time decay (net theta) ───────────────────────────────────────────────────
export function thetaNarrative(netTheta) {
  const collect = netTheta >= 0;
  const perMonth = fmt$(Math.abs(netTheta) * 30);
  const label = collect ? "collecting decay" : "paying decay";
  const plain = collect
    ? `The book collects ≈ ${fmt$(netTheta)}/day (~${perMonth}/mo) from time passing — premium income (CSPs/CCs) plus shares outweigh LEAP decay.`
    : `The book pays ≈ ${fmt$(Math.abs(netTheta))}/day (~${perMonth}/mo) in time decay — LEAP bleed outweighs premium collected.`;
  const about = "Net theta — dollar P&L per day from time passing, holding price and vol constant. Short premium collects theta; long options (LEAPs) pay it.";
  return { label, plain, about };
}

// ── One-line book posture (derived from the three signs) ─────────────────────
export function bookSummary(agg) {
  const dir = agg.netBetaWeightedDelta > 0 ? "long the market"
            : agg.netBetaWeightedDelta < 0 ? "short the market" : "market-neutral";
  const vol = Math.abs(agg.netVega) < 50 ? "vega-neutral"
            : agg.netVega > 0 ? "long vol" : "short vol";
  const th = agg.netTheta >= 0 ? "collecting theta" : "paying theta";
  return `${cap(dir)}, ${vol}, ${th}.`;
}

// ── Family risk-vs-capital divergence ────────────────────────────────────────
// riskShare, capShare are fractions in [0, 1].
export function familyDivergence(riskShare, capShare) {
  if (capShare < 0.005) {
    return riskShare >= 0.05 ? "risk-dense — meaningful risk on ~no capital" : "small footprint";
  }
  const ratio = riskShare / capShare;
  if (ratio >= 1.5)  return `risk-dense — ~${ratio.toFixed(1)}× more risk than capital share`;
  if (ratio <= 0.67) return `capital-heavy, risk-light — ~${(1 / ratio).toFixed(1)}× more capital than risk`;
  return "balanced — risk ≈ capital share";
}

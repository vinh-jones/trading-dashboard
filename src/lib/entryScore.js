// Entry-quality score for selling premium on a ticker — shared across Radar,
// the CSP selection calculator, and ticker detail.
//
// Core (unchanged from the original Radar scannerScore, validated):
//   base = (1 − bbPosition)·0.50  +  compositeIv·0.50
//   → structure (lower Bollinger Band = better) and richness (IV rank + IV)
//     weighted co-equally — Ryan's 1b + 1a.
// then × trend (MA50/200) × IV-trend, and — new — × gamma-environment × flow.
//
// The UW-sourced modifiers (gammaEnvMod, flowMod) are null-safe no-ops: until
// the Unusual Whales backbone populates `gammaEnv` / `flowSentiment`, they
// return 1.0 and the score is byte-identical to the old scannerScore. They are
// deliberately capped tighter than the core — Ryan treats gamma/flow as
// confirmation ("extra fuel"), never the driver.

export function compositeIv(iv, ivRank) {
  if (iv == null || ivRank == null) return null;
  return (ivRank / 100 * 0.60) + (Math.min(iv / 1.50, 1.0) * 0.40);
}

export function getTrendState(price, ma50, ma200) {
  if (price == null) return null;
  const above200 = ma200 == null || price >= ma200;
  const above50  = ma50  == null || price >= ma50;
  if (above200 && above50)   return { state: "uptrend",   label: "Uptrend",    modifier: 1.00 };
  if (above200 && !above50)  return { state: "pullback",  label: "Pullback",   modifier: 0.90 };
  if (!above200 && above50)  return { state: "recovering",label: "Recovering", modifier: 0.85 };
  return                            { state: "downtrend", label: "Downtrend",  modifier: 0.70 };
}

// Gamma environment. `gammaEnv` is the net dealer gamma (call_gamma + put_gamma)
// pre-normalized by ingestion to roughly [-1, 1]. > 0 = positive-gamma (dealers
// stabilize → chop, CSP-friendly), < 0 = negative-gamma (dealers amplify → fast
// moves, risky). Boosts up to +10% in stable regimes, damps to −15% in fast
// ones. null → no-op.
export function gammaEnvMod(gammaEnv) {
  if (gammaEnv == null) return 1.0;
  const g = Math.max(-1, Math.min(1, gammaEnv));
  return g >= 0 ? 1 + 0.10 * g : 1 + 0.15 * g;
}

// Flow confirmation. `flowSentiment` is pre-normalized to [-1, 1]: > 0 = whales
// selling puts / bullish (Ryan's primary CSP confirmation), < 0 = bearish put
// buying. Symmetric ±15% — capped tighter than the core. null → no-op.
export function flowMod(flowSentiment) {
  if (flowSentiment == null) return 1.0;
  const f = Math.max(-1, Math.min(1, flowSentiment));
  return 1 + 0.15 * f;
}

export function entryScore(
  bbPosition, iv, ivRank, price, ma50, ma200, ivTrend,
  gammaEnv = null, flowSentiment = null
) {
  if (bbPosition == null) return null;
  const ivComp = compositeIv(iv, ivRank);
  if (ivComp == null) return null;
  const base  = (1 - bbPosition) * 0.50 + ivComp * 0.50;
  const trend = getTrendState(price, ma50, ma200);
  const ivMod = (ivTrend?.state && ivTrend.state !== "insufficient") ? (ivTrend.modifier ?? 1.0) : 1.0;
  return base
    * (trend?.modifier ?? 1.0)
    * ivMod
    * gammaEnvMod(gammaEnv)
    * flowMod(flowSentiment);
}

export function scoreLabel(score) {
  if (score == null) return null;
  if (score >= 0.70) return "Strong";
  if (score >= 0.50) return "Moderate";
  if (score >= 0.30) return "Neutral";
  return "Weak";
}

// Earnings-before-expiry risk for a specific (ticker, expiry). Ryan handles
// earnings specially (sell *outside* the expected move). This is an overlay for
// position / calculator surfaces — NOT folded into the per-ticker entryScore,
// which has no expiry. All dates are ISO yyyy-mm-dd.
export function entryEarningsRisk({ earningsDateIso, expiryIso, todayIso } = {}) {
  if (!earningsDateIso || !expiryIso) return { earningsBeforeExpiry: false, earningsDate: null };
  const today = todayIso ?? new Date().toISOString().slice(0, 10);
  const before = earningsDateIso >= today && earningsDateIso <= expiryIso;
  return { earningsBeforeExpiry: before, earningsDate: before ? earningsDateIso : null };
}

// 14-day Wilder RSI — a momentum context signal for the Radar tab.
//
// This is DISPLAY-ONLY context, deliberately NOT part of the Scanner Score
// (entryScore). RSI largely re-measures "is price stretched" (already captured
// by BB Position), so folding it into the score would double-count. Its unique
// value is distinguishing "oversold and turning" from "oversold and still
// falling" — which a trader reads off the badge, not the composite number.
//
// computeRSI runs in api/bb.js (Node) off the same daily-close series it already
// fetches for Bollinger Bands; the bucket/label/color helpers run in the browser.

/**
 * Wilder's RSI over a series of closing prices.
 * Seeds the first average as a simple mean of the first `period` deltas, then
 * applies Wilder smoothing for the remainder — the canonical RSI definition.
 *
 * @param {number[]} closes  daily closes, oldest → newest
 * @param {number}   period  lookback (default 14)
 * @returns {number|null}    RSI in [0,100], or null if too few closes
 */
export function computeRSI(closes, period = 14) {
  if (!Array.isArray(closes)) return null;
  const c = closes.filter((v) => v != null && Number.isFinite(v));
  if (c.length < period + 1) return null;

  // Seed: simple average of the first `period` gains/losses.
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = c[i] - c[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  // Wilder smoothing over the remaining deltas.
  for (let i = period + 1; i < c.length; i++) {
    const diff = c[i] - c[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100; // no downside over the window
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ── Bucketing (mirrors bbBucket.js) ───────────────────────────────────────────
// Standard 30/70 thresholds. For a put-seller, oversold is the favorable read.

export function rsiBucket(rsi) {
  if (rsi == null) return null;
  if (rsi < 30) return "oversold";
  if (rsi > 70) return "overbought";
  return "neutral";
}

export const RSI_BUCKET_LABELS = {
  oversold:   "Oversold",
  neutral:    "Neutral",
  overbought: "Overbought",
};

export const RSI_BUCKET_DEFINITIONS = {
  oversold:   "RSI(14) < 30 — recent selling is one-sided. Favorable for a put entry IF momentum is stabilizing; still risky if price is in free-fall.",
  neutral:    "RSI(14) 30–70 — no momentum edge either way.",
  overbought: "RSI(14) > 70 — recent buying is one-sided and price is extended. Thinner margin of safety for a new put.",
};

// Hardcoded hex — intentional exception (same role as BB_BUCKET_COLORS):
// a semantic-data color map for RSI buckets. Green = favorable (oversold),
// amber = extended (overbought), muted = neutral. Matches the BB badge palette.
export const RSI_BUCKET_COLORS = {
  oversold:   { bg: "#1c2d1c", text: "#3fb950" },
  neutral:    { bg: "#21262d", text: "#8b949e" },
  overbought: { bg: "#3d3010", text: "#e3b341" },
};

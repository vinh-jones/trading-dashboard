// Flow smoothing (finance review) — confirm institutional flow before any
// flow-driven *pull-toward-risk* recommendation fires (let-it-ride, ★ candidacy).
// Two layers that must AGREE:
//   • intraday EMA over the 15-min snapshots → kills single-print noise.
//   • daily-close streak → consecutive trading days the close agreed in
//     direction → "repeat activity, not a one-off" (Ryan's rule).
//
// "Confirmed" = the EMA is in-direction AND the streak has ≥ N days agreeing.
// Push-toward-safety directions (shed, assignment defense) use the EMA alone
// (noise removed) but NOT the streak — erring toward closing is the safe error,
// so it should never be blocked waiting for multi-day confirmation.

export const FLOW_SMOOTHING_DEFAULTS = {
  EMA_ALPHA:  0.3,   // weight on the newest reading in the intraday EMA
  BULLISH:    0.2,   // direction thresholds (match trendOverlay)
  BEARISH:   -0.2,
  STREAK_MIN: 2,     // consecutive in-direction days required to confirm
};

export function flowDir(value, config = FLOW_SMOOTHING_DEFAULTS) {
  const cfg = { ...FLOW_SMOOTHING_DEFAULTS, ...config };
  if (value == null || !Number.isFinite(value)) return 0;
  if (value >= cfg.BULLISH) return 1;
  if (value <= cfg.BEARISH) return -1;
  return 0;
}

function rollStreak(prevStreak, dir) {
  const p = Number.isFinite(prevStreak) ? prevStreak : 0;
  if (dir === 0) return 0;                  // a neutral day breaks the streak
  if (Math.sign(p) === dir) return p + dir; // same direction → extend
  return dir;                               // flip / cold start → ±1
}

// Advance the per-ticker flow state for one snapshot. `raw` may be null (no
// flow data this run) → state is carried forward unchanged. On the first run of
// a new trading day, yesterday's final EMA is finalized into the streak and the
// EMA reseeds; within a day the EMA blends.
export function updateFlowState(
  { raw, today, prevEma = null, prevDay = null, prevStreak = 0 } = {},
  config = FLOW_SMOOTHING_DEFAULTS
) {
  const cfg = { ...FLOW_SMOOTHING_DEFAULTS, ...config };
  const streak0 = Number.isFinite(prevStreak) ? prevStreak : 0;

  if (raw == null || !Number.isFinite(raw)) {
    return { flow_ema: prevEma ?? null, flow_day: prevDay ?? null, flow_streak: streak0 };
  }

  if (prevDay !== today) {
    // New trading day. Finalize yesterday's direction into the streak (skip on
    // a cold start where there is no prior day), then reseed the EMA.
    const streak = prevDay == null ? streak0 : rollStreak(streak0, flowDir(prevEma, cfg));
    return { flow_ema: +raw.toFixed(4), flow_day: today, flow_streak: streak };
  }

  const ema = prevEma == null ? raw : cfg.EMA_ALPHA * raw + (1 - cfg.EMA_ALPHA) * prevEma;
  return { flow_ema: +ema.toFixed(4), flow_day: today, flow_streak: streak0 };
}

// Is flow confirmed in a direction? EMA in-direction AND streak ≥ N days agree.
// Used for the pull-toward-risk gates only.
export function flowConfirmation({ flowEma, flowStreak } = {}, config = FLOW_SMOOTHING_DEFAULTS) {
  const cfg = { ...FLOW_SMOOTHING_DEFAULTS, ...config };
  const ema = Number.isFinite(flowEma) ? flowEma : null;
  const streak = Number.isFinite(flowStreak) ? flowStreak : 0;
  return {
    bullish: ema != null && ema >= cfg.BULLISH && streak >=  cfg.STREAK_MIN,
    bearish: ema != null && ema <= cfg.BEARISH && streak <= -cfg.STREAK_MIN,
  };
}

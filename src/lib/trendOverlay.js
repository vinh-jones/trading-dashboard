// Consumer 4 — flow conviction veto on the redeploy signal.
//
// The redeploy ratio (redeploySignal) is trend-blind: it says "close & redeploy"
// purely on how fast the leftover premium is decaying. This overlays
// institutional flow so that:
//   • a winner smart money is still pushing your way doesn't get churned out the
//     moment the close-trigger fires (bullish flow → "let it ride"), and
//   • a position flow has turned against gets flagged to shed earlier than the
//     premium math alone would say (bearish flow → "shed").
//
// Pure and additive — it NEVER mutates the redeploy ratio; it returns a separate
// recommendation. This is Jefferson's "close early unless big money is piling
// in" encoded against the redeploy chip.

export const TREND_OVERLAY_DEFAULTS = { BULLISH: 0.2, BEARISH: -0.2 };

export function trendOverlay(redeploy, flowSentiment, config = TREND_OVERLAY_DEFAULTS) {
  const base = redeploy && !redeploy.skipped ? redeploy.redeploy_state : null;
  const flow = flowSentiment ?? null;
  if (base == null) return { state: null, base: null, overridden: false, flow, reason: null };

  const { BULLISH, BEARISH } = { ...TREND_OVERLAY_DEFAULTS, ...config };
  const bullish = flow != null && flow >= BULLISH;
  const bearish = flow != null && flow <= BEARISH;

  // Headline: close-trigger fired, but smart money is bullish → hold the winner.
  if (base === "redeploy" && bullish) {
    return {
      state: "let_it_ride", base, overridden: true, flow,
      reason: "Your close-trigger fired, but institutional flow is bullish — don't churn out of a winner smart money is still pushing your way.",
    };
  }
  // Approaching the line + bullish → lean hold.
  if (base === "watch" && bullish) {
    return {
      state: "hold", base, overridden: true, flow,
      reason: "Approaching the redeploy line, but bullish flow supports holding a little longer.",
    };
  }
  // Holding fine, but flow has turned against you → consider shedding earlier.
  if ((base === "hold" || base === "watch") && bearish) {
    return {
      state: "shed", base, overridden: true, flow,
      reason: "Flow has turned bearish — consider closing or rolling earlier than the premium math alone suggests.",
    };
  }

  return { state: base, base, overridden: false, flow, reason: null };
}

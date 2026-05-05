const CUSHION_N_AMBER = 2;
const CUSHION_N_RED   = 1;
const SQRT_252        = Math.sqrt(252);

const NULL_RESULT = {
  cushion_trigger_amber: null,
  cushion_trigger_red:   null,
  cushion_pct:           null,
  cushion_state:         null,
  cushion_iv_used:       null,
  cushion_n_amber:       null,
  cushion_n_red:         null,
};

/**
 * Computes IV-scaled cushion breach fields for a single CSP position.
 *
 * @param {number} strike          - option strike price
 * @param {number} underlyingPrice - current underlying mid/last price
 * @param {number|null} iv         - implied volatility as decimal (e.g. 0.685 for 68.5%)
 * @returns cushion fields object — all values null when iv is null
 */
export function computeCushion(strike, underlyingPrice, iv) {
  if (iv == null || strike == null || underlyingPrice == null) return NULL_RESULT;

  const dailyMove           = iv / SQRT_252;
  const cushionTriggerAmber = strike * (1 + dailyMove * CUSHION_N_AMBER);
  const cushionTriggerRed   = strike * (1 + dailyMove * CUSHION_N_RED);
  const cushionPct          = (underlyingPrice - strike) / strike;

  let cushionState;
  if (underlyingPrice <= cushionTriggerRed) {
    cushionState = "assignment_risk";
  } else if (underlyingPrice <= cushionTriggerAmber) {
    cushionState = "approaching";
  } else {
    cushionState = "safe";
  }

  return {
    cushion_trigger_amber: Math.round(cushionTriggerAmber * 100) / 100,
    cushion_trigger_red:   Math.round(cushionTriggerRed   * 100) / 100,
    cushion_pct:           Math.round(cushionPct * 10000) / 10000,
    cushion_state:         cushionState,
    cushion_iv_used:       iv,
    cushion_n_amber:       CUSHION_N_AMBER,
    cushion_n_red:         CUSHION_N_RED,
  };
}

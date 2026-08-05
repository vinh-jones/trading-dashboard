// src/lib/orb/params.js
//
// Every tunable in one object. This is stamped verbatim into each orb_sessions
// row (the `params` jsonb column) so a later backtest can tell exactly which
// parameterization produced a given verdict. Bump `version` on any change.

export const ORB_PARAMS = Object.freeze({
  version: 1,

  // Gate 2/3 — ATR and the liquidity threshold
  atrPeriod:            14,
  atrWarmupBars:        120,    // Wilder needs a long warm-up to match a chart
  atrThresholdPct:      0.25,   // range must be >= 25% of ATR to qualify
  greyBandLowPct:       0.22,   // 22-25% passes but is flagged

  // Gate 5 — pattern geometry
  hammerBodyZone:       1 / 3,  // body must sit in the top (or bottom) third
  hammerWickRatio:      2.0,    // signal-side wick >= 2x body
  hammerOppWickRatio:   0.5,    // opposite wick <= 0.5x body
  engulfTolerance:      0.01,   // dollars of slack on the engulf comparison
  minBodyPctOfRange:    0.10,   // doji guard
  minRangePctOfAtr:     0.05,   // noise guard — QQQ 5m bars are tight
  outsideRule:          "close",// (c) from the spec: close outside the box

  // Gate 6 — time
  windowMinutes:        90,     // from 09:30 ET; box completes at 09:45
});

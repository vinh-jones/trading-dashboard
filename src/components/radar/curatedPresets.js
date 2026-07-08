// Built-in, curated Radar filter presets — one-click "setups" that combine the
// numeric metrics with the chip-signal allow-sets (Task 1). These live in code
// (not radar_presets) so they're always present, non-deletable, and tunable in
// one place.
//
// NAMING DISCIPLINE: presets are named for WHAT MATCHED THE SCREEN
// (setup-descriptive), never for what to do (no "Entry"/"Buy"/"Safe"). The radar
// is a CONFIRMATION screen, subordinate to Ryan-first + the checklist + the VIX
// cash target — not a deploy trigger. Same relabelling the UW work applied.
//
// BLIND SPOT: these filter one ticker at a time and CANNOT see household-level
// concentration. A clean Prime Setup list can be five names in the same AI-infra
// / high-beta cluster as the assigned book (CLS, NBIS, IREN, CRDO…); in a
// drawdown that's one bet, not five. A screen can't catch this — judge it
// separately.
//
// Thresholds are the agreed starting values (see the design spec); tune here.

export const CURATED_ICON = "✦";

export const CURATED_PRESETS = [
  {
    id: "builtin:prime-setup",
    name: "Prime Setup",
    builtin: true,
    filters: {
      score_buckets: ["Strong"],
      bb_position_max: 0.20,
      trend_states: ["uptrend", "pullback", "recovering"],
      gex_envs: ["stabilized", "neutral"],
      earnings_days_min: 30,
      ownership: "not_held",
    },
  },
  {
    id: "builtin:oversold-bounce",
    name: "Oversold Bounce",
    builtin: true,
    filters: {
      rsi_buckets: ["oversold"],
      bb_position_max: 0.20,
      trend_states: ["uptrend", "pullback", "recovering"],
    },
  },
  {
    id: "builtin:juiced-premium",
    name: "Juiced Premium",
    builtin: true,
    // High IV both relative (rank) AND absolute — this is the high-vol assignment
    // cluster, NOT a safety screen. Well-paid, but assignment is likely.
    filters: {
      iv_rank_min: 50,
      raw_iv_min: 0.50,
      rsi_buckets: ["oversold", "neutral"], // ≠ overbought
      earnings_days_min: 30,
    },
  },
  {
    id: "builtin:fresh-calm",
    name: "Fresh & Calm",
    builtin: true,
    filters: {
      ownership: "not_held",
      trend_states: ["uptrend", "pullback", "recovering"],
      gex_envs: ["stabilized", "neutral"],
      bb_position_max: 0.60, // not extended
      earnings_days_min: 30,
    },
  },
  {
    id: "builtin:pinned-paid",
    name: "Pinned & Paid",
    builtin: true,
    filters: {
      gex_envs: ["stabilized"],
      iv_rank_min: 50,
      raw_iv_min: 0.35,
      earnings_days_min: 30,
    },
  },
  {
    id: "builtin:write-zone",
    name: "Write Zone",
    builtin: true,
    // Held book: which assigned names are in a call-writing window. A surfacer,
    // not a strike-picker — the below-cost / roll nuance lives in cc-gex-decision.
    filters: {
      ownership: "held",
      gex_envs: ["stabilized"],
      iv_rank_min: 40,
      rsi_buckets: ["neutral", "overbought"], // don't cap upside writing at a bounce low
    },
  },
];

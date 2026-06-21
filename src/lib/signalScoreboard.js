// Signal scoreboard scaffold (finance review). Built now, against thin data, so
// it can be flipped on once weeks of signal_log + closed-position history accrue
// — rather than becoming a two-week build at decision time.
//
// What's computable from the log ALONE (no trade join, no price feed) and lands
// here today:
//   • frequency — distinct positions each decision-relevant state fired on.
//   • the lead DRIFT metric: "held past rule" — for positions where `rule_close`
//     fired (a take-profit tier / cushion said close), how many logged days the
//     position kept appearing AFTER the rule first fired. If you'd followed the
//     rule it would have left the log, so extra days = held past your own rule.
//
// Deliberately NOT here yet (need accrued data / a forward-price feed — these
// are the data-accruing follow-ons, kept distinct per the review):
//   • decision-divergence rate vs the Ryan-first baseline (the real lead metric)
//   • P&L delta on follow-vs-diverge (small-sample, noisy over 3–4 weeks)
//   • state-accuracy for descriptive signals (did "choppy" realize higher vol;
//     did "assignment risk" precede breaches) — a process measure on untouched
//     positions
//   • entry paper-track for ★ / entry-score (counterfactual, separate from live P&L)

const NOTABLE_STATES = ["rule_close", "let_it_ride", "shed"];
const RISK_LEVELS = ["elevated", "high"];

export function computeScoreboard(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const posByState = Object.fromEntries(NOTABLE_STATES.map((s) => [s, new Set()]));
  const posByRisk = Object.fromEntries(RISK_LEVELS.map((r) => [r, new Set()]));
  const byPos = new Map();

  for (const r of list) {
    if (!r?.position_key) continue;
    if (posByState[r.overlay_state]) posByState[r.overlay_state].add(r.position_key);
    if (posByRisk[r.assignment_level]) posByRisk[r.assignment_level].add(r.position_key);
    if (!byPos.has(r.position_key)) byPos.set(r.position_key, []);
    byPos.get(r.position_key).push(r);
  }

  // Held-past-rule: per position, days still logged after rule_close first fired.
  let rulePositions = 0;
  let heldPastRuleDays = 0;
  for (const logs of byPos.values()) {
    const sorted = [...logs].sort((a, b) => String(a.logged_date).localeCompare(String(b.logged_date)));
    const firstRule = sorted.findIndex((l) => l.overlay_state === "rule_close");
    if (firstRule >= 0) {
      rulePositions += 1;
      heldPastRuleDays += sorted.length - firstRule - 1;
    }
  }

  return {
    position_days:        list.length,
    distinct_positions:   byPos.size,
    counts: {
      rule_close:   posByState.rule_close.size,
      let_it_ride:  posByState.let_it_ride.size,
      shed:         posByState.shed.size,
      risk_elevated: posByRisk.elevated.size,
      risk_high:     posByRisk.high.size,
    },
    rule_close_positions: rulePositions,
    held_past_rule_days:  heldPastRuleDays,
  };
}

/**
 * verdictThreshold(totalCapital) — minimum dollar delta required against
 * BOTH baselines for a lifespan to be considered Ahead or Behind.
 * = max($100, 0.5% of capital).
 */
export function verdictThreshold(totalCapital) {
  if (!totalCapital || totalCapital <= 0) return 100;
  return Math.max(100, totalCapital * 0.005);
}

/**
 * computeLifespanVerdict(lifespanSummary) — returns one of:
 *   "ahead" | "behind" | "neutral" | "suspect"
 *
 * Suspect overrides verdict (per spec).
 * Active lifespans: neutral until they close (we don't predict).
 * Both vs-baseline deltas must exceed +/- threshold in the same direction.
 */
export function computeLifespanVerdict(lifespan) {
  if (lifespan.data_quality === "suspect") return "suspect";
  if (lifespan.lifespan_status === "active") return "neutral";

  const spaxx = lifespan.benchmarks?.spaxx_baseline?.vs_actual_pnl;
  const cut   = lifespan.benchmarks?.cut_and_redeploy_baseline?.vs_actual_pnl;

  if (spaxx == null || cut == null) return "neutral";

  const t = verdictThreshold(lifespan.total_capital_committed);

  if (spaxx > t && cut > t) return "ahead";
  if (spaxx < -t && cut < -t) return "behind";
  return "neutral";
}

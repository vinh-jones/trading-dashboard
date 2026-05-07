import { theme } from "./theme";
import { computeCushion } from "./cushionBreach";

export function computePositionHealth({ openPositions, quote }) {
  const csps = openPositions?.csps ?? [];
  const last = quote?.last ?? quote?.mid ?? null;

  let worst = "safe";
  for (const p of csps) {
    const c = computeCushion(p.strike, last, p.iv ?? null);
    if (c.cushion_state === "assignment_risk") { worst = "assignment_risk"; break; }
    if (c.cushion_state === "approaching") worst = "approaching";
  }

  const totalOpen = (openPositions?.csps?.length   ?? 0)
                  + (openPositions?.shares?.length ?? 0)
                  + (openPositions?.leaps?.length  ?? 0);

  if (totalOpen === 0) {
    return { color: theme.text.muted, label: "Idle", worstCushionState: null };
  }
  if (worst === "assignment_risk") {
    return { color: theme.red, label: "Risk", worstCushionState: "assignment_risk" };
  }
  if (worst === "approaching") {
    return { color: theme.amber, label: "Watch", worstCushionState: "approaching" };
  }
  return { color: theme.green, label: "Healthy", worstCushionState: "safe" };
}

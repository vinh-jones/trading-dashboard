/**
 * VIX bands — the canonical deployment framework. This is the one with
 * decision authority: focusEngine, riskNarrative, earningsEngine, trading.js
 * and the persisted `vix_band` snapshot columns all read from here.
 */
export function getVixBand(vix) {
  if (vix == null) return null;
  if (vix <= 12) return { label: "≤12",   sentiment: "Extreme Greed", floorPct: 0.40, ceilingPct: 0.50 };
  if (vix <= 15) return { label: "12–15", sentiment: "Greed",         floorPct: 0.30, ceilingPct: 0.40 };
  if (vix <= 18) return { label: "15–18", sentiment: "Slight Fear",   floorPct: 0.20, ceilingPct: 0.25 };
  if (vix <= 20) return { label: "18–20", sentiment: "Transition",    floorPct: 0.15, ceilingPct: 0.20 };
  if (vix <= 25) return { label: "20–25", sentiment: "Fear",          floorPct: 0.10, ceilingPct: 0.15 };
  if (vix <= 30) return { label: "25–30", sentiment: "Very Fearful",  floorPct: 0.05, ceilingPct: 0.10 };
  return               { label: "≥30",   sentiment: "Extreme Fear",  floorPct: 0.00, ceilingPct: 0.05 };
}

/**
 * VXN bands — Ryan's Nasdaq-100 volatility framework, under evaluation as of
 * 2026-08-04. DISPLAY-ONLY. Deliberately not wired into focusEngine, the
 * forecast, or any `vix_band` column: swapping the index behind a live decision
 * path would silently rewrite the meaning of stored history. VXN gets its own
 * `vxn` / `vxn_band` columns so the two frameworks stay comparable after the fact.
 *
 * Boundary convention differs from getVixBand on purpose. getVixBand is
 * upper-inclusive (`<=`); Ryan's chart reads "VXN < 15" / "15–19" / "VXN > 35",
 * so a reading of exactly 15 belongs to Grind Zone, not Complacency. Matching
 * his published table verbatim matters more than internal consistency here —
 * the point of the test run is evaluating HIS framework, not a hybrid.
 *
 * Six zones, not seven: VXN has no analogue to the 18–20 "Transition" band, and
 * its cash ranges are wider (Fear = 10–20% vs VIX Fear's 10–15%). It is a
 * coarser framework, not a rescaled one.
 */
export function getVxnBand(vxn) {
  if (vxn == null) return null;
  if (vxn < 15)  return { label: "<15",   sentiment: "Complacency",   floorPct: 0.40, ceilingPct: 0.50 };
  if (vxn < 19)  return { label: "15–19", sentiment: "Grind Zone",    floorPct: 0.30, ceilingPct: 0.40 };
  if (vxn < 25)  return { label: "19–25", sentiment: "Slight Fear",   floorPct: 0.20, ceilingPct: 0.30 };
  if (vxn < 30)  return { label: "25–30", sentiment: "Fear",          floorPct: 0.10, ceilingPct: 0.20 };
  if (vxn <= 35) return { label: "30–35", sentiment: "Very Fearful",  floorPct: 0.05, ceilingPct: 0.10 };
  return              { label: ">35",   sentiment: "Extreme Fear",  floorPct: 0.00, ceilingPct: 0.05 };
}

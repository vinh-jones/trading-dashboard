export function getVixBand(vix) {
  if (vix == null) return null;
  if (vix <= 12) return { label: "≤12",   floorPct: 0.40, ceilingPct: 0.50 };
  if (vix <= 15) return { label: "12–15", floorPct: 0.30, ceilingPct: 0.40 };
  if (vix <= 20) return { label: "15–20", floorPct: 0.20, ceilingPct: 0.25 };
  if (vix <= 25) return { label: "20–25", floorPct: 0.10, ceilingPct: 0.15 };
  if (vix <= 30) return { label: "25–30", floorPct: 0.05, ceilingPct: 0.10 };
  return               { label: "≥30",   floorPct: 0.00, ceilingPct: 0.05 };
}

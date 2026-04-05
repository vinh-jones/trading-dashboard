export function getVixBand(vix) {
  if (!vix) return null;
  if (vix <= 12)  return { label: "≤12",   floor: 0.40, ceiling: 0.50 };
  if (vix <= 15)  return { label: "12-15",  floor: 0.30, ceiling: 0.40 };
  if (vix <= 20)  return { label: "15-20",  floor: 0.20, ceiling: 0.25 };
  if (vix <= 25)  return { label: "20-25",  floor: 0.10, ceiling: 0.15 };
  if (vix <= 30)  return { label: "25-30",  floor: 0.05, ceiling: 0.10 };
  return           { label: "≥30",    floor: 0.00, ceiling: 0.05 };
}

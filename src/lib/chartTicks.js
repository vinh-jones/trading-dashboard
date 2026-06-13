// Nice axis ticks for hand-rolled SVG charts. Returns a 0-anchored, padded
// domain rounded outward to a 1/2/5×10ⁿ step, plus the tick values on it.

export function niceTicks(dataMin, dataMax, targetCount = 5) {
  let lo = Math.min(0, dataMin);
  let hi = Math.max(0, dataMax);
  if (hi - lo === 0) { lo -= 1; hi += 1; } // flat series → open a window
  const pad = (hi - lo) * 0.05;
  lo -= pad;
  hi += pad;

  const rawStep = (hi - lo) / (targetCount - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;

  const domainMin = Math.floor(lo / step) * step;
  const domainMax = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = domainMin; v <= domainMax + step / 2; v += step) {
    ticks.push(Math.round(v * 1e6) / 1e6); // kill float drift so 0 is exactly 0
  }
  return { ticks, domainMin, domainMax };
}

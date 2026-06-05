// Worst-case per-ticker capital exposure — shared by RadarTab's concentration
// gauge and the AI Thesis basket exposure math so both use one definition.
//
//   sharePos : assigned-shares block { cost_basis_total, ... } or null
//   csps     : open CSPs for the ticker  [{ capital_fronted }]  (worst-case = full assignment)
//   leaps    : open LEAPs for the ticker [{ entry_cost }]
//   covered calls contribute 0 (the underlying shares are already counted).

export function tickerExposure(sharePos, csps, leaps) {
  const shares = sharePos?.cost_basis_total ?? 0;
  const csp    = (csps  || []).reduce((sum, p) => sum + (p.capital_fronted ?? 0), 0);
  const leap   = (leaps || []).reduce((sum, l) => sum + (l.entry_cost ?? 0), 0);
  return shares + csp + leap;
}

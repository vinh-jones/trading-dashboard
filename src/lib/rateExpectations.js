// Display formatting for the FedWatch "Rate Expectations" card.
//
// `cutsPricedIn` is a SIGNED count of rate moves the market prices over the next
// ~12 months: positive = cuts, negative = hikes, ~0 = no net change. The Fed can
// be in either regime, so the card must flip between "cuts" and "hikes" rather than
// always saying "cuts" — otherwise a hiking curve renders nonsense like "-1.1 cuts".
export function formatRateMoves(cutsPricedIn) {
  if (cutsPricedIn == null) return null;
  const mag = Math.abs(cutsPricedIn);
  if (mag < 0.05) return "≈ flat";
  return `${mag.toFixed(1)} ${cutsPricedIn > 0 ? "cuts" : "hikes"}`;
}

// Top-level modes in the redesigned workspace.
// Focus = command center (home); Explore = drill-downs; Review = reporting & reflection.
export const MODES = ["focus", "explore", "review"];

export const EXPLORE_SUBVIEWS = ["positions", "radar", "earnings", "macro"];
export const REVIEW_SUBVIEWS  = ["journal", "monthly", "ytd"];

export const SUBVIEW_LABELS = {
  positions: "Positions",
  radar:     "Radar",
  earnings:  "Earnings",
  macro:     "Macro",
  monthly:   "Monthly",
  ytd:       "YTD",
  journal:   "Journal",
};

export const MODE_LABELS = {
  focus:   "Focus",
  explore: "Explore",
  review:  "Review",
};

export function defaultSubView(mode) {
  if (mode === "explore") return "positions";
  if (mode === "review")  return "journal";
  return null;
}

export function isValidMode(mode) {
  return MODES.includes(mode);
}

export function isValidSubView(mode, subView) {
  if (mode === "focus")   return subView === null;
  if (mode === "explore") return EXPLORE_SUBVIEWS.includes(subView);
  if (mode === "review")  return REVIEW_SUBVIEWS.includes(subView);
  return false;
}

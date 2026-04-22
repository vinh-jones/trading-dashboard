// Single source of truth for monthly premium targets.
// Used by api/snapshot.js (v2 forecast target_gap) and api/data.js (account.monthly_targets).
export const MONTHLY_TARGETS = {
  baseline: 15000,
  stretch:  25000,
};

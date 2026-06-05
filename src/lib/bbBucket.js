// Bollinger Band position bucketing — the canonical scheme shared across the
// Radar tab and the AI Thesis page so both classify and color BB position
// identically. Extracted from RadarTab; do not fork these thresholds/colors.

export function bbBucket(pos) {
  if (pos == null) return null;
  if (pos < 0)    return "below_band";
  if (pos < 0.20) return "near_lower";
  if (pos < 0.80) return "mid_range";
  if (pos <= 1.0) return "near_upper";
  return "above_band";
}

export const BB_BUCKET_LABELS = {
  below_band: "Below Band",
  near_lower: "Near Lower",
  mid_range:  "Mid Range",
  near_upper: "Near Upper",
  above_band: "Above Band",
};

// Hardcoded hex — intentional exception (same role as TYPE_COLORS / SCORE_BG_COLORS):
// a semantic-data color map for Bollinger-Band buckets.
export const BB_BUCKET_COLORS = {
  below_band: { bg: "#3d1a1a", text: "#f85149" },
  near_lower: { bg: "#1a3d1a", text: "#3fb950" },
  mid_range:  { bg: "#21262d", text: "#8b949e" },
  near_upper: { bg: "#3d3010", text: "#e3b341" },
  above_band: { bg: "#2d1f00", text: "#e3b341" },
};

// Terminal design tokens for the redesign.
// Darker, more dramatic than the existing theme — "terminal as artform."
export const T = {
  // Backgrounds
  bg:   "#07090d",
  surf: "#0e1219",
  elev: "#161c27",
  deep: "#04060a",

  // Borders
  hair: "#161b24",
  bd:   "#1e2530",
  bdS:  "#2a3342",

  // Text hierarchy
  t1:   "#e6edf3",
  t2:   "#cfd8e3",
  tm:   "#94a0ae",
  ts:   "#6b7582",
  tf:   "#454d59",

  // Semantic colors
  green:  "#3fb950",
  greenD: "#1f7a2e",
  red:    "#f85149",
  redD:   "#8a2a26",
  blue:   "#58a6ff",
  blueB:  "#1f6feb",
  amber:  "#e3b341",
  cyan:   "#39d0d8",
  mag:    "#d084ea",

  // Posture accent — the hero
  post:   "#e3b341",
  postDim: "rgba(227,179,65,0.12)",

  // Typography
  mono: "'JetBrains Mono', 'SF Mono', 'Fira Code', 'Consolas', monospace",
  sans: "'Geist', -apple-system, 'Inter', system-ui, sans-serif",

  // Spacing (4-point grid)
  sp1: 4, sp2: 8, sp3: 12, sp4: 16, sp5: 20, sp6: 24,

  // Font sizes
  xs: 10, sm: 12, md: 14, lg: 16, xl: 18, xxl: 32,

  // Radius
  rSm: 2, rMd: 4,
};

// VIX band lookup
export function getVixBand(vix) {
  if (vix == null) return null;
  if (vix <= 12)  return { label: "≤12",   sentiment: "Extreme Greed", floorPct: 0.40, ceilingPct: 0.50 };
  if (vix <= 15)  return { label: "12–15", sentiment: "Greed",         floorPct: 0.30, ceilingPct: 0.40 };
  if (vix <= 20)  return { label: "15–20", sentiment: "Slight Fear",   floorPct: 0.20, ceilingPct: 0.25 };
  if (vix <= 25)  return { label: "20–25", sentiment: "Fear",          floorPct: 0.10, ceilingPct: 0.15 };
  if (vix <= 30)  return { label: "25–30", sentiment: "Very Fearful",  floorPct: 0.05, ceilingPct: 0.10 };
  return               { label: "≥30",   sentiment: "Extreme Fear",  floorPct: 0.00, ceilingPct: 0.05 };
}

// Accent per surface
export const SURFACE_ACCENT = {
  focus:   "#58a6ff",
  explore: "#3fb950",
  review:  "#d084ea",
  mobile:  "#e3b341",
};

// Type tag colors (kept as intentional semantic-data map, per CLAUDE.md)
export const TYPE_COLORS = {
  CSP:   { c: "#58a6ff", b: "#58a6ff44" },
  CC:    { c: "#3fb950", b: "#3fb95044" },
  LEAPS: { c: "#d084ea", b: "#d084ea44" },
  LEAP:  { c: "#d084ea", b: "#d084ea44" },
  Shares:{ c: "#f85149", b: "#f8514944" },
};

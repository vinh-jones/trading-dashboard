// Central design token system — GitHub Dark palette, monospace aesthetic.
// Import this instead of hardcoding hex values in components.
export const theme = {
  // ── Backgrounds ──────────────────────────────────────────────────────────
  bg: {
    base:     "#0d1117",  // page background (rgb 13, 17, 23)
    surface:  "#161b22",  // cards, panels
    elevated: "#1c2333",  // selected state
    weekend:  "#0a0e14",  // weekend day cells
  },

  // ── Text hierarchy ────────────────────────────────────────────────────────
  text: {
    primary:   "#e6edf3",
    secondary: "#c9d1d9",
    muted:     "#8b949e",
    subtle:    "#6e7681",
    faint:     "#4e5a65",
  },

  // ── Borders ───────────────────────────────────────────────────────────────
  border: {
    default: "#21262d",
    strong:  "#30363d",
  },

  // ── Semantic / status ─────────────────────────────────────────────────────
  green:     "#3fb950",
  red:       "#f85149",
  blue:      "#58a6ff",  // link / accent blue (lighter)
  blueBold:  "#1f6feb",  // primary-action blue (progress bars, bar chart fills)
  amber:     "#e3b341",

  // ── Danger / warning panels ───────────────────────────────────────────────
  // Darker than TYPE_COLORS.Shares for an inset "empty state" alert feel.
  alert: {
    dangerBg:     "#3a1a1a",
    dangerBorder: "#7c2a2a",
  },

  // ── Loss / gain gradients (monthly bar chart) ────────────────────────────
  gradient: {
    loss: "linear-gradient(180deg, #8b2a2a 0%, #da3633 100%)",
    gain: "linear-gradient(180deg, #238636 0%, #1a5a2a 100%)",
  },

  // ── Typography ────────────────────────────────────────────────────────────
  font: {
    mono: "'SF Mono', 'Fira Code', 'Consolas', monospace",
  },

  // ── Spacing scale (px) — 4-point grid ────────────────────────────────────
  space: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24 },

  // ── Border radius ─────────────────────────────────────────────────────────
  radius: { sm: 4, md: 8, pill: 20 },

  // ── Font size scale ───────────────────────────────────────────────────────
  size: { xs: 10, sm: 12, md: 14, lg: 16, xl: 18 },

  // ── Chart-specific colors ─────────────────────────────────────────────────
  chart: { shares: "#2eb88a", leaps: "#f0c040" },
};

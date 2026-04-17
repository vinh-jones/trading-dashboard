export const TYPE_COLORS = {
  CSP:    { bg: "#1a3a5c", text: "#6db3f2", border: "#2a5a8c" },
  CC:     { bg: "#1a4a3a", text: "#6dd9a0", border: "#2a6a5a" },
  LEAPS:  { bg: "#4a2a5c", text: "#c49df2", border: "#6a3a7c" },
  Spread: { bg: "#5c4a1a", text: "#f2d96d", border: "#7c6a2a" },
  Shares: { bg: "#5c1a1a", text: "#f26d6d", border: "#7c2a2a" },
};

export const SUBTYPE_LABELS = {
  Close:       "Closed",
  Assigned:    "Assigned",
  "Roll Loss": "Roll Loss",
  "Bear Call": "Bear Call Spread",
  "Bear Debit":"Bear Debit Spread",
  Sold:        "Shares Sold",
  Exit:        "Position Exit",
};

export const MONTHS = [
  { label: "Jan", month: 0, year: 2026 },
  { label: "Feb", month: 1, year: 2026 },
  { label: "Mar", month: 2, year: 2026 },
  { label: "Apr", month: 3, year: 2026 },
];

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const VERSION = "1.52.5";

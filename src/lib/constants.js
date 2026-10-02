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
  "Bull Put":  "Bull Put Spread",
  "Bull Call": "Bull Call Spread",
  "Bear Put":  "Bear Put Spread",
  "Bear Debit":"Bear Debit Spread",
  Sold:        "Shares Sold",
  Exit:        "Position Exit",
};

// Every month from Jan 2026 (start of tracked history) through the current
// month, so a new month's tab appears on its own when the calendar rolls over.
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS = (() => {
  const now = new Date();
  const out = [];
  for (let year = 2026, month = 0; year < now.getFullYear() || (year === now.getFullYear() && month <= now.getMonth()); ) {
    out.push({ label: MONTH_LABELS[month], month, year });
    if (++month === 12) { month = 0; year++; }
  }
  return out;
})();

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const VERSION = "1.190.0";


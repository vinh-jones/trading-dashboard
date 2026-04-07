export const JOURNAL_BADGE = {
  trade_note:    { label: "TRADE NOTE",    color: "#58a6ff" },
  eod_update:    { label: "EOD UPDATE",    color: "#3fb950" },
  position_note: { label: "POSITION NOTE", color: "#e3b341" },
};

export const MOODS = [
  { emoji: "🟢", label: "Clean",    activeBg: "#1a4a2a", activeBorder: "#3fb950" },
  { emoji: "🟡", label: "Mixed",    activeBg: "#4a3a1a", activeBorder: "#e3b341" },
  { emoji: "🔴", label: "Rough",    activeBg: "#4a1a1a", activeBorder: "#f85149" },
  { emoji: "🌪️", label: "Volatile", activeBg: "#2a1a4a", activeBorder: "#8b5cf6" },
  { emoji: "🎯", label: "Target",   activeBg: "#1a3a5c", activeBorder: "#58a6ff" },
];

export const JOURNAL_ENTRY_TYPES = [
  { key: "trade_note",    label: "Trade Note",    activeColor: "#58a6ff", activeBg: "#0d419d" },
  { key: "eod_update",    label: "EOD Update",    activeColor: "#3fb950", activeBg: "#1a4a2a" },
  { key: "position_note", label: "Position Note", activeColor: "#e3b341", activeBg: "#4a3a1a" },
];

// Shared journal form styles — module-level so React never remounts form elements
export const JOURNAL_INPUT_ST = {
  background: "#0d1117", border: "1px solid #21262d", color: "#c9d1d9",
  borderRadius: 4, padding: "8px 10px", fontFamily: "inherit", fontSize: 13,
  width: "100%", boxSizing: "border-box",
};

export const JOURNAL_LABEL_ST = {
  display: "block", color: "#8b949e", fontSize: 11, textTransform: "uppercase",
  letterSpacing: "0.8px", marginBottom: 6, fontWeight: 500,
};

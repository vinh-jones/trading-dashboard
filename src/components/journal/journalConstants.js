import { theme } from "../../lib/theme";

export const JOURNAL_BADGE = {
  trade_note:    { label: "TRADE NOTE",    color: theme.blue },
  eod_update:    { label: "EOD UPDATE",    color: theme.green },
  position_note: { label: "POSITION NOTE", color: theme.amber },
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
  background: theme.bg.base, border: `1px solid ${theme.border.default}`, color: theme.text.secondary,
  borderRadius: theme.radius.sm, padding: "8px 10px", fontFamily: "inherit", fontSize: theme.size.md,
  width: "100%", boxSizing: "border-box",
};

export const JOURNAL_LABEL_ST = {
  display: "block", color: theme.text.muted, fontSize: theme.size.xs, textTransform: "uppercase",
  letterSpacing: "0.8px", marginBottom: 6, fontWeight: 500,
};

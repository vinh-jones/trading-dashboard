import { useState } from "react";
import { theme } from "../../lib/theme";
import { eodFloorLabel, fmtEntryDate } from "./journalHelpers";
import { JournalEntryCard } from "./JournalEntryCard";

export function EODBand({ entry, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered]   = useState(false);
  const md = entry.metadata ?? {};
  const floorLbl = eodFloorLabel(md.floor_status);

  // When expanded, delegate to the existing full EOD card view.
  // Wrap in a click-to-collapse region.
  if (expanded) {
    return (
      <div onClick={() => setExpanded(false)} style={{ cursor: "pointer" }}>
        <JournalEntryCard entry={entry} onEdit={onEdit} onDelete={onDelete} />
      </div>
    );
  }

  const borderColor = floorLbl?.color ?? theme.border.default;

  return (
    <div
      onClick={() => setExpanded(true)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: theme.space[3],
        padding: `${theme.space[3]}px ${theme.space[4]}px`,
        background: hovered ? "rgba(58,130,246,0.06)" : theme.bg.surface,
        border: `1px solid ${theme.border.default}`,
        borderLeft: `3px solid ${borderColor}`,
        borderRadius: theme.radius.md,
        marginBottom: theme.space[2],
        cursor: "pointer",
        transition: "background 0.15s",
      }}
    >
      {/* Left: badge + mood */}
      <div style={{ display: "flex", alignItems: "center", gap: theme.space[2], flexShrink: 0 }}>
        <span style={{ color: theme.green, fontSize: theme.size.xs, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px" }}>
          EOD Update
        </span>
        {entry.mood && <span style={{ fontSize: theme.size.md, lineHeight: 1 }}>{entry.mood}</span>}
      </div>

      {/* Middle: stat pills */}
      <div style={{ display: "flex", alignItems: "center", gap: theme.space[3], flex: 1, flexWrap: "wrap", fontSize: theme.size.sm, color: theme.text.subtle }}>
        {md.vix != null && <span>VIX <span style={{ color: theme.text.primary, fontWeight: 600 }}>{md.vix}</span></span>}
        {md.free_cash_pct != null && (
          <span>
            Cash <span style={{ color: theme.text.primary, fontWeight: 600 }}>{md.free_cash_pct}%</span>
            {floorLbl && <span style={{ color: floorLbl.color, marginLeft: theme.space[1] }}>{floorLbl.text}</span>}
          </span>
        )}
        {md.mtd_realized != null && (
          <span>MTD <span style={{ color: theme.green, fontWeight: 600 }}>${md.mtd_realized.toLocaleString()}</span></span>
        )}
      </div>

      {/* Right: date */}
      <span style={{ color: theme.text.muted, fontSize: theme.size.sm, flexShrink: 0 }}>
        {fmtEntryDate(entry.entry_date)}
      </span>
    </div>
  );
}

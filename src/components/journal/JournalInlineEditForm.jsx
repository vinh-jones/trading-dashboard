import { useState } from "react";
import { JOURNAL_BADGE, MOODS, JOURNAL_INPUT_ST } from "./journalConstants";
import { fmtEntryDate } from "./journalHelpers";
import { JournalField } from "./JournalField";
import { JournalAutoTextarea } from "./JournalAutoTextarea";
import { theme } from "../../lib/theme";

export function JournalInlineEditForm({ entry, title, onTitleChange, body, onBodyChange, tags, onTagsChange, source, onSourceChange, mood, onMoodChange, onSave, onCancel, saving, error }) {
  const isEOD = entry.entry_type === "eod_update";
  const badge = JOURNAL_BADGE[entry.entry_type] || { label: entry.entry_type, color: theme.text.muted };
  const [cancelHovered, setCancelHovered] = useState(false);
  const [moodHovered, setMoodHovered] = useState(null);
  return (
    <div style={{ background: theme.bg.surface, border: `2px solid ${theme.amber}`, borderRadius: theme.radius.md, padding: theme.space[4], marginBottom: theme.space[3] }}>
      {/* Q2: marginBottom 14 → theme.space[3] */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: theme.space[3] }}>
        <span style={{ fontSize: theme.size.sm, fontWeight: 700, color: theme.amber, textTransform: "uppercase", letterSpacing: "0.8px" }}>
          Editing — <span style={{ color: badge.color }}>{badge.label}</span>
        </span>
        <span style={{ color: theme.text.muted, fontSize: theme.size.sm }}>{fmtEntryDate(entry.entry_date)}</span>
      </div>

      {/* Title (not for EOD — title is auto-generated) */}
      {!isEOD && (
        <JournalField label="Title">
          <input type="text" style={JOURNAL_INPUT_ST} value={title} onChange={onTitleChange} />
        </JournalField>
      )}

      {/* Mood (EOD only) */}
      {isEOD && (
        <JournalField label="Mood">
          {/* Q2: gap 6 → theme.space[1] */}
          <div style={{ display: "flex", gap: theme.space[1] }}>
            {MOODS.map(m => {
              const active = mood === m.emoji;
              const hovered = moodHovered === m.emoji;
              return (
                <button key={m.emoji} onClick={() => onMoodChange(m.emoji)}
                  onMouseEnter={() => setMoodHovered(m.emoji)}
                  onMouseLeave={() => setMoodHovered(null)}
                  style={{
                  /* Q2: padding "8px 2px" → token; gap 3 → theme.space[1] */
                  flex: 1, padding: `${theme.space[2]}px 2px`, borderRadius: theme.radius.sm, cursor: "pointer", fontFamily: "inherit",
                  border: `2px solid ${active ? m.activeBorder : theme.border.strong}`,
                  background: active ? m.activeBg : hovered ? "rgba(58,130,246,0.06)" : "transparent",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: theme.space[1],
                }}>
                  {/* Q3: fontSize 20 → theme.size.xl */}
                  <span style={{ fontSize: theme.size.xl, lineHeight: 1 }}>{m.emoji}</span>
                  <span style={{ fontSize: theme.size.xs, color: active ? m.activeBorder : theme.text.subtle }}>{m.label}</span>
                </button>
              );
            })}
          </div>
        </JournalField>
      )}

      {/* Notes */}
      <JournalField label="Notes">
        <JournalAutoTextarea value={body} onChange={onBodyChange} minH={140} placeholder="Your notes..." />
      </JournalField>

      {/* Source (trade / position notes) */}
      {!isEOD && (
        <JournalField label="Source">
          {/* Q2: gap 16 → theme.space[4] */}
          <div style={{ display: "flex", gap: theme.space[4], fontSize: theme.size.md }}>
            {["Ryan", "Self"].map(s => (
              <label key={s} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: theme.text.secondary }}>
                <input type="radio" name="inline-source" value={s} checked={source === s} onChange={() => onSourceChange(s)} style={{ accentColor: theme.blue }} />
                {s}
              </label>
            ))}
          </div>
        </JournalField>
      )}

      {/* Tags (trade / position notes) */}
      {!isEOD && (
        <JournalField label="Tags (comma separated, optional)">
          <input type="text" style={JOURNAL_INPUT_ST} value={tags} onChange={onTagsChange} placeholder="ryan-signal, lower-bb, vix-elevated" />
        </JournalField>
      )}

      {/* Q2: marginBottom 10 → theme.space[2]; padding "8px 10px" → token */}
      {error && (
        <div style={{ color: theme.red, fontSize: theme.size.sm, marginBottom: theme.space[2], padding: `${theme.space[2]}px ${theme.space[2]}px`, background: theme.bg.base, borderRadius: theme.radius.sm }}>
          {error}
        </div>
      )}

      {/* Q2: gap 8 → theme.space[2]; Cancel padding "6px 12px" → token; Save padding "6px 16px" → token; Q1: color "#fff" → theme.text.primary; Q5: Cancel hover */}
      <div style={{ display: "flex", gap: theme.space[2], justifyContent: "flex-end" }}>
        <button onClick={onCancel}
          onMouseEnter={() => setCancelHovered(true)}
          onMouseLeave={() => setCancelHovered(false)}
          style={{ background: cancelHovered ? "rgba(58,130,246,0.06)" : "transparent", border: "none", color: theme.text.muted, cursor: "pointer", fontSize: theme.size.md, fontFamily: "inherit", padding: `${theme.space[1]}px ${theme.space[3]}px`, borderRadius: theme.radius.sm }}>
          Cancel
        </button>
        <button onClick={onSave} disabled={saving} style={{ background: theme.green, border: "none", color: theme.text.primary, cursor: saving ? "not-allowed" : "pointer", fontSize: theme.size.md, fontFamily: "inherit", padding: `${theme.space[1]}px ${theme.space[4]}px`, borderRadius: theme.radius.sm, fontWeight: 500, opacity: saving ? 0.7 : 1 }}>
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

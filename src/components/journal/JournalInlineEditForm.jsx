import { JOURNAL_BADGE, MOODS, JOURNAL_INPUT_ST } from "./journalConstants";
import { fmtEntryDate } from "./journalHelpers";
import { JournalField } from "./JournalField";
import { JournalAutoTextarea } from "./JournalAutoTextarea";

export function JournalInlineEditForm({ entry, title, onTitleChange, body, onBodyChange, tags, onTagsChange, source, onSourceChange, mood, onMoodChange, onSave, onCancel, saving, error }) {
  const isEOD = entry.entry_type === "eod_update";
  const badge = JOURNAL_BADGE[entry.entry_type] || { label: entry.entry_type, color: "#8b949e" };
  return (
    <div style={{ background: "#161b22", border: "2px solid #e3b341", borderRadius: 6, padding: 16, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#e3b341", textTransform: "uppercase", letterSpacing: "0.8px" }}>
          Editing — <span style={{ color: badge.color }}>{badge.label}</span>
        </span>
        <span style={{ color: "#8b949e", fontSize: 12 }}>{fmtEntryDate(entry.entry_date)}</span>
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
          <div style={{ display: "flex", gap: 6 }}>
            {MOODS.map(m => {
              const active = mood === m.emoji;
              return (
                <button key={m.emoji} onClick={() => onMoodChange(m.emoji)} style={{
                  flex: 1, padding: "8px 2px", borderRadius: 4, cursor: "pointer", fontFamily: "inherit",
                  border: `2px solid ${active ? m.activeBorder : "#30363d"}`,
                  background: active ? m.activeBg : "transparent",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                }}>
                  <span style={{ fontSize: 20, lineHeight: 1 }}>{m.emoji}</span>
                  <span style={{ fontSize: 10, color: active ? m.activeBorder : "#6e7681" }}>{m.label}</span>
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
          <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
            {["Ryan", "Self"].map(s => (
              <label key={s} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "#c9d1d9" }}>
                <input type="radio" name="inline-source" value={s} checked={source === s} onChange={() => onSourceChange(s)} style={{ accentColor: "#58a6ff" }} />
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

      {error && (
        <div style={{ color: "#f85149", fontSize: 12, marginBottom: 10, padding: "8px 10px", background: "#1a1a1a", borderRadius: 4 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={{ background: "transparent", border: "none", color: "#8b949e", cursor: "pointer", fontSize: 13, fontFamily: "inherit", padding: "6px 12px" }}>
          Cancel
        </button>
        <button onClick={onSave} disabled={saving} style={{ background: "#238636", border: "none", color: "#fff", cursor: saving ? "not-allowed" : "pointer", fontSize: 13, fontFamily: "inherit", padding: "6px 16px", borderRadius: 4, fontWeight: 500, opacity: saving ? 0.7 : 1 }}>
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

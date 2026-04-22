import { theme } from "../../lib/theme";
import { CATEGORY_COLORS, categoryFromTag } from "../../lib/tagConstants";

export function TagChip({ tag, onRemove, size = "md" }) {
  const cat    = categoryFromTag(tag);
  const colors = CATEGORY_COLORS[cat];
  const fs     = size === "sm" ? theme.size.xs : theme.size.sm;
  const px     = size === "sm" ? "4px 7px" : "3px 9px";

  return (
    <span style={{
      display:      "inline-flex",
      alignItems:   "center",
      gap:          4,
      fontSize:     fs,
      fontFamily:   theme.font.mono,
      color:        colors.text,
      background:   colors.bg,
      border:       `1px ${colors.dashed ? "dashed" : "solid"} ${colors.border}`,
      borderRadius: theme.radius.sm,
      padding:      px,
      lineHeight:   1.3,
      whiteSpace:   "nowrap",
    }}>
      {tag}
      {onRemove && (
        <button
          onClick={e => { e.stopPropagation(); onRemove(); }}
          style={{
            background: "none", border: "none", padding: "0 1px",
            cursor: "pointer", color: colors.text, opacity: 0.6,
            fontSize: fs, lineHeight: 1, fontFamily: "inherit",
          }}
          aria-label={`Remove ${tag}`}
        >
          ✕
        </button>
      )}
    </span>
  );
}

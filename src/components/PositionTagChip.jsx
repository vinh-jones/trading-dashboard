import { theme } from "../lib/theme";
import { CATEGORY_COLORS, categoryFromTag } from "../lib/tagConstants";
import { TagChip } from "./journal/TagChip";

function tagSuffix(tag) {
  const i = tag.indexOf(":");
  return i === -1 ? tag : tag.slice(i + 1);
}

/**
 * Tag chip for an open-position row.
 *
 * - compact: short label (suffix only when prefixed; full when not), inline next to ticker.
 * - !compact: full TagChip styling, used inside the expanded-row "Strategic context" block.
 *
 * onClick is forwarded to the wrapper. The chip stops event propagation so
 * clicking a chip on a collapsed row doesn't also toggle the row's expand state.
 */
export function PositionTagChip({ tag, onClick, compact = false }) {
  const cat    = categoryFromTag(tag);
  const colors = CATEGORY_COLORS[cat];

  if (!compact) {
    // Expanded-row form: defer to TagChip for consistent styling.
    return (
      <span
        onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
        style={{ cursor: onClick ? "pointer" : "default", display: "inline-flex" }}
      >
        <TagChip tag={tag} size="sm" />
      </span>
    );
  }

  // Compact collapsed-row form.
  return (
    <span
      onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
      style={{
        display:      "inline-flex",
        alignItems:   "center",
        fontSize:     theme.size.xs,
        fontFamily:   theme.font.mono,
        color:        colors.text,
        background:   theme.bg.elevated,
        border:       `1px solid ${colors.border}`,
        borderRadius: theme.radius.pill,
        padding:      "1px 7px",
        lineHeight:   1.3,
        whiteSpace:   "nowrap",
        cursor:       onClick ? "pointer" : "default",
        marginLeft:   theme.space[1],
      }}
      title={tag}
    >
      {tagSuffix(tag)}
    </span>
  );
}

/** Compact "+N" overflow indicator for collapsed rows with multiple tags. */
export function PositionTagOverflow({ count, onClick }) {
  return (
    <span
      onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
      style={{
        display:      "inline-flex",
        alignItems:   "center",
        fontSize:     theme.size.xs,
        fontFamily:   theme.font.mono,
        color:        theme.text.muted,
        background:   theme.bg.elevated,
        border:       `1px solid ${theme.border.default}`,
        borderRadius: theme.radius.pill,
        padding:      "1px 6px",
        marginLeft:   theme.space[1],
        cursor:       onClick ? "pointer" : "default",
      }}
    >
      +{count}
    </span>
  );
}

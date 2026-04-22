import { theme } from "../../lib/theme";
import { CATEGORY_COLORS, CATEGORY_ORDER } from "../../lib/tagConstants";

export function TagCategoryLegend() {
  return (
    <div style={{
      display: "flex", flexWrap: "wrap", gap: theme.space[1],
      marginBottom: theme.space[2],
    }}>
      <span style={{
        fontSize: theme.size.xs, color: theme.text.faint,
        fontFamily: theme.font.mono, alignSelf: "center",
        letterSpacing: "0.06em", marginRight: 2,
      }}>
        categories:
      </span>
      {CATEGORY_ORDER.map(cat => {
        const c = CATEGORY_COLORS[cat];
        return (
          <span key={cat} style={{
            fontSize:     theme.size.xs,
            fontFamily:   theme.font.mono,
            color:        c.text,
            opacity:      0.6,
            background:   c.bg,
            border:       `1px solid ${c.border}`,
            borderRadius: theme.radius.sm,
            padding:      "2px 7px",
          }}>
            {cat}
          </span>
        );
      })}
    </div>
  );
}

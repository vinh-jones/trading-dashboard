import { theme } from "../../lib/theme";

export function PaletteItem({ item, active, onClick, onMouseEnter }) {
  const isAction = item.kind === "action";
  return (
    <div
      role="option"
      aria-selected={active}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      style={{
        display:       "flex",
        alignItems:    "center",
        gap:           theme.space[3],
        padding:       `${theme.space[2]}px ${theme.space[3]}px`,
        cursor:        "pointer",
        background:    active ? theme.bg.elevated : "transparent",
        borderLeft:    active ? `2px solid ${theme.blue}` : "2px solid transparent",
      }}
    >
      <span style={{
        fontSize:      theme.size.xs,
        color:         isAction ? theme.blue : theme.text.subtle,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        minWidth:      52,
      }}>
        {isAction ? "Action" : "Position"}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: theme.size.md,
          color:    theme.text.primary,
          fontWeight: 500,
        }}>
          {item.title}
        </div>
        {item.subtitle && (
          <div style={{
            fontSize: theme.size.xs,
            color:    theme.text.muted,
            marginTop: 1,
          }}>
            {item.subtitle}
          </div>
        )}
      </div>
    </div>
  );
}

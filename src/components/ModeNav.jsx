import { MODES, MODE_LABELS } from "../lib/modes";
import { theme } from "../lib/theme";
import { useWindowWidth } from "../hooks/useWindowWidth";

export function ModeNav({ mode, onChange, p1Count = 0 }) {
  const windowWidth = useWindowWidth();
  const isMobile    = windowWidth < 600;

  const buttonStyle = (m) => ({
    padding:       isMobile ? "10px 14px" : "10px 24px",
    fontSize:      theme.size.md,
    fontFamily:    "inherit",
    cursor:        "pointer",
    fontWeight:    mode === m ? 600 : 400,
    color:         mode === m ? theme.text.primary : theme.text.muted,
    background:    "transparent",
    border:        "none",
    borderBottom:  mode === m ? `2px solid ${theme.blue}` : "2px solid transparent",
    transition:    "all 0.15s",
    letterSpacing: "0.3px",
    whiteSpace:    "nowrap",
    display:       "inline-flex",
    alignItems:    "center",
    gap:           6,
  });

  const badgeStyle = {
    fontSize:      theme.size.xs,
    fontWeight:    700,
    padding:       "0 6px",
    borderRadius:  theme.radius.pill,
    background:    theme.red,
    color:         theme.text.primary,
    letterSpacing: "0.03em",
  };

  return (
    <div
      role="tablist"
      aria-label="Workspace modes"
      style={{
        display:                 "flex",
        gap:                     0,
        borderBottom:            `1px solid ${theme.border.default}`,
        marginBottom:            theme.space[5],
        overflowX:               "auto",
        WebkitOverflowScrolling: "touch",
      }}
    >
      {MODES.map(m => (
        <button
          key={m}
          role="tab"
          aria-selected={mode === m}
          style={buttonStyle(m)}
          onClick={() => onChange(m)}
        >
          {MODE_LABELS[m]}
          {m === "focus" && p1Count > 0 && (
            <span style={badgeStyle}>{p1Count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

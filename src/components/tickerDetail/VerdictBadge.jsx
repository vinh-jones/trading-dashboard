import { theme } from "../../lib/theme";

const VERDICT_STYLES = {
  ahead:    { color: theme.green, border: theme.green, bg: `${theme.green}1a`, label: "ahead" },
  behind:   { color: theme.red,   border: theme.red,   bg: `${theme.red}1a`,   label: "behind" },
  neutral:  { color: theme.text.muted, border: theme.border.strong, bg: theme.bg.elevated, label: "neutral" },
  suspect:  { color: theme.amber, border: theme.amber, bg: `${theme.amber}1a`, label: "suspect" },
};

export function VerdictBadge({ verdict }) {
  const s = VERDICT_STYLES[verdict] || VERDICT_STYLES.neutral;
  return (
    <span style={{
      display:        "inline-flex",
      alignItems:     "center",
      fontSize:       theme.size.xs,
      letterSpacing:  "0.08em",
      textTransform:  "uppercase",
      padding:        "2px 8px",
      border:         `1px solid ${s.border}`,
      background:     s.bg,
      color:          s.color,
      borderRadius:   theme.radius.pill,
      fontFamily:     theme.font.mono,
      fontWeight:     600,
    }}>
      {s.label}
    </span>
  );
}

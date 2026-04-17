import { theme } from "../../lib/theme";

// Non-position alerts are those whose focusItem has no matching ticker in the
// positions tree, or whose rule is inherently ambient (cash_below_floor,
// macro_overlap-without-ticker). The parent filters and passes these in.
export function AlertsBanner({ alerts }) {
  if (!alerts || alerts.length === 0) return null;

  return (
    <div style={{
      display:      "flex",
      flexDirection:"column",
      gap:          theme.space[1],
      marginBottom: theme.space[4],
    }}>
      {alerts.map(a => (
        <div key={a.id} style={{
          display:      "flex",
          alignItems:   "baseline",
          gap:          theme.space[2],
          padding:      `${theme.space[2]}px ${theme.space[3]}px`,
          background:   a.priority === "P1" ? "rgba(248,81,73,0.08)" : theme.bg.surface,
          border:       `1px solid ${a.priority === "P1" ? theme.red : theme.border.default}`,
          borderLeft:   `3px solid ${a.priority === "P1" ? theme.red : theme.amber}`,
          borderRadius: theme.radius.sm,
          fontSize:     theme.size.sm,
        }}>
          <span style={{
            fontSize:      theme.size.xs,
            fontWeight:    700,
            letterSpacing: "0.08em",
            color:         a.priority === "P1" ? theme.red : theme.amber,
            minWidth:      22,
          }}>
            {a.priority}
          </span>
          <span style={{ color: theme.text.primary, fontWeight: 500 }}>{a.title}</span>
          {a.detail && (
            <span style={{ color: theme.text.muted, fontSize: theme.size.xs, marginLeft: theme.space[2] }}>
              {a.detail}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

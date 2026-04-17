import { theme } from "../../lib/theme";
import { PositionRow } from "./PositionRow";

export function PositionsFeed({ rows }) {
  if (!rows || rows.length === 0) {
    return (
      <div style={{
        padding:      theme.space[5],
        background:   theme.bg.surface,
        border:       `1px solid ${theme.border.default}`,
        borderRadius: theme.radius.md,
        color:        theme.text.subtle,
        fontSize:     theme.size.sm,
        textAlign:    "center",
      }}>
        No open positions.
      </div>
    );
  }

  return (
    <div style={{
      background:   theme.bg.surface,
      border:       `1px solid ${theme.border.default}`,
      borderRadius: theme.radius.md,
      overflow:     "hidden",
      marginBottom: theme.space[4],
    }}>
      <div style={{
        fontSize:      theme.size.xs,
        color:         theme.text.muted,
        textTransform: "uppercase",
        letterSpacing: "0.1em",
        padding:       `${theme.space[2]}px ${theme.space[3]}px`,
        borderBottom:  `1px solid ${theme.border.default}`,
        background:    theme.bg.base,
      }}>
        Positions · by urgency
      </div>
      {rows.map((row, i) => (
        <PositionRow
          key={row.position?.id ?? `${row.ticker}-${row.type}-${row.strike}-${row.position?.expiry_date}-${row.position?.contracts}-${i}`}
          row={row}
        />
      ))}
    </div>
  );
}

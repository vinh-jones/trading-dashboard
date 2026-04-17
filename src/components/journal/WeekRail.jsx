import { theme } from "../../lib/theme";

export function WeekRail({ label, rangeLabel, entryCount }) {
  return (
    <div style={{
      width: 110, flexShrink: 0,
      padding: `${theme.space[3]}px 0 0`,
      position: "sticky", top: 0, alignSelf: "flex-start",
    }}>
      <div style={{
        color: theme.text.primary, fontSize: theme.size.xs, fontWeight: 600,
        textTransform: "uppercase", letterSpacing: "0.5px",
        marginBottom: theme.space[1],
      }}>
        {label}
      </div>
      <div style={{ color: theme.text.subtle, fontSize: theme.size.xs }}>
        {rangeLabel}
      </div>
      <div style={{ color: theme.blue, fontSize: theme.size.xs, marginTop: theme.space[1] }}>
        {entryCount} {entryCount === 1 ? "entry" : "entries"}
      </div>
    </div>
  );
}

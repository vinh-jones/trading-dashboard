import { buildBreakdownRows } from "../lib/breakdown";
import { formatDollars } from "../lib/format";
import { theme } from "../lib/theme";

/**
 * Ranked horizontal-bar breakdown of realized income for the active range.
 * Flips between grouping by ticker ("name") and by trade type ("type").
 * Clicking a bar toggles the matching selection via the injected handlers;
 * the rolled-up "Other" bar is inert.
 */
export function IncomeBreakdown({
  mode,               // "name" | "type"
  onModeChange,       // (mode) => void
  tickerSummary,      // [{ ticker, trades, premium, ... }]
  typeSummary,        // [{ type, count, premium }]
  selectedTicker,
  selectedType,
  onSelectTicker,     // (ticker) => void  (parent handles toggle-off)
  onSelectType,       // (type) => void
}) {
  const isName = mode === "name";
  const { rows, maxAbs } = isName
    ? buildBreakdownRows(tickerSummary, { key: "ticker", countKey: "trades", cap: 10 })
    : buildBreakdownRows(typeSummary, { key: "type", countKey: "count" });

  const MODES = [
    ["name", "By name"],
    ["type", "By type"],
  ];

  return (
    <div style={{ marginBottom: theme.space[5] }}>
      {/* Name | Type toggle */}
      <div style={{ display: "flex", gap: theme.space[2], marginBottom: theme.space[3] }}>
        {MODES.map(([m, label]) => {
          const active = mode === m;
          return (
            <button
              key={m}
              onClick={() => onModeChange(m)}
              style={{
                padding: `${theme.space[1]}px ${theme.space[3]}px`,
                borderRadius: theme.radius.pill,
                fontSize: theme.size.md,
                fontFamily: "inherit",
                cursor: "pointer",
                border: `1px solid ${active ? theme.border.strong : "transparent"}`,
                background: active ? theme.bg.elevated : "transparent",
                color: active ? theme.text.primary : theme.text.muted,
                transition: "background 0.15s",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Bars */}
      <div style={{ display: "flex", flexDirection: "column", gap: theme.space[2] }}>
        {rows.length === 0 && (
          <div style={{ fontSize: theme.size.md, color: theme.text.subtle }}>
            No realized income in this range.
          </div>
        )}
        {rows.map((r) => {
          const selected = !r.isOther && r.id === (isName ? selectedTicker : selectedType);
          const neg = r.premium < 0;
          const width = Math.max(2, (Math.abs(r.premium) / maxAbs) * 100);
          const clickable = !r.isOther;
          const right = r.isOther
            ? `${formatDollars(r.premium)} · ${r.groups} more`
            : `${formatDollars(r.premium)}${r.share != null ? ` · ${Math.round(r.share)}%` : ""}`;
          return (
            <button
              key={r.label + (r.id ?? "__other__")}
              onClick={clickable ? () => (isName ? onSelectTicker(r.id) : onSelectType(r.id)) : undefined}
              disabled={!clickable}
              style={{
                display: "grid",
                gridTemplateColumns: "64px 1fr auto",
                alignItems: "center",
                gap: theme.space[3],
                width: "100%",
                textAlign: "left",
                padding: `${theme.space[1]}px ${theme.space[2]}px`,
                border: `1px solid ${selected ? theme.blue : "transparent"}`,
                borderRadius: theme.radius.sm,
                background: selected ? theme.bg.elevated : "transparent",
                cursor: clickable ? "pointer" : "default",
                fontFamily: "inherit",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => { if (clickable && !selected) e.currentTarget.style.background = "rgba(58,130,246,0.06)"; }}
              onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{
                fontSize: theme.size.md,
                fontWeight: 600,
                color: r.isOther ? theme.text.muted : selected ? theme.blue : theme.text.primary,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                {r.label}
              </span>
              <span style={{ height: 16, background: theme.bg.surface, borderRadius: theme.radius.sm, overflow: "hidden" }}>
                <span style={{
                  display: "block",
                  width: `${width}%`,
                  height: "100%",
                  borderRadius: theme.radius.sm,
                  background: r.isOther ? theme.border.strong : neg ? theme.gradient.loss : theme.gradient.gain,
                  transition: "width 0.3s",
                }} />
              </span>
              <span style={{
                fontSize: theme.size.md,
                fontFamily: theme.font.mono,
                color: neg ? theme.red : theme.text.secondary,
                whiteSpace: "nowrap",
              }}>
                {right}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

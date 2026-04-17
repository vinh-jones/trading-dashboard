import { theme } from "../../lib/theme";
import { TYPE_COLORS } from "../../lib/constants";

function priorityStripColor(priority) {
  if (priority === "P1") return theme.red;
  if (priority === "P2") return theme.amber;
  return "transparent";
}

function glColor(glPct, targetPct) {
  if (glPct == null) return theme.text.muted;
  if (glPct < 0) return theme.red;
  if (targetPct != null && glPct >= targetPct) return theme.green;
  if (targetPct != null && glPct >= targetPct * 0.7) return theme.amber;
  return theme.text.secondary;
}

function proximityBarColor(fraction) {
  if (fraction >= 1) return theme.green;
  if (fraction >= 0.7) return theme.amber;
  return theme.blueBold;
}

function AlertTag({ tag }) {
  const isP1 = tag.priority === "P1";
  return (
    <span
      title={tag.title}
      style={{
        fontSize:      theme.size.xs,
        padding:       "1px 6px",
        borderRadius:  theme.radius.pill,
        background:    isP1 ? "rgba(248,81,73,0.15)" : theme.bg.elevated,
        color:         isP1 ? theme.red : theme.amber,
        border:        `1px solid ${isP1 ? theme.red : theme.border.strong}`,
        fontWeight:    600,
        letterSpacing: "0.03em",
        cursor:        "help",
      }}
    >
      {tag.priority}
    </span>
  );
}

export function PositionRow({ row }) {
  const { ticker, type, strike, dte, dtePct, glPct, targetPct, proximity, alertTags, priority } = row;

  const typeColor = TYPE_COLORS[type] ?? { text: theme.text.primary, bg: theme.bg.surface };

  return (
    <div style={{
      display:         "grid",
      gridTemplateColumns: "1fr auto",
      gap:             theme.space[3],
      alignItems:      "center",
      padding:         `${theme.space[2]}px ${theme.space[3]}px`,
      borderBottom:    `1px solid ${theme.border.default}`,
      borderLeft:      `3px solid ${priorityStripColor(priority)}`,
      background:      priority === "P1" ? "rgba(248,81,73,0.04)" : "transparent",
    }}>

      {/* ── Left: ticker + tags + meta ─────────────────────────────── */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: theme.space[2], flexWrap: "wrap" }}>
          <span style={{
            fontSize: theme.size.md,
            fontWeight: 700,
            color: theme.text.primary,
            letterSpacing: "0.02em",
          }}>
            {ticker}
          </span>
          <span style={{
            fontSize:      theme.size.xs,
            padding:       "1px 6px",
            borderRadius:  theme.radius.sm,
            background:    typeColor.bg,
            color:         typeColor.text,
            border:        `1px solid ${typeColor.border ?? theme.border.strong}`,
          }}>
            {type}
          </span>
          {alertTags.map(t => <AlertTag key={t.id} tag={t} />)}
        </div>
        <div style={{
          fontSize:   theme.size.xs,
          color:      theme.text.muted,
          marginTop:  2,
        }}>
          {strike != null && <>${strike} · </>}
          {dte != null && <>{dte}d</>}
          {dtePct != null && <> · {dtePct.toFixed(0)}% DTE left</>}
        </div>
      </div>

      {/* ── Right: G/L% + proximity bar ─────────────────────────────── */}
      <div style={{ textAlign: "right", minWidth: 110 }}>
        <div style={{
          fontSize:   theme.size.md,
          fontWeight: 700,
          color:      glColor(glPct, targetPct),
          letterSpacing: "0.02em",
        }}>
          {glPct != null ? `${glPct > 0 ? "+" : ""}${glPct.toFixed(0)}%` : "—"}
        </div>
        {targetPct != null && glPct != null && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end", marginTop: 2 }}>
            <span style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>
              {glPct.toFixed(0)}/{targetPct}
            </span>
            <div style={{
              width:        44,
              height:       3,
              background:   theme.border.default,
              borderRadius: theme.radius.sm,
              overflow:     "hidden",
            }}>
              <div style={{
                width:      `${Math.round(proximity * 100)}%`,
                height:     "100%",
                background: proximityBarColor(proximity),
                transition: "width 0.3s",
              }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

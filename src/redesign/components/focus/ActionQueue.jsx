import { useState } from "react";
import { T } from "../../theme.js";
import { Frame, Pill, Empty } from "../../primitives.jsx";
import { openPosition } from "../PositionDetail.jsx";
import { normalizePositions } from "./PositionsMatrix.jsx";

// Map focus engine item → action queue row
function itemToAction(item) {
  const pri = item.priority ?? "P2";
  const verb = actionVerb(item);
  return {
    pri,
    ticker: item.ticker ?? "—",
    type: item.type ?? "",
    verb,
    reason: item.message ?? item.rule ?? "",
    due: item.due ?? "",
  };
}

function actionVerb(item) {
  const rule = (item.rule || "").toLowerCase();
  const msg  = (item.message || "").toLowerCase();
  if (rule.includes("expir") || msg.includes("expir"))  return "REVIEW BEFORE EXPIRY";
  if (rule.includes("itm") || msg.includes("itm"))      return "ROLL OR CLOSE";
  if (rule.includes("earnings") || msg.includes("earn")) return "EARNINGS HOLD";
  if (rule.includes("uncovered") || msg.includes("uncov")) return "SELL COVERED CALL";
  if (rule.includes("60/60") || msg.includes("60%"))    return "TAKE PROFIT";
  if (rule.includes("roll") || msg.includes("roll"))    return "REVIEW ROLL";
  if (rule.includes("cash") || msg.includes("cash"))    return "DEPLOY CAPITAL";
  return "REVIEW";
}

export function ActionQueue({ focusItems, positions }) {
  const p1 = (focusItems || []).filter(it => it.priority === "P1");
  const p2 = (focusItems || []).filter(it => it.priority === "P2");
  const p3 = (focusItems || []).filter(it => it.priority === "P3");
  const actions = [...p1, ...p2].map(itemToAction);

  // Build a ticker+type → position id lookup from normalized rows
  const posRows = normalizePositions(positions || {});
  const posLookup = new Map(posRows.map(r => [`${r.ticker}|${r.type}`, r.id]));

  const header = (
    <div style={{ display: "flex", gap: 6 }}>
      <Pill color={T.red}   border={T.red}>P1·{p1.length}</Pill>
      <Pill color={T.amber} border={T.amber}>P2·{p2.length}</Pill>
      <Pill color={T.blue}  border={T.bd}>P3·{p3.length}</Pill>
    </div>
  );

  if (actions.length === 0) {
    return (
      <Frame accent="warn" title="ACTION QUEUE" subtitle="all clear" right={header}>
        <Empty
          glyph="✓" accent="green" tone="positive" compact
          title="Nothing needs your attention."
          body="Alerts and roll decisions appear here as positions age or conditions change."
        />
      </Frame>
    );
  }

  return (
    <Frame accent="warn" title="ACTION QUEUE" subtitle={`${actions.length} items · by urgency`} right={header}>
      <div style={{ display: "grid", gap: 1, background: T.bd, border: `1px solid ${T.bd}`, borderRadius: T.rSm }}>
        {actions.map((a, i) => (
          <ActionRow key={i} {...a} onOpen={() => {
            const id = posLookup.get(`${a.ticker}|${a.type}`);
            if (id) openPosition(id);
          }} />
        ))}
      </div>
    </Frame>
  );
}

function ActionRow({ pri, ticker, type, verb, reason, due, onOpen }) {
  const [hover, setHover] = useState(false);
  const priColor = pri === "P1" ? T.red : T.amber;

  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "grid",
        gridTemplateColumns: "auto auto 1fr auto",
        alignItems: "center",
        gap: 14,
        padding: "12px 14px 12px 10px",
        background: hover ? T.elev : T.surf,
        transition: "background 0.12s",
        borderLeft: `3px solid ${priColor}`,
        cursor: onOpen ? "pointer" : "default",
      }}
    >
      <span style={{ fontSize: T.xs, letterSpacing: "0.1em", color: priColor, fontWeight: 700, width: 18 }}>{pri}</span>

      <div style={{ display: "flex", alignItems: "center", gap: 8, width: 96 }}>
        <span style={{ fontSize: T.md, fontWeight: 600, color: T.t1, letterSpacing: "0.02em" }}>{ticker}</span>
        {type && (
          <span style={{ fontSize: T.xs, padding: "1px 5px", border: `1px solid ${T.bd}`, color: T.tm, borderRadius: T.rSm }}>
            {type}
          </span>
        )}
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: T.sm, color: priColor, fontWeight: 500, letterSpacing: "0.04em" }}>
          ▸ {verb}
        </div>
        <div style={{ fontSize: T.sm, color: T.tm, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {reason}
        </div>
      </div>

      {due && (
        <span style={{ fontSize: T.xs, color: T.ts, letterSpacing: "0.08em", whiteSpace: "nowrap" }}>
          {due.toUpperCase()}
        </span>
      )}
    </div>
  );
}

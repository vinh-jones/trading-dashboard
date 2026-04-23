import { Suspense } from "react";
import { useData } from "../hooks/useData";
import { EXPLORE_SUBVIEWS, SUBVIEW_LABELS, isValidSubView } from "../lib/modes";
import { theme } from "../lib/theme";
import { lazyNamed } from "../lib/lazyNamed";

const OpenPositionsTab = lazyNamed(() => import("./OpenPositionsTab"), "OpenPositionsTab");
const RadarTab         = lazyNamed(() => import("./RadarTab"),         "RadarTab");
const MacroTab         = lazyNamed(() => import("./MacroTab"),         "MacroTab");
const EarningsTab      = lazyNamed(() => import("./EarningsTab"),      "EarningsTab");

function TabLoading() {
  return (
    <div style={{
      padding:   theme.space[5],
      color:     theme.text.muted,
      fontSize:  theme.size.sm,
      textAlign: "center",
    }}>
      Loading…
    </div>
  );
}

// Chip-nav button. Active chip gets the blue accent.
function Chip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding:       "6px 14px",
        fontSize:      theme.size.sm,
        fontFamily:    "inherit",
        cursor:        "pointer",
        background:    active ? theme.bg.elevated : theme.bg.surface,
        color:         active ? theme.blue : theme.text.muted,
        border:        `1px solid ${active ? theme.blue : theme.border.default}`,
        borderRadius:  theme.radius.pill,
        fontWeight:    active ? 600 : 400,
        letterSpacing: "0.3px",
        whiteSpace:    "nowrap",
        transition:    "all 0.15s",
      }}
    >
      {children}
    </button>
  );
}

export function ExploreView({ subView, onSubViewChange, positionIntent, onPositionIntentConsumed }) {
  const { positions, account, trades } = useData();
  const active = isValidSubView("explore", subView) ? subView : "positions";

  return (
    <div>
      <div style={{
        display:     "flex",
        gap:         theme.space[2],
        marginBottom: theme.space[4],
        overflowX:   "auto",
        WebkitOverflowScrolling: "touch",
      }}>
        {EXPLORE_SUBVIEWS.map(sv => (
          <Chip key={sv} active={active === sv} onClick={() => onSubViewChange(sv)}>
            {SUBVIEW_LABELS[sv]}
          </Chip>
        ))}
      </div>

      <Suspense fallback={<TabLoading />}>
        {active === "positions" && (
          <OpenPositionsTab
            positionIntent={positionIntent}
            onPositionIntentConsumed={onPositionIntentConsumed}
          />
        )}
        {active === "radar"     && <RadarTab positions={positions} account={account} />}
        {active === "earnings"  && <EarningsTab positions={positions} account={account} trades={trades} />}
        {active === "macro"     && <MacroTab />}
      </Suspense>
    </div>
  );
}

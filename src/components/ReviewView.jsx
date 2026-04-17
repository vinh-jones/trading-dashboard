import { REVIEW_SUBVIEWS, SUBVIEW_LABELS, isValidSubView } from "../lib/modes";
import { theme } from "../lib/theme";
import { SummaryTab } from "./SummaryTab";
import { CalendarTab } from "./CalendarTab";
import { JournalTab } from "./journal/JournalTab";

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

export function ReviewView({
  subView,
  onSubViewChange,
  selectedTicker, setSelectedTicker,
  selectedType, setSelectedType,
  selectedDuration, setSelectedDuration,
  selectedDay, setSelectedDay,
  captureRate, setCaptureRate,
  journalIntent, onJournalIntentConsumed,
}) {
  const active = isValidSubView("review", subView) ? subView : "monthly";

  return (
    <div>
      <div style={{
        display:     "flex",
        gap:         theme.space[2],
        marginBottom: theme.space[4],
        overflowX:   "auto",
        WebkitOverflowScrolling: "touch",
      }}>
        {REVIEW_SUBVIEWS.map(sv => (
          <Chip key={sv} active={active === sv} onClick={() => onSubViewChange(sv)}>
            {SUBVIEW_LABELS[sv]}
          </Chip>
        ))}
      </div>

      {active === "monthly" && (
        <CalendarTab
          selectedTicker={selectedTicker} setSelectedTicker={setSelectedTicker}
          selectedType={selectedType}     setSelectedType={setSelectedType}
          selectedDay={selectedDay}       setSelectedDay={setSelectedDay}
          captureRate={captureRate}       setCaptureRate={setCaptureRate}
        />
      )}
      {active === "ytd" && (
        <SummaryTab
          selectedTicker={selectedTicker} setSelectedTicker={setSelectedTicker}
          selectedType={selectedType}     setSelectedType={setSelectedType}
          selectedDuration={selectedDuration} setSelectedDuration={setSelectedDuration}
        />
      )}
      {active === "journal" && (
        <JournalTab
          journalIntent={journalIntent}
          onJournalIntentConsumed={onJournalIntentConsumed}
        />
      )}
    </div>
  );
}

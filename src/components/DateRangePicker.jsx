import { useEffect, useRef, useState } from "react";
import { theme } from "../lib/theme";

const PRESETS = [
  { key: "1m",  label: "1M"  },
  { key: "3m",  label: "3M"  },
  { key: "ytd", label: "YTD" },
  { key: "1y",  label: "1Y"  },
  { key: "all", label: "All" },
];

/** Format a Date as "Jan 15" for chip label and calendar display. */
function fmtChipDate(d) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_ABBREVS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/**
 * Returns an array of Date | null for a single-month grid.
 * Leading nulls pad to the correct weekday column.
 */
function buildCalendarGrid(year, month) {
  const firstDay    = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  return cells;
}

/** True if two Dates refer to the same calendar day. */
function sameDay(a, b) {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear()
      && a.getMonth()    === b.getMonth()
      && a.getDate()     === b.getDate();
}

/**
 * Preset chip row + optional calendar popup for custom date range selection.
 *
 * Props:
 *   preset:      'ytd' | '1m' | '3m' | '1y' | 'all' | 'custom'
 *   customRange: { start: Date, end: Date } | null
 *   onChange:    ({ preset, customRange }) => void
 */
export function DateRangePicker({ preset, customRange, onChange }) {
  const isCustom = preset === "custom";
  const hasRange = isCustom && customRange != null;

  // Calendar popup state
  const [calYear,      setCalYear]      = useState(() => new Date().getFullYear());
  const [calMonth,     setCalMonth]     = useState(() => new Date().getMonth());
  const [pendingStart, setPendingStart] = useState(null); // first clicked date
  const [pendingEnd,   setPendingEnd]   = useState(null); // second clicked date
  const [hoverDate,    setHoverDate]    = useState(null);
  const containerRef = useRef(null);

  // Reset calendar state when popup opens
  useEffect(() => {
    if (isCustom && !hasRange) {
      const n = new Date();
      setCalYear(n.getFullYear());
      setCalMonth(n.getMonth());
      setPendingStart(null);
      setPendingEnd(null);
      setHoverDate(null);
    }
  }, [isCustom, hasRange]);

  // Close popup on click-outside
  useEffect(() => {
    if (!isCustom || hasRange) return;
    function handler(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        onChange({ preset: "ytd", customRange: null });
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isCustom, hasRange, onChange]);

  // Chip label when a custom range is confirmed
  const customChipLabel = hasRange
    ? `${fmtChipDate(customRange.start)} – ${fmtChipDate(customRange.end)} ✕`
    : "Custom…";

  function handlePresetClick(key) {
    onChange({ preset: key, customRange: null });
  }

  function handleCustomChipClick() {
    if (hasRange) {
      onChange({ preset: "ytd", customRange: null }); // ✕ — clear
    } else {
      onChange({ preset: "custom", customRange: null }); // open calendar
    }
  }

  // Calendar nav
  function prevMonth() {
    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); }
    else setCalMonth(m => m - 1);
  }
  function nextMonth() {
    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); }
    else setCalMonth(m => m + 1);
  }

  // Two-click date selection
  function handleDayClick(date) {
    if (!pendingStart || pendingEnd) {
      // Start fresh
      setPendingStart(date);
      setPendingEnd(null);
    } else {
      // Second click
      if (date < pendingStart) {
        setPendingEnd(pendingStart);
        setPendingStart(date);
      } else {
        setPendingEnd(date);
      }
    }
  }

  // Per-day style: determines start, end, in-range, hover-range
  function getDayBg(date) {
    if (!date) return {};
    const isStart = sameDay(date, pendingStart);
    const isEnd   = sameDay(date, pendingEnd);

    if (isStart || isEnd) {
      return {
        background:   theme.blue,
        color:        theme.text.onAccent,
        borderRadius: theme.radius.sm,
      };
    }

    // Determine effective range (confirmed or hover-preview)
    let rangeMin = null;
    let rangeMax = null;
    if (pendingStart && pendingEnd) {
      rangeMin = pendingStart;
      rangeMax = pendingEnd;
    } else if (pendingStart && hoverDate) {
      rangeMin = pendingStart < hoverDate ? pendingStart : hoverDate;
      rangeMax = pendingStart < hoverDate ? hoverDate    : pendingStart;
    }

    if (rangeMin && rangeMax && date > rangeMin && date < rangeMax) {
      return {
        background:   `${theme.blue}22`,
        color:        theme.blue,
        borderRadius: 2,
      };
    }

    return { color: theme.text.secondary };
  }

  function handleApply() {
    if (pendingStart && pendingEnd) {
      onChange({ preset: "custom", customRange: { start: pendingStart, end: pendingEnd } });
    }
  }

  function handleCancel() {
    onChange({ preset: "ytd", customRange: null });
  }

  const calendarGrid = buildCalendarGrid(calYear, calMonth);
  const canApply = pendingStart && pendingEnd;

  return (
    <div ref={containerRef} style={{ marginBottom: theme.space[4] }}>
      {/* Chip row */}
      <div style={{ display: "flex", alignItems: "center", gap: theme.space[2], flexWrap: "wrap" }}>
        <span style={{
          fontSize:      theme.size.sm,
          color:         theme.text.muted,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          flexShrink:    0,
        }}>
          Range
        </span>

        {PRESETS.map(({ key, label }) => {
          const active = preset === key;
          return (
            <button
              key={key}
              onClick={() => handlePresetClick(key)}
              style={{
                padding:      `${theme.space[1]}px ${theme.space[3]}px`,
                borderRadius: theme.radius.pill,
                fontSize:     theme.size.sm,
                fontFamily:   "inherit",
                cursor:       "pointer",
                background:   active ? theme.bg.elevated : "transparent",
                color:        active ? theme.blue : theme.text.muted,
                border:       `1px solid ${active ? theme.blue : theme.border.default}`,
                fontWeight:   active ? 600 : 400,
                transition:   "all 0.15s",
              }}
            >
              {label}
            </button>
          );
        })}

        {/* Custom chip */}
        <button
          onClick={handleCustomChipClick}
          style={{
            padding:      `${theme.space[1]}px ${theme.space[3]}px`,
            borderRadius: theme.radius.pill,
            fontSize:     theme.size.sm,
            fontFamily:   "inherit",
            cursor:       "pointer",
            background:   isCustom ? theme.bg.elevated : "transparent",
            color:        isCustom ? theme.blue : theme.text.muted,
            border:       isCustom
              ? `1px solid ${theme.blue}`
              : `1px dashed ${theme.border.strong}`,
            fontWeight:   isCustom ? 600 : 400,
            transition:   "all 0.15s",
          }}
        >
          {customChipLabel}
        </button>
      </div>

      {/* Calendar popup — shown when Custom is active and no range is confirmed yet */}
      {isCustom && !hasRange && (
        <div style={{
          marginTop:    theme.space[3],
          background:   theme.bg.elevated,
          border:       `1px solid ${theme.border.strong}`,
          borderRadius: theme.radius.md,
          padding:      theme.space[4],
          display:      "inline-block",
          minWidth:     220,
          userSelect:   "none",
        }}>
          {/* Month navigation header */}
          <div style={{
            display:        "flex",
            justifyContent: "space-between",
            alignItems:     "center",
            marginBottom:   theme.space[3],
          }}>
            <button
              onClick={prevMonth}
              style={{
                background:   "transparent",
                border:       "none",
                color:        theme.text.muted,
                cursor:       "pointer",
                fontSize:     theme.size.md,
                padding:      `0 ${theme.space[2]}px`,
                lineHeight:   1,
              }}
            >
              ‹
            </button>
            <span style={{ fontSize: theme.size.sm, fontWeight: 600, color: theme.text.primary }}>
              {MONTH_NAMES[calMonth]} {calYear}
            </span>
            <button
              onClick={nextMonth}
              style={{
                background:   "transparent",
                border:       "none",
                color:        theme.text.muted,
                cursor:       "pointer",
                fontSize:     theme.size.md,
                padding:      `0 ${theme.space[2]}px`,
                lineHeight:   1,
              }}
            >
              ›
            </button>
          </div>

          {/* Day-of-week header row */}
          <div style={{
            display:             "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap:                 2,
            marginBottom:        4,
          }}>
            {DAY_ABBREVS.map(d => (
              <div key={d} style={{
                textAlign:  "center",
                fontSize:   theme.size.xs,
                color:      theme.text.subtle,
                fontWeight: 600,
                padding:    "2px 0",
              }}>
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div style={{
            display:             "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap:                 2,
          }}>
            {calendarGrid.map((date, i) => {
              if (!date) {
                return <div key={`empty-${i}`} />;
              }
              const dayBg = getDayBg(date);
              return (
                <div
                  key={date.getDate()}
                  onClick={() => handleDayClick(date)}
                  onMouseEnter={() => setHoverDate(date)}
                  onMouseLeave={() => setHoverDate(null)}
                  style={{
                    textAlign:    "center",
                    fontSize:     theme.size.xs,
                    padding:      "4px 2px",
                    cursor:       "pointer",
                    transition:   "background 0.1s",
                    ...dayBg,
                  }}
                >
                  {date.getDate()}
                </div>
              );
            })}
          </div>

          {/* Footer: hint + Cancel/Apply */}
          <div style={{
            marginTop:      theme.space[3],
            display:        "flex",
            justifyContent: "space-between",
            alignItems:     "center",
          }}>
            <span style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>
              {!pendingStart
                ? "Click a start date"
                : !pendingEnd
                  ? "Click an end date"
                  : `${fmtChipDate(pendingStart)} – ${fmtChipDate(pendingEnd)}`}
            </span>
            <div style={{ display: "flex", gap: theme.space[2] }}>
              <button
                onClick={handleCancel}
                style={{
                  padding:      `${theme.space[1]}px ${theme.space[3]}px`,
                  borderRadius: theme.radius.sm,
                  fontSize:     theme.size.sm,
                  fontFamily:   "inherit",
                  cursor:       "pointer",
                  background:   "transparent",
                  color:        theme.text.muted,
                  border:       `1px solid ${theme.border.default}`,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleApply}
                disabled={!canApply}
                style={{
                  padding:      `${theme.space[1]}px ${theme.space[3]}px`,
                  borderRadius: theme.radius.sm,
                  fontSize:     theme.size.sm,
                  fontFamily:   "inherit",
                  cursor:       canApply ? "pointer" : "not-allowed",
                  background:   canApply ? theme.blue : theme.border.default,
                  color:        canApply ? theme.text.onAccent : theme.text.muted,
                  border:       "none",
                  transition:   "all 0.15s",
                }}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

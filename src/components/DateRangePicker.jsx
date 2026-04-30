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

  const customChipLabel = hasRange
    ? `${fmtChipDate(customRange.start)} – ${fmtChipDate(customRange.end)} ✕`
    : "Custom…";

  function handlePresetClick(key) {
    onChange({ preset: key, customRange: null });
  }

  function handleCustomChipClick() {
    if (hasRange) {
      // ✕ — clear back to YTD
      onChange({ preset: "ytd", customRange: null });
    } else {
      // Open calendar picker
      onChange({ preset: "custom", customRange: null });
    }
  }

  return (
    <div style={{ marginBottom: theme.space[4] }}>
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
    </div>
  );
}

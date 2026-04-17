import { useState, useEffect } from "react";
import { theme } from "../../lib/theme";
import { SECTOR_GROUPS } from "./radarConstants";

// ── Tooltip ───────────────────────────────────────────────────────────────────

function SectorTooltip({ group, data }) {
  return (
    <div style={{
      position:      "absolute",
      bottom:        "calc(100% + 6px)",
      left:          "50%",
      transform:     "translateX(-50%)",
      background:    theme.bg.elevated,
      border:        `1px solid ${theme.border.strong}`,
      borderRadius:  theme.radius.md,
      padding:       `${theme.space[2]}px ${theme.space[3]}px`,
      zIndex:        300,
      minWidth:      200,
      maxWidth:      280,
      pointerEvents: "none",
    }}>
      <div style={{ fontSize: theme.size.xs, fontWeight: 700, color: theme.text.primary, marginBottom: theme.space[1] }}>
        {group}
      </div>
      <div style={{ fontSize: theme.size.xs, color: theme.text.muted, marginBottom: theme.space[1] }}>
        <span style={{ color: theme.text.subtle }}>Sectors: </span>
        {data.sectors.join(', ')}
      </div>
      {data.tickers.length > 0 && (
        <div style={{ fontSize: theme.size.xs, color: theme.text.muted }}>
          <span style={{ color: theme.text.subtle }}>Tickers: </span>
          {data.tickers.join(', ')}
        </div>
      )}
    </div>
  );
}

// ── Sector toggle button ──────────────────────────────────────────────────────

function SectorBtn({ group, active, onClick }) {
  const [hovered, setHovered] = useState(false);
  const data = SECTOR_GROUPS[group];

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          fontSize:     theme.size.xs,
          padding:      `2px ${theme.space[2]}px`,
          borderRadius: theme.radius.pill,
          border:       `1px solid ${active ? theme.blue : theme.border.default}`,
          background:   active ? theme.blue : "transparent",
          color:        active ? theme.text.primary : theme.text.muted,
          cursor:       "pointer",
          fontWeight:   active ? 600 : 400,
          whiteSpace:   "nowrap",
        }}
      >
        {group}
      </button>
      {hovered && <SectorTooltip group={group} data={data} />}
    </div>
  );
}

// ── Numeric range input ───────────────────────────────────────────────────────
// Uses local string state so partial input like "-", "-0." doesn't reset mid-type.
// Syncs from external filters when they change (preset applied, clear all).

function RangeInput({ label, minField, maxField, filters, onChange, placeholderMin, placeholderMax, displayScale, storeScale }) {
  function storedToDisplay(stored) {
    if (stored === null || stored === undefined) return '';
    return displayScale ? String(Math.round(stored * displayScale)) : String(stored);
  }

  const [minStr, setMinStr] = useState(() => storedToDisplay(filters[minField]));
  const [maxStr, setMaxStr] = useState(() => storedToDisplay(filters[maxField]));
  const [minFocused, setMinFocused] = useState(false);
  const [maxFocused, setMaxFocused] = useState(false);

  // Sync display state when filters change externally (preset load, clear all)
  useEffect(() => { setMinStr(storedToDisplay(filters[minField])); }, [filters[minField]]);
  useEffect(() => { setMaxStr(storedToDisplay(filters[maxField])); }, [filters[maxField]]);

  function isPartial(s) {
    // Allow mid-type states: "-", "0.", "-0.", "-0.1" etc.
    return s === '-' || s === '.' || s === '-.' || /^-?\d*\.$/.test(s);
  }

  function handleChange(str, field, setStr) {
    setStr(str);
    if (str === '') { onChange(field, null); return; }
    if (isPartial(str)) return; // don't flush to store yet
    const n = parseFloat(str);
    if (!isNaN(n)) onChange(field, storeScale ? n * storeScale : n);
  }

  return (
    <div>
      <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginBottom: theme.space[1] }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: theme.space[1] }}>
        <input
          type="text"
          value={minStr}
          onChange={e => handleChange(e.target.value, minField, setMinStr)}
          placeholder={placeholderMin}
          style={{ ...inputStyle, border: `1px solid ${minFocused ? theme.blue : theme.border.default}` }}
          onFocus={() => setMinFocused(true)}
          onBlur={() => setMinFocused(false)}
        />
        <span style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>–</span>
        <input
          type="text"
          value={maxStr}
          onChange={e => handleChange(e.target.value, maxField, setMaxStr)}
          placeholder={placeholderMax}
          style={{ ...inputStyle, border: `1px solid ${maxFocused ? theme.blue : theme.border.default}` }}
          onFocus={() => setMaxFocused(true)}
          onBlur={() => setMaxFocused(false)}
        />
      </div>
    </div>
  );
}

const inputStyle = {
  width:        56,
  padding:      `${theme.space[1]}px ${theme.space[1]}px`,
  fontSize:     theme.size.xs,
  background:   theme.bg.base,
  border:       `1px solid ${theme.border.default}`,
  borderRadius: theme.radius.sm,
  color:        theme.text.primary,
  outline:      "none",
};

// ── Main component ────────────────────────────────────────────────────────────
// bare=true    — strips card chrome (background/border/padding); used when embedded in a modal
// hideFooter=true — hides Clear All / Save as Preset buttons

export default function RadarAdvancedFilters({
  filters,
  onChange,
  onClear       = () => {},
  onSavePreset  = () => {},
  hideFooter    = false,
  bare          = false,
}) {
  const groupNames = Object.keys(SECTOR_GROUPS);
  const [earningsFocused, setEarningsFocused] = useState(false);

  function toggleSectorGroup(row, group) {
    const current = filters[row] ?? [];
    const next = current.includes(group)
      ? current.filter(g => g !== group)
      : [...current, group];
    onChange(row, next);
  }

  const cardStyle = bare ? {} : {
    background:   theme.bg.surface,
    border:       `1px solid ${theme.border.default}`,
    borderRadius: theme.radius.md,
    padding:      `${theme.space[3]}px ${theme.space[4]}px`,
    marginBottom: theme.space[3],
  };

  return (
    <div style={cardStyle}>

      {/* ── Numeric ranges ── */}
      <div style={{ display: "flex", gap: theme.space[4], flexWrap: "wrap", marginBottom: theme.space[3] }}>
        <RangeInput
          label="BB Position"
          minField="bb_position_min"
          maxField="bb_position_max"
          filters={filters}
          onChange={onChange}
          placeholderMin="e.g. -0.10"
          placeholderMax="e.g. 0.25"
        />
        <RangeInput
          label="Raw IV (%)"
          minField="raw_iv_min"
          maxField="raw_iv_max"
          filters={filters}
          onChange={onChange}
          placeholderMin="e.g. 40"
          placeholderMax="e.g. 120"
          displayScale={100}
          storeScale={0.01}
        />
        <RangeInput
          label="Composite IV"
          minField="composite_iv_min"
          maxField="composite_iv_max"
          filters={filters}
          onChange={onChange}
          placeholderMin="e.g. 0.40"
          placeholderMax="e.g. 0.85"
        />
        <RangeInput
          label="IV Rank"
          minField="iv_rank_min"
          maxField="iv_rank_max"
          filters={filters}
          onChange={onChange}
          placeholderMin="e.g. 50"
          placeholderMax="e.g. 90"
        />
        <RangeInput
          label="P/E (TTM)"
          minField="pe_min"
          maxField="pe_max"
          filters={filters}
          onChange={onChange}
          placeholderMin="e.g. 10"
          placeholderMax="e.g. 30"
        />
      </div>

      {/* ── Sector toggles ── */}
      <div style={{ marginBottom: theme.space[3] }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: theme.space[2], flexWrap: "wrap", marginBottom: theme.space[2] }}>
          <span style={{ fontSize: theme.size.xs, color: theme.text.subtle, flexShrink: 0, minWidth: 64 }}>Include:</span>
          {groupNames.map(g => (
            <SectorBtn key={g} group={g} active={filters.sectors_include?.includes(g)} onClick={() => toggleSectorGroup('sectors_include', g)} />
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: theme.space[2], flexWrap: "wrap", marginBottom: theme.space[1] }}>
          <span style={{ fontSize: theme.size.xs, color: theme.text.subtle, flexShrink: 0, minWidth: 64 }}>Exclude:</span>
          {groupNames.map(g => (
            <SectorBtn key={g} group={g} active={filters.sectors_exclude?.includes(g)} onClick={() => toggleSectorGroup('sectors_exclude', g)} />
          ))}
        </div>
        <div style={{ fontSize: theme.size.xs, color: theme.text.faint, marginTop: 4 }}>
          Include takes precedence over Exclude if both are set.
        </div>
      </div>

      {/* ── Ownership + Earnings ── */}
      <div style={{ display: "flex", gap: theme.space[6], flexWrap: "wrap", marginBottom: hideFooter ? 0 : theme.space[3] }}>
        <div>
          <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginBottom: theme.space[1] }}>Ownership</div>
          <div style={{ display: "flex", gap: theme.space[3] }}>
            {[['all', 'All'], ['not_held', 'Not held'], ['held', 'Held']].map(([val, label]) => (
              <label key={val} style={{ display: "flex", alignItems: "center", gap: theme.space[1], fontSize: theme.size.sm, color: theme.text.muted, cursor: "pointer" }}>
                <input
                  type="radio"
                  name="radar-ownership"
                  value={val}
                  checked={filters.ownership === val}
                  onChange={() => onChange('ownership', val)}
                  style={{ cursor: "pointer" }}
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div>
          <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginBottom: theme.space[1] }}>Min days to earnings</div>
          <div style={{ display: "flex", alignItems: "center", gap: theme.space[2] }}>
            <input
              type="text"
              value={filters.earnings_days_min ?? ''}
              onChange={e => {
                const n = parseInt(e.target.value, 10);
                onChange('earnings_days_min', isNaN(n) ? null : n);
              }}
              placeholder="e.g. 21"
              style={{ ...inputStyle, width: 64, border: `1px solid ${earningsFocused ? theme.blue : theme.border.default}` }}
              onFocus={() => setEarningsFocused(true)}
              onBlur={() => setEarningsFocused(false)}
            />
            <span style={{ fontSize: theme.size.xs, color: theme.text.faint }}>blank = no filter</span>
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      {!hideFooter && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: theme.space[3] }}>
          <button onClick={onClear} style={ghostBtnStyle}>Clear All</button>
          <button onClick={onSavePreset} style={ghostBtnStyle}>Save as Preset</button>
        </div>
      )}
    </div>
  );
}

const ghostBtnStyle = {
  fontSize:     theme.size.sm,
  padding:      `${theme.space[1]}px ${theme.space[3]}px`,
  borderRadius: theme.radius.sm,
  border:       `1px solid ${theme.border.default}`,
  background:   "transparent",
  color:        theme.text.muted,
  cursor:       "pointer",
};

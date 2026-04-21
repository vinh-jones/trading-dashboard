import { useState, useEffect } from "react";
import { T } from "../../theme.js";
import { supabase } from "../../../lib/supabase.js";
import {
  DEFAULT_FILTERS,
  SECTOR_GROUPS,
  expandGroupsToSectors,
  countActiveFilters,
} from "../../../components/radar/radarConstants.js";

export { DEFAULT_FILTERS, countActiveFilters };

// ── Filter application ────────────────────────────────────────────────────────
// Operates on adapted radar rows from RadarSurface. Key fields expected:
//   r.ticker, r.sector, r.bb_position (0..1±), r.iv_pct (0..100),
//   r.iv_rank (0..100), r.pe (number|null), r.earn (days|null), r.held (bool)
export function applyRadarFilters(rows, filters, sortKey) {
  const f = filters || DEFAULT_FILTERS;
  let out = (rows || []).slice();

  // BB position (bb_position scale: 0..1, stored filter is percent-style -30..130)
  if (f.bb_position_min != null) out = out.filter(r => r.bb_position != null && r.bb_position * 100 >= f.bb_position_min);
  if (f.bb_position_max != null) out = out.filter(r => r.bb_position != null && r.bb_position * 100 <= f.bb_position_max);

  // Raw IV (filter stored as 0..1 decimal; row iv_pct is 0..100)
  if (f.raw_iv_min != null) out = out.filter(r => r.iv_pct != null && r.iv_pct >= f.raw_iv_min * 100);
  if (f.raw_iv_max != null) out = out.filter(r => r.iv_pct != null && r.iv_pct <= f.raw_iv_max * 100);

  // IV rank (both 0..100)
  if (f.iv_rank_min != null) out = out.filter(r => r.iv_rank != null && r.iv_rank >= f.iv_rank_min);
  if (f.iv_rank_max != null) out = out.filter(r => r.iv_rank != null && r.iv_rank <= f.iv_rank_max);

  // Composite IV (IV rank × 0.6 + min(iv/1.5, 1) × 0.4, × 100). Display as 0..100.
  if (f.composite_iv_min != null || f.composite_iv_max != null) {
    out = out.filter(r => {
      if (r.iv_rank == null || r.iv_pct == null) return false;
      const composite = (r.iv_rank / 100 * 0.60 + Math.min(r.iv_pct / 150, 1) * 0.40) * 100;
      if (f.composite_iv_min != null && composite < f.composite_iv_min) return false;
      if (f.composite_iv_max != null && composite > f.composite_iv_max) return false;
      return true;
    });
  }

  // P/E
  if (f.pe_min != null) out = out.filter(r => r.pe != null && r.pe >= f.pe_min);
  if (f.pe_max != null) out = out.filter(r => r.pe != null && r.pe <= f.pe_max);

  // Sector include / exclude (filter stores GROUP NAMES, expand to sector strings)
  if (f.sectors_include?.length > 0) {
    const allowed = new Set(expandGroupsToSectors(f.sectors_include));
    out = out.filter(r => r.sector && allowed.has(r.sector));
  }
  if (f.sectors_exclude?.length > 0) {
    const blocked = new Set(expandGroupsToSectors(f.sectors_exclude));
    out = out.filter(r => !r.sector || !blocked.has(r.sector));
  }

  // Earnings: require ≥N days until next report (drops tickers with earnings inside window)
  if (f.earnings_days_min != null) {
    out = out.filter(r => r.earn == null || r.earn >= f.earnings_days_min);
  }

  // Ownership
  if (f.ownership === "held")      out = out.filter(r => r.held);
  if (f.ownership === "not_held")  out = out.filter(r => !r.held);

  // Sort
  const sorters = {
    score: (a, b) => (b.score ?? 0) - (a.score ?? 0),
    bb:    (a, b) => (a.bb_position ?? 0) - (b.bb_position ?? 0),
    ivr:   (a, b) => (b.iv_rank ?? 0) - (a.iv_rank ?? 0),
    iv:    (a, b) => (b.iv_pct ?? 0) - (a.iv_pct ?? 0),
    pe:    (a, b) => (a.pe ?? Infinity) - (b.pe ?? Infinity),
  };
  out.sort(sorters[sortKey] || sorters.score);

  return out;
}

// ── Presets Supabase I/O ──────────────────────────────────────────────────────
export function useRadarPresets() {
  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("radar_presets")
      .select("*")
      .order("display_order", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error) setPresets(data || []);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  async function savePreset(name, filters) {
    const order = presets.length;
    const { data, error } = await supabase
      .from("radar_presets")
      .insert({ name: name.trim(), filters, display_order: order })
      .select()
      .single();
    if (error) { console.warn("[radar-presets] save failed:", error.message); return null; }
    setPresets(prev => [...prev, data]);
    return data;
  }

  async function deletePreset(id) {
    const { error } = await supabase.from("radar_presets").delete().eq("id", id);
    if (error) { console.warn("[radar-presets] delete failed:", error.message); return false; }
    setPresets(prev => prev.filter(p => p.id !== id));
    return true;
  }

  return { presets, loading, savePreset, deletePreset };
}

// ── UI: Filter bar (quiet style) ──────────────────────────────────────────────
const BB_PILLS = [
  { k: "all",        lbl: "ALL",    apply: (f) => ({ ...f, bb_position_min: null, bb_position_max: null }) },
  { k: "below",      lbl: "BELOW",  apply: (f) => ({ ...f, bb_position_min: -30, bb_position_max: 0   }) },
  { k: "near_lower", lbl: "NEAR ↓", apply: (f) => ({ ...f, bb_position_min: 0,   bb_position_max: 20  }) },
  { k: "mid",        lbl: "MID",    apply: (f) => ({ ...f, bb_position_min: 20,  bb_position_max: 80  }) },
  { k: "near_upper", lbl: "NEAR ↑", apply: (f) => ({ ...f, bb_position_min: 80,  bb_position_max: 100 }) },
  { k: "above",      lbl: "ABOVE",  apply: (f) => ({ ...f, bb_position_min: 100, bb_position_max: 130 }) },
];

const SORT_OPTIONS = [
  { k: "score", lbl: "SCORE" },
  { k: "bb",    lbl: "BB"    },
  { k: "ivr",   lbl: "IVR"   },
  { k: "iv",    lbl: "IV"    },
  { k: "pe",    lbl: "P/E"   },
];

function bbActivePill(filters) {
  const min = filters.bb_position_min, max = filters.bb_position_max;
  for (const p of BB_PILLS) {
    const applied = p.apply(DEFAULT_FILTERS);
    if (applied.bb_position_min === min && applied.bb_position_max === max) return p.k;
  }
  return null;
}

export function RadarFilterBar({ filters, setFilters, sortKey, setSortKey, presets, savePreset, deletePreset }) {
  const [advOpen, setAdvOpen]       = useState(false);
  const [presetMenu, setPresetMenu] = useState(false);
  const activeCount = countActiveFilters(filters);
  const bbPill = bbActivePill(filters);

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {/* Main bar */}
      <div style={{
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14,
        padding: "9px 12px", background: T.surf, border: `1px solid ${T.bd}`,
      }}>
        {/* BB pills */}
        <div style={{ display: "flex", gap: 2 }}>
          {BB_PILLS.map(o => (
            <button
              key={o.k}
              onClick={() => setFilters(o.apply(filters))}
              style={{
                padding: "4px 10px", fontSize: T.xs, letterSpacing: "0.08em",
                fontFamily: T.mono, fontWeight: 600,
                border: `1px solid ${bbPill === o.k ? T.cyan : T.bd}`,
                background: bbPill === o.k ? T.cyan + "18" : "transparent",
                color: bbPill === o.k ? T.cyan : T.tm,
                cursor: "pointer",
              }}
            >{o.lbl}</button>
          ))}
        </div>

        <div style={{ width: 1, height: 18, background: T.bd }} />

        {/* Sort */}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: T.xs, color: T.tf, letterSpacing: "0.15em", fontFamily: T.mono }}>SORT</span>
          {SORT_OPTIONS.map(o => (
            <button
              key={o.k}
              onClick={() => setSortKey(o.k)}
              style={{
                padding: "3px 7px", fontSize: T.xs, letterSpacing: "0.06em",
                fontFamily: T.mono, border: "none", background: "transparent",
                color: sortKey === o.k ? T.t1 : T.tm,
                borderBottom: `1px solid ${sortKey === o.k ? T.t1 : "transparent"}`,
                fontWeight: sortKey === o.k ? 600 : 400,
                cursor: "pointer",
              }}
            >{o.lbl}</button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        {/* Presets dropdown */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setPresetMenu(!presetMenu)}
            style={{
              padding: "4px 10px", fontSize: T.xs, letterSpacing: "0.1em",
              fontFamily: T.mono, border: `1px solid ${T.bd}`, background: "transparent",
              color: T.tm, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            PRESETS · {presets.length} <span style={{ color: T.tf }}>▾</span>
          </button>
          {presetMenu && (
            <PresetMenu
              presets={presets}
              onPick={(p) => { setFilters({ ...DEFAULT_FILTERS, ...p.filters }); setPresetMenu(false); }}
              onDelete={deletePreset}
              onClose={() => setPresetMenu(false)}
            />
          )}
        </div>

        {/* Filters toggle */}
        <button
          onClick={() => setAdvOpen(!advOpen)}
          style={{
            padding: "4px 10px", fontSize: T.xs, letterSpacing: "0.1em",
            fontFamily: T.mono, fontWeight: 600,
            border: `1px solid ${activeCount ? T.cyan : T.bd}`,
            background: activeCount || advOpen ? T.cyan + "18" : "transparent",
            color: activeCount || advOpen ? T.cyan : T.tm,
            cursor: "pointer",
            display: "flex", alignItems: "center", gap: 6,
          }}
        >
          {advOpen ? "▾" : "▸"} FILTERS
          {activeCount > 0 && (
            <span style={{
              background: T.cyan, color: T.bg,
              padding: "0 5px", borderRadius: 8,
              fontSize: 9, fontWeight: 700,
            }}>{activeCount}</span>
          )}
        </button>
      </div>

      {/* Active chips + save-as-preset */}
      {activeCount > 0 && (
        <ActiveChips filters={filters} setFilters={setFilters} onSavePreset={savePreset} />
      )}

      {/* Advanced panel */}
      {advOpen && (
        <AdvancedPanel filters={filters} setFilters={setFilters} onClose={() => setAdvOpen(false)} />
      )}
    </div>
  );
}

function PresetMenu({ presets, onPick, onDelete, onClose }) {
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 19 }} />
      <div style={{
        position: "absolute", top: "100%", right: 0, marginTop: 4,
        background: T.deep, border: `1px solid ${T.bd}`,
        minWidth: 240, zIndex: 20, boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
      }}>
        {presets.length === 0 && (
          <div style={{ padding: 12, fontSize: T.sm, color: T.tf, fontStyle: "italic", fontFamily: T.mono }}>
            No saved presets yet. Set up filters and click “save as preset”.
          </div>
        )}
        {presets.map(p => (
          <div key={p.id} style={{
            display: "grid", gridTemplateColumns: "1fr auto", gap: 4, alignItems: "center",
            borderBottom: `1px solid ${T.hair}`,
          }}>
            <button
              onClick={() => onPick(p)}
              style={{
                textAlign: "left", padding: "8px 12px", fontSize: T.sm,
                fontFamily: T.mono, background: "transparent", border: "none",
                color: T.t2, cursor: "pointer",
              }}
            >{p.name}</button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(p.id); }}
              title="Delete preset"
              style={{
                background: "transparent", border: "none", color: T.tf,
                padding: "0 10px", fontSize: T.sm, cursor: "pointer",
              }}
            >✕</button>
          </div>
        ))}
      </div>
    </>
  );
}

// ── Active chips strip ────────────────────────────────────────────────────────
function ActiveChips({ filters, setFilters, onSavePreset }) {
  const chips = [];
  const push = (k, label, clear) => chips.push({ k, label, clear });

  if (filters.bb_position_min != null || filters.bb_position_max != null) {
    push("bb", `BB ${filters.bb_position_min ?? "·"}—${filters.bb_position_max ?? "·"}`,
      () => setFilters({ ...filters, bb_position_min: null, bb_position_max: null }));
  }
  if (filters.iv_rank_min != null || filters.iv_rank_max != null) {
    push("ivr", `IVR ${filters.iv_rank_min ?? "·"}—${filters.iv_rank_max ?? "·"}`,
      () => setFilters({ ...filters, iv_rank_min: null, iv_rank_max: null }));
  }
  if (filters.raw_iv_min != null || filters.raw_iv_max != null) {
    const min = filters.raw_iv_min != null ? Math.round(filters.raw_iv_min * 100) : "·";
    const max = filters.raw_iv_max != null ? Math.round(filters.raw_iv_max * 100) : "·";
    push("iv", `IV ${min}—${max}%`, () => setFilters({ ...filters, raw_iv_min: null, raw_iv_max: null }));
  }
  if (filters.pe_min != null || filters.pe_max != null) {
    push("pe", `P/E ${filters.pe_min ?? "·"}—${filters.pe_max ?? "·"}`,
      () => setFilters({ ...filters, pe_min: null, pe_max: null }));
  }
  if (filters.sectors_include?.length > 0) {
    push("sec+", `Incl: ${filters.sectors_include.join(", ")}`,
      () => setFilters({ ...filters, sectors_include: [] }));
  }
  if (filters.sectors_exclude?.length > 0) {
    push("sec-", `Excl: ${filters.sectors_exclude.join(", ")}`,
      () => setFilters({ ...filters, sectors_exclude: [] }));
  }
  if (filters.earnings_days_min != null) {
    push("earn", `≥${filters.earnings_days_min}d to earnings`,
      () => setFilters({ ...filters, earnings_days_min: null }));
  }
  if (filters.ownership !== "all") {
    push("own", filters.ownership === "held" ? "Held only" : "Not held",
      () => setFilters({ ...filters, ownership: "all" }));
  }

  if (chips.length === 0) return null;

  return (
    <div style={{
      display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center",
      padding: "8px 10px", background: T.bg, border: `1px solid ${T.bd}`,
    }}>
      <span style={{ fontSize: T.xs, color: T.tm, letterSpacing: "0.12em", marginRight: 4, fontFamily: T.mono }}>
        ACTIVE ·
      </span>
      {chips.map(c => (
        <button
          key={c.k}
          onClick={c.clear}
          style={{
            fontSize: T.xs, padding: "3px 8px",
            border: `1px solid ${T.cyan}66`, background: T.cyan + "12", color: T.cyan,
            fontFamily: T.mono, letterSpacing: "0.04em",
            display: "flex", alignItems: "center", gap: 6,
            cursor: "pointer",
          }}
        >
          {c.label} <span style={{ color: T.tm }}>✕</span>
        </button>
      ))}
      <button
        onClick={() => setFilters(DEFAULT_FILTERS)}
        style={{
          fontSize: T.xs, padding: "3px 8px", marginLeft: 4,
          background: "transparent", border: `1px solid ${T.bd}`, color: T.tm,
          fontFamily: T.mono, letterSpacing: "0.05em", cursor: "pointer",
        }}
      >CLEAR ALL</button>
      <div style={{ flex: 1 }} />
      <SavePresetInline filters={filters} onSave={onSavePreset} />
    </div>
  );
}

function SavePresetInline({ filters, onSave }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const clean = name.trim();
    if (!clean) return;
    setSaving(true);
    await onSave(clean, filters);
    setSaving(false);
    setOpen(false);
    setName("");
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          fontSize: T.xs, padding: "3px 8px",
          background: T.post + "12", border: `1px solid ${T.post}66`, color: T.post,
          fontFamily: T.mono, letterSpacing: "0.08em", cursor: "pointer",
        }}
      >+ SAVE AS PRESET</button>
    );
  }
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <input
        autoFocus value={name} onChange={e => setName(e.target.value)}
        placeholder="preset name…"
        onKeyDown={e => {
          if (e.key === "Enter")  submit();
          if (e.key === "Escape") { setOpen(false); setName(""); }
        }}
        style={{
          background: T.bg, border: `1px solid ${T.post}`, color: T.t1,
          fontSize: T.sm, padding: "3px 8px", fontFamily: T.mono,
          width: 140, outline: "none",
        }}
      />
      <button
        onClick={submit}
        disabled={saving || !name.trim()}
        style={{
          fontSize: T.xs, padding: "3px 8px",
          background: T.post + "22", border: `1px solid ${T.post}`, color: T.post,
          fontFamily: T.mono, cursor: saving ? "default" : "pointer",
        }}
      >{saving ? "SAVING…" : "SAVE"}</button>
      <button
        onClick={() => { setOpen(false); setName(""); }}
        style={{
          fontSize: T.xs, padding: "3px 8px",
          background: "transparent", border: `1px solid ${T.bd}`, color: T.tm,
          fontFamily: T.mono, cursor: "pointer",
        }}
      >✕</button>
    </div>
  );
}

// ── Advanced panel ────────────────────────────────────────────────────────────
function AdvancedPanel({ filters, setFilters, onClose }) {
  return (
    <div style={{
      padding: 14, background: T.bg, border: `1px solid ${T.bd}`,
      display: "grid", gap: 14,
    }}>
      {/* Primary row — BB & IV Rank */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <RangeField
          label="BB Position" hint="% within 20d 2σ Bollinger band"
          min={-30} max={130}
          minVal={filters.bb_position_min} maxVal={filters.bb_position_max}
          onMin={v => setFilters({ ...filters, bb_position_min: v })}
          onMax={v => setFilters({ ...filters, bb_position_max: v })}
          shortcuts={[
            { lbl: "Below band",  min: -30, max: 0 },
            { lbl: "Lower half",  min: 0,   max: 50 },
            { lbl: "Above band",  min: 100, max: 130 },
          ]}
        />
        <RangeField
          label="IV Rank" hint="0–100 vs 52w range"
          min={0} max={100}
          minVal={filters.iv_rank_min} maxVal={filters.iv_rank_max}
          onMin={v => setFilters({ ...filters, iv_rank_min: v })}
          onMax={v => setFilters({ ...filters, iv_rank_max: v })}
          shortcuts={[
            { lbl: "High ≥70",   min: 70, max: 100 },
            { lbl: "Mid 40–70",  min: 40, max: 70  },
          ]}
        />
      </div>

      {/* Sectors */}
      <SectorPicker
        includeGroups={filters.sectors_include}
        excludeGroups={filters.sectors_exclude}
        onInclude={v => setFilters({ ...filters, sectors_include: v })}
        onExclude={v => setFilters({ ...filters, sectors_exclude: v })}
      />

      {/* Secondary — P/E, Raw IV, earnings, ownership */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <RangeField
          label="Raw IV %" min={0} max={200} compact
          minVal={filters.raw_iv_min != null ? Math.round(filters.raw_iv_min * 100) : null}
          maxVal={filters.raw_iv_max != null ? Math.round(filters.raw_iv_max * 100) : null}
          onMin={v => setFilters({ ...filters, raw_iv_min: v == null ? null : v / 100 })}
          onMax={v => setFilters({ ...filters, raw_iv_max: v == null ? null : v / 100 })}
        />
        <RangeField
          label="P/E (TTM)" min={0} max={200} compact
          minVal={filters.pe_min} maxVal={filters.pe_max}
          onMin={v => setFilters({ ...filters, pe_min: v })}
          onMax={v => setFilters({ ...filters, pe_max: v })}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <ToggleField
          label="Avoid earnings within"
          value={filters.earnings_days_min}
          options={[
            { lbl: "OFF", val: null },
            { lbl: "14d", val: 14 },
            { lbl: "21d", val: 21 },
            { lbl: "30d", val: 30 },
          ]}
          onChange={v => setFilters({ ...filters, earnings_days_min: v })}
        />
        <ToggleField
          label="Ownership"
          value={filters.ownership}
          options={[
            { lbl: "ALL",      val: "all" },
            { lbl: "HELD",     val: "held" },
            { lbl: "NOT HELD", val: "not_held" },
          ]}
          onChange={v => setFilters({ ...filters, ownership: v })}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, borderTop: `1px solid ${T.hair}`, paddingTop: 10 }}>
        <button
          onClick={onClose}
          style={{
            padding: "4px 14px", fontSize: T.xs, letterSpacing: "0.1em",
            fontFamily: T.mono, fontWeight: 600,
            background: T.cyan + "22", border: `1px solid ${T.cyan}`, color: T.cyan,
            cursor: "pointer",
          }}
        >DONE</button>
      </div>
    </div>
  );
}

function RangeField({ label, hint, min, max, minVal, maxVal, onMin, onMax, shortcuts, compact }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: T.sm, color: T.t1, fontFamily: T.mono, letterSpacing: "0.04em", fontWeight: 600 }}>{label}</span>
        {hint && !compact && <span style={{ fontSize: T.xs, color: T.tf, fontFamily: T.mono }}>{hint}</span>}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <NumInput value={minVal} placeholder={String(min)} onChange={onMin} />
        <span style={{ color: T.tf, fontFamily: T.mono }}>—</span>
        <NumInput value={maxVal} placeholder={String(max)} onChange={onMax} />
      </div>
      {shortcuts && shortcuts.length > 0 && (
        <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
          {shortcuts.map(p => (
            <button
              key={p.lbl}
              onClick={() => { onMin(p.min); onMax(p.max); }}
              style={{
                fontSize: T.xs, padding: "2px 7px", fontFamily: T.mono,
                background: "transparent", border: `1px solid ${T.hair}`, color: T.tm,
                cursor: "pointer",
              }}
            >{p.lbl}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function NumInput({ value, placeholder, onChange }) {
  return (
    <input
      type="number"
      value={value ?? ""}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value === "" ? null : parseFloat(e.target.value))}
      style={{
        background: T.bg, border: `1px solid ${T.bd}`, color: T.t1,
        fontSize: T.sm, padding: "4px 8px", width: 72,
        fontFamily: T.mono, outline: "none",
      }}
    />
  );
}

function ToggleField({ label, options, value, onChange }) {
  return (
    <div>
      <div style={{ fontSize: T.sm, color: T.t1, fontFamily: T.mono, letterSpacing: "0.04em", fontWeight: 600, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ display: "flex", border: `1px solid ${T.bd}` }}>
        {options.map((o, i) => (
          <button
            key={String(o.val)}
            onClick={() => onChange(o.val)}
            style={{
              flex: 1, padding: "5px 8px", fontSize: T.xs,
              letterSpacing: "0.08em", fontFamily: T.mono,
              border: "none",
              background: value === o.val ? T.cyan + "22" : "transparent",
              color: value === o.val ? T.cyan : T.tm,
              borderRight: i < options.length - 1 ? `1px solid ${T.bd}` : "none",
              cursor: "pointer",
            }}
          >{o.lbl}</button>
        ))}
      </div>
    </div>
  );
}

function SectorPicker({ includeGroups, excludeGroups, onInclude, onExclude }) {
  const groupNames = Object.keys(SECTOR_GROUPS);
  // Single group can only be in one list at a time. Toggle cycles: none → include → exclude → none.
  const state = (g) => includeGroups.includes(g) ? "include" : excludeGroups.includes(g) ? "exclude" : "none";
  const cycle = (g) => {
    const s = state(g);
    if (s === "none") {
      onInclude([...includeGroups, g]);
    } else if (s === "include") {
      onInclude(includeGroups.filter(x => x !== g));
      onExclude([...excludeGroups, g]);
    } else {
      onExclude(excludeGroups.filter(x => x !== g));
    }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: T.sm, color: T.t1, fontFamily: T.mono, letterSpacing: "0.04em", fontWeight: 600 }}>Sectors</span>
        <span style={{ fontSize: T.xs, color: T.tf, fontFamily: T.mono }}>click to include · again to exclude</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {groupNames.map(g => {
          const s = state(g);
          const color = s === "include" ? T.green : s === "exclude" ? T.red : T.tm;
          const border = s === "include" ? T.green : s === "exclude" ? T.red : T.bd;
          const bg     = s === "include" ? T.green + "18" : s === "exclude" ? T.red + "18" : "transparent";
          const prefix = s === "include" ? "+ " : s === "exclude" ? "− " : "";
          return (
            <button
              key={g}
              onClick={() => cycle(g)}
              style={{
                padding: "4px 10px", fontSize: T.xs, fontFamily: T.mono,
                border: `1px solid ${border}`, background: bg, color,
                cursor: "pointer", letterSpacing: "0.03em",
              }}
            >{prefix}{g}</button>
          );
        })}
      </div>
    </div>
  );
}

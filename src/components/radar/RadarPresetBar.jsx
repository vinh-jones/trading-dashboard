import { useState } from "react";
import { theme } from "../../lib/theme";
import { supabase } from "../../lib/supabase";
import { filterSummaryLines } from "./radarConstants";

const PRESET_BUTTON_THRESHOLD = 5;

// ── Simple modal overlay ──────────────────────────────────────────────────────

function Modal({ onClose, children }) {
  return (
    <div
      onClick={onClose}
      style={{
        position:        "fixed",
        inset:           0,
        background:      "rgba(0,0,0,0.55)",
        zIndex:          200,
        display:         "flex",
        alignItems:      "center",
        justifyContent:  "center",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background:   theme.bg.elevated,
          border:       `1px solid ${theme.border.strong}`,
          borderRadius: theme.radius.md,
          padding:      `${theme.space[4]}px`,
          minWidth:     320,
          maxWidth:     400,
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ── Save preset modal ─────────────────────────────────────────────────────────

function SavePresetModal({ filters, onSave, onClose }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const summaryLines = filterSummaryLines(filters);

  async function handleSave() {
    if (!name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    const { data: existing } = await supabase
      .from('radar_presets')
      .select('display_order')
      .order('display_order', { ascending: false })
      .limit(1);
    const maxOrder = existing?.[0]?.display_order ?? 0;
    const { data, error: err } = await supabase
      .from('radar_presets')
      .insert({ name: name.trim(), filters, display_order: maxOrder + 1, updated_at: new Date().toISOString() })
      .select()
      .single();
    if (err) { setError(err.message); setSaving(false); return; }
    onSave(data);
  }

  return (
    <Modal onClose={onClose}>
      <div style={{ fontSize: theme.size.md, fontWeight: 700, color: theme.text.primary, marginBottom: theme.space[3] }}>
        Save Filter Preset
      </div>

      <div style={{ marginBottom: theme.space[3] }}>
        <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginBottom: 4 }}>Name (max 20 chars)</div>
        <input
          autoFocus
          type="text"
          maxLength={20}
          value={name}
          onChange={e => { setName(e.target.value); setError(null); }}
          placeholder="e.g. High Income"
          style={modalInputStyle}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onClose(); }}
        />
        {error && <div style={{ fontSize: theme.size.xs, color: theme.red, marginTop: 4 }}>{error}</div>}
      </div>

      {summaryLines.length > 0 && (
        <div style={{ marginBottom: theme.space[3] }}>
          <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginBottom: 4 }}>Filters being saved:</div>
          {summaryLines.map((line, i) => (
            <div key={i} style={{ fontSize: theme.size.xs, color: theme.text.muted }}>· {line}</div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: theme.space[2] }}>
        <button onClick={onClose} style={cancelBtnStyle}>Cancel</button>
        <button onClick={handleSave} disabled={saving} style={primaryBtnStyle}>
          {saving ? 'Saving…' : 'Save Preset'}
        </button>
      </div>
    </Modal>
  );
}

// ── Edit preset modal ─────────────────────────────────────────────────────────

function EditPresetModal({ preset, onSave, onDelete, onClose }) {
  const [name, setName] = useState(preset.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleSave() {
    if (!name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    const { data, error: err } = await supabase
      .from('radar_presets')
      .update({ name: name.trim(), updated_at: new Date().toISOString() })
      .eq('id', preset.id)
      .select()
      .single();
    if (err) { setError(err.message); setSaving(false); return; }
    onSave(data);
  }

  async function handleDelete() {
    const { error: err } = await supabase.from('radar_presets').delete().eq('id', preset.id);
    if (err) { setError(err.message); return; }
    onDelete(preset.id);
  }

  if (confirmDelete) {
    return (
      <Modal onClose={() => setConfirmDelete(false)}>
        <div style={{ fontSize: theme.size.md, fontWeight: 700, color: theme.text.primary, marginBottom: theme.space[3] }}>
          Delete &ldquo;{preset.name}&rdquo;?
        </div>
        <div style={{ fontSize: theme.size.sm, color: theme.text.muted, marginBottom: theme.space[4] }}>
          This cannot be undone.
        </div>
        {error && <div style={{ fontSize: theme.size.xs, color: theme.red, marginBottom: theme.space[2] }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: theme.space[2] }}>
          <button onClick={() => setConfirmDelete(false)} style={cancelBtnStyle}>Cancel</button>
          <button onClick={handleDelete} style={{ ...primaryBtnStyle, background: theme.red, borderColor: theme.red }}>Delete</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose}>
      <div style={{ fontSize: theme.size.md, fontWeight: 700, color: theme.text.primary, marginBottom: theme.space[3] }}>
        Edit Preset
      </div>

      <div style={{ marginBottom: theme.space[3] }}>
        <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginBottom: 4 }}>Name (max 20 chars)</div>
        <input
          autoFocus
          type="text"
          maxLength={20}
          value={name}
          onChange={e => { setName(e.target.value); setError(null); }}
          style={modalInputStyle}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onClose(); }}
        />
        {error && <div style={{ fontSize: theme.size.xs, color: theme.red, marginTop: 4 }}>{error}</div>}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button onClick={() => setConfirmDelete(true)} style={{ ...cancelBtnStyle, color: theme.red, borderColor: theme.red }}>
          Delete Preset
        </button>
        <div style={{ display: "flex", gap: theme.space[2] }}>
          <button onClick={onClose} style={cancelBtnStyle}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={primaryBtnStyle}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Preset button ─────────────────────────────────────────────────────────────

function PresetBtn({ preset, active, onSelect, onEdit }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        onClick={onSelect}
        style={{
          fontSize:     theme.size.sm,
          padding:      `3px ${hovered ? '6px' : '10px'} 3px 10px`,
          borderRadius: theme.radius.pill,
          border:       `1px solid ${active ? theme.blue : theme.border.default}`,
          background:   active ? theme.blue : "transparent",
          color:        active ? "#fff" : theme.text.muted,
          cursor:       "pointer",
          fontWeight:   active ? 600 : 400,
          transition:   "all 0.1s",
          whiteSpace:   "nowrap",
        }}
      >
        {preset.name}
      </button>
      {/* Pencil icon — visible on hover */}
      {hovered && (
        <button
          onClick={e => { e.stopPropagation(); onEdit(); }}
          style={{
            fontSize:    theme.size.xs,
            padding:     "3px 6px 3px 4px",
            borderRadius: `0 ${theme.radius.pill}px ${theme.radius.pill}px 0`,
            border:      `1px solid ${active ? theme.blue : theme.border.default}`,
            borderLeft:  "none",
            background:  active ? theme.blue : theme.bg.elevated,
            color:       active ? "rgba(255,255,255,0.8)" : theme.text.subtle,
            cursor:      "pointer",
            marginLeft:  -1,
          }}
          title={`Edit "${preset.name}"`}
        >
          ✎
        </button>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RadarPresetBar({
  presets,
  activePresetId,
  filtersExpanded,
  activeFilterCount,
  currentFilters,
  onSelect,
  onPresetsChange,
  onToggleFilters,
  saveModalOpen = false,
  onSaveModalClose,
}) {
  const [internalSaveModal, setInternalSaveModal] = useState(false);
  const [editPreset, setEditPreset] = useState(null); // preset object being edited

  // saveModalOpen can be triggered externally (e.g. from "Save as Preset" in filter panel)
  const saveModal = saveModalOpen || internalSaveModal;
  function closeSaveModal() {
    setInternalSaveModal(false);
    onSaveModalClose?.();
  }

  const activePreset = presets.find(p => p.id === activePresetId) ?? null;

  // Toggle label
  let toggleLabel;
  if (activePreset) {
    toggleLabel = `${filtersExpanded ? '▲' : '▼'} Preset: ${activePreset.name}`;
  } else if (activeFilterCount > 0) {
    toggleLabel = `${filtersExpanded ? '▲' : '▼'} Advanced Filters · ${activeFilterCount} active`;
  } else {
    toggleLabel = `${filtersExpanded ? '▲' : '▼'} Advanced Filters`;
  }

  function handleSaved(newPreset) {
    onPresetsChange([...presets, newPreset], newPreset.id);
    closeSaveModal();
  }

  function handleEdited(updated) {
    onPresetsChange(presets.map(p => p.id === updated.id ? updated : p), activePresetId);
    setEditPreset(null);
  }

  function handleDeleted(deletedId) {
    const next = presets.filter(p => p.id !== deletedId);
    onPresetsChange(next, activePresetId === deletedId ? null : activePresetId);
    setEditPreset(null);
  }

  const useDropdown = presets.length > PRESET_BUTTON_THRESHOLD;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: theme.space[2], flexWrap: "wrap" }}>

        {/* "Presets:" label */}
        <span style={{ fontSize: theme.size.sm, color: theme.text.subtle, flexShrink: 0 }}>
          Presets:
        </span>

        {/* Preset buttons or dropdown */}
        {useDropdown ? (
          <>
            <select
              value={activePresetId || ''}
              onChange={e => {
                const p = presets.find(x => x.id === e.target.value);
                if (p) onSelect(p); else onSelect(null);
              }}
              style={{
                fontSize:     theme.size.sm,
                padding:      "3px 8px",
                background:   theme.bg.base,
                border:       `1px solid ${theme.border.default}`,
                borderRadius: theme.radius.sm,
                color:        theme.text.primary,
                cursor:       "pointer",
              }}
            >
              <option value="">Select preset…</option>
              {presets.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button
              onClick={() => setEditPreset(presets.find(p => p.id === activePresetId) ?? presets[0])}
              style={ghostBtnStyle}
            >
              Edit presets
            </button>
          </>
        ) : (
          presets.map(p => (
            <PresetBtn
              key={p.id}
              preset={p}
              active={activePresetId === p.id}
              onSelect={() => onSelect(activePresetId === p.id ? null : p)}
              onEdit={() => setEditPreset(p)}
            />
          ))
        )}

        {/* + New Preset */}
        <button onClick={() => setInternalSaveModal(true)} style={ghostBtnStyle}>
          + New Preset
        </button>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Advanced Filters toggle */}
        <button
          onClick={onToggleFilters}
          style={{
            ...ghostBtnStyle,
            borderColor: (filtersExpanded || activeFilterCount > 0) ? theme.blue : theme.border.default,
            color:        (filtersExpanded || activeFilterCount > 0) ? theme.blue : theme.text.muted,
          }}
        >
          {toggleLabel}
        </button>
      </div>

      {/* Modals */}
      {saveModal && (
        <SavePresetModal
          filters={currentFilters}
          onSave={handleSaved}
          onClose={closeSaveModal}
        />
      )}
      {editPreset && (
        <EditPresetModal
          preset={editPreset}
          onSave={handleEdited}
          onDelete={handleDeleted}
          onClose={() => setEditPreset(null)}
        />
      )}
    </>
  );
}

// ── Shared button styles ──────────────────────────────────────────────────────

const ghostBtnStyle = {
  fontSize:     theme.size.sm,
  padding:      "3px 10px",
  borderRadius: theme.radius.pill,
  border:       `1px solid ${theme.border.default}`,
  background:   "transparent",
  color:        theme.text.muted,
  cursor:       "pointer",
  whiteSpace:   "nowrap",
};

const cancelBtnStyle = {
  fontSize:     theme.size.sm,
  padding:      "5px 14px",
  borderRadius: theme.radius.sm,
  border:       `1px solid ${theme.border.default}`,
  background:   "transparent",
  color:        theme.text.muted,
  cursor:       "pointer",
};

const primaryBtnStyle = {
  fontSize:     theme.size.sm,
  padding:      "5px 14px",
  borderRadius: theme.radius.sm,
  border:       `1px solid ${theme.blue}`,
  background:   theme.blue,
  color:        "#fff",
  cursor:       "pointer",
  fontWeight:   600,
};

const modalInputStyle = {
  width:        "100%",
  padding:      "6px 10px",
  fontSize:     theme.size.sm,
  background:   theme.bg.base,
  border:       `1px solid ${theme.border.default}`,
  borderRadius: theme.radius.sm,
  color:        theme.text.primary,
  outline:      "none",
  boxSizing:    "border-box",
};

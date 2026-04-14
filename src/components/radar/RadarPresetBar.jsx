import { useState } from "react";
import { theme } from "../../lib/theme";
import { supabase } from "../../lib/supabase";
import { DEFAULT_FILTERS } from "./radarConstants";
import RadarAdvancedFilters from "./RadarAdvancedFilters";

const PRESET_BUTTON_THRESHOLD = 5;

// ── Modal overlay ─────────────────────────────────────────────────────────────

function Modal({ onClose, wide = false, children }) {
  return (
    <div
      onClick={onClose}
      style={{
        position:       "fixed",
        inset:          0,
        background:     "rgba(0,0,0,0.55)",
        zIndex:         200,
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        padding:        `${theme.space[4]}px`,
        overflowY:      "auto",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background:   theme.bg.elevated,
          border:       `1px solid ${theme.border.strong}`,
          borderRadius: theme.radius.md,
          padding:      `${theme.space[4]}px`,
          width:        "100%",
          maxWidth:     wide ? 740 : 400,
          maxHeight:    "90vh",
          overflowY:    "auto",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ── Save preset modal ─────────────────────────────────────────────────────────

function SavePresetModal({ initialFilters, onSave, onClose }) {
  const [name, setName]               = useState('');
  const [localFilters, setLocalFilters] = useState({ ...DEFAULT_FILTERS, ...initialFilters });
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState(null);

  function handleFilterChange(field, value) {
    setLocalFilters(prev => ({ ...prev, [field]: value }));
  }

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
      .insert({ name: name.trim(), filters: localFilters, display_order: maxOrder + 1, updated_at: new Date().toISOString() })
      .select()
      .single();
    if (err) { setError(err.message); setSaving(false); return; }
    onSave(data);
  }

  return (
    <Modal onClose={onClose} wide>
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
          onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
        />
        {error && <div style={{ fontSize: theme.size.xs, color: theme.red, marginTop: 4 }}>{error}</div>}
      </div>

      <RadarAdvancedFilters
        filters={localFilters}
        onChange={handleFilterChange}
        hideFooter
        bare
      />

      <div style={{ display: "flex", justifyContent: "flex-end", gap: theme.space[2], marginTop: theme.space[3] }}>
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
  const [name, setName]               = useState(preset.name);
  const [localFilters, setLocalFilters] = useState({ ...DEFAULT_FILTERS, ...preset.filters });
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function handleFilterChange(field, value) {
    setLocalFilters(prev => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    if (!name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    const { data, error: err } = await supabase
      .from('radar_presets')
      .update({ name: name.trim(), filters: localFilters, updated_at: new Date().toISOString() })
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
    <Modal onClose={onClose} wide>
      <div style={{ fontSize: theme.size.md, fontWeight: 700, color: theme.text.primary, marginBottom: theme.space[3] }}>
        Edit Preset: {preset.name}
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
          onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
        />
        {error && <div style={{ fontSize: theme.size.xs, color: theme.red, marginTop: 4 }}>{error}</div>}
      </div>

      <RadarAdvancedFilters
        filters={localFilters}
        onChange={handleFilterChange}
        hideFooter
        bare
      />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: theme.space[3] }}>
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
      style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        onClick={onSelect}
        style={{
          fontSize:     theme.size.sm,
          padding:      "3px 10px",
          borderRadius: theme.radius.pill,
          border:       `1px solid ${active ? theme.blue : theme.border.default}`,
          background:   active ? theme.blue : "transparent",
          color:        active ? theme.text.primary : theme.text.muted,
          cursor:       "pointer",
          fontWeight:   active ? 600 : 400,
          whiteSpace:   "nowrap",
        }}
      >
        {preset.name}
      </button>

      {/* Edit icon — separate circle button, appears on hover */}
      {hovered && (
        <button
          onClick={e => { e.stopPropagation(); onEdit(); }}
          title={`Edit "${preset.name}"`}
          style={{
            width:          18,
            height:         18,
            borderRadius:   "50%",
            border:         `1px solid ${theme.border.default}`,
            background:     theme.bg.elevated,
            color:          theme.text.subtle,
            cursor:         "pointer",
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            fontSize:       10,
            padding:        0,
            flexShrink:     0,
          }}
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
  const [editPreset, setEditPreset]               = useState(null);

  const saveModal = saveModalOpen || internalSaveModal;
  function closeSaveModal() {
    setInternalSaveModal(false);
    onSaveModalClose?.();
  }

  const activePreset = presets.find(p => p.id === activePresetId) ?? null;

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
    onPresetsChange(
      presets.filter(p => p.id !== deletedId),
      activePresetId === deletedId ? null : activePresetId,
    );
    setEditPreset(null);
  }

  const useDropdown = presets.length > PRESET_BUTTON_THRESHOLD;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: theme.space[2], flexWrap: "wrap" }}>

        <span style={{ fontSize: theme.size.sm, color: theme.text.subtle, flexShrink: 0 }}>Presets:</span>

        {useDropdown ? (
          <>
            <select
              value={activePresetId || ''}
              onChange={e => {
                const p = presets.find(x => x.id === e.target.value);
                onSelect(p ?? null);
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
              {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
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

        <button onClick={() => setInternalSaveModal(true)} style={ghostBtnStyle}>+ New Preset</button>

        <div style={{ flex: 1 }} />

        <button
          onClick={onToggleFilters}
          style={{
            ...ghostBtnStyle,
            borderColor: (filtersExpanded || activeFilterCount > 0) ? theme.blue : theme.border.default,
            color:       (filtersExpanded || activeFilterCount > 0) ? theme.blue : theme.text.muted,
          }}
        >
          {toggleLabel}
        </button>
      </div>

      {saveModal && (
        <SavePresetModal
          initialFilters={currentFilters}
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
  color:        theme.text.primary,
  cursor:       "pointer",
  fontWeight:   600,
};

const modalInputStyle = {
  width:      "100%",
  padding:    "6px 10px",
  fontSize:   theme.size.sm,
  background: theme.bg.base,
  border:     `1px solid ${theme.border.default}`,
  borderRadius: theme.radius.sm,
  color:      theme.text.primary,
  outline:    "none",
  boxSizing:  "border-box",
};

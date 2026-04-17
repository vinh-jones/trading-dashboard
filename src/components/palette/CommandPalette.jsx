import { useEffect, useMemo, useRef, useState } from "react";
import { theme } from "../../lib/theme";
import { filterPaletteItems } from "../../lib/paletteItems";
import { PaletteItem } from "./PaletteItem";

export function CommandPalette({ open, items, onClose, onSelect }) {
  const [query,     setQuery]     = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);

  // Reset state + focus the input every time the palette opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      // Defer focus one tick so the input actually exists in the DOM.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => filterPaletteItems(items, query), [items, query]);

  // Clamp the active index when the result set shrinks.
  useEffect(() => {
    if (activeIdx >= filtered.length) setActiveIdx(Math.max(0, filtered.length - 1));
  }, [filtered.length, activeIdx]);

  function handleKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[activeIdx];
      if (item) onSelect(item);
      return;
    }
  }

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset:    0,
        zIndex:   1000,
        background: "rgba(0, 0, 0, 0.6)",
        display:    "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-label="Command palette"
        style={{
          width:         "min(640px, 92vw)",
          maxHeight:     "70vh",
          background:    theme.bg.surface,
          border:        `1px solid ${theme.border.strong}`,
          borderRadius:  theme.radius.md,
          display:       "flex",
          flexDirection: "column",
          overflow:      "hidden",
          fontFamily:    theme.font.mono,
          boxShadow:     "0 20px 40px rgba(0,0,0,0.4)",
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setActiveIdx(0); }}
          placeholder="Search positions, actions…"
          autoFocus
          style={{
            padding:    `${theme.space[3]}px ${theme.space[4]}px`,
            fontSize:   theme.size.md,
            fontFamily: "inherit",
            background: theme.bg.base,
            color:      theme.text.primary,
            border:     "none",
            borderBottom: `1px solid ${theme.border.default}`,
            outline:    "none",
          }}
        />
        <div role="listbox" style={{ overflowY: "auto", flex: 1 }}>
          {filtered.length === 0 ? (
            <div style={{
              padding:   theme.space[4],
              textAlign: "center",
              color:     theme.text.subtle,
              fontSize:  theme.size.sm,
            }}>
              No matches.
            </div>
          ) : (
            filtered.map((item, i) => (
              <PaletteItem
                key={item.id}
                item={item}
                active={i === activeIdx}
                onClick={() => onSelect(item)}
                onMouseEnter={() => setActiveIdx(i)}
              />
            ))
          )}
        </div>
        <div style={{
          padding:      `${theme.space[2]}px ${theme.space[3]}px`,
          borderTop:    `1px solid ${theme.border.default}`,
          fontSize:     theme.size.xs,
          color:        theme.text.subtle,
          display:      "flex",
          gap:          theme.space[4],
          background:   theme.bg.base,
        }}>
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { theme } from "../../lib/theme";
import { CATEGORY_COLORS, CATEGORY_ORDER, categoryFromTag } from "../../lib/tagConstants";
import { TagChip } from "./TagChip";

export function TagInput({ value, onChange, vocabulary }) {
  const [open,      setOpen]      = useState(false);
  const [query,     setQuery]     = useState("");
  const [activeCat, setActiveCat] = useState(null);
  const [highlight, setHighlight] = useState(0);
  const inputRef    = useRef(null);
  const containerRef = useRef(null);
  const listRef     = useRef(null);

  const queryLc = query.trim().toLowerCase();

  // Filtered vocabulary (exclude already-added tags)
  const filtered = (vocabulary || []).filter(v => {
    if (activeCat && v.category !== activeCat) return false;
    if (queryLc) return v.tag.includes(queryLc) || v.description?.toLowerCase().includes(queryLc);
    return true;
  }).filter(v => !value.includes(v.tag));

  const canAddCustom = queryLc.length > 0
    && !(vocabulary || []).some(v => v.tag === queryLc)
    && !value.includes(queryLc);

  const suggestions = [
    ...filtered,
    ...(canAddCustom ? [{ tag: queryLc, category: "custom", description: "Custom tag — not in vocabulary", isCustom: true }] : []),
  ];

  // Reset highlight when suggestions change
  useEffect(() => { setHighlight(0); }, [query, activeCat]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.children[highlight];
    item?.scrollIntoView?.({ block: "nearest" });
  }, [highlight]);

  // Close on outside click
  useEffect(() => {
    function handler(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setQuery("");
        setActiveCat(null);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function openDropdown() {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function addTag(tag) {
    if (!value.includes(tag)) onChange([...value, tag]);
    setQuery("");
    setHighlight(0);
    inputRef.current?.focus();
  }

  function handleKeyDown(e) {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight(h => Math.min(h + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (suggestions.length > 0) addTag(suggestions[highlight].tag);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
      setActiveCat(null);
    }
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      {/* Chip strip + add button */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", minHeight: 32 }}>
        {value.map(tag => (
          <TagChip key={tag} tag={tag} onRemove={() => onChange(value.filter(t => t !== tag))} />
        ))}
        <button
          type="button"
          onClick={openDropdown}
          style={{
            background: "transparent",
            border: `1px dashed ${theme.border.strong}`,
            color: theme.text.subtle,
            fontSize: theme.size.xs,
            fontFamily: theme.font.mono,
            padding: "3px 9px",
            borderRadius: theme.radius.sm,
            cursor: "pointer",
            letterSpacing: "0.06em",
          }}
        >
          + add tag
        </button>
      </div>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200,
          width: 420, maxWidth: "calc(100vw - 32px)",
          background: theme.bg.elevated,
          border: `1px solid ${theme.border.strong}`,
          borderRadius: theme.radius.md,
          padding: theme.space[3],
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        }}>
          {/* Search input */}
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="type to search or enter custom tag…"
            style={{
              width: "100%", boxSizing: "border-box",
              background: theme.bg.base,
              border: `1px solid ${theme.border.default}`,
              borderRadius: theme.radius.sm,
              color: theme.text.primary,
              fontFamily: theme.font.mono,
              fontSize: theme.size.sm,
              padding: "6px 10px",
              outline: "none",
            }}
          />

          {/* Category filter chips */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "8px 0 6px" }}>
            {CATEGORY_ORDER.map(cat => {
              const active = activeCat === cat;
              const c = CATEGORY_COLORS[cat];
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCat(active ? null : cat)}
                  style={{
                    fontSize: theme.size.xs,
                    fontFamily: theme.font.mono,
                    padding: "2px 7px",
                    borderRadius: theme.radius.sm,
                    border: `1px solid ${active ? c.border : theme.border.default}`,
                    background: active ? c.bg : "transparent",
                    color: active ? c.text : theme.text.subtle,
                    cursor: "pointer",
                  }}
                >
                  {cat}
                </button>
              );
            })}
          </div>

          {/* Tag list */}
          <div
            ref={listRef}
            style={{ maxHeight: 240, overflowY: "auto" }}
          >
            {suggestions.length === 0 && (
              <div style={{
                padding: "10px 4px",
                fontFamily: theme.font.mono,
                fontSize: theme.size.xs,
                color: theme.text.faint,
              }}>
                {queryLc ? "No matches — press Enter to add as custom tag" : "No more tags in this category"}
              </div>
            )}
            {suggestions.map((v, i) => {
              const cat = categoryFromTag(v.tag);
              const c   = CATEGORY_COLORS[cat];
              return (
                <button
                  key={v.tag}
                  type="button"
                  onClick={() => addTag(v.tag)}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    background: i === highlight ? theme.bg.base : "transparent",
                    border: "none",
                    borderRadius: theme.radius.sm,
                    padding: "5px 8px",
                    cursor: "pointer",
                  }}
                >
                  <div style={{
                    fontFamily: theme.font.mono,
                    fontSize: theme.size.xs,
                    color: c.text,
                  }}>
                    {v.tag}
                    {v.isCustom && (
                      <span style={{ color: theme.text.faint, marginLeft: 6 }}>custom</span>
                    )}
                  </div>
                  {v.description && (
                    <div style={{
                      fontFamily: theme.font.mono,
                      fontSize: theme.size.xs,
                      color: theme.text.faint,
                      marginTop: 1,
                    }}>
                      {v.description}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

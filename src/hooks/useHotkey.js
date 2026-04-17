import { useEffect } from "react";

// Matches mac's ⌘ and win/linux Ctrl — so "mod+k" Just Works cross-platform.
function matches(event, combo) {
  const parts = combo.toLowerCase().split("+");
  const key   = parts[parts.length - 1];
  const wantMod = parts.includes("mod");
  const wantShift = parts.includes("shift");

  if (event.key.toLowerCase() !== key) return false;
  if (wantMod && !(event.metaKey || event.ctrlKey)) return false;
  if (!wantMod && (event.metaKey || event.ctrlKey)) return false;
  if (wantShift !== event.shiftKey) return false;
  return true;
}

function isEditableTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

// Binds a global keydown handler. `handler` receives the event so callers can
// preventDefault when they want to override a browser shortcut.
// Bare-letter combos (no mod/shift) auto-skip when focus is in an editable field.
export function useHotkey(combo, handler, { enabled = true } = {}) {
  useEffect(() => {
    if (!enabled) return;
    const isBare = !combo.toLowerCase().includes("mod") && !combo.toLowerCase().includes("shift");
    const onKey = (event) => {
      if (isBare && isEditableTarget(event.target)) return;
      if (matches(event, combo)) handler(event);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [combo, handler, enabled]);
}

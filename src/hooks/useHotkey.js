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

// Binds a global keydown handler. `handler` receives the event so callers can
// preventDefault when they want to override a browser shortcut.
export function useHotkey(combo, handler, { enabled = true } = {}) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event) => {
      if (matches(event, combo)) handler(event);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [combo, handler, enabled]);
}

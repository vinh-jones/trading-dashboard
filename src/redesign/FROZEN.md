# FROZEN

This folder is paused mid-redesign. The canonical app is legacy (`index.html` → `src/App.jsx` → `src/components/`).

## Rules while frozen

- **Do not add features here.** New features land in legacy (`src/components/`) only.
- **Do not port legacy changes into this folder.** When the redesign resumes, it will catch up then.
- **Shared `src/lib/*` and `src/hooks/*` keep evolving normally** — both apps use them, and the redesign will inherit improvements when thawed.
- **Keep `trades-v2.html` building.** It stays deployable so work can resume from the exact paused state.

## When to thaw

Resume work here when the Claude Design session continues the redesign. At that point, decide whether to:
1. Catch the redesign up to legacy's current feature set, then cut over, or
2. Cut over partially (per-surface) and retire legacy surfaces one at a time.

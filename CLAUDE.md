# Claude Code Instructions

## Version bumping

**Always check main's current version before bumping.** This repo uses worktrees — the local `package.json` may be on an old branch. Before any version bump, run:

```bash
git show origin/main:package.json | grep '"version"'
```

Increment from that number. Never use the local file's version as the baseline.

- Minor bump (`x.Y.0`) for new features
- Patch bump (`x.y.Z`) for fixes
- Bump `package.json` AND `const VERSION` in `src/App.jsx` in the same commit

## PR workflow

After creating a PR, merge it immediately (no need to ask).

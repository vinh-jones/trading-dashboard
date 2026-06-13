# Cohort Evolution Chart Legibility — Design Spec

**Date:** 2026-06-12
**Status:** Approved (terminal brainstorm w/ Vinh)
**Scope:** `EvolutionChart` in `src/components/CohortsPanel.jsx` only. No API, no math-module changes. Patch bump.

## Problem

The v1.126.0 cohort chart pins its y-domain to `[min(0, data), max(100, data)]`. A cohort living in −25%…+10% renders squashed in the bottom third under a mile of dead space below the dashed 100% line, with no ticks and no way to read which day a move happened.

## Design

1. **Data-fit y-domain.** Compute nice rounded bounds from the series (always include 0), padded ~5% of range. The solid 0% reference line stays. The dashed 100% line draws only when 100 is within the computed domain (i.e. data approaches max capture).
2. **Y ticks.** 4–5 ticks at rounded percentages via a nice-step function (1/2/5×10ⁿ). Muted `theme.size.xs` labels left of the plot, faint horizontal gridlines (`theme.border.default`).
3. **Hover/tap readout.** Pointer events on the SVG map x → nearest series point: highlighted dot + small floating label `MM-DD · +x.x%`. Pointer leave hides it. Implemented with `onPointerMove`/`onPointerLeave` on the SVG (works for touch), React state for the active index — no library.
4. **Date ticks.** First, middle, and last series dates along the bottom (middle omitted when fewer than 3 points). Replaces the current two-endpoint row; the "0% — solid · 100% — dashed" legend text drops when the 100% line isn't drawn (keep "0% — solid" only, or omit entirely when ticks make it obvious — implementer keeps it minimal: drop the legend, the labeled ticks carry the meaning).

Layout: reserve a left gutter (~40px in the 600-wide viewBox) for tick labels; plot area shrinks accordingly. The header line ("Capture % over time — now x.x%") is unchanged.

## Edge cases

- Single-point series: existing dot rendering stays; hover shows that point; domain pads around the single value and 0.
- Flat series: nice-step function must not produce a zero step (fall back to step 1).
- All-positive or all-negative series: domain still includes 0 (anchor for "premium kept vs underwater").

## Testing

Pure helpers (`niceTicks(min, max)` / domain computation) exported from the component file or inlined — if exported, a small vitest covers rounding, zero-step fallback, and 0-inclusion. Build must pass; visual verification post-deploy (API-fed view).

## Out of scope

Captured $ in hover (series carries % only), per-member ghost lines, chart library.

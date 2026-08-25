import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import { buildContract, buildRung, summarizeTicker } from "../../lib/ccWritability.js";

/**
 * Renders the panel for real.
 *
 * A passing `vite build` only proves the module parses — it says nothing about
 * whether the component throws on a live payload, and this panel is the ONLY
 * surface where AMBER ever appears. The payload here is built by the real math
 * functions off the spec's §7 measured chain, so this exercises
 * math → payload → DOM in one pass.
 *
 * No JSX: the suite runs under `environment: "node"` with the default esbuild
 * loader for .js, so createElement keeps this file inside the existing config
 * rather than dragging in jsdom and a testing-library.
 */

const mockState = { data: null, loading: false, error: null };
vi.mock("../../hooks/useCcWritability", () => ({
  useCcWritability: () => ({ ...mockState, refresh: () => {} }),
}));

const { CcWritability } = await import("../CcWritability.jsx");

const render = () => renderToStaticMarkup(createElement(CcWritability));

function irenPayload() {
  const shares = 800, contracts = 8, grossBasis = 50;
  const rows = [
    { t: 7,  e: "2026-08-28", d: 7,  bid: 0.72, ask: 0.74, mid: 0.730, delta: 0.19, iv: 1.40, oi: 10641 },
    { t: 28, e: "2026-09-18", d: 28, bid: 2.15, ask: 2.21, mid: 2.180, delta: 0.32, iv: 1.05, oi: 29108 },
    { t: 35, e: "2026-09-25", d: 35, bid: 2.36, ask: 2.74, mid: 2.550, delta: 0.34, iv: 1.02, oi: 431   },
  ];
  const ladder = [
    { strike: 50, bid: 2.15, ask: 2.21, delta: 0.32, oi: 29108 },
    { strike: 60, bid: 0.83, ask: 0.88, delta: 0.15, oi: 14140 },
  ].map(c => buildContract({
    strike: c.strike, bid: c.bid, ask: c.ask, delta: c.delta, open_interest: c.oi,
    dte: 28, grossBasis, shares, contracts, priced_from: "chain",
  }));

  const rungs = rows.map(r => buildRung({
    target_dte: r.t, expiry: r.e, dte: r.d,
    basisContract: buildContract({
      strike: 50, bid: r.bid, ask: r.ask, mid: r.mid, delta: r.delta, iv: r.iv,
      open_interest: r.oi, dte: r.d, grossBasis, shares, contracts, priced_from: "chain",
    }),
    ladder: r.d === 28 ? ladder : [],
    grossBasis, todayISO: "2026-08-28",
  }));

  return {
    ok: true,
    fetched_at: "2026-08-28T17:00:00Z",
    per_position: [summarizeTicker({
      ticker: "IREN", spot: 41.875, gross_basis: grossBasis, shares, contracts,
      k_basis: 50, rungs, iv: 1.0, iv_rank: 27.6, iv_rank_pctile_90d: 0.42,
      bb_position: 0.31, earnings_date: "2026-11-05", status: "ok",
    })],
  };
}

describe("CcWritability panel", () => {
  it("renders the RED card, rung table and strike ladder without throwing", () => {
    Object.assign(mockState, { data: irenPayload(), loading: false, error: null });

    const html = render();

    expect(html).toContain("Covered-Call Writability");
    expect(html).toContain("IREN");
    expect(html).toContain("RED");
    expect(html).toContain("76.1%");            // the 7d rung's rate
    expect(html).toContain("Strike ladder");
    expect(html).toContain("$8,000");           // gain if assigned at $60
    expect(html).toContain("illiquid");         // the 35d rung's flag
    expect(html).toContain("rank pctile 90d");  // shadow fields (§8)
  });

  it("falls back to a rung that has a ladder when the pushed rung came back bare", () => {
    // The 7d rung is the pushed one here and carries no ladder — its chain
    // fetch could have failed, or it could be modeled. The ladder must still
    // render off the 28d rung rather than disappearing.
    const payload = irenPayload();
    expect(payload.per_position[0].push_rung).toBe(7);
    expect(payload.per_position[0].rungs.find(r => r.dte === 7).strike_ladder).toHaveLength(0);

    Object.assign(mockState, { data: payload, loading: false, error: null });
    const html = render();
    expect(html).toContain("Strike ladder");
    expect(html).toContain("2026-09-18 (28d)");   // the rung it fell back to
  });

  it("shows each rung's strike and marks the ones that are not at gross basis", () => {
    // The LRCX shape: front rungs at $325, the 10/16 monthly at $330 because
    // that expiry lists no $325. Without a strike column the two rows look
    // identical and a $500-of-appreciation difference is invisible.
    const shares = 100, contracts = 1, grossBasis = 325;
    const mk = (dte, strike, mid) => buildRung({
      target_dte: dte, expiry: `2026-10-${dte}`, dte,
      basisContract: buildContract({
        strike, bid: mid - 0.05, ask: mid + 0.05, delta: 0.4, iv: 0.62,
        open_interest: 900, dte, grossBasis, shares, contracts, priced_from: "chain",
      }),
      ladder: [], grossBasis,
    });
    const rungs = [mk(10, 325, 8.90), mk(52, 330, 23.00)];

    Object.assign(mockState, {
      loading: false, error: null,
      data: { ok: true, per_position: [summarizeTicker({
        ticker: "LRCX", spot: 313.21, gross_basis: grossBasis, shares, contracts,
        k_basis: 325, rungs, status: "ok",
      })] },
    });

    const html = render();
    expect(html).toContain("Strike");                 // the column exists
    expect(html).toContain("$330");                   // the off-basis rung's strike
    expect(html).toContain("+$500 if assigned");      // what it captures
    expect(html).toContain("$325–$330");              // header shows the range
    expect(html).toContain("rates not comparable");   // and says why it matters
  });

  it("renders a message in every empty state rather than nothing at all", () => {
    // The failure mode that reads as "the feature never shipped" is a panel
    // that renders null. It must never do that.
    Object.assign(mockState, { data: null, loading: true, error: null });
    expect(render()).toContain("Loading covered-call writability");

    Object.assign(mockState, { loading: false, error: "boom" });
    expect(render()).toContain("CC writability unavailable");

    Object.assign(mockState, { error: null, data: { ok: true, per_position: [] } });
    expect(render()).toContain("No uncovered assigned positions");
  });
});

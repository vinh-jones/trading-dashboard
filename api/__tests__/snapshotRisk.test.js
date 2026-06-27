import { describe, it, expect } from "vitest";
import { buildSnapshotRisk } from "../_lib/snapshotRisk.js";

// Minimal Supabase stub: .from(table).select(...).in(...) → Promise<{data}>
function makeSupabase({ quotes = [], fundamentals = [] }) {
  return {
    from(table) {
      return {
        select() {
          return {
            in() {
              return Promise.resolve({ data: table === "quotes" ? quotes : table === "fundamentals" ? fundamentals : [] });
            },
          };
        },
      };
    },
  };
}

const positions = {
  open_csps: [{ ticker: "NVDA", strike: 100, expiry_date: "2026-08-21", contracts: 2, capital_fronted: 20000 }],
  open_leaps: [{ ticker: "GOOGL", strike: 150, expiry_date: "2027-08-20", contracts: 1, entry_cost: 9000 }],
  assigned_shares: [{ ticker: "HOOD", cost_basis_total: 50000, positions: [{ description: "100 shares", fronted: 50000 }] }],
  open_spreads: [],
};

const supabase = makeSupabase({
  quotes: [
    { symbol: "NVDA", last: 105 },
    { symbol: "GOOGL", last: 160 },
    { symbol: "HOOD", last: 25 },
    { symbol: "NVDA260821P00100000", iv: 0.45, delta: -0.30 },
    { symbol: "GOOGL270820C00150000", iv: 0.35, delta: 0.62 },
  ],
  fundamentals: [
    { ticker: "NVDA", beta: 1.6 },
    { ticker: "GOOGL", beta: 1.0 },
    { ticker: "HOOD", beta: 1.9 },
  ],
});

describe("buildSnapshotRisk", () => {
  it("returns a structured risk block + compact text", async () => {
    const { risk, text } = await buildSnapshotRisk(supabase, positions, {
      todayIso: "2026-06-27", accountValue: 727000,
    });

    expect(risk.descriptive_only).toBe(true);
    expect(typeof risk.units.net_beta_weighted_delta_per_1pct_spx).toBe("number");
    expect(typeof risk.units.net_vega_per_iv_point).toBe("number");
    expect(risk.units.beta_weighted_delta_pct_of_account).not.toBeNull();

    // family labels use the TYPE_COLORS keys (LEAPS, not LEAP)
    expect(Object.keys(risk.by_family)).toEqual(expect.arrayContaining(["LEAPS", "CSP", "Shares"]));

    // per-position present and labeled
    expect(risk.positions.length).toBeGreaterThan(0);
    expect(risk.positions.every((p) => typeof p.beta_weighted_delta === "number")).toBe(true);

    // scenario grid dimensions line up
    const { spx_shocks_pct, iv_shocks_pts, pnl_rows_spx_cols_iv } = risk.scenario_grid;
    expect(pnl_rows_spx_cols_iv).toHaveLength(spx_shocks_pct.length);
    expect(pnl_rows_spx_cols_iv[0]).toHaveLength(iv_shocks_pts.length);

    expect(risk.coverage.covered).toBeGreaterThan(0);
    expect(text).toContain("RISK UNITS");
    expect(text).toContain("Beta-weighted delta");
  });

  it("does not throw when quotes/betas are empty (all legs uncovered)", async () => {
    const empty = makeSupabase({ quotes: [], fundamentals: [] });
    const { risk } = await buildSnapshotRisk(empty, positions, { todayIso: "2026-06-27", accountValue: null });
    expect(risk.coverage.covered).toBe(0);
    expect(risk.units.beta_weighted_delta_pct_of_account).toBeNull();
  });
});

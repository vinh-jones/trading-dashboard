import { describe, it, expect } from "vitest";
import { bsCallPrice, RISK_FREE_RATE } from "../blackScholes.js";
import {
  ROR_ANN_MIN,
  pickBasisStrike,
  ladderStrikes,
  contractLiquidity,
  buildContract,
  buildRung,
  summarizeTicker,
  bestUpsideStrike,
  spotRequiredForGate,
  decomposeEventMove,
  tradingDaysBetween,
  formatPushCopy,
} from "../ccWritability.js";

// ── The acceptance fixture (spec §7) ─────────────────────────────────────────
// IREN, real chain, 2026-08-21 close. MEASURED, not modeled: spot $41.875,
// gross basis $50.00 (400 @ $55 + 400 @ $45), 800 shares / 8 contracts,
// $40,000 capital, earnings 2026-08-27 pm.
//
// Every number in EXPECTED below is copied from the spec table. If a change to
// the math moves any of them, either the change or the spec is wrong.

const IREN = {
  ticker: "IREN",
  spot: 41.875,
  gross_basis: 50.0,
  shares: 800,
  contracts: 8,
  k_basis: 50,
  earnings_date: "2026-08-27",
  today: "2026-08-21",
};

const IREN_RUNGS = [
  { target_dte: 7,  expiry: "2026-08-28", dte: 7,  bid: 0.72, ask: 0.74, mid: 0.730, delta: 0.19, iv: 1.40, oi: 10641 },
  { target_dte: 14, expiry: "2026-09-04", dte: 14, bid: 1.24, ask: 1.32, mid: 1.280, delta: 0.25, iv: 1.19, oi: 5790  },
  { target_dte: 21, expiry: "2026-09-11", dte: 21, bid: 1.60, ask: 1.97, mid: 1.785, delta: 0.29, iv: 1.11, oi: 1159  },
  { target_dte: 28, expiry: "2026-09-18", dte: 28, bid: 2.15, ask: 2.21, mid: 2.180, delta: 0.32, iv: 1.05, oi: 29108 },
  { target_dte: 35, expiry: "2026-09-25", dte: 35, bid: 2.36, ask: 2.74, mid: 2.550, delta: 0.34, iv: 1.02, oi: 431   },
  { target_dte: 45, expiry: "2026-10-02", dte: 42, bid: 2.62, ask: 3.25, mid: 2.935, delta: 0.36, iv: 1.00, oi: 564   },
  { target_dte: 60, expiry: "2026-10-16", dte: 56, bid: 3.50, ask: 3.90, mid: 3.700, delta: 0.40, iv: 0.98, oi: 2723  },
];

// Spec §7 table: premium (8c) · ann. (mid) · ann. (bid) · liquid
const EXPECTED = [
  { dte: 7,  premium: 584,  ann: 76.1, annBid: 75.1, liquid: true  },
  { dte: 14, premium: 1024, ann: 66.7, annBid: 64.7, liquid: true  },
  { dte: 21, premium: 1428, ann: 62.0, annBid: 55.6, liquid: false },
  { dte: 28, premium: 1744, ann: 56.8, annBid: 56.1, liquid: true  },
  { dte: 35, premium: 2040, ann: 53.2, annBid: 49.2, liquid: false },
  { dte: 42, premium: 2348, ann: 51.0, annBid: 45.5, liquid: false },
  { dte: 56, premium: 2960, ann: 48.2, annBid: 45.6, liquid: false },
];

// §3.2 strike ladder, IREN 9/18 (28 DTE). Bid/ask reconstructed from the
// spec's mid + spread_pct pairs; K_basis row is quoted directly.
const IREN_28D_LADDER = [
  { strike: 50, bid: 2.15, ask: 2.21, delta: 0.32, oi: 29108 },
  { strike: 55, bid: 1.28, ask: 1.40, delta: 0.22, oi: 10419 },
  { strike: 60, bid: 0.83, ask: 0.88, delta: 0.15, oi: 14140 },
  { strike: 65, bid: 0.51, ask: 0.59, delta: 0.10, oi: 32445 },
];

function irenContract(r) {
  return buildContract({
    strike: IREN.k_basis, bid: r.bid, ask: r.ask, mid: r.mid, delta: r.delta,
    iv: r.iv, open_interest: r.oi, dte: r.dte,
    grossBasis: IREN.gross_basis, shares: IREN.shares, contracts: IREN.contracts,
    priced_from: "chain",
  });
}

function irenLadder() {
  return IREN_28D_LADDER.map(c => buildContract({
    strike: c.strike, bid: c.bid, ask: c.ask, delta: c.delta, open_interest: c.oi,
    dte: 28, grossBasis: IREN.gross_basis, shares: IREN.shares, contracts: IREN.contracts,
    priced_from: "chain",
  }));
}

function irenPayload({ earnings_override = false, today = IREN.today } = {}) {
  const rungs = IREN_RUNGS.map(r => buildRung({
    target_dte: r.target_dte,
    expiry: r.expiry,
    dte: r.dte,
    basisContract: irenContract(r),
    ladder: r.dte === 28 ? irenLadder() : [],
    earnings_date: IREN.earnings_date,
    earnings_override,
    grossBasis: IREN.gross_basis,
    todayISO: today,
  }));
  return summarizeTicker({
    ticker: IREN.ticker, spot: IREN.spot, gross_basis: IREN.gross_basis,
    shares: IREN.shares, contracts: IREN.contracts, k_basis: IREN.k_basis,
    rungs, iv: 1.0, iv_rank: 27.6, bb_position: 0.31,
    earnings_date: IREN.earnings_date,
  });
}

describe("§7 acceptance fixture — IREN 2026-08-21 close reproduces from the chain", () => {
  const payload = irenPayload();

  it("reproduces every rung's premium and annualized RoR within a percentage point", () => {
    expect(payload.rungs).toHaveLength(EXPECTED.length);
    payload.rungs.forEach((rung, i) => {
      const want = EXPECTED[i];
      expect(rung.dte).toBe(want.dte);
      expect(rung.premium).toBeCloseTo(want.premium, 2);
      expect(rung.ror_annualized).toBeCloseTo(want.ann, 0);
      expect(rung.ror_annualized_bid).toBeCloseTo(want.annBid, 0);
    });
  });

  it("marks the illiquid rungs and no others", () => {
    // Rule: spread > 10% of mid OR OI < 500. The 56d rung's 10.8% spread puts
    // it over the line — the spec table's "~" is borderline, the rule is not.
    payload.rungs.forEach((rung, i) => {
      expect(rung.illiquid).toBe(!EXPECTED[i].liquid);
    });
  });

  it("carries capital and the K_basis strike as measured", () => {
    expect(payload.capital).toBe(40000);
    expect(payload.k_basis).toBe(50);
    expect(payload.contracts).toBe(8);
  });

  // Load-bearing test 2: the ladder here is monotone DECREASING (76.1 → 48.2).
  // An implementation carrying §2.2's U-shape as an assumption reports the
  // wrong best_rate_rung.
  it("picks the 7d rung as best rate — the ladder is monotone decreasing here", () => {
    const rates = payload.rungs.map(r => r.ror_annualized);
    expect(rates).toEqual([...rates].sort((a, b) => b - a));
    expect(payload.best_rate_rung).toBe(7);
    expect(payload.shortest_qualifying_rung).toBe(7);
  });

  // Acceptance 4 + load-bearing test 3.
  it("is RED at every rung and pushes on none of them — every expiry crosses 8/27", () => {
    expect(payload.tier).toBe("RED");
    expect(payload.qualifying_rung_count).toBe(7);
    expect(payload.suppressed_rung_count).toBe(7);
    expect(payload.pushable).toBe(false);
    expect(payload.push_copy).toBeNull();
  });

  it("un-suppresses once the print is behind it", () => {
    const after = irenPayload({ today: "2026-08-28" });
    expect(after.suppressed_rung_count).toBe(0);
    expect(after.pushable).toBe(true);
    // Selection still refuses the illiquid rungs.
    expect(after.rungs.find(r => r.dte === after.push_rung).illiquid).toBe(false);
  });

  it("honours a per-ticker earnings override", () => {
    const overridden = irenPayload({ earnings_override: true });
    expect(overridden.suppressed_rung_count).toBe(0);
    expect(overridden.pushable).toBe(true);
  });
});

describe("a ladder that prices at more than one strike", () => {
  // Live LRCX case: gross basis $325, weeklies quote $2.50 increments so the
  // front rungs price at $325, but the 10/16 monthly quotes $10 increments with
  // no $325 — so K_basis there is $330. Both selections are correct per §2.1.
  // What must not happen is the payload presenting them as one strike: the
  // rates stop being comparable and the back rung stops returning zero
  // appreciation.
  const mkRung = (dte, strike, mid) => buildRung({
    target_dte: dte, expiry: `exp-${dte}`, dte,
    basisContract: buildContract({
      strike, bid: mid - 0.05, ask: mid + 0.05, delta: 0.4, iv: 0.62,
      open_interest: 900, dte, grossBasis: 325, shares: 100, contracts: 1,
    }),
    grossBasis: 325,
  });

  it("reports the strike range and flags that rates are not comparable", () => {
    const mixed = summarizeTicker({
      ticker: "LRCX", spot: 313.21, gross_basis: 325, shares: 100, contracts: 1,
      k_basis: 325, rungs: [mkRung(10, 325, 8.90), mkRung(52, 330, 23.00)],
    });
    expect(mixed.k_basis_varies).toBe(true);
    expect(mixed.k_basis_min).toBe(325);
    expect(mixed.k_basis_max).toBe(330);
  });

  it("gives the off-basis rung a nonzero gain_if_assigned", () => {
    // §3.2's "exactly zero appreciation" holds only when the strike IS the
    // basis. At $330 against a $325 basis the rung captures $500, and hiding
    // that would misstate the trade.
    expect(mkRung(52, 330, 23.00).gain_if_assigned).toBe(500);
    expect(mkRung(10, 325, 8.90).gain_if_assigned).toBe(0);
  });

  it("stays quiet when every rung priced at the same strike", () => {
    const uniform = summarizeTicker({
      ticker: "T", spot: 313.21, gross_basis: 325, shares: 100, contracts: 1,
      k_basis: 325, rungs: [mkRung(10, 325, 8.90), mkRung(52, 325, 25.02)],
    });
    expect(uniform.k_basis_varies).toBe(false);
    expect(uniform.k_basis_min).toBe(325);
    expect(uniform.k_basis_max).toBe(325);
  });
});

describe("§3.2 strike ladder — reported, never gated", () => {
  const payload = irenPayload({ earnings_override: true });
  const rung28 = payload.rungs.find(r => r.dte === 28);

  // Acceptance 10: gain_if_assigned == 0 at K_basis. A nonzero value there
  // means spot has been substituted for basis somewhere.
  it("returns exactly zero appreciation at K_basis", () => {
    expect(rung28.strike_ladder[0].strike).toBe(50);
    expect(rung28.strike_ladder[0].gain_if_assigned).toBe(0);
    expect(rung28.gain_if_assigned).toBe(0);
  });

  it("reports K_basis plus the next 4 listed strikes with payoff-if-assigned", () => {
    const ladder = rung28.strike_ladder;
    expect(ladder.map(c => c.strike)).toEqual([50, 55, 60, 65]);
    expect(ladder.map(c => c.gain_if_assigned)).toEqual([0, 4000, 8000, 12000]);
    expect(ladder.map(c => c.total_if_assigned)).toEqual([1744, 5072, 8684, 12440]);
    expect(ladder.map(c => Math.round(c.ror_annualized * 10) / 10))
      .toEqual([56.8, 34.9, 22.3, 14.3]);
  });

  it("never names an illiquid strike as the upside pick", () => {
    const upside = bestUpsideStrike(rung28);
    expect(upside.strike).toBe(60);          // $65 has the bigger payoff but a 14.5% spread
    expect(upside.illiquid).toBe(false);
    expect(upside.gain_if_assigned).toBe(8000);
  });

  it("writes push copy naming the shortest qualifying rung and the upside strike", () => {
    const copy = formatPushCopy({ ticker: "IREN", rung: rung28 });
    expect(copy).toContain("IREN writable — 28d, $50 $1,744 @ 56.8% ann");
    expect(copy).toContain("$60 $684");
    expect(copy).toContain("keeping $8,000 upside");
  });
});

describe("the gate is annualized RoR at K_basis and nothing else", () => {
  // Acceptance 6: a 60 DTE rung with HIGHER absolute premium than a 14 DTE
  // rung must still lose "best rate" to the 14 DTE rung.
  it("ranks on rate, not on absolute premium", () => {
    const mk = (dte, mid) => buildRung({
      target_dte: dte, expiry: `dte-${dte}`, dte,
      basisContract: buildContract({
        strike: 100, bid: mid - 0.02, ask: mid + 0.02, delta: 0.2, iv: 0.6,
        open_interest: 5000, dte, grossBasis: 100, shares: 100, contracts: 1,
      }),
      grossBasis: 100,
    });
    const short = mk(14, 2.00);   // $200 premium → 52.1% annualized
    const long  = mk(60, 5.00);   // $500 premium → 30.4% annualized
    expect(long.premium).toBeGreaterThan(short.premium);

    const payload = summarizeTicker({
      ticker: "TEST", spot: 95, gross_basis: 100, shares: 100, contracts: 1,
      k_basis: 100, rungs: [short, long],
    });
    expect(payload.best_rate_rung).toBe(14);
  });

  it("qualifies on the rate alone — a 0.05 delta rung passes if the rate does", () => {
    const rung = buildRung({
      target_dte: 7, expiry: "2026-09-04", dte: 7,
      basisContract: buildContract({
        strike: 50, bid: 0.72, ask: 0.74, delta: 0.05, iv: 1.4,
        open_interest: 10641, dte: 7, grossBasis: 50, shares: 800, contracts: 8,
      }),
      grossBasis: 50,
    });
    expect(rung.delta).toBe(0.05);
    expect(rung.qualifies).toBe(true);
  });

  it("rejects a rung under the bar regardless of how rich its delta looks", () => {
    const rung = buildRung({
      target_dte: 30, expiry: "2026-09-20", dte: 30,
      basisContract: buildContract({
        strike: 50, bid: 0.50, ask: 0.54, delta: 0.45, iv: 0.4,
        open_interest: 9000, dte: 30, grossBasis: 50, shares: 800, contracts: 8,
      }),
      grossBasis: 50,
    });
    expect(rung.ror_annualized).toBeLessThan(ROR_ANN_MIN);
    expect(rung.qualifies).toBe(false);
  });
});

describe("liquidity fencing (§3.4)", () => {
  const liquidLow = buildRung({
    target_dte: 28, expiry: "2026-09-18", dte: 28,
    basisContract: buildContract({
      strike: 50, bid: 1.30, ask: 1.34, delta: 0.2, iv: 0.9,
      open_interest: 9000, dte: 28, grossBasis: 50, shares: 800, contracts: 8,
    }),
    grossBasis: 50,
  });
  const illiquidHigh = buildRung({
    target_dte: 7, expiry: "2026-08-28", dte: 7,
    basisContract: buildContract({
      strike: 50, bid: 0.60, ask: 0.90, delta: 0.2, iv: 1.4,
      open_interest: 120, dte: 7, grossBasis: 50, shares: 800, contracts: 8,
    }),
    grossBasis: 50,
  });

  it("never lets an illiquid rung be best_rate_rung or drive a push", () => {
    expect(illiquidHigh.ror_annualized).toBeGreaterThan(liquidLow.ror_annualized);
    expect(illiquidHigh.illiquid).toBe(true);

    const payload = summarizeTicker({
      ticker: "TEST", spot: 45, gross_basis: 50, shares: 800, contracts: 8,
      k_basis: 50, rungs: [illiquidHigh, liquidLow],
    });
    expect(payload.best_rate_rung).toBe(28);
    expect(payload.shortest_qualifying_rung).toBe(28);
    expect(payload.push_rung).toBe(28);
    // Still RED — the rate is real, only the tradeability is not.
    expect(payload.tier).toBe("RED");
  });

  it("flags wide spreads and thin OI, and tolerates an unknown OI", () => {
    expect(contractLiquidity({ bid: 0.51, ask: 0.59, open_interest: 32445 }).illiquid).toBe(true);
    expect(contractLiquidity({ bid: 2.15, ask: 2.21, open_interest: 431 }).illiquid).toBe(true);
    const unknownOi = contractLiquidity({ bid: 2.15, ask: 2.21, open_interest: null });
    expect(unknownOi.illiquid).toBe(false);
    expect(unknownOi.open_interest).toBeNull();
  });
});

describe("AMBER band and the qualifying spot", () => {
  // Load-bearing test 1: IREN qualifies at zero move while KTOS needs +16.2%.
  // The spread is the volatility term, not the distance to basis.
  it("puts two names at different required moves from similar distances", () => {
    const hiVol = spotRequiredForGate({ strike: 50, dte: 28, iv: 1.05, grossBasis: 50 });
    const loVol = spotRequiredForGate({ strike: 50, dte: 28, iv: 0.35, grossBasis: 50 });
    expect(hiVol).toBeLessThan(loVol);
  });

  it("round-trips: at the required spot the rung sits exactly on the gate", () => {
    const iv = 0.62, dte = 28, strike = 75, basis = 75;
    const required = spotRequiredForGate({ strike, dte, iv, grossBasis: basis });
    const T = dte / 365;
    // Re-price at that spot and confirm the gate is met, not exceeded.
    const perShare = bsCallPrice(required, strike, T, RISK_FREE_RATE, iv);
    const ann = (perShare / basis) * (365 / dte) * 100;
    expect(ann).toBeCloseTo(ROR_ANN_MIN, 1);
  });

  it("goes AMBER within 5% of the qualifying spot and stays dark outside it", () => {
    const mkRung = (spotIv) => buildRung({
      target_dte: 28, expiry: "2026-09-18", dte: 28,
      basisContract: buildContract({
        strike: 50, bid: 0.20, ask: 0.22, delta: 0.05, iv: spotIv,
        open_interest: 9000, dte: 28, grossBasis: 50, shares: 800, contracts: 8,
      }),
      grossBasis: 50,
    });
    const rung = mkRung(0.9);
    expect(rung.qualifies).toBe(false);
    expect(rung.spot_required).toBeGreaterThan(0);

    const justInside = summarizeTicker({
      ticker: "T", spot: rung.spot_required * 0.97, gross_basis: 50, shares: 800,
      contracts: 8, k_basis: 50, rungs: [rung],
    });
    const wellOutside = summarizeTicker({
      ticker: "T", spot: rung.spot_required * 0.80, gross_basis: 50, shares: 800,
      contracts: 8, k_basis: 50, rungs: [rung],
    });
    expect(justInside.tier).toBe("AMBER");
    expect(wellOutside.tier).toBeNull();
  });
});

describe("§2.2a event decomposition", () => {
  // Off the IREN 7d/14d pair the spec reports base IV 92.9% and an implied
  // event move of ±14.5% → $35.79 / $47.96.
  it("recovers base IV and the implied event move from adjacent rungs", () => {
    const d = decomposeEventMove({
      nearIv: 1.40, nearDte: 7, farIv: 1.19, farDte: 14, spot: 41.875,
    });
    expect(d.base_iv).toBeCloseTo(0.929, 2);
    expect(d.event_move_pct).toBeCloseTo(0.145, 2);
    expect(d.down_level).toBeCloseTo(35.8, 0);
    expect(d.up_level).toBeCloseTo(47.9, 0);
  });

  it("returns null rather than a made-up number when the pair implies no event", () => {
    expect(decomposeEventMove({ nearIv: 0.5, nearDte: 7, farIv: 0.9, farDte: 14, spot: 40 }))
      .toBeNull();
    expect(decomposeEventMove({ nearIv: 1.4, nearDte: 14, farIv: 1.19, farDte: 7, spot: 40 }))
      .toBeNull();
  });
});

describe("strike and expiry selection", () => {
  it("picks the lowest listed strike at or above gross basis", () => {
    expect(pickBasisStrike([40, 45, 50, 55, 60], 50)).toBe(50);
    expect(pickBasisStrike([40, 45, 50, 55, 60], 47.3)).toBe(50);
    expect(pickBasisStrike([40, 45, 50], 62)).toBeNull();
  });

  it("walks the listed grid rather than adding fixed offsets", () => {
    // IREN is $5 above $50; a fixed offset would invent strikes that do not trade.
    expect(ladderStrikes([45, 50, 55, 60, 65, 70], 50)).toEqual([50, 55, 60, 65, 70]);
    expect(ladderStrikes([70, 72.5, 75, 77.5, 80, 82.5], 75)).toEqual([75, 77.5, 80, 82.5]);
  });
});

describe("re-arm arithmetic (§4.2)", () => {
  it("counts trading days, not calendar days", () => {
    expect(tradingDaysBetween("2026-08-21", "2026-08-28")).toBe(5);  // Fri → Fri
    expect(tradingDaysBetween("2026-08-21", "2026-08-24")).toBe(1);  // Fri → Mon
    expect(tradingDaysBetween("2026-08-21", "2026-08-21")).toBe(0);
  });
});

describe("unpriced rungs", () => {
  it("never qualifies and never counts toward AMBER", () => {
    const rung = buildRung({
      target_dte: 7, expiry: "2026-08-28", dte: 7,
      basisContract: { strike: 50, priced_from: "unpriced" },
      grossBasis: 50,
    });
    expect(rung.unpriced).toBe(true);
    expect(rung.qualifies).toBe(false);
    const payload = summarizeTicker({
      ticker: "T", spot: 49, gross_basis: 50, shares: 800, contracts: 8,
      k_basis: 50, rungs: [rung],
    });
    expect(payload.tier).toBeNull();
    expect(payload.pushable).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import {
  buildExposureLots,
  buildExposureRows,
  computeExposureRow,
  denominatorFor,
  findDescriptionConflicts,
  impliedBasisFromDescription,
  FALLBACK_BOOK,
  BACKFILL_START,
} from "../_lib/shareExposure.js";

// Real Shares ledger as of 2026-09-22 (trades type='Shares' + positions
// assigned_shares lots). Includes the 7 subtype='Assigned' marker rows that
// must NOT count — spec §6 acceptance numbers depend on dropping them.
const T = (ticker, subtype, open_date, close_date, capital_fronted, description = null) =>
  ({ ticker, type: "Shares", subtype, open_date, close_date, capital_fronted, description });

const SHARE_TRADES = [
  T("TSLL", "Sold", "2025-11-21", "2025-12-19", 18000, "Shares ($18)"),
  T("IREN", "Sold", "2025-11-21", "2026-01-29", 26000, "Shares (500, $52)"),
  T("HOOD", "Sold", "2025-11-21", "2026-07-02", 36300, "Shares ($121, 300)"),
  T("HIMS", "Sold", "2025-11-21", "2026-02-09", 30400, "Shares ($38)"),
  T("IREN", "Assigned", "2025-12-26", "2025-12-26", 13200),
  T("IREN", "Sold", "2025-12-26", "2026-01-29", 8600, "Shares (200, $43)"),
  T("IREN", "Assigned", "2025-12-26", "2025-12-26", 8600),
  T("IREN", "Sold", "2025-12-26", "2026-01-30", 13200, "Shares (300, $44)"),
  T("HOOD", "Sold", "2026-01-16", "2026-07-02", 52000, "Shares ($130, 400)"),
  T("PLTR", "Sold", "2026-01-30", "2026-08-10", 55500, "Shares (300, $185)"),
  T("PLTR", "Sold", "2026-01-30", "2026-08-10", 52500, "Shares (300, $175)"),
  T("SOFI", "Sold", "2026-02-12", "2026-06-01", 85800, "Shares (3300, $26)"),
  T("SHOP", "Sold", "2026-02-13", "2026-08-21", 29000, "Shares (200, $145)"),
  T("APP",  "Sold", "2026-02-13", "2026-07-01", 53000, "Shares (100, $530)"),
  T("CRDO", "Sold", "2026-02-13", "2026-04-20", 81000, "Shares (600, $135)"),
  T("IREN", "Sold", "2026-02-20", "2026-05-08", 52000, "Shares (1000, $52)"),
  T("NVDA", "Sold", "2026-03-28", "2026-04-17", 18000, "Shares (100, $180)"),
  T("HOOD", "Sold", "2026-05-11", "2026-07-02", 32084, "Shares (400, $80.21)"),
  T("HOOD", "Assigned", "2026-05-11", "2026-05-11", 32084),
  T("COHR", "Sold", "2026-07-17", "2026-08-14", 35000, "Shares (100, $350)"),
  T("GLW",  "Sold", "2026-07-29", "2026-08-07", 16500, "Shares (100, $165)"),
  T("COHR", "Sold", "2026-07-30", "2026-08-14", 24600, "Shares (100, $246)"),
  T("GLW",  "Sold", "2026-07-30", "2026-08-07", 16750, "Shares (100, $165)"),
  T("COHR", "Assigned", "2026-07-30", "2026-07-30", 24600),
  T("GLW",  "Sold", "2026-07-31", "2026-08-07", 14800, "Shares (100, $148)"),
  T("GLW",  "Sold", "2026-08-03", "2026-08-07", 14100, "Shares (100, $141)"),
  T("GLW",  "Assigned", "2026-08-03", "2026-08-03", 14100),
  T("CLS",  "Assigned", "2026-08-06", "2026-08-06", 31700),
  T("IREN", "Assigned", "2026-08-28", "2026-08-28", 7580),
];

const L = (fronted, open_date, description) => ({ fronted, open_date, description });
const SHARE_POSITIONS = [
  { ticker: "CDE",  lots: [L(22000, "2026-03-28", "Shares (1000, $22)"), L(21000, "2026-05-01", "Shares (1000, $20)"), L(19000, "2026-07-02", "Shares (1000, $19)")] },
  { ticker: "KTOS", lots: [L(14000, "2026-04-24", "Shares (200, $70)"), L(15400, "2026-04-24", "Shares (200, $77)")] },
  { ticker: "CCJ",  lots: [L(11300, "2026-05-29", "Shares (100, $113)")] },
  { ticker: "CLS",  lots: [L(38000, "2026-07-02", "Shares (100, $380)"), L(31700, "2026-08-06", "Shares (100, $317)")] },
  { ticker: "IREN", lots: [L(22000, "2026-07-16", "Shares (400, $55)"), L(18000, "2026-07-24", "Shares (400, $45)"), L(7580, "2026-08-28", "Shares (200, $37.9)")] },
  { ticker: "LRCX", lots: [L(32500, "2026-07-24", "Shares (100, $325)")] },
  { ticker: "DRAM", lots: [L(28000, "2026-07-30", "Shares (400, $70)"), L(22400, "2026-07-31", "Shares (400, $56)"), L(22600, "2026-07-31", "Shares (400, $56.5)")] },
  { ticker: "CRDO", lots: [L(23000, "2026-09-18", "Shares (100, $230)"), L(21000, "2026-09-18", "Shares (100, $210)")] },
].map(p => ({
  ...p, position_type: "assigned_shares", type: "Shares", open_date: null,
  capital_fronted: p.lots.reduce((s, l) => s + l.fronted, 0),
}));

// account_snapshots starts 2026-04-04 and has held 875131.25 ever since.
const ACCOUNT_ROWS = [{ snapshot_date: "2026-04-04", account_value: 875131.25 }];

function fullSeries() {
  return buildExposureRows({
    positions: SHARE_POSITIONS, trades: SHARE_TRADES, accountRows: ACCOUNT_ROWS,
    from: BACKFILL_START, to: "2026-09-22", liveDate: "2026-09-22",
  });
}
const byDate = rows => Object.fromEntries(rows.map(r => [r.snapshot_date, r]));
const monthAvg = (rows, ym) => {
  const m = rows.filter(r => r.snapshot_date.startsWith(ym));
  return m.reduce((s, r) => s + r.shares_basis_pct, 0) / m.length;
};

describe("share exposure — spec §6 acceptance (real ledger)", () => {
  const { rows } = fullSeries();
  const d = byDate(rows);

  it("writes one row per calendar day from 2025-11-21", () => {
    expect(rows[0].snapshot_date).toBe("2025-11-21");
    expect(rows).toHaveLength(306);
  });

  it("2026-09-22: $369,480 · 8 tickers · 42.2%", () => {
    expect(d["2026-09-22"].shares_basis_total).toBe(369480);
    expect(d["2026-09-22"].n_tickers).toBe(8);
    expect(d["2026-09-22"].shares_basis_pct.toFixed(1)).toBe("42.2");
    expect(d["2026-09-22"].source).toBe("live");
  });

  it("2026-09-22 by_ticker", () => {
    expect(d["2026-09-22"].by_ticker).toEqual({
      DRAM: 73000, CLS: 69700, CDE: 62000, IREN: 47580,
      CRDO: 44000, LRCX: 32500, KTOS: 29400, CCJ: 11300,
    });
  });

  it("2026-08-06 is the YTD peak: $576,650 · 65.9%", () => {
    expect(d["2026-08-06"].shares_basis_total).toBe(576650);
    expect(d["2026-08-06"].shares_basis_pct.toFixed(1)).toBe("65.9");
    const peak = rows.filter(r => r.snapshot_date >= "2026-01-01")
      .reduce((a, b) => (b.shares_basis_total > a.shares_basis_total ? b : a));
    expect(peak.snapshot_date).toBe("2026-08-06");
  });

  it("2026-01-01: $114,500 · 13.1% (pre-account_snapshots → fallback book)", () => {
    expect(d["2026-01-01"].shares_basis_total).toBe(114500);
    expect(d["2026-01-01"].book_denominator).toBe(FALLBACK_BOOK);
    expect(d["2026-01-01"].shares_basis_pct.toFixed(1)).toBe("13.1");
  });

  it("July avg 37.6%, August avg 45.7%", () => {
    expect(monthAvg(rows, "2026-07").toFixed(1)).toBe("37.6");
    expect(monthAvg(rows, "2026-08").toFixed(1)).toBe("45.7");
  });

  it("every day before today is a ledger reconstruction", () => {
    expect(rows.slice(0, -1).every(r => r.source === "backfill_ledger")).toBe(true);
  });

  it("re-running produces identical rows", () => {
    expect(fullSeries().rows).toEqual(rows);
  });
});

describe("live path == backfill path (§6.1)", () => {
  it("today's row from positions alone matches the full-ledger row", () => {
    // The live job only needs positions for today; closed trades can't be
    // open today. Prove it: evaluate today with no trades at all.
    const liveOnly = buildExposureRows({
      positions: SHARE_POSITIONS, trades: [], accountRows: ACCOUNT_ROWS,
      from: "2026-09-22", to: "2026-09-22", liveDate: "2026-09-22",
    }).rows[0];
    expect(liveOnly).toEqual(byDate(fullSeries().rows)["2026-09-22"]);
  });
});

describe("exclusions", () => {
  it("subtype='Assigned' share rows never become lots (§6.2)", () => {
    const { shares } = buildExposureLots({ trades: SHARE_TRADES });
    expect(shares).toHaveLength(SHARE_TRADES.filter(t => t.subtype === "Sold").length);
    // CLS 8/06 Assigned marker duplicates a still-open positions lot.
    const row = computeExposureRow({
      lots: buildExposureLots({ positions: SHARE_POSITIONS, trades: SHARE_TRADES }),
      date: "2026-08-06", denominator: FALLBACK_BOOK, source: "live",
    });
    expect(row.by_ticker.CLS).toBe(69700);
  });

  it("covered calls never reach csp_collateral_total (§6.3)", () => {
    const positions = [
      { position_type: "open_csp", type: "CSP", ticker: "WDC", open_date: "2026-09-11", capital_fronted: 42000 },
      { position_type: "open_csp", type: "CC",  ticker: "DRAM", open_date: "2026-09-17", capital_fronted: 69600 },
    ];
    const trades = [
      { ticker: "CDE", type: "CSP", subtype: "Close", open_date: "2026-09-16", close_date: "2026-09-25", capital_fronted: 18000 },
      { ticker: "CLS", type: "CC",  subtype: "Close", open_date: "2026-09-01", close_date: "2026-09-25", capital_fronted: 64470 },
    ];
    const row = computeExposureRow({
      lots: buildExposureLots({ positions, trades }),
      date: "2026-09-22", denominator: FALLBACK_BOOK, source: "live",
    });
    expect(row.csp_collateral_total).toBe(60000);
  });

  it("a lot closed on d is not open on d", () => {
    const trades = [{ ticker: "X", type: "LEAPS", subtype: "Close", open_date: "2026-01-01", close_date: "2026-01-05", capital_fronted: 100 }];
    const lots = buildExposureLots({ trades });
    const at = date => computeExposureRow({ lots, date, denominator: 1, source: "live" }).leaps_basis_total;
    expect([at("2025-12-31"), at("2026-01-01"), at("2026-01-04"), at("2026-01-05")]).toEqual([0, 100, 100, 0]);
  });
});

describe("§5 description conflicts", () => {
  it("parses both orderings and skips price-only descriptions", () => {
    expect(impliedBasisFromDescription("Shares (1000, $20)")).toBe(20000);
    expect(impliedBasisFromDescription("Shares ($121, 300)")).toBe(36300);
    expect(impliedBasisFromDescription("Shares ($18)")).toBeNull();
    expect(impliedBasisFromDescription(null)).toBeNull();
  });

  it("flags CDE 2026-05-01 (desc $20,000 vs stored $21,000) without correcting it", () => {
    const { shares } = buildExposureLots({ positions: SHARE_POSITIONS, trades: SHARE_TRADES });
    const conflicts = findDescriptionConflicts(shares);
    expect(conflicts).toContainEqual(expect.objectContaining({
      ticker: "CDE", open_date: "2026-05-01", implied: 20000, stored: 21000,
    }));
    // GLW 7/30 lot: "(100, $165)" vs 16750 — $250 off, also surfaced.
    expect(conflicts.map(c => `${c.ticker} ${c.open_date}`).sort())
      .toEqual(["CDE 2026-05-01", "GLW 2026-07-30"]);
  });
});

describe("denominatorFor", () => {
  const rows = [
    { snapshot_date: "2026-04-04", account_value: 800000 },
    { snapshot_date: "2026-04-06", account_value: 810000 },
  ];
  it("uses the latest account row on or before d, else the fallback", () => {
    expect(denominatorFor("2026-04-03", rows)).toBe(FALLBACK_BOOK);
    expect(denominatorFor("2026-04-05", rows)).toBe(800000);
    expect(denominatorFor("2026-04-06", rows)).toBe(810000);
  });
});

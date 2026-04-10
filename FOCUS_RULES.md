# Focus Engine Rules

Rules evaluated by `src/lib/focusEngine.js` on every Focus tab load.
Update this file whenever rules are added, changed, or removed.

## P1 — Act Today

| Rule | Trigger | Data Source |
|------|---------|-------------|
| **Cash below floor** | `free_cash_pct` is below the VIX band floor (e.g. VIX 20–25 → floor is 10%) | Account snapshot |
| **Expiring soon** | CC or CSP with DTE ≤ 2 | Positions |
| **Uncovered shares** | Assigned shares with no active covered call | Positions |

## P2 — Review This Week

| Rule | Trigger | Data Source |
|------|---------|-------------|
| **Expiring soon** | CC or CSP with DTE 3–5 | Positions |
| **Earnings before expiry** | Next earnings date falls on or before an option's expiry date | Market context (Finnhub via OpenClaw) |
| **Macro overlap** | CPI, FOMC, or NFP event within 2 calendar days of any option expiry | Market context (TradingView via OpenClaw) |

## P3 — Informational

| Rule | Trigger | Data Source |
|------|---------|-------------|
| **Expiry cluster** | 3 or more options (CC or CSP) expire on the same date | Positions |

---

## Notes

- P1/P3 rules run entirely from positions + account data — no OpenClaw dependency.
- P2 earnings and macro rules go silent if market context is unavailable (OpenClaw hasn't run yet).
- Market context refreshes once daily when OpenClaw POSTs to `/api/ingest-market-context`.
- Focus tab fetches fresh data on every page load / tab mount.

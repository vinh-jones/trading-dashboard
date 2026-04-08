import { useState, useMemo } from "react";
import { useData } from "../../hooks/useData";
import { normalizeTrade } from "../../lib/trading";
import { formatDollars } from "../../lib/format";
import { formatExpiry } from "../../lib/format";
import { JOURNAL_BADGE } from "./journalConstants";
import { getTradeEmoji, eodFloorLabel, eodActivityLabel, fmtEntryDate } from "./journalHelpers";

export function JournalEntryCard({ entry, onEdit, onDelete }) {
  const { trades, positions, account } = useData();
  const [expanded, setExpanded] = useState(false);

  // Flatten open positions (CSPs, CCs, standalone LEAPS) into normalized trade objects
  // so they can be matched against journal entries the same way as closed trades.
  const openTrades = useMemo(() => {
    if (!positions) return [];
    const open = [
      ...(positions.open_csps  ?? []),
      ...(positions.open_leaps ?? []),
      ...(positions.assigned_shares ?? []).flatMap(s => [
        ...(s.active_cc  ? [s.active_cc]  : []),
        ...(s.open_leaps ?? []),
      ]),
    ];
    return open.map(normalizeTrade);
  }, [positions]);

  // Look up the matching trade for emoji + metadata.
  // Searches closed trades first (matched by close_date), then open positions (matched by open_date).
  const linkedTrade = useMemo(() => {
    if (entry.entry_type !== "trade_note" || !entry.ticker) return null;
    const typeMatch   = entry.title?.match(/^(\w+)/);
    // Only match a strike if it appears directly after the type word (e.g. "LEAPS $230 —")
    // This prevents entry costs like "LEAPS — Opened @ $56.20" from being misread as strikes.
    const strikeMatch = entry.title?.match(/^\w+ \$(\d+(?:\.\d+)?)/);
    const titleType   = typeMatch?.[1];
    const titleStrike = strikeMatch ? parseFloat(strikeMatch[1]) : null;
    const matches = (t) =>
      t.ticker === entry.ticker &&
      (!titleType   || t.type   === titleType) &&
      (!titleStrike || t.strike === titleStrike);
    // Closed trades: entry_date = close_date
    const closed = trades.find(t =>
      matches(t) && t.closeDate?.toISOString().slice(0, 10) === entry.entry_date
    );
    if (closed) return closed;
    // Open positions: entry_date = open_date
    return openTrades.find(t =>
      matches(t) && t.open_date === entry.entry_date
    ) ?? null;
  }, [trades, entry.ticker, entry.entry_date, entry.title, entry.entry_type]);

  // Emoji for context line: computed for trade notes, fixed for position notes, none for EOD
  const cardEmoji =
    entry.entry_type === "trade_note"    ? (linkedTrade ? getTradeEmoji(linkedTrade) : null) :
    entry.entry_type === "position_note" ? "👁️" :
    null;

  const badge  = JOURNAL_BADGE[entry.entry_type] || { label: entry.entry_type, color: "#8b949e" };
  const isEOD  = entry.entry_type === "eod_update";
  const hasMeta = isEOD && entry.metadata != null;

  // ── New-style EOD card (has metadata) ─────────────────────────────────────
  if (hasMeta) {
    const md = entry.metadata;
    const floorLbl    = eodFloorLabel(md.floor_status);
    const activityLbl = eodActivityLabel(md.activity);
    const truncatedBody = entry.body
      ? (entry.body.length > 120 ? entry.body.slice(0, 120) + "…" : entry.body)
      : "";

    // Shared label style for the metadata grid
    const CELL_LBL = { color: "#6e7681", textTransform: "uppercase", letterSpacing: "0.5px", fontSize: 11, marginBottom: 5 };
    const CELL_VAL = { fontSize: 13, fontWeight: 600, color: "#e6edf3" };
    const SEC_HDR  = { color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.8px", fontSize: 11, fontWeight: 700, marginBottom: 10 };

    return (
      <div style={{ marginBottom: 12 }}>
        {/* ── Collapsed card ── */}
        <div
          onClick={() => setExpanded(prev => !prev)}
          style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: expanded ? "6px 6px 0 0" : 6, padding: 16, cursor: "pointer", userSelect: "none" }}
        >
          {/* Header: badge + mood · date · arrow */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: badge.color, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px" }}>
                {badge.label}
              </span>
              {entry.mood && <span style={{ fontSize: 16, lineHeight: 1 }}>{entry.mood}</span>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ color: "#8b949e", fontSize: 12 }}>{fmtEntryDate(entry.entry_date)}</span>
              <span style={{ color: "#6e7681", fontSize: 16, lineHeight: 1, width: 14, textAlign: "center" }}>{expanded ? "↑" : "↓"}</span>
            </div>
          </div>

          {/* Stinger line */}
          <div style={{ fontSize: 12, color: "#6e7681", marginBottom: 8, display: "flex", flexWrap: "wrap", gap: "0 6px" }}>
            {md.vix != null && <span>VIX {md.vix}</span>}
            {md.free_cash_pct != null && (
              <>
                <span>·</span>
                <span>
                  Cash {md.free_cash_pct}%
                  {floorLbl && <span style={{ color: floorLbl.color, marginLeft: 4 }}>{floorLbl.text}</span>}
                </span>
              </>
            )}
            {md.mtd_realized != null && (
              <>
                <span>·</span>
                <span>MTD ${md.mtd_realized.toLocaleString()}</span>
              </>
            )}
            {activityLbl && (
              <>
                <span>·</span>
                <span>{activityLbl}</span>
              </>
            )}
          </div>

          <div style={{ borderTop: "1px solid #21262d", marginBottom: expanded ? 0 : 10 }} />

          {/* Body preview — only when collapsed */}
          {!expanded && (
            <div style={{ color: truncatedBody ? "#c9d1d9" : "#6e7681", fontSize: 13, lineHeight: 1.6, fontStyle: truncatedBody ? "normal" : "italic" }}>
              {truncatedBody || "No notes yet."}
            </div>
          )}
        </div>

        {/* ── Expanded detail view ── */}
        {expanded && (
          <div style={{ background: "#0d1117", border: "1px solid #21262d", borderTop: "none", borderRadius: "0 0 6px 6px", padding: "16px 16px 12px" }}>

            {/* ── Section A: Metadata grid ── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "18px 20px", marginBottom: 20 }}>
              <div>
                <div style={CELL_LBL}>Free Cash</div>
                <div style={CELL_VAL}>{md.free_cash_pct != null ? `${md.free_cash_pct}%` : "—"}</div>
              </div>
              <div>
                <div style={CELL_LBL}>Deployment Status</div>
                {floorLbl
                  ? <div style={{ fontSize: 13, fontWeight: 600, color: floorLbl.color }}>
                      {floorLbl.text}
                      {md.floor_delta != null && <span style={{ fontWeight: 400, color: "#8b949e", fontSize: 12 }}> ({(md.floor_delta * 100).toFixed(1)}%)</span>}
                    </div>
                  : <div style={{ fontSize: 13, color: "#6e7681" }}>—</div>}
                {md.floor_band_low != null && (
                  <div style={{ color: "#6e7681", fontSize: 11, marginTop: 4 }}>Floor: {md.floor_band_low}–{md.floor_band_high}%</div>
                )}
              </div>
              <div>
                <div style={CELL_LBL}>VIX</div>
                <div style={CELL_VAL}>{md.vix ?? "—"}</div>
              </div>
              <div>
                <div style={CELL_LBL}>MTD Realized</div>
                <div style={{ ...CELL_VAL, color: "#3fb950" }}>{md.mtd_realized != null ? `$${md.mtd_realized.toLocaleString()}` : "—"}</div>
              </div>
              <div>
                <div style={CELL_LBL}>Pipeline Total</div>
                <div style={CELL_VAL}>{md.pipeline_total != null ? `$${md.pipeline_total.toLocaleString()}` : "—"}</div>
              </div>
              <div>
                <div style={CELL_LBL}>Pipeline Est.</div>
                <div style={CELL_VAL}>{md.pipeline_est != null ? `$${md.pipeline_est.toLocaleString()}` : "—"}</div>
              </div>
            </div>

            {/* Monthly targets with progress bars */}
            {account?.monthly_targets && (
              <div style={{ marginBottom: 20, paddingBottom: 16, borderBottom: "1px solid #21262d" }}>
                <div style={SEC_HDR}>Monthly Targets</div>
                {[
                  { label: "Baseline", target: account.monthly_targets.baseline, color: "#3fb950" },
                  { label: "Stretch",  target: account.monthly_targets.stretch,  color: "#58a6ff" },
                ].map(({ label, target, color }) => {
                  const pct    = md.mtd_realized != null ? (md.mtd_realized / target) * 100 : 0;
                  const pctStr = md.mtd_realized != null ? pct.toFixed(1) + "%" : "—";
                  const barColor = pct >= 100 ? color : color + "99";
                  return (
                    <div key={label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                      <span style={{ color: "#8b949e", fontSize: 12, width: 56 }}>{label}</span>
                      <span style={{ color: "#c9d1d9", fontSize: 12, width: 58 }}>${(target / 1000).toFixed(0)}k</span>
                      <div style={{ flex: 1, height: 5, background: "#21262d", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: barColor, borderRadius: 3, transition: "width 0.3s ease" }} />
                      </div>
                      <span style={{ color: md.mtd_realized != null && pct >= 100 ? color : "#8b949e", fontSize: 12, width: 38, textAlign: "right" }}>{pctStr}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Section B: Today's Activity ── */}
            <div style={{ marginBottom: 20 }}>
              <div style={SEC_HDR}>Today's Activity</div>
              <div style={{ borderTop: "1px solid #21262d", paddingTop: 10 }}>
                {(!md.activity?.closed?.length && !md.activity?.opened?.length) ? (
                  <div style={{ color: "#6e7681", fontStyle: "italic", fontSize: 12 }}>No trades on this date</div>
                ) : (
                  <>
                    {(md.activity.closed || []).map((t, i) => (
                      <div key={i} style={{ marginBottom: 6, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                        <span style={{ color: "#6e7681", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.4px", minWidth: 44 }}>Closed</span>
                        <span style={{ color: "#e6edf3", fontWeight: 700, fontSize: 13 }}>{t.ticker}</span>
                        <span style={{ color: "#8b949e", fontSize: 12 }}>{t.type} ${t.strike}</span>
                        {t.pct_kept != null && <span style={{ color: "#3fb950", fontSize: 12 }}>+{t.pct_kept}%</span>}
                        {t.dte_remaining != null && <span style={{ color: "#6e7681", fontSize: 12 }}>({t.dte_remaining}d DTE rem. @ close)</span>}
                      </div>
                    ))}
                    {(md.activity.opened || []).map((p, i) => (
                      <div key={i} style={{ marginBottom: 6, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                        <span style={{ color: "#6e7681", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.4px", minWidth: 44 }}>Opened</span>
                        <span style={{ color: "#e6edf3", fontWeight: 700, fontSize: 13 }}>{p.ticker}</span>
                        <span style={{ color: "#8b949e", fontSize: 12 }}>{p.type} ${p.strike}</span>
                        {p.expiry && <span style={{ color: "#6e7681", fontSize: 12 }}>exp {formatExpiry(p.expiry)}</span>}
                        {p.premium && <span style={{ color: "#3fb950", fontSize: 12 }}>+${p.premium.toLocaleString()}</span>}
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>

            {/* ── Section C: Open CSP Snapshot ── */}
            <div style={{ marginBottom: 20 }}>
              <div style={SEC_HDR}>Open CSP Positions <span style={{ color: "#6e7681", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(as of save time)</span></div>
              <div style={{ borderTop: "1px solid #21262d", paddingTop: 10 }}>
                {!md.csp_snapshot?.length ? (
                  <div style={{ color: "#6e7681", fontStyle: "italic", fontSize: 12 }}>No open CSPs at time of save</div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr>
                          {["Ticker", "Strike", "Expiry", "DTE", "% Left", "Premium", "Capital", "ROI"].map(h => (
                            <th key={h} style={{ color: "#6e7681", textAlign: "left", padding: "0 12px 8px 0", fontWeight: 600, fontSize: 11, whiteSpace: "nowrap" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {md.csp_snapshot.map((row, i) => (
                          <tr key={i} style={{ borderTop: "1px solid #161b22" }}>
                            <td style={{ color: "#e6edf3", fontWeight: 700, padding: "5px 12px 5px 0" }}>{row.ticker}</td>
                            <td style={{ color: "#c9d1d9", padding: "5px 12px 5px 0" }}>${row.strike}</td>
                            <td style={{ color: "#8b949e", padding: "5px 12px 5px 0" }}>{formatExpiry(row.expiry)}</td>
                            <td style={{ color: "#c9d1d9", padding: "5px 12px 5px 0" }}>{row.dte}d</td>
                            <td style={{ color: row.dte_pct >= 60 ? "#3fb950" : "#c9d1d9", padding: "5px 12px 5px 0", fontWeight: row.dte_pct >= 60 ? 600 : 400 }}>{row.dte_pct}%</td>
                            <td style={{ color: "#3fb950", padding: "5px 12px 5px 0", fontWeight: 500 }}>${row.premium?.toLocaleString()}</td>
                            <td style={{ color: "#8b949e", padding: "5px 12px 5px 0" }}>${row.capital?.toLocaleString()}</td>
                            <td style={{ color: "#c9d1d9", padding: "5px 0 5px 0" }}>{Number(row.roi).toFixed(2)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Body text */}
            {entry.body && (
              <div style={{ color: "#c9d1d9", fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap", marginBottom: 16, paddingTop: 14, borderTop: "1px solid #21262d" }}>
                {entry.body}
              </div>
            )}

            {/* Edit + Delete at bottom */}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={e => { e.stopPropagation(); onDelete(entry.id); }}
                style={{ background: "none", border: "none", color: "#6e7681", cursor: "pointer", fontSize: 12, fontFamily: "inherit", padding: "5px 8px" }}
              >
                Delete
              </button>
              <button
                onClick={e => { e.stopPropagation(); onEdit(entry); }}
                style={{ background: "none", border: "1px solid #30363d", color: "#8b949e", cursor: "pointer", fontSize: 12, fontFamily: "inherit", padding: "5px 14px", borderRadius: 4 }}
              >
                Edit
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Legacy EOD card (no metadata) and all non-EOD cards ───────────────────
  return (
    <div style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: 6, padding: 16, marginBottom: 12 }}>
      {/* Header row: badge (+ mood for EOD) and date */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: badge.color, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px" }}>
            {badge.label}
          </span>
          {isEOD && entry.mood && (
            <span style={{ fontSize: 16, lineHeight: 1 }}>{entry.mood}</span>
          )}
        </div>
        <span style={{ color: "#8b949e", fontSize: 12 }}>{fmtEntryDate(entry.entry_date)}</span>
      </div>

      {/* Context line: emoji + ticker + title (trade/position notes only) */}
      {!isEOD && (entry.ticker || entry.title) && (
        <div style={{ fontSize: 13, marginBottom: 8, display: "flex", alignItems: "baseline", gap: 5 }}>
          {cardEmoji && <span style={{ fontSize: 15 }}>{cardEmoji}</span>}
          {entry.ticker && <span style={{ color: "#e6edf3", fontWeight: 600 }}>{entry.ticker}</span>}
          {entry.ticker && entry.title && <span style={{ color: "#8b949e" }}> · {entry.title}</span>}
          {!entry.ticker && entry.title && <span style={{ color: "#e6edf3", fontWeight: 500 }}>{entry.title}</span>}
        </div>
      )}

      {/* Trade metadata row */}
      {linkedTrade && (() => {
        const isOpen   = !linkedTrade.closeDate;
        const isCSP    = linkedTrade.type === "CSP";
        const isCC     = linkedTrade.type === "CC";
        const isLEAPS  = linkedTrade.type === "LEAPS";

        // Strike suffix: puts for CSP, calls for everything else (CC, LEAPS, Spread)
        const strikeSuffix = isCSP ? "p" : "c";

        // @ entry [→ exit] cost
        const entryCostStr = linkedTrade.entry_cost != null
          ? `@ $${linkedTrade.entry_cost.toFixed(2)}` : null;
        const exitCostStr = linkedTrade.exit_cost != null
          ? `→ $${linkedTrade.exit_cost.toFixed(2)}` : null;

        // % cash allocated (CSP + LEAPS only; CCs don't use free cash)
        const cashPct = !isCC && linkedTrade.fronted != null && account?.account_value
          ? `${(linkedTrade.fronted / account.account_value * 100).toFixed(1)}% cash`
          : null;

        // Delta (open CSP/CC only, display as whole number e.g. 25δ)
        const deltaDisplay = isOpen && !isLEAPS && linkedTrade.delta != null
          ? `${linkedTrade.delta <= 1 ? Math.round(linkedTrade.delta * 100) : Math.round(linkedTrade.delta)}δ`
          : null;

        // RoR (open CSP/CC only; value stored as e.g. 1.50 meaning 1.50%)
        const rorDisplay = isOpen && !isLEAPS && linkedTrade.roi != null
          ? `${linkedTrade.roi.toFixed(2)}% RoR`
          : null;

        // Closed-only: days + kept% + P&L
        const daysDisplay = !isOpen && linkedTrade.days != null ? `${linkedTrade.days}d` : null;
        const keptDisplay = !isOpen && !isLEAPS && linkedTrade.kept && linkedTrade.kept !== "—"
          ? linkedTrade.kept + " kept" : null;
        const plDisplay = !isOpen && linkedTrade.premium != null
          ? (linkedTrade.premium >= 0 ? "+" : "") + formatDollars(linkedTrade.premium)
          : null;

        const dot = <span style={{ color: "#444d56" }}>·</span>;
        return (
          <div style={{ fontSize: 12, color: "#6e7681", marginBottom: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {linkedTrade.strike && <span>${linkedTrade.strike}{strikeSuffix}</span>}
            {linkedTrade.expiry && linkedTrade.expiry !== "—" && <>{dot}<span>exp {linkedTrade.expiry}</span></>}
            {linkedTrade.contracts                               && <>{dot}<span>{linkedTrade.contracts} ct</span></>}
            {entryCostStr                                        && <>{dot}<span>{entryCostStr}{exitCostStr ? ` ${exitCostStr}` : ""}</span></>}
            {cashPct                                             && <>{dot}<span>{cashPct}</span></>}
            {deltaDisplay                                        && <>{dot}<span>{deltaDisplay}</span></>}
            {rorDisplay                                          && <>{dot}<span>{rorDisplay}</span></>}
            {daysDisplay                                         && <>{dot}<span>{daysDisplay}</span></>}
            {keptDisplay                                         && <>{dot}<span>{keptDisplay}</span></>}
            {plDisplay                                           && <>{dot}<span style={{ color: linkedTrade.premium >= 0 ? "#3fb950" : "#f85149" }}>{plDisplay}</span></>}
          </div>
        );
      })()}

      {/* Body */}
      <div style={{ color: entry.body ? "#c9d1d9" : "#6e7681", fontSize: 13, lineHeight: 1.6, marginBottom: entry.tags?.length ? 10 : 6, whiteSpace: "pre-wrap", fontStyle: entry.body ? "normal" : "italic" }}>
        {entry.body || "No notes yet — click Edit to add."}
      </div>

      {/* Tags */}
      {entry.tags?.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          {entry.tags.map(tag => (
            <span key={tag} style={{ background: "#1c2333", color: "#58a6ff", fontSize: 11, padding: "2px 8px", borderRadius: 4, marginRight: 6, display: "inline-block", marginBottom: 4 }}>
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
        <button onClick={() => onEdit(entry)} style={{ background: "none", border: "none", color: "#8b949e", cursor: "pointer", fontSize: 12, fontFamily: "inherit", padding: 0 }}>Edit</button>
        <button onClick={() => onDelete(entry.id)} style={{ background: "none", border: "none", color: "#8b949e", cursor: "pointer", fontSize: 12, fontFamily: "inherit", padding: 0 }}>Delete</button>
      </div>
    </div>
  );
}

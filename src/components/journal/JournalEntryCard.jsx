import { useState, useMemo } from "react";
import { useData } from "../../hooks/useData";
import { normalizeTrade } from "../../lib/trading";
import { formatDollars } from "../../lib/format";
import { formatExpiry } from "../../lib/format";
import { JOURNAL_BADGE } from "./journalConstants";
import { getTradeEmoji, eodFloorLabel, eodActivityLabel, fmtEntryDate } from "./journalHelpers";
import { theme } from "../../lib/theme";
import { useWindowWidth } from "../../hooks/useWindowWidth";
import { TagChip } from "./TagChip";

export function JournalEntryCard({ entry, onEdit, onDelete, defaultExpanded = false }) {
  const { trades, positions, account } = useData();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [cardHovered, setCardHovered] = useState(false);
  const [editHovered, setEditHovered] = useState(false);
  const [deleteHovered, setDeleteHovered] = useState(false);
  const [actionsHovered, setActionsHovered] = useState(false);
  const isMobile = useWindowWidth() < 600;

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

  const badge  = JOURNAL_BADGE[entry.entry_type] || { label: entry.entry_type, color: theme.text.muted };
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
    // Q2: CELL_LBL marginBottom 5 → theme.space[2] (8px, nearest grid point; 5px off-grid)
    const CELL_LBL = { color: theme.text.subtle, textTransform: "uppercase", letterSpacing: "0.5px", fontSize: theme.size.xs, marginBottom: theme.space[2] };
    const CELL_VAL = { fontSize: theme.size.md, fontWeight: 600, color: theme.text.primary };
    // Q2: SEC_HDR marginBottom 10 → theme.space[2]
    const SEC_HDR  = { color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.8px", fontSize: theme.size.xs, fontWeight: 700, marginBottom: theme.space[2] };

    return (
      /* Q2: marginBottom 12 → theme.space[3] */
      <div style={{ marginBottom: theme.space[3] }}>
        {/* ── Collapsed card ── */}
        {/* Q5: hover tint on collapsed card; Q2: padding 16 → theme.space[4] */}
        <div
          onClick={() => setExpanded(prev => !prev)}
          onMouseEnter={() => setCardHovered(true)}
          onMouseLeave={() => setCardHovered(false)}
          style={{
            background: cardHovered && !expanded ? "rgba(58,130,246,0.06)" : theme.bg.surface,
            border: `1px solid ${theme.border.default}`,
            borderRadius: expanded ? `${theme.radius.md}px ${theme.radius.md}px 0 0` : theme.radius.md,
            padding: theme.space[4], cursor: "pointer", userSelect: "none",
          }}
        >
          {/* Header: badge + mood · date · arrow */}
          {/* Q2: marginBottom 6 → theme.space[1]; gap 8 → theme.space[2] */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: theme.space[1] }}>
            <div style={{ display: "flex", alignItems: "center", gap: theme.space[2] }}>
              {/* Q2/Q3: fontSize 11 → theme.size.xs */}
              <span style={{ color: badge.color, fontSize: theme.size.xs, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px" }}>
                {badge.label}
              </span>
              {entry.mood && <span style={{ fontSize: theme.size.lg, lineHeight: 1 }}>{entry.mood}</span>}
            </div>
            {/* Q2: gap 10 → theme.space[2] */}
            <div style={{ display: "flex", alignItems: "center", gap: theme.space[2] }}>
              <span style={{ color: theme.text.muted, fontSize: theme.size.sm }}>{fmtEntryDate(entry.entry_date)}</span>
              <span style={{ color: theme.text.subtle, fontSize: theme.size.lg, lineHeight: 1, width: 14, textAlign: "center" }}>{expanded ? "↑" : "↓"}</span>
            </div>
          </div>

          {/* Stinger line */}
          {/* Q2: marginBottom 8 → theme.space[2]; gap 6 → theme.space[1] */}
          <div style={{ fontSize: theme.size.sm, color: theme.text.subtle, marginBottom: theme.space[2], display: "flex", flexWrap: "wrap", gap: `0 ${theme.space[1]}px` }}>
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

          <div style={{ borderTop: `1px solid ${theme.border.default}`, marginBottom: expanded ? 0 : theme.space[2] }} />

          {/* Body preview — only when collapsed */}
          {!expanded && (
            <div style={{ color: truncatedBody ? theme.text.secondary : theme.text.subtle, fontSize: theme.size.md, lineHeight: 1.6, fontStyle: truncatedBody ? "normal" : "italic" }}>
              {truncatedBody || "No notes yet."}
            </div>
          )}
        </div>

        {/* ── Expanded detail view ── */}
        {expanded && (
          /* Q2: padding "16px 16px 12px" → token; gap "18px 20px" → token; marginBottom 20 → theme.space[5] */
          <div style={{ background: theme.bg.base, border: `1px solid ${theme.border.default}`, borderTop: "none", borderRadius: `0 0 ${theme.radius.md}px ${theme.radius.md}px`, padding: `${theme.space[4]}px ${theme.space[4]}px ${theme.space[3]}px` }}>

            {/* ── Section A: Metadata grid ── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: `${theme.space[4]}px ${theme.space[5]}px`, marginBottom: theme.space[5] }}>
              <div>
                <div style={CELL_LBL}>Free Cash</div>
                <div style={CELL_VAL}>{md.free_cash_pct != null ? `${md.free_cash_pct}%` : "—"}</div>
              </div>
              <div>
                <div style={CELL_LBL}>Deployment Status</div>
                {floorLbl
                  ? <div style={{ fontSize: theme.size.md, fontWeight: 600, color: floorLbl.color }}>
                      {floorLbl.text}
                      {md.floor_delta != null && <span style={{ fontWeight: 400, color: theme.text.muted, fontSize: theme.size.sm }}> ({(md.floor_delta * 100).toFixed(1)}%)</span>}
                    </div>
                  : <div style={{ fontSize: theme.size.md, color: theme.text.subtle }}>—</div>}
                {md.floor_band_low != null && (
                  <div style={{ color: theme.text.subtle, fontSize: theme.size.xs, marginTop: 4 }}>Floor: {md.floor_band_low}–{md.floor_band_high}%</div>
                )}
              </div>
              <div>
                <div style={CELL_LBL}>VIX</div>
                <div style={CELL_VAL}>{md.vix ?? "—"}</div>
              </div>
              <div>
                <div style={CELL_LBL}>MTD Realized</div>
                <div style={{ ...CELL_VAL, color: theme.green }}>{md.mtd_realized != null ? `$${md.mtd_realized.toLocaleString()}` : "—"}</div>
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
            {/* Q2: marginBottom 20 → theme.space[5]; paddingBottom 16 → theme.space[4] */}
            {account?.monthly_targets && (
              <div style={{ marginBottom: theme.space[5], paddingBottom: theme.space[4], borderBottom: `1px solid ${theme.border.default}` }}>
                <div style={SEC_HDR}>Monthly Targets</div>
                {[
                  { label: "Baseline", target: account.monthly_targets.baseline, color: "#3fb950" },
                  { label: "Stretch",  target: account.monthly_targets.stretch,  color: "#58a6ff" },
                ].map(({ label, target, color }) => {
                  const pct    = md.mtd_realized != null ? (md.mtd_realized / target) * 100 : 0;
                  const pctStr = md.mtd_realized != null ? pct.toFixed(1) + "%" : "—";
                  const barColor = pct >= 100 ? color : color + "99";
                  return (
                    /* Q2: gap 10 → theme.space[2]; marginBottom 6 → theme.space[1] */
                    <div key={label} style={{ display: "flex", alignItems: "center", gap: theme.space[2], marginBottom: theme.space[1] }}>
                      <span style={{ color: theme.text.muted, fontSize: theme.size.sm, width: 56 }}>{label}</span>
                      <span style={{ color: theme.text.secondary, fontSize: theme.size.sm, width: 58 }}>${(target / 1000).toFixed(0)}k</span>
                      <div style={{ flex: 1, height: 5, background: theme.border.default, borderRadius: theme.radius.sm, overflow: "hidden" }}>
                        <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: barColor, borderRadius: theme.radius.sm, transition: "width 0.3s ease" }} />
                      </div>
                      <span style={{ color: md.mtd_realized != null && pct >= 100 ? color : theme.text.muted, fontSize: theme.size.sm, width: 38, textAlign: "right" }}>{pctStr}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Section B: Today's Activity ── */}
            {/* Q2: marginBottom 20 → theme.space[5]; paddingTop 10 → theme.space[2]; marginBottom 6 → theme.space[1]; gap 8 → theme.space[2] */}
            <div style={{ marginBottom: theme.space[5] }}>
              <div style={SEC_HDR}>Today's Activity</div>
              <div style={{ borderTop: `1px solid ${theme.border.default}`, paddingTop: theme.space[2] }}>
                {(!md.activity?.closed?.length && !md.activity?.opened?.length) ? (
                  <div style={{ color: theme.text.subtle, fontStyle: "italic", fontSize: theme.size.sm }}>No trades on this date</div>
                ) : (
                  <>
                    {(md.activity.closed || []).map((t, i) => (
                      <div key={i} style={{ marginBottom: theme.space[1], display: "flex", gap: theme.space[2], flexWrap: "wrap", alignItems: "baseline" }}>
                        <span style={{ color: theme.text.subtle, fontSize: theme.size.xs, textTransform: "uppercase", letterSpacing: "0.4px", minWidth: 44 }}>Closed</span>
                        <span style={{ color: theme.text.primary, fontWeight: 700, fontSize: theme.size.md }}>{t.ticker}</span>
                        <span style={{ color: theme.text.muted, fontSize: theme.size.sm }}>{t.type} ${t.strike}</span>
                        {t.pct_kept != null && <span style={{ color: theme.green, fontSize: theme.size.sm }}>+{t.pct_kept}%</span>}
                        {t.dte_remaining != null && <span style={{ color: theme.text.subtle, fontSize: theme.size.sm }}>({t.dte_remaining}d DTE rem. @ close)</span>}
                      </div>
                    ))}
                    {(md.activity.opened || []).map((p, i) => (
                      <div key={i} style={{ marginBottom: theme.space[1], display: "flex", gap: theme.space[2], flexWrap: "wrap", alignItems: "baseline" }}>
                        <span style={{ color: theme.text.subtle, fontSize: theme.size.xs, textTransform: "uppercase", letterSpacing: "0.4px", minWidth: 44 }}>Opened</span>
                        <span style={{ color: theme.text.primary, fontWeight: 700, fontSize: theme.size.md }}>{p.ticker}</span>
                        <span style={{ color: theme.text.muted, fontSize: theme.size.sm }}>{p.type} ${p.strike}</span>
                        {p.expiry && <span style={{ color: theme.text.subtle, fontSize: theme.size.sm }}>exp {formatExpiry(p.expiry)}</span>}
                        {p.premium && <span style={{ color: theme.green, fontSize: theme.size.sm }}>+${p.premium.toLocaleString()}</span>}
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>

            {/* ── Section C: Open CSP Snapshot ── */}
            {/* Q2: marginBottom 20 → theme.space[5]; paddingTop 10 → theme.space[2]; table cell padding "5px 12px 5px 0" → token */}
            <div style={{ marginBottom: theme.space[5] }}>
              <div style={SEC_HDR}>Open CSP Positions <span style={{ color: theme.text.subtle, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(as of save time)</span></div>
              <div style={{ borderTop: `1px solid ${theme.border.default}`, paddingTop: theme.space[2] }}>
                {!md.csp_snapshot?.length ? (
                  <div style={{ color: theme.text.subtle, fontStyle: "italic", fontSize: theme.size.sm }}>No open CSPs at time of save</div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: theme.size.sm }}>
                      <thead>
                        <tr>
                          {["Ticker", "Strike", "Expiry", "DTE", "% Left", "Premium", "Capital", "ROI"].map(h => (
                            <th key={h} style={{ color: theme.text.subtle, textAlign: "left", padding: `0 ${theme.space[3]}px ${theme.space[2]}px 0`, fontWeight: 600, fontSize: theme.size.xs, whiteSpace: "nowrap" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {md.csp_snapshot.map((row, i) => (
                          <tr key={i} style={{ borderTop: `1px solid ${theme.bg.surface}` }}>
                            <td style={{ color: theme.text.primary, fontWeight: 700, padding: `${theme.space[1]}px ${theme.space[3]}px ${theme.space[1]}px 0` }}>{row.ticker}</td>
                            <td style={{ color: theme.text.secondary, padding: `${theme.space[1]}px ${theme.space[3]}px ${theme.space[1]}px 0` }}>${row.strike}</td>
                            <td style={{ color: theme.text.muted, padding: `${theme.space[1]}px ${theme.space[3]}px ${theme.space[1]}px 0` }}>{formatExpiry(row.expiry)}</td>
                            <td style={{ color: theme.text.secondary, padding: `${theme.space[1]}px ${theme.space[3]}px ${theme.space[1]}px 0` }}>{row.dte}d</td>
                            <td style={{ color: row.dte_pct >= 60 ? theme.green : theme.text.secondary, padding: `${theme.space[1]}px ${theme.space[3]}px ${theme.space[1]}px 0`, fontWeight: row.dte_pct >= 60 ? 600 : 400 }}>{row.dte_pct}%</td>
                            <td style={{ color: theme.green, padding: `${theme.space[1]}px ${theme.space[3]}px ${theme.space[1]}px 0`, fontWeight: 500 }}>${row.premium?.toLocaleString()}</td>
                            <td style={{ color: theme.text.muted, padding: `${theme.space[1]}px ${theme.space[3]}px ${theme.space[1]}px 0` }}>${row.capital?.toLocaleString()}</td>
                            <td style={{ color: theme.text.secondary, padding: `${theme.space[1]}px 0 ${theme.space[1]}px 0` }}>{Number(row.roi).toFixed(2)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Body text */}
            {/* Q2: marginBottom 16 → theme.space[4]; paddingTop 14 → theme.space[3] */}
            {entry.body && (
              <div style={{ color: theme.text.secondary, fontSize: theme.size.md, lineHeight: 1.7, whiteSpace: "pre-wrap", marginBottom: theme.space[4], paddingTop: theme.space[3], borderTop: `1px solid ${theme.border.default}` }}>
                {entry.body}
              </div>
            )}

            {/* Edit + Delete at bottom */}
            {/* Q2: gap 8 → theme.space[2]; Delete padding "5px 8px" → token; Edit padding "5px 14px" → token; Q5: hover states */}
            <div style={{ display: "flex", gap: theme.space[2], justifyContent: "flex-end" }}>
              <button
                onClick={e => { e.stopPropagation(); onDelete(entry.id); }}
                onMouseEnter={() => setDeleteHovered(true)}
                onMouseLeave={() => setDeleteHovered(false)}
                style={{ background: deleteHovered ? "rgba(58,130,246,0.06)" : "none", border: "none", color: theme.text.subtle, cursor: "pointer", fontSize: theme.size.sm, fontFamily: "inherit", padding: `${theme.space[1]}px ${theme.space[2]}px`, borderRadius: theme.radius.sm }}
              >
                Delete
              </button>
              <button
                onClick={e => { e.stopPropagation(); onEdit(entry); }}
                onMouseEnter={() => setEditHovered(true)}
                onMouseLeave={() => setEditHovered(false)}
                style={{ background: editHovered ? "rgba(58,130,246,0.06)" : "none", border: `1px solid ${theme.border.strong}`, color: theme.text.muted, cursor: "pointer", fontSize: theme.size.sm, fontFamily: "inherit", padding: `${theme.space[1]}px ${theme.space[3]}px`, borderRadius: theme.radius.sm }}
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
    /* Q2: marginBottom 12 → theme.space[3] */
    <div
      onMouseEnter={() => { setActionsHovered(true); }}
      onMouseLeave={() => { setActionsHovered(false); }}
      style={{ background: theme.bg.surface, border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.md, padding: theme.space[4], marginBottom: theme.space[3] }}
    >
      {/* Header row: badge (+ mood for EOD) and date */}
      {/* Q2: marginBottom 8 → theme.space[2]; gap 8 → theme.space[2] */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: theme.space[2] }}>
        <div style={{ display: "flex", alignItems: "center", gap: theme.space[2] }}>
          {/* Q2/Q3: fontSize 11 → theme.size.xs */}
          <span style={{ color: badge.color, fontSize: theme.size.xs, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px" }}>
            {badge.label}
          </span>
          {isEOD && entry.mood && (
            /* Q3: fontSize 16 → theme.size.lg */
            <span style={{ fontSize: theme.size.lg, lineHeight: 1 }}>{entry.mood}</span>
          )}
        </div>
        <span style={{ color: theme.text.muted, fontSize: theme.size.sm }}>{fmtEntryDate(entry.entry_date)}</span>
      </div>

      {/* Context line: emoji + ticker + title (trade/position notes only) */}
      {/* Q2/Q3: fontSize 13 → theme.size.sm; marginBottom 8 → theme.space[2]; gap 5 → theme.space[1] */}
      {!isEOD && (entry.ticker || entry.title) && (
        <div style={{ fontSize: theme.size.sm, marginBottom: theme.space[2], display: "flex", alignItems: "baseline", gap: theme.space[1] }}>
          {/* Q3: cardEmoji fontSize 15 → theme.size.md */}
          {cardEmoji && <span style={{ fontSize: theme.size.md }}>{cardEmoji}</span>}
          {entry.ticker && <span style={{ color: theme.text.primary, fontWeight: 600 }}>{entry.ticker}</span>}
          {entry.ticker && entry.title && <span style={{ color: theme.text.muted }}> · {entry.title}</span>}
          {!entry.ticker && entry.title && <span style={{ color: theme.text.primary, fontWeight: 500 }}>{entry.title}</span>}
        </div>
      )}

      {/* Trade metadata row */}
      {/* Q2: marginBottom 8 → theme.space[2]; gap 8 → theme.space[2] */}
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
          ? `→ $${Math.abs(linkedTrade.exit_cost).toFixed(2)}` : null;

        // % cash allocated (CSP + LEAPS only; CCs don't use free cash)
        const cashPct = !isCC && linkedTrade.fronted != null && account?.account_value
          ? `${(linkedTrade.fronted / account.account_value * 100).toFixed(1)}% cash`
          : null;

        // Delta (CSP/CC only, display as whole number e.g. 25δ)
        // Delta stored as decimal (e.g. -0.31 for a put). Display as absolute whole number (31δ).
        const deltaDisplay = !isLEAPS && linkedTrade.delta != null
          ? `${Math.round(Math.abs(linkedTrade.delta) * 100)}δ`
          : null;

        // RoR (CSP/CC only; value stored as e.g. 1.50 meaning 1.50%)
        const rorDisplay = !isLEAPS && linkedTrade.roi != null
          ? `${linkedTrade.roi.toFixed(2)}% RoR`
          : null;

        // Closed-only: days + kept% + P&L
        const daysDisplay = !isOpen && linkedTrade.days != null ? `${linkedTrade.days}d` : null;
        const keptDisplay = !isOpen && !isLEAPS && linkedTrade.kept && linkedTrade.kept !== "—"
          ? linkedTrade.kept + " kept" : null;
        const plDisplay = !isOpen && linkedTrade.premium != null
          ? (linkedTrade.premium >= 0 ? "+" : "") + formatDollars(linkedTrade.premium)
          : null;

        const dot  = <span style={{ color: theme.text.faint, margin: `0 ${theme.space[1]}px` }}>·</span>;
        const pipe = <span style={{ color: theme.border.strong, margin: `0 ${theme.space[2]}px`, fontWeight: 300 }}>|</span>;

        const contractGroup = [
          linkedTrade.strike && <span key="strike">${linkedTrade.strike}{strikeSuffix}</span>,
          linkedTrade.expiry && linkedTrade.expiry !== "—" && <span key="expiry">exp {linkedTrade.expiry}</span>,
          linkedTrade.contracts && <span key="contracts">{linkedTrade.contracts} ct</span>,
        ].filter(Boolean);

        const executionGroup = [
          entryCostStr && <span key="cost">{entryCostStr}{exitCostStr ? ` ${exitCostStr}` : ""}</span>,
          cashPct      && <span key="cash">{cashPct}</span>,
        ].filter(Boolean);

        const performanceGroup = [
          rorDisplay   && <span key="ror">{rorDisplay}</span>,
          deltaDisplay && <span key="delta">{deltaDisplay}</span>,
          daysDisplay  && <span key="days">{daysDisplay}</span>,
          keptDisplay  && <span key="kept">{keptDisplay}</span>,
        ].filter(Boolean);

        const resultGroup = plDisplay
          ? [<span key="pl" style={{ color: linkedTrade.premium >= 0 ? theme.green : theme.red, fontWeight: 600 }}>{plDisplay}</span>]
          : [];

        const renderGroup = (items) => items.flatMap((node, i) => i === 0 ? [node] : [dot, node]);

        const groups = [contractGroup, executionGroup, performanceGroup, resultGroup].filter(g => g.length > 0);

        return (
          <div style={{ fontSize: theme.size.sm, color: theme.text.subtle, marginBottom: theme.space[2], display: "flex", flexWrap: "wrap", alignItems: "center" }}>
            {groups.flatMap((group, i) => i === 0 ? renderGroup(group) : [<span key={`pipe-${i}`}>{pipe}</span>, ...renderGroup(group)])}
          </div>
        );
      })()}

      {/* Body */}
      <div style={{ color: entry.body ? theme.text.secondary : theme.text.subtle, fontSize: theme.size.md, lineHeight: 1.6, marginBottom: entry.tags?.length ? theme.space[2] : theme.space[1], whiteSpace: "pre-wrap", fontStyle: entry.body ? "normal" : "italic" }}>
        {entry.body || "No notes yet — click Edit to add."}
      </div>

      {/* Tags */}
      {entry.tags?.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: theme.space[2] }}>
          {entry.tags.map(tag => <TagChip key={tag} tag={tag} size="sm" />)}
        </div>
      )}

      {/* Actions — Q2: gap 12 → theme.space[3]; Q5: hover states on Edit/Delete */}
      <div style={{ display: "flex", gap: theme.space[3], justifyContent: "flex-end", opacity: isMobile || actionsHovered ? 1 : 0, transition: "opacity 0.15s" }}>
        <button
          onClick={() => onEdit(entry)}
          onMouseEnter={() => setEditHovered(true)}
          onMouseLeave={() => setEditHovered(false)}
          style={{ background: editHovered ? "rgba(58,130,246,0.06)" : "none", border: "none", color: theme.text.muted, cursor: "pointer", fontSize: theme.size.sm, fontFamily: "inherit", padding: "2px 4px", borderRadius: theme.radius.sm }}
        >Edit</button>
        <button
          onClick={() => onDelete(entry.id)}
          onMouseEnter={() => setDeleteHovered(true)}
          onMouseLeave={() => setDeleteHovered(false)}
          style={{ background: deleteHovered ? "rgba(58,130,246,0.06)" : "none", border: "none", color: theme.text.muted, cursor: "pointer", fontSize: theme.size.sm, fontFamily: "inherit", padding: "2px 4px", borderRadius: theme.radius.sm }}
        >Delete</button>
      </div>
    </div>
  );
}

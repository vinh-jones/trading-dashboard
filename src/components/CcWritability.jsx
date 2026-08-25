import React, { useState } from "react";
import { theme } from "../lib/theme";
import { useCcWritability } from "../hooks/useCcWritability";

/**
 * Covered-call writability — the CSP cushion monitor's counterpart.
 * Spec: docs/spec_cc_writability_alert_v1.md
 *
 * AMBER is a dashboard-only state (§2.4), so this panel is the only place it
 * ever surfaces. RED also pushes, but a push that was suppressed — through a
 * print, inside the re-arm window — still shows here with its reason, because
 * §4.4's whole point is that a deliberate silence must stay visible.
 *
 * This panel REPORTS. It never recommends a strike (§3.3, §6): premium,
 * P(assign) and payoff-if-assigned sit side by side and the choice is Vinh's.
 */

const TIER_STYLE = {
  RED:   { label: "RED",   color: theme.red,   bg: theme.alert.dangerBg,  border: theme.alert.dangerBorder },
  AMBER: { label: "AMBER", color: theme.amber, bg: theme.bg.elevated,     border: theme.border.strong },
};

const BLOCK_REASON_LABEL = {
  earnings_suppressed: "held through earnings",
  rearm_window:        "re-arm window",
  order_placed_today:  "order placed today",
  modeled_only:        "modeled — chain not pulled",
};

const STATUS_LABEL = {
  below_min_lot:   "fewer than 100 shares",
  missing_lots:    "no lot capital recorded",
  no_spot:         "no spot price",
  no_chain_meta:   "no chain data",
  no_basis_strike: "no listed strike at or above basis",
  no_market_data:  "market data unavailable",
};

const money   = v => (v == null ? "—" : `$${Math.round(v).toLocaleString()}`);
const dollars = v => (v == null ? "—" : `$${Number(v).toFixed(2)}`);
const pct1    = v => (v == null ? "—" : `${Number(v).toFixed(1)}%`);
const delta2  = v => (v == null ? "—" : Number(v).toFixed(2));

/**
 * One strike, or the range the ladder actually priced at. Reading the first
 * rung's strike as "the" basis strike misdescribes every rung whose expiry
 * lists a different grid — see k_basis_varies in src/lib/ccWritability.js.
 */
function formatKBasis(position) {
  if (position.k_basis == null) return "—";
  if (!position.k_basis_varies) return `$${position.k_basis}`;
  return `$${position.k_basis_min}–$${position.k_basis_max}`;
}

const cell = { padding: `${theme.space[1]}px ${theme.space[2]}px`, textAlign: "right", whiteSpace: "nowrap" };
const headCell = {
  ...cell,
  color: theme.text.muted,
  fontSize: theme.size.xs,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  borderBottom: `1px solid ${theme.border.default}`,
};

function Badge({ tier }) {
  const style = TIER_STYLE[tier];
  if (!style) {
    return (
      <span style={{ color: theme.text.subtle, fontSize: theme.size.xs }}>
        not writable
      </span>
    );
  }
  return (
    <span style={{
      color: style.color, background: style.bg,
      border: `1px solid ${style.border}`, borderRadius: theme.radius.sm,
      padding: `2px ${theme.space[2]}px`, fontSize: theme.size.xs, fontWeight: 700,
      letterSpacing: "0.06em",
    }}>
      {style.label}
    </span>
  );
}

/** Per-rung table at K_basis. Illiquid and suppressed rungs stay visible. */
function RungTable({ position }) {
  const rungs = position.rungs ?? [];
  if (!rungs.length) return null;

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: theme.font.mono, fontSize: theme.size.sm }}>
      <thead>
        <tr>
          <th style={{ ...headCell, textAlign: "left" }}>Expiry</th>
          <th style={headCell}>DTE</th>
          <th style={headCell}>Strike</th>
          <th style={headCell}>Mid</th>
          <th style={headCell}>Premium</th>
          <th style={headCell}>Ann.</th>
          <th style={headCell}>Ann. bid</th>
          <th style={headCell}>Δ</th>
          <th style={headCell}>IV</th>
          <th style={headCell}>Spread</th>
          <th style={headCell}>OI</th>
          <th style={{ ...headCell, textAlign: "left" }}>Flags</th>
        </tr>
      </thead>
      <tbody>
        {rungs.map(rung => {
          const dim = rung.unpriced || rung.illiquid || rung.suppressed;
          // A rung whose listed grid has no strike at gross basis prices one
          // increment up. Its rate is then not comparable to the rest of the
          // ladder and it no longer returns zero appreciation, so it gets both
          // a colored strike and the dollars it would capture.
          const offBasis = rung.strike != null && rung.gain_if_assigned > 0;
          return (
            <tr key={`${rung.target_dte}-${rung.expiry}`} style={{ opacity: dim ? 0.55 : 1 }}>
              <td style={{ ...cell, textAlign: "left", color: theme.text.secondary }}>{rung.expiry ?? "—"}</td>
              <td style={{ ...cell, color: theme.text.secondary }}>{rung.dte ?? "—"}</td>
              <td style={{ ...cell, color: offBasis ? theme.amber : theme.text.secondary }}>
                {rung.strike == null ? "—" : `$${rung.strike}`}
              </td>
              <td style={{ ...cell, color: theme.text.secondary }}>{dollars(rung.mid)}</td>
              <td style={{ ...cell, color: theme.text.primary }}>{money(rung.premium)}</td>
              <td style={{
                ...cell,
                color: rung.qualifies ? theme.green : theme.text.muted,
                fontWeight: rung.qualifies ? 700 : 400,
              }}>
                {pct1(rung.ror_annualized)}
              </td>
              <td style={{ ...cell, color: theme.text.muted }}>{pct1(rung.ror_annualized_bid)}</td>
              <td style={{ ...cell, color: theme.text.muted }}>{delta2(rung.delta)}</td>
              <td style={{ ...cell, color: theme.text.muted }}>
                {rung.iv == null ? "—" : `${(rung.iv * 100).toFixed(0)}%`}
              </td>
              <td style={{ ...cell, color: rung.illiquid ? theme.amber : theme.text.muted }}>
                {rung.spread_pct == null ? "—" : `${(rung.spread_pct * 100).toFixed(1)}%`}
              </td>
              <td style={{ ...cell, color: theme.text.muted }}>
                {rung.open_interest == null ? "—" : rung.open_interest.toLocaleString()}
              </td>
              <td style={{ ...cell, textAlign: "left", color: theme.text.subtle, fontSize: theme.size.xs }}>
                {[
                  offBasis ? `+${money(rung.gain_if_assigned)} if assigned` : null,
                  rung.illiquid ? "illiquid" : null,
                  rung.suppressed ? "earnings" : null,
                  rung.unpriced ? "unpriced" : null,
                  rung.priced_from === "model" ? "modeled" : null,
                ].filter(Boolean).join(" · ") || "—"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * The strike ladder (§3.2) — the section that exists because a call struck at
 * gross basis returns exactly zero appreciation, and reporting only that rung
 * hides the trade.
 */
function StrikeLadder({ rung, grossBasis }) {
  const ladder = rung?.strike_ladder ?? [];
  if (!ladder.length) return null;

  return (
    <div style={{ marginTop: theme.space[3] }}>
      <div style={{
        color: theme.text.muted, fontSize: theme.size.xs, marginBottom: theme.space[1],
        textTransform: "uppercase", letterSpacing: "0.04em",
      }}>
        Strike ladder · {rung.expiry} ({rung.dte}d) · basis {dollars(grossBasis)}
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: theme.font.mono, fontSize: theme.size.sm }}>
        <thead>
          <tr>
            <th style={{ ...headCell, textAlign: "left" }}>Strike</th>
            <th style={headCell}>Mid</th>
            <th style={headCell}>Premium</th>
            <th style={headCell}>Ann.</th>
            <th style={headCell}>Δ</th>
            <th style={headCell}>Gain if assigned</th>
            <th style={headCell}>Total</th>
            <th style={headCell}>Spread</th>
            <th style={headCell}>OI</th>
          </tr>
        </thead>
        <tbody>
          {ladder.map(c => (
            <tr key={c.strike} style={{ opacity: c.illiquid ? 0.55 : 1 }}>
              <td style={{ ...cell, textAlign: "left", color: theme.text.primary }}>
                ${c.strike}
                {c.strike === rung.strike && (
                  <span style={{ color: theme.text.subtle, fontSize: theme.size.xs }}> basis</span>
                )}
              </td>
              <td style={{ ...cell, color: theme.text.secondary }}>{dollars(c.mid)}</td>
              <td style={{ ...cell, color: theme.text.secondary }}>{money(c.premium)}</td>
              <td style={{ ...cell, color: theme.text.muted }}>{pct1(c.ror_annualized)}</td>
              <td style={{ ...cell, color: theme.text.muted }}>{delta2(c.delta)}</td>
              <td style={{ ...cell, color: c.gain_if_assigned ? theme.green : theme.text.subtle }}>
                {money(c.gain_if_assigned)}
              </td>
              <td style={{ ...cell, color: theme.text.primary }}>{money(c.total_if_assigned)}</td>
              <td style={{ ...cell, color: c.illiquid ? theme.amber : theme.text.muted }}>
                {c.spread_pct == null ? "—" : `${(c.spread_pct * 100).toFixed(1)}%`}
              </td>
              <td style={{ ...cell, color: theme.text.muted }}>
                {c.open_interest == null ? "—" : c.open_interest.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ color: theme.text.faint, fontSize: theme.size.xs, marginTop: theme.space[1] }}>
        Reported, not ranked — what separates these strikes is preference about outcome shape, not edge.
      </div>
    </div>
  );
}

function PositionCard({ position }) {
  const [open, setOpen] = useState(position.tier === "RED");

  // Prefer the rung being pushed (or the best rate), but fall back to ANY rung
  // that actually carries a ladder. Matching on target_dte alone is not enough:
  // a rung exists whether or not its chain fetch succeeded, and modeled rungs
  // carry no ladder at all by design. Without the length check the §3.2 ladder
  // vanishes from the panel whenever the preferred rung happens to be the one
  // that came back bare — which is exactly when the appreciation trade it is
  // meant to expose would go unseen.
  const rungs      = position.rungs ?? [];
  const preferred  = rungs.find(r => r.target_dte === (position.push_rung ?? position.best_rate_rung));
  const ladderRung = (preferred?.strike_ladder?.length ? preferred : null)
    ?? rungs.find(r => (r.strike_ladder ?? []).length)
    ?? null;

  const blocked = position.push_blocked_reason
    ? BLOCK_REASON_LABEL[position.push_blocked_reason] ?? position.push_blocked_reason
    : null;

  return (
    <div style={{
      background: theme.bg.surface,
      border: `1px solid ${position.tier === "RED" ? theme.alert.dangerBorder : theme.border.default}`,
      borderRadius: theme.radius.md,
      padding: theme.space[3],
      marginBottom: theme.space[3],
    }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: "flex", alignItems: "center", gap: theme.space[3], cursor: "pointer", flexWrap: "wrap" }}
      >
        <span style={{ color: theme.text.primary, fontWeight: 700, fontSize: theme.size.md, fontFamily: theme.font.mono }}>
          {position.ticker}
        </span>
        <Badge tier={position.tier} />
        <span style={{ color: theme.text.muted, fontSize: theme.size.sm, fontFamily: theme.font.mono }}>
          {dollars(position.spot)} vs basis {dollars(position.gross_basis)} · K {formatKBasis(position)} · {position.contracts ?? 0}c
        </span>
        {position.k_basis_varies && (
          <span style={{ color: theme.amber, fontSize: theme.size.xs }}>
            mixed strikes — rates not comparable across rungs
          </span>
        )}
        {position.status !== "ok" && (
          <span style={{ color: theme.text.subtle, fontSize: theme.size.xs }}>
            {STATUS_LABEL[position.status] ?? position.status}
          </span>
        )}
        {blocked && (
          <span style={{ color: theme.amber, fontSize: theme.size.xs }}>no push — {blocked}</span>
        )}
        <span style={{ marginLeft: "auto", color: theme.text.subtle, fontSize: theme.size.xs }}>
          {open ? "collapse" : "expand"}
        </span>
      </div>

      {position.push_copy && (
        <div style={{
          marginTop: theme.space[2], color: theme.text.secondary,
          fontSize: theme.size.sm, fontFamily: theme.font.mono,
        }}>
          {position.push_copy}
        </div>
      )}

      {open && (
        <div style={{ marginTop: theme.space[3] }}>
          <RungTable position={position} />
          <StrikeLadder rung={ladderRung} grossBasis={position.gross_basis} />

          <div style={{
            marginTop: theme.space[3], display: "flex", gap: theme.space[4], flexWrap: "wrap",
            color: theme.text.muted, fontSize: theme.size.xs, fontFamily: theme.font.mono,
          }}>
            {/* Shadow instrumentation (§8) — colors the read, gates nothing. */}
            <span>IV {position.iv == null ? "—" : `${(position.iv * 100).toFixed(0)}%`}</span>
            <span>IV rank {position.iv_rank == null ? "—" : position.iv_rank.toFixed(1)}</span>
            <span>rank pctile 90d {position.iv_rank_pctile_90d == null ? "—" : position.iv_rank_pctile_90d.toFixed(2)}</span>
            <span>bb {position.bb_position == null ? "—" : position.bb_position.toFixed(2)}</span>
            <span>earnings {position.earnings_date ?? "—"}</span>
            <span>priced from {position.priced_from ?? "—"}</span>
            {position.event_move_implied && (
              <span>
                event ±{(position.event_move_implied.event_move_pct * 100).toFixed(1)}%
                {" "}(base IV {(position.event_move_implied.base_iv * 100).toFixed(0)}%
                {" → "}{dollars(position.event_move_implied.down_level)} / {dollars(position.event_move_implied.up_level)})
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function CcWritability() {
  const { data, loading, error } = useCcWritability();

  if (loading) {
    return (
      <div style={{ color: theme.text.muted, fontSize: theme.size.sm, padding: theme.space[3] }}>
        Loading covered-call writability…
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ color: theme.red, fontSize: theme.size.sm, padding: theme.space[3] }}>
        CC writability unavailable: {error}
      </div>
    );
  }

  const positions = data?.per_position ?? [];
  if (!positions.length) {
    return (
      <div style={{ color: theme.text.muted, fontSize: theme.size.sm, padding: theme.space[3] }}>
        No uncovered assigned positions — every share position has an active call.
      </div>
    );
  }

  // RED first, then AMBER, then the rest: the ones that need a decision sit on top.
  const rank = p => (p.tier === "RED" ? 0 : p.tier === "AMBER" ? 1 : 2);
  const sorted = [...positions].sort((a, b) => rank(a) - rank(b) || a.ticker.localeCompare(b.ticker));

  return (
    <div style={{ marginTop: theme.space[6] }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: theme.space[3], marginBottom: theme.space[3] }}>
        <h3 style={{ color: theme.text.primary, fontSize: theme.size.lg, margin: 0 }}>
          Covered-Call Writability
        </h3>
        <span style={{ color: theme.text.subtle, fontSize: theme.size.xs }}>
          30% annualized at gross basis · {sorted.filter(p => p.tier === "RED").length} red ·{" "}
          {sorted.filter(p => p.tier === "AMBER").length} amber
        </span>
        {data?.stale && (
          <span style={{ color: theme.amber, fontSize: theme.size.xs }}>stale — upstream unavailable</span>
        )}
        {data?.fetched_at && (
          <span style={{ marginLeft: "auto", color: theme.text.faint, fontSize: theme.size.xs }}>
            {new Date(data.fetched_at).toLocaleString()}
          </span>
        )}
      </div>

      {sorted.map(p => <PositionCard key={p.ticker} position={p} />)}
    </div>
  );
}

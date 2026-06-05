import { useMemo } from "react";
import { theme } from "../lib/theme";
import { useRadar } from "../hooks/useRadar";
import { bbBucket, BB_BUCKET_LABELS, BB_BUCKET_COLORS } from "../lib/bbBucket";
import { tickerExposure } from "../lib/exposure";
import { getAssignedShares, getOpenCSPs, getOpenLEAPs } from "../lib/positionSchema";
import { ON_THESIS_BASKETS, OFF_THESIS_BASKETS } from "../config/aiBaskets";

// ── Formatting helpers ─────────────────────────────────────────────────────────

function fmtK(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  return `${sign}$${Math.round(abs)}`;
}

function fmtNavPct(exposure, nav) {
  if (!nav || exposure == null) return null;
  return `${((exposure / nav) * 100).toFixed(1)}%`;
}

function fmtDay(pct) {
  if (pct == null) return "—";
  return `${pct >= 0 ? "+" : ""}${(pct * 100).toFixed(1)}%`;
}

// Translate a theme hex to rgba so Day% heat tints derive from the design tokens
// (theme.green / theme.red) rather than introducing new hardcoded colors.
function hexToRgba(hex, a) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function dayTint(pct) {
  if (pct == null || pct === 0) return "transparent";
  const alpha = Math.min(0.2, Math.abs(pct) * 4); // ~5% move → max tint
  return hexToRgba(pct > 0 ? theme.green : theme.red, alpha);
}

function dayColor(pct) {
  if (pct == null || pct === 0) return theme.text.muted;
  return pct > 0 ? theme.green : theme.red;
}

function mean(nums) {
  const vals = nums.filter(n => n != null);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// ── Data derivation ────────────────────────────────────────────────────────────

// Build per-ticker lookups from the positions object once.
function buildPositionIndex(positions) {
  const shares = new Map();
  for (const s of getAssignedShares(positions)) shares.set(s.ticker, s);
  const csps = new Map();
  for (const p of getOpenCSPs(positions)) {
    if (!csps.has(p.ticker)) csps.set(p.ticker, []);
    csps.get(p.ticker).push(p);
  }
  const leaps = new Map();
  for (const l of getOpenLEAPs(positions)) {
    if (!leaps.has(l.ticker)) leaps.set(l.ticker, []);
    leaps.get(l.ticker).push(l);
  }
  return { shares, csps, leaps };
}

function deriveBasket(basket, radarMap, posIndex) {
  const tickers = basket.tickers.map(t => {
    const row = radarMap.get(t) || null;
    const last = row?.last ?? null;
    const prev = row?.prev_close ?? null;
    const dayPct = last != null && prev != null && prev !== 0 ? (last - prev) / prev : null;

    const sharePos = posIndex.shares.get(t) ?? null;
    const csps = posIndex.csps.get(t) ?? [];
    const leaps = posIndex.leaps.get(t) ?? [];
    const held = !!sharePos || csps.length > 0 || leaps.length > 0;

    return {
      ticker: t,
      dayPct,
      ivr: row?.iv_rank ?? null,
      bb: row?.bb_position ?? null,
      held,
      exposure: tickerExposure(sharePos, csps, leaps),
    };
  });

  const exposure = tickers.reduce((sum, t) => sum + t.exposure, 0);
  const heldCount = tickers.filter(t => t.held).length;
  const momentum = mean(tickers.map(t => t.dayPct));
  const bbAvg = mean(tickers.map(t => t.bb));

  return { ...basket, tickers, exposure, heldCount, momentum, bbAvg };
}

// ── Subcomponents ──────────────────────────────────────────────────────────────

function SummaryChip({ label, value, valueColor }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 2,
      padding: `${theme.space[2]}px ${theme.space[3]}px`,
      background: theme.bg.surface,
      border: `1px solid ${theme.border.default}`,
      borderRadius: theme.radius.md,
      minWidth: 120,
    }}>
      <span style={{ fontSize: theme.size.xs, color: theme.text.subtle, textTransform: "uppercase", letterSpacing: "0.4px" }}>
        {label}
      </span>
      <span style={{ fontSize: theme.size.md, fontFamily: theme.font.mono, color: valueColor ?? theme.text.primary, fontWeight: 600 }}>
        {value}
      </span>
    </div>
  );
}

function Pill({ text, color, background }) {
  return (
    <span style={{
      fontSize: theme.size.xs, fontWeight: 600, color, background,
      borderRadius: theme.radius.pill, padding: "2px 8px", flexShrink: 0,
      fontFamily: theme.font.mono,
    }}>
      {text}
    </span>
  );
}

const ROW_GRID = "12px minmax(0, 1fr) 58px 40px 46px";

function TickerRow({ t }) {
  const bucket = bbBucket(t.bb);
  const dotColor = bucket ? BB_BUCKET_COLORS[bucket].text : theme.text.faint;
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: ROW_GRID,
      alignItems: "center",
      gap: theme.space[2],
      padding: `3px ${theme.space[2]}px`,
      background: dayTint(t.dayPct),
      borderRadius: theme.radius.sm,
    }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor }} title={bucket ? BB_BUCKET_LABELS[bucket] : "No BB data"} />
      <span style={{ display: "flex", alignItems: "center", gap: theme.space[1], minWidth: 0 }}>
        <span style={{
          fontSize: theme.size.sm,
          fontWeight: t.held ? 700 : 400,
          color: t.held ? theme.text.primary : theme.text.muted,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {t.ticker}
        </span>
        {t.held && (
          <span style={{ fontSize: theme.size.xs, flexShrink: 0 }} title="You hold a position in this name">📌</span>
        )}
      </span>
      <span style={{ fontSize: theme.size.sm, fontFamily: theme.font.mono, color: dayColor(t.dayPct), textAlign: "right" }}>
        {fmtDay(t.dayPct)}
      </span>
      <span style={{ fontSize: theme.size.sm, fontFamily: theme.font.mono, color: theme.text.muted, textAlign: "right" }}>
        {t.ivr != null ? Math.round(t.ivr) : "—"}
      </span>
      <span style={{ fontSize: theme.size.sm, fontFamily: theme.font.mono, color: theme.text.muted, textAlign: "right" }}>
        {t.bb != null ? t.bb.toFixed(2) : "—"}
      </span>
    </div>
  );
}

function BasketCard({ basket, nav }) {
  const { name, tickers, exposure, heldCount, momentum, bbAvg } = basket;
  const inBook = heldCount > 0;

  const accent = !inBook ? theme.border.strong
    : momentum == null ? theme.blue
    : momentum >= 0 ? theme.green
    : theme.red;

  const bucket = bbBucket(bbAvg);
  const navPct = fmtNavPct(exposure, nav);

  return (
    <div style={{
      background: theme.bg.surface,
      border: `1px solid ${theme.border.default}`,
      borderLeft: `3px solid ${accent}`,
      borderRadius: theme.radius.md,
      padding: theme.space[3],
      display: "flex", flexDirection: "column", gap: theme.space[2],
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: theme.space[2] }}>
        <span style={{ fontSize: theme.size.sm, fontWeight: 600, color: theme.text.primary }}>{name}</span>
        <div style={{ display: "flex", alignItems: "center", gap: theme.space[2], flexShrink: 0 }}>
          {inBook ? (
            <span style={{ fontSize: theme.size.xs, fontFamily: theme.font.mono, color: theme.text.secondary }}>
              {fmtK(exposure)}{navPct ? ` · ${navPct} NAV` : ""}
            </span>
          ) : (
            <span style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>Not in book</span>
          )}
          {momentum != null && (
            <Pill
              text={fmtDay(momentum)}
              color={dayColor(momentum)}
              background={dayTint(momentum) === "transparent" ? theme.bg.elevated : dayTint(momentum)}
            />
          )}
        </div>
      </div>

      {/* Column headers */}
      <div style={{
        display: "grid", gridTemplateColumns: ROW_GRID, gap: theme.space[2],
        padding: `0 ${theme.space[2]}px`,
        fontSize: theme.size.xs, color: theme.text.subtle, textTransform: "uppercase", letterSpacing: "0.4px",
      }}>
        <span />
        <span>Ticker</span>
        <span style={{ textAlign: "right" }}>Day</span>
        <span style={{ textAlign: "right" }}>IVR</span>
        <span style={{ textAlign: "right" }}>BB</span>
      </div>

      {/* Ticker rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {tickers.map(t => <TickerRow key={t.ticker} t={t} />)}
      </div>

      {/* Footer: basket BB avg */}
      <div style={{ display: "flex", alignItems: "center", gap: theme.space[2], marginTop: 2 }}>
        <span style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>Basket BB avg</span>
        <span style={{ fontSize: theme.size.sm, fontFamily: theme.font.mono, color: theme.text.secondary }}>
          {bbAvg != null ? bbAvg.toFixed(2) : "—"}
        </span>
        {bucket && (
          <Pill text={BB_BUCKET_LABELS[bucket]} color={BB_BUCKET_COLORS[bucket].text} background={BB_BUCKET_COLORS[bucket].bg} />
        )}
      </div>
    </div>
  );
}

const LEGEND = [
  ["Below <0", "below_band"],
  ["Near lower 0–0.20", "near_lower"],
  ["Mid 0.20–0.80", "mid_range"],
  ["Near upper 0.80–1.0", "near_upper"],
  ["Above >1.0", "above_band"],
];

// ── Main component ─────────────────────────────────────────────────────────────

export function AIThesisTab({ positions, account }) {
  const { rows, loading, error } = useRadar();

  const { onThesis, offThesisTotal, onThesisTotal, basketsActive } = useMemo(() => {
    const radarMap = new Map((rows || []).map(r => [r.ticker, r]));
    const posIndex = buildPositionIndex(positions);
    const onThesis = ON_THESIS_BASKETS.map(b => deriveBasket(b, radarMap, posIndex));
    const offThesis = OFF_THESIS_BASKETS.map(b => deriveBasket(b, radarMap, posIndex));
    return {
      onThesis,
      onThesisTotal: onThesis.reduce((s, b) => s + b.exposure, 0),
      offThesisTotal: offThesis.reduce((s, b) => s + b.exposure, 0),
      basketsActive: onThesis.filter(b => b.heldCount > 0).length,
    };
  }, [rows, positions]);

  const nav = account?.account_value ?? null;
  const cashPct = account?.free_cash_pct_est ?? null;
  const cash = nav != null && cashPct != null ? nav * cashPct : null;

  if (error) {
    return <div style={{ padding: theme.space[5], color: theme.red, fontSize: theme.size.sm }}>Failed to load radar data: {error}</div>;
  }

  return (
    <div>
      {/* Summary strip */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: theme.space[2], marginBottom: theme.space[3] }}>
        <SummaryChip label="On-thesis AI infra" value={`${fmtK(onThesisTotal)}${fmtNavPct(onThesisTotal, nav) ? ` · ${fmtNavPct(onThesisTotal, nav)}` : ""}`} valueColor={theme.green} />
        <SummaryChip label="Off-thesis" value={`${fmtK(offThesisTotal)}${fmtNavPct(offThesisTotal, nav) ? ` · ${fmtNavPct(offThesisTotal, nav)}` : ""}`} valueColor={theme.amber} />
        <SummaryChip label="Cash" value={`${fmtK(cash)}${cashPct != null ? ` · ${(cashPct * 100).toFixed(0)}%` : ""}`} />
        <SummaryChip label="Total NAV" value={fmtK(nav)} />
        <SummaryChip label="Baskets active" value={`${basketsActive} of ${ON_THESIS_BASKETS.length}`} />
      </div>

      <div style={{ fontSize: theme.size.sm, color: theme.text.muted, marginBottom: theme.space[3] }}>
        Cards show on-thesis AI infrastructure baskets only · off-thesis concentration shown in the summary above.
      </div>

      {/* Legend */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: theme.space[3], marginBottom: theme.space[3], fontSize: theme.size.xs, color: theme.text.subtle }}>
        {LEGEND.map(([label, bucket]) => (
          <span key={bucket} style={{ display: "inline-flex", alignItems: "center", gap: theme.space[1] }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: BB_BUCKET_COLORS[bucket].text }} />
            {label}
          </span>
        ))}
        <span style={{ color: theme.text.faint }}>· 📌 Bold = held</span>
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ padding: theme.space[5], color: theme.text.muted, fontSize: theme.size.sm, textAlign: "center" }}>Loading…</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: theme.space[3] }}>
          {onThesis.map(b => <BasketCard key={b.id} basket={b} nav={nav} />)}
        </div>
      )}
    </div>
  );
}

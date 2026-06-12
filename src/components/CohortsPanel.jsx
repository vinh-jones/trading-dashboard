import { useEffect, useMemo, useState } from "react";
import { theme } from "../lib/theme";
import { formatDollarsFull, formatExpiry } from "../lib/format";
import { resolveCohort, cohortScoreboard, memberCapturePct, cohortCaptureSeries } from "../lib/cohorts";

const BLUE_BORDER = "rgba(58,130,246,0.40)";

function labelStyle() {
  return {
    fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase",
    letterSpacing: "0.5px", fontWeight: 500, marginBottom: 2,
  };
}

function Stat({ label, value, color }) {
  return (
    <div>
      <div style={labelStyle()}>{label}</div>
      <div style={{ fontSize: theme.size.md, fontWeight: 600, color: color ?? theme.text.primary, whiteSpace: "nowrap" }}>
        {value}
      </div>
    </div>
  );
}

function StatusBadge({ openCount, memberCount }) {
  const allClosed = openCount === 0;
  return (
    <span style={{
      fontSize: theme.size.xs, borderRadius: theme.radius.pill, padding: "1px 8px",
      color: allClosed ? theme.text.muted : theme.green,
      border: `1px solid ${allClosed ? theme.border.default : `${theme.green}66`}`,
      background: allClosed ? "transparent" : `${theme.green}18`,
      whiteSpace: "nowrap",
    }}>
      {allClosed ? "closed" : `${openCount} open${memberCount > openCount ? ` · ${memberCount - openCount} closed` : ""}`}
    </span>
  );
}

// Hand-rolled SVG line, same spirit as the allocation chart — no chart library.
function EvolutionChart({ series }) {
  if (!series.length) {
    return (
      <div style={{ padding: theme.space[3], color: theme.text.subtle, fontSize: theme.size.sm }}>
        No history yet — the chart fills in as daily snapshots accumulate.
      </div>
    );
  }
  const W = 600, H = 140, PAD = 6;
  const ys = series.map(p => p.capturePct);
  const yMin = Math.min(0, ...ys), yMax = Math.max(100, ...ys);
  const x = i => series.length === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (series.length - 1);
  const y = v => H - PAD - ((v - yMin) * (H - 2 * PAD)) / (yMax - yMin || 1);
  const points = series.map((p, i) => `${x(i)},${y(p.capturePct)}`).join(" ");
  const last = series[series.length - 1];
  return (
    <div>
      <div style={{ ...labelStyle(), marginBottom: theme.space[1] }}>
        Capture % over time — now {last.capturePct.toFixed(1)}%
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
        <line x1={PAD} x2={W - PAD} y1={y(0)} y2={y(0)} stroke={theme.border.strong} strokeWidth="1" />
        <line x1={PAD} x2={W - PAD} y1={y(100)} y2={y(100)} stroke={theme.border.default} strokeWidth="1" strokeDasharray="4 4" />
        <polyline points={points} fill="none" stroke={theme.blue} strokeWidth="2" />
        {series.length === 1 && (
          <circle cx={x(0)} cy={y(series[0].capturePct)} r="3" fill={theme.blue} />
        )}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: theme.size.xs, color: theme.text.subtle }}>
        <span>{series[0].date}</span>
        <span>0% — solid · 100% — dashed</span>
        <span>{last.date}</span>
      </div>
    </div>
  );
}

function CohortDetail({ cohort, quoteMap, isMobile, onBack, onDelete, deleting }) {
  const { tag, name, members, unresolved, createdAt, scoreboard: sb } = cohort;
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    setHistoryError(null);
    (async () => {
      try {
        const res = await fetch(`/api/cohort-history?tag=${encodeURIComponent(tag)}`);
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
        if (!cancelled) setHistory(json.data ?? []);
      } catch (err) {
        if (!cancelled) setHistoryError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [tag]);

  const series = useMemo(
    () => (history ? cohortCaptureSeries(members, history) : []),
    [history, members],
  );

  const capturedColor = sb.captured == null ? theme.text.muted : sb.captured >= 0 ? theme.green : theme.red;

  const cell = (content, style = {}) => (
    <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, ...style }}>{content}</td>
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: theme.space[2], marginBottom: theme.space[3], flexWrap: "wrap" }}>
        <button
          onClick={onBack}
          style={{ background: "transparent", border: "none", padding: 0, color: theme.text.muted, cursor: "pointer", fontSize: theme.size.sm, fontFamily: "inherit" }}
        >
          ← Cohorts
        </button>
        <span style={{ color: theme.blue, fontWeight: 700, fontSize: theme.size.md }}>{name}</span>
        {createdAt && (
          <span style={{ color: theme.text.subtle, fontSize: theme.size.xs }}>
            created {String(createdAt).slice(0, 10)}
          </span>
        )}
        <button
          onClick={onDelete}
          disabled={deleting}
          style={{ marginLeft: "auto", background: "transparent", border: "none", padding: 0, color: theme.red, cursor: "pointer", fontSize: theme.size.sm, fontFamily: "inherit", opacity: deleting ? 0.5 : 1 }}
        >
          {deleting ? "deleting…" : "✕ delete"}
        </button>
      </div>

      <div style={{
        display: "flex", gap: theme.space[5], flexWrap: "wrap",
        background: theme.bg.elevated, border: `1px solid ${BLUE_BORDER}`,
        borderRadius: theme.radius.md, padding: `${theme.space[2]}px ${theme.space[4]}px`,
        marginBottom: theme.space[4],
      }}>
        <Stat label="Members" value={`${sb.memberCount} (${sb.openCount} open)`} color={theme.blue} />
        <Stat
          label="Collateral"
          value={<>
            {formatDollarsFull(sb.collateral)}
            {sb.collateralPct != null && (
              <span style={{ color: theme.text.muted, fontWeight: 400 }}> ({sb.collateralPct.toFixed(1)}%)</span>
            )}
          </>}
        />
        <Stat label="Max premium" value={formatDollarsFull(sb.maxPremium)} color={theme.green} />
        <Stat
          label="Captured"
          value={<>
            {sb.captured != null ? formatDollarsFull(sb.captured) : "—"}
            {sb.capturePct != null && (
              <span style={{ color: theme.text.muted, fontWeight: 400 }}> ({sb.capturePct.toFixed(1)}%)</span>
            )}
          </>}
          color={capturedColor}
        />
        {sb.missingMarkCount > 0 && (
          <span style={{ alignSelf: "center", fontSize: theme.size.xs, color: theme.text.subtle }}>
            *{sb.missingMarkCount} no mark
          </span>
        )}
      </div>

      <div style={{ overflowX: "auto", marginBottom: theme.space[4] }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: theme.size.md }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${theme.border.strong}` }}>
              {["Member", "Status", "Premium", "Capture"].map(h => (
                <th key={h} style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, fontSize: theme.size.xs, color: theme.text.muted, fontWeight: 500, letterSpacing: "0.5px", textAlign: h === "Member" ? "left" : "right", textTransform: "uppercase" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohort.members.map((m, i) => {
              const cap = memberCapturePct(m, quoteMap);
              const capColor = cap == null ? theme.text.muted : cap >= 0 ? theme.green : theme.red;
              return (
                <tr key={`${m.ticker}|${m.strike}|${m.expiry}`} style={{ borderBottom: `1px solid ${theme.border.default}` }}>
                  {cell(
                    <span style={{ fontWeight: 700, color: theme.text.primary }}>
                      {m.ticker} ${m.strike} {!isMobile && m.expiry ? formatExpiry(m.expiry) : ""}
                    </span>
                  )}
                  {cell(
                    m.status === "open"
                      ? <span style={{ color: theme.green }}>open</span>
                      : <span style={{ color: theme.text.muted }}>closed {m.closeDate ? String(m.closeDate).slice(5) : ""}</span>,
                    { textAlign: "right" }
                  )}
                  {cell(formatDollarsFull(m.premiumCollected), { color: theme.green, fontWeight: 600, textAlign: "right" })}
                  {cell(cap != null ? `${cap.toFixed(1)}%` : "—", { color: capColor, fontWeight: 600, textAlign: "right" })}
                </tr>
              );
            })}
            {cohort.unresolved.map((u, i) => (
              <tr key={`u-${u.ticker}|${u.strike}|${u.expiry}`} style={{ borderBottom: `1px solid ${theme.border.default}` }}>
                {cell(<span style={{ color: theme.text.muted }}>{u.ticker} ${u.strike}</span>)}
                {cell(<span style={{ color: theme.amber, fontSize: theme.size.sm }}>unresolved</span>, { textAlign: "right" })}
                {cell("—", { textAlign: "right", color: theme.text.muted })}
                {cell("—", { textAlign: "right", color: theme.text.muted })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {historyError
        ? <div style={{ color: theme.text.subtle, fontSize: theme.size.sm }}>History unavailable: {historyError}</div>
        : history == null
          ? <div style={{ color: theme.text.subtle, fontSize: theme.size.sm }}>Loading history…</div>
          : <EvolutionChart series={series} />}
    </div>
  );
}

/**
 * Cohort list + detail. Mounted by OpenPositionsTab when the Cohorts pill is
 * active. Membership source of truth: journal entries with cohort:* tags.
 */
export function CohortsPanel({ cohortEntries, openCsps, trades, quoteMap, accountValue, isMobile, selectedTag, onSelectTag, onCohortsChanged }) {
  const [deleting, setDeleting] = useState(false);

  const cohorts = useMemo(() => {
    const tags = [...new Set(
      cohortEntries.flatMap(e => (e.tags ?? []).filter(t => t.startsWith("cohort:")))
    )];
    return tags.map(tag => {
      const resolved = resolveCohort(tag, { openPositions: openCsps, trades, entries: cohortEntries });
      return {
        tag,
        name: tag.slice("cohort:".length),
        ...resolved,
        scoreboard: cohortScoreboard(resolved.members, quoteMap, accountValue),
      };
    }).sort((a, b) => {
      const aActive = a.scoreboard.openCount > 0 ? 0 : 1;
      const bActive = b.scoreboard.openCount > 0 ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""));
    });
  }, [cohortEntries, openCsps, trades, quoteMap, accountValue]);

  const selected = cohorts.find(c => c.tag === selectedTag) ?? null;

  async function handleDelete() {
    if (!selected) return;
    const entryCount = cohortEntries.filter(e => (e.tags ?? []).includes(selected.tag)).length;
    if (!window.confirm(`Delete cohort "${selected.name}"? This removes its tag from ${entryCount} journal entr${entryCount === 1 ? "y" : "ies"} (entries with no other tags are deleted).`)) return;
    setDeleting(true);
    try {
      const memberEntries = cohortEntries.filter(e => (e.tags ?? []).includes(selected.tag));
      for (const e of memberEntries) {
        const newTags = e.tags.filter(t => t !== selected.tag);
        if (newTags.length === 0) {
          const res = await fetch(`/api/journal-entry?id=${encodeURIComponent(e.id)}`, { method: "DELETE" });
          const json = await res.json();
          if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
        } else {
          // NEVER include `source` in PATCH fields — the API propagates it to positions.
          const res = await fetch("/api/journal-entry", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: e.id, fields: { tags: newTags, updated_at: new Date().toISOString() } }),
          });
          const json = await res.json();
          if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
        }
      }
      onSelectTag(null);
    } catch (err) {
      window.alert(`Delete failed: ${err.message}`);
    } finally {
      onCohortsChanged();
      setDeleting(false);
    }
  }

  if (selected) {
    return (
      <CohortDetail
        cohort={selected}
        quoteMap={quoteMap}
        isMobile={isMobile}
        onBack={() => onSelectTag(null)}
        onDelete={handleDelete}
        deleting={deleting}
      />
    );
  }

  if (!cohorts.length) {
    return (
      <div style={{ fontSize: theme.size.sm, color: theme.text.subtle, padding: "12px 0" }}>
        No cohorts yet. Select CSP rows and use "Save as cohort" in the selection bar.
      </div>
    );
  }

  return (
    <div>
      {cohorts.map(c => {
        const sb = c.scoreboard;
        const capColor = sb.captured == null ? theme.text.muted : sb.captured >= 0 ? theme.green : theme.red;
        return (
          <div
            key={c.tag}
            onClick={() => onSelectTag(c.tag)}
            style={{
              display: "flex", alignItems: "baseline", gap: theme.space[3], flexWrap: "wrap",
              padding: `${theme.space[2]}px 0`, borderBottom: `1px solid ${theme.border.default}`,
              cursor: "pointer",
            }}
          >
            <span style={{ color: theme.blue, fontWeight: 700 }}>{c.name}</span>
            <StatusBadge openCount={sb.openCount} memberCount={sb.memberCount} />
            <span style={{ color: theme.text.muted, fontSize: theme.size.sm }}>
              {sb.capturePct != null ? `capture ${sb.capturePct.toFixed(0)}%` : "capture —"}
            </span>
            <span style={{ color: capColor, fontWeight: 600 }}>
              {sb.captured != null ? formatDollarsFull(sb.captured) : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

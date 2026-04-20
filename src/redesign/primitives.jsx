import { T } from "./theme.js";

// Corner register mark — the aesthetic anchor of every Frame.
export function Corner({ pos, color }) {
  const size = 6, off = -1;
  const s = {
    tl: { top: off, left: off,   borderTop:    `1px solid ${color}`, borderLeft:   `1px solid ${color}` },
    tr: { top: off, right: off,  borderTop:    `1px solid ${color}`, borderRight:  `1px solid ${color}` },
    bl: { bottom: off, left: off,  borderBottom: `1px solid ${color}`, borderLeft:   `1px solid ${color}` },
    br: { bottom: off, right: off, borderBottom: `1px solid ${color}`, borderRight:  `1px solid ${color}` },
  }[pos];
  return <div style={{ position: "absolute", width: size, height: size, pointerEvents: "none", ...s }} />;
}

// Instrument panel frame — titled, cornered, terminal chrome.
export function Frame({ title, subtitle, right, children, accent = "default", style = {}, pad = 16 }) {
  const accentColor = {
    default: T.bdS,
    posture: T.post,
    focus:   T.blue,
    radar:   T.cyan,
    journal: T.mag,
    danger:  T.red,
    warn:    T.amber,
    ok:      T.green,
    quiet:   T.bd,
  }[accent] ?? T.bdS;
  const titleColor = accent === "quiet" ? T.tm : accentColor;

  return (
    <div style={{
      position: "relative",
      background: `linear-gradient(180deg, ${T.surf} 0%, ${T.deep} 100%)`,
      border: `1px solid ${T.bd}`,
      borderRadius: T.rMd,
      padding: pad,
      ...style,
    }}>
      <Corner pos="tl" color={accentColor} />
      <Corner pos="tr" color={accentColor} />
      <Corner pos="bl" color={accentColor} />
      <Corner pos="br" color={accentColor} />

      {(title || right) && (
        <div style={{
          display: "flex", alignItems: "baseline",
          justifyContent: "space-between", gap: 12,
          marginBottom: title ? 14 : 0,
        }}>
          <div>
            {title && (
              <div style={{
                fontSize: T.xs, letterSpacing: "0.18em", textTransform: "uppercase",
                color: titleColor, fontWeight: 600,
              }}>
                <span style={{ opacity: 0.6, marginRight: 6 }}>▸</span>{title}
              </div>
            )}
            {subtitle && (
              <div style={{ fontSize: T.xs, color: T.ts, marginTop: 3 }}>{subtitle}</div>
            )}
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

// Monospaced value with a label above it.
export function Datum({ label, value, sub, color, align = "left", size = 16 }) {
  return (
    <div style={{ textAlign: align, minWidth: 0 }}>
      <div style={{ fontSize: T.xs, letterSpacing: "0.15em", textTransform: "uppercase", color: T.tm, marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontSize: size, color: color || T.t1, fontWeight: 500, fontFamily: T.mono, letterSpacing: "-0.01em" }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: T.xs, color: T.ts, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// Semantic pill badge.
export function Pill({ children, color = T.tm, bg, border }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: T.xs, letterSpacing: "0.08em", textTransform: "uppercase",
      padding: "2px 7px",
      border: `1px solid ${border || color}`,
      background: bg || "transparent",
      color, borderRadius: T.rSm,
      fontFamily: T.mono,
    }}>
      {children}
    </span>
  );
}

// Section divider with hairline — groups clusters of frames.
export function SectionLabel({ label, right, color }) {
  const c = color || T.tm;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      fontSize: T.xs, letterSpacing: "0.22em", textTransform: "uppercase",
      color: c, fontWeight: 600, paddingTop: 2, minWidth: 0,
    }}>
      <span style={{ opacity: 0.5 }}>▸</span>
      <span style={{ whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ flex: 1, height: 1, background: T.hair, minWidth: 12 }} />
      {right && <span style={{ fontSize: T.xs, color: T.tf, letterSpacing: "0.1em", whiteSpace: "nowrap" }}>{right}</span>}
    </div>
  );
}

// Empty state — terminal-styled placeholder for no-data frames.
export function Empty({ glyph = "○", title, body, ctas = [], accent = "default", compact = false, tone = "neutral" }) {
  const accentColor = {
    default: T.tm, focus: T.blue, radar: T.cyan, journal: T.mag,
    posture: T.post, amber: T.amber, green: T.green, quiet: T.tf,
  }[accent] || T.tm;

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: compact ? "28px 20px" : "56px 24px",
      textAlign: "center", fontFamily: T.mono,
    }}>
      <div style={{
        width: compact ? 38 : 54, height: compact ? 38 : 54,
        border: `1px solid ${accentColor}55`, borderRadius: T.rSm,
        background: accentColor + "08",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: compact ? 18 : 26, color: accentColor,
        marginBottom: compact ? 14 : 18,
      }}>{glyph}</div>
      <div style={{ fontSize: compact ? T.sm : T.md, color: T.t1, marginBottom: 6, maxWidth: 460 }}>{title}</div>
      {body && (
        <div style={{ fontSize: compact ? T.xs : T.sm, color: T.tm, lineHeight: 1.55, maxWidth: 420, marginBottom: ctas.length ? 16 : 0 }}>
          {body}
        </div>
      )}
      {ctas.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap", justifyContent: "center" }}>
          {ctas.map((c, i) => (
            <button key={i} onClick={c.onClick} style={{
              padding: "5px 12px",
              border: `1px solid ${c.primary ? accentColor : T.bd}`,
              background: c.primary ? accentColor + "18" : "transparent",
              color: c.primary ? accentColor : T.t2,
              fontSize: T.xs, fontFamily: T.mono, letterSpacing: "0.08em", fontWeight: 600,
              cursor: "pointer", borderRadius: T.rSm,
            }}>{c.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// Type tag badge (CSP / CC / LEAPS / Shares)
export function TypeTag({ t }) {
  const colors = {
    CSP:    { c: T.blue,  b: T.blue  + "44" },
    CC:     { c: T.green, b: T.green + "44" },
    LEAPS:  { c: T.mag,   b: T.mag   + "44" },
    LEAP:   { c: T.mag,   b: T.mag   + "44" },
    Shares: { c: T.red,   b: T.red   + "44" },
  }[t] || { c: T.tm, b: T.bd };
  return (
    <span style={{
      fontSize: T.xs, padding: "2px 6px",
      border: `1px solid ${colors.b}`,
      color: colors.c, fontWeight: 600,
      letterSpacing: "0.1em", borderRadius: T.rSm, textAlign: "center",
      fontFamily: T.mono,
    }}>{t}</span>
  );
}

// Signed number formatter
export function signed(n, pct = false, d = 0) {
  if (n == null) return "—";
  const sign = n > 0 ? "+" : "";
  return pct
    ? `${sign}${n.toFixed(d)}%`
    : `${sign}${n.toLocaleString(undefined, { maximumFractionDigits: d })}`;
}

export function dollars(n) {
  if (n == null) return "—";
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.abs(n).toFixed(0)}`;
}

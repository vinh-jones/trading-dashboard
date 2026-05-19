import { useState, useEffect } from "react";
import { theme } from "../lib/theme";
import { getStoredSecret, setSecret } from "../lib/auth";

// Gates the whole app behind the shared APP_SECRET in production. Dev builds
// never call /api, so the gate is a no-op there.
export function AuthGate({ children }) {
  const [authed, setAuthed] = useState(
    () => !import.meta.env.PROD || !!getStoredSecret()
  );
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    function onAuthRequired() {
      setError("Session expired — re-enter the access key.");
      setAuthed(false);
    }
    window.addEventListener("app-auth-required", onAuthRequired);
    return () => window.removeEventListener("app-auth-required", onAuthRequired);
  }, []);

  if (authed) return children;

  function submit(e) {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    setSecret(v);
    setError("");
    setValue("");
    setAuthed(true);
  }

  return (
    <div style={{
      fontFamily:     theme.font.mono,
      background:      theme.bg.base,
      color:           theme.text.secondary,
      minHeight:       "100vh",
      display:         "flex",
      alignItems:      "center",
      justifyContent:  "center",
      padding:         theme.space[5],
    }}>
      <form onSubmit={submit} style={{
        background:    theme.bg.surface,
        border:        `1px solid ${theme.border.default}`,
        borderRadius:  theme.radius.md,
        padding:       theme.space[6],
        width:         320,
        maxWidth:      "100%",
      }}>
        <h1 style={{
          fontSize:     theme.size.lg,
          fontWeight:   600,
          color:        theme.text.primary,
          margin:       0,
          marginBottom: theme.space[2],
          letterSpacing:"0.5px",
        }}>
          TRADE DASHBOARD
        </h1>
        <p style={{
          fontSize:     theme.size.sm,
          color:        theme.text.muted,
          margin:       0,
          marginBottom: theme.space[4],
        }}>
          Enter access key to continue.
        </p>
        <input
          type="password"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Access key"
          style={{
            width:        "100%",
            boxSizing:    "border-box",
            background:   theme.bg.base,
            border:       `1px solid ${theme.border.default}`,
            borderRadius: theme.radius.sm,
            color:        theme.text.primary,
            fontFamily:   theme.font.mono,
            fontSize:     theme.size.md,
            padding:      `${theme.space[2]}px ${theme.space[3]}px`,
            marginBottom: theme.space[3],
          }}
        />
        {error && (
          <div style={{
            fontSize:     theme.size.sm,
            color:        theme.red,
            marginBottom: theme.space[3],
          }}>
            {error}
          </div>
        )}
        <button type="submit" style={{
          width:        "100%",
          background:   theme.blueBold,
          border:       "none",
          borderRadius: theme.radius.sm,
          color:        "#ffffff",
          fontFamily:   theme.font.mono,
          fontSize:     theme.size.md,
          fontWeight:   600,
          padding:      `${theme.space[2]}px ${theme.space[3]}px`,
          cursor:       "pointer",
        }}>
          Unlock
        </button>
      </form>
    </div>
  );
}

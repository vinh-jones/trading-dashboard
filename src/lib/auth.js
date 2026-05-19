// Single-user auth: the SPA holds a shared secret and presents it to the
// APP_SECRET gate in middleware.js. The secret is mirrored into a same-origin
// cookie so existing fetch("/api/...") call sites need no changes.

const KEY = "app_auth";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export function getStoredSecret() {
  try {
    return localStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
}

function writeCookie(secret) {
  const attrs = "path=/; SameSite=Strict; Secure; max-age=" + COOKIE_MAX_AGE;
  document.cookie = `${KEY}=${encodeURIComponent(secret)}; ${attrs}`;
}

export function applyAuthCookie() {
  const s = getStoredSecret();
  if (s) writeCookie(s);
}

export function setSecret(secret) {
  try {
    localStorage.setItem(KEY, secret);
  } catch {
    /* ignore */
  }
  writeCookie(secret);
}

export function clearSecret() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  document.cookie = `${KEY}=; path=/; SameSite=Strict; Secure; max-age=0`;
}

// Wrap window.fetch once so any 401 from a same-origin /api/ call forces a
// re-prompt instead of silently rendering an empty dashboard.
let installed = false;
export function installFetchInterceptor() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await orig(input, init);
    try {
      const url = typeof input === "string" ? input : input?.url || "";
      if (res.status === 401 && url.includes("/api/")) {
        clearSecret();
        window.dispatchEvent(new Event("app-auth-required"));
      }
    } catch {
      /* never let interception break a request */
    }
    return res;
  };
}

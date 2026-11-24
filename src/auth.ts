// GitHub sign-in (OAuth App). The token lives in sessionStorage: it's gone when the tab closes.
// Local dev (`npm run dev`) skips sign-in: the dev server proxies GitHub with your own token.
// The deployed app gets its client ID from GET /api/oauth (see api/oauth.ts).

const TOKEN_KEY = "gh_token";
const STATE_KEY = "gh_oauth_state";
// repo: issues in private game repos; read:org: membership check; project: Projects read/write.
const SCOPES = "repo read:org project";

export const usesDevProxy = import.meta.env.DEV;

// Public settings from the Vercel function (GET /api/oauth), so nothing has to be baked into
// the page at build time: the client ID and an optional hub.config.json branch.
let settings = { clientId: "", configRef: "" };

export async function loadSettings(): Promise<void> {
  if (usesDevProxy) return;
  try {
    const res = await fetch("/api/oauth");
    if (res.ok) settings = { ...settings, ...(await res.json()) };
  } catch {
    /* sign-in will report it */
  }
}

/** Git ref to read games' hub.config.json from: .env.local in dev, HUB_CONFIG_REF on Vercel, else HEAD. */
export const configRef = () => import.meta.env.VITE_HUB_CONFIG_REF || settings.configRef || "HEAD";

export function signIn(): void {
  const clientId = settings.clientId;
  if (!clientId) {
    alert("Sign-in isn't set up: GITHUB_CLIENT_ID is missing in Vercel.");
    return;
  }
  const state = crypto.randomUUID();
  sessionStorage.setItem(STATE_KEY, state);
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", window.location.origin + "/");
  window.location.assign(url.toString());
}

export function signOut(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  window.location.assign("/");
}

/** If GitHub just sent us back with ?code=…, swap it for a token. Returns an error message or null. */
export async function finishSignIn(): Promise<string | null> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return params.get("error_description");
  const expected = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  window.history.replaceState(null, "", "/");
  if (!expected || params.get("state") !== expected) return "Sign-in was interrupted. Try again.";
  const res = await fetch("/api/oauth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!data.token) return data.error ?? `Sign-in failed (${res.status})`;
  sessionStorage.setItem(TOKEN_KEY, data.token);
  return null;
}

export function hasToken(): boolean {
  try {
    return !!sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return false;
  }
}

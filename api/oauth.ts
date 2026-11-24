// Vercel function: swaps GitHub's one-time login code for an access token.
// The client secret stays here, in Vercel's environment variables, never in the repo or the browser.
//
// Env (set in Vercel → Project → Settings → Environment Variables; all can be Sensitive):
//   GITHUB_CLIENT_ID      the OAuth App's client ID
//   GITHUB_CLIENT_SECRET  the OAuth App's client secret
//   HUB_CONFIG_REF        optional: branch to read games' hub.config.json from instead of the default branch
// (VITE_GITHUB_CLIENT_ID / VITE_HUB_CONFIG_REF are accepted too.)

const clientId = () => process.env.GITHUB_CLIENT_ID || process.env.VITE_GITHUB_CLIENT_ID || "";
const configRef = () => process.env.HUB_CONFIG_REF || process.env.VITE_HUB_CONFIG_REF || "";

/** Public settings the page needs before sign-in. The client ID is public by design. */
export async function GET(): Promise<Response> {
  return json({ clientId: clientId(), configRef: configRef() }, 200);
}

export async function POST(request: Request): Promise<Response> {
  const id = clientId();
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!id || !clientSecret) return json({ error: "Sign-in isn't set up: GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET missing in Vercel." }, 500);

  let code: unknown;
  try {
    code = ((await request.json()) as { code?: unknown }).code;
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  if (typeof code !== "string" || !code || code.length > 200) return json({ error: "Missing code" }, 400);

  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: id, client_secret: clientSecret, code }),
  });
  const data = (await res.json()) as { access_token?: string; error_description?: string };
  if (!data.access_token) return json({ error: data.error_description ?? "GitHub refused the login code" }, 400);
  return json({ token: data.access_token }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

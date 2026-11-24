// Vercel function: swaps GitHub's one-time login code for an access token.
// The client secret stays here, in Vercel's environment variables, never in the repo or the browser.
//
// Env (set in Vercel → Project → Settings → Environment Variables):
//   VITE_GITHUB_CLIENT_ID  the OAuth App's client ID (public; the page uses it too)
//   GITHUB_CLIENT_SECRET   the OAuth App's client secret
//   GITHUB_CLIENT_ID       optional; overrides VITE_GITHUB_CLIENT_ID here

export async function POST(request: Request): Promise<Response> {
  const clientId = process.env.GITHUB_CLIENT_ID || process.env.VITE_GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return json({ error: "Sign-in isn't set up: VITE_GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET missing in Vercel." }, 500);

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
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
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

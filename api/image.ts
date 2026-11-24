// Vercel function: generate one concept image for a model task. Provider keys stay in Vercel env vars.
// Only signed-in members of the PGP-studio organization may call it.

import { generate, NotSetUp, validate } from "./_images.js"; // ".js": Vercel runs functions as ES modules

export const config = { maxDuration: 60 };

const ORG = "PGP-studio";

export async function POST(request: Request): Promise<Response> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign in first." }, 401);
  const member = await fetch(`https://api.github.com/user/memberships/orgs/${ORG}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "studio-hub" },
  });
  const state = member.ok ? ((await member.json()) as { state?: string }).state : undefined;
  if (state !== "active") return json({ error: `Only members of ${ORG} can generate images.` }, 403);

  const req = validate(await request.json().catch(() => null));
  if (typeof req === "string") return json({ error: req }, 400);
  try {
    const out = await generate(req, process.env);
    return new Response(out.image, { status: 200, headers: { "Content-Type": out.contentType, "Cache-Control": "no-store" } });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, e instanceof NotSetUp ? 501 : 502);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

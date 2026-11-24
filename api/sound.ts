// Vercel function: generate one sound effect or music track with ElevenLabs and return the audio.
// The ElevenLabs key stays here (Vercel env ELEVENLABS_API_KEY). Only signed-in members of the
// PGP-studio organization may call it, so nobody else can spend the studio's credits.

import { generate, validate } from "./_elevenlabs.js"; // ".js": Vercel runs functions as ES modules, which need the extension

export const config = { maxDuration: 60 };

const ORG = "PGP-studio";

export async function POST(request: Request): Promise<Response> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return json({ error: "Sound generation isn't set up: ELEVENLABS_API_KEY is missing in Vercel." }, 500);

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign in first." }, 401);
  const member = await fetch(`https://api.github.com/user/memberships/orgs/${ORG}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "studio-hub" },
  });
  const state = member.ok ? ((await member.json()) as { state?: string }).state : undefined;
  if (state !== "active") return json({ error: `Only members of ${ORG} can generate sounds.` }, 403);

  const req = validate(await request.json().catch(() => null));
  if (typeof req === "string") return json({ error: req }, 400);
  try {
    const out = await generate(req, key);
    return new Response(out.audio, { status: 200, headers: { "Content-Type": out.contentType, "Cache-Control": "no-store" } });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

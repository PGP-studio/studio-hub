// ElevenLabs calls, shared by the Vercel function (api/sound.ts) and the local dev server (vite.config.ts).
// Files starting with "_" in api/ are helpers, not endpoints.
//
// Sound effects: POST /v1/sound-generation  (0.5–30 s, one sound per call)
// Music:         POST /v1/music             (3 s – 10 min per call)

export type SoundRequest = {
  kind: "sfx" | "music";
  prompt: string;
  durationSeconds?: number; // sfx: 0.5–30; music: 3–600
  promptInfluence?: number; // sfx only, 0–1 (lower = more varied)
  seed?: number; // only used by the fake generator
};

export type SoundResult = { audio: ArrayBuffer; contentType: string };

const API = "https://api.elevenlabs.io";

export function validate(body: unknown): SoundRequest | string {
  const b = body as Partial<SoundRequest>;
  if (b?.kind !== "sfx" && b?.kind !== "music") return "kind must be sfx or music";
  if (typeof b.prompt !== "string" || !b.prompt.trim()) return "prompt is required";
  if (b.prompt.length > 4000) return "prompt is too long (4000 characters max)";
  const d = b.durationSeconds;
  if (d !== undefined && (typeof d !== "number" || !isFinite(d))) return "durationSeconds must be a number";
  if (b.kind === "sfx" && d !== undefined && (d < 0.5 || d > 30)) return "sound effects are 0.5–30 seconds";
  if (b.kind === "music" && d !== undefined && (d < 3 || d > 600)) return "music is 3–600 seconds";
  const p = b.promptInfluence;
  if (p !== undefined && (typeof p !== "number" || p < 0 || p > 1)) return "promptInfluence must be 0–1";
  return { kind: b.kind, prompt: b.prompt.trim(), durationSeconds: d, promptInfluence: p, seed: typeof b.seed === "number" ? b.seed : 0 };
}

export async function generate(req: SoundRequest, apiKey: string): Promise<SoundResult> {
  const sfx = req.kind === "sfx";
  const url = sfx ? `${API}/v1/sound-generation?output_format=mp3_44100_128` : `${API}/v1/music?output_format=mp3_44100_128`;
  const body = sfx
    ? { text: req.prompt, duration_seconds: req.durationSeconds ?? null, prompt_influence: req.promptInfluence ?? 0.3 }
    : { prompt: req.prompt, music_length_ms: req.durationSeconds ? Math.round(req.durationSeconds * 1000) : undefined };
  const res = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ElevenLabs ${res.status}: ${text.slice(0, 300)}`);
  }
  return { audio: await res.arrayBuffer(), contentType: res.headers.get("content-type") ?? "audio/mpeg" };
}

/**
 * Local testing without an ElevenLabs key: a short beep whose pitch depends on the seed,
 * so the 10 "variations" sound different. Never used on Vercel.
 */
export function fakeSound(req: SoundRequest): SoundResult {
  const rate = 22050;
  const seconds = Math.min(req.kind === "music" ? 3 : (req.durationSeconds ?? 1), 3);
  const n = Math.round(rate * seconds);
  const freq = 220 * Math.pow(2, ((req.seed ?? 0) % 12) / 12);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / 400, (n - i) / 2000);
    v.setInt16(44 + i * 2, Math.sin((2 * Math.PI * freq * i) / rate) * 9000 * env, true);
  }
  return { audio: buf, contentType: "audio/wav" };
}

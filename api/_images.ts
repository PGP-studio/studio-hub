// Concept image generation, shared by the Vercel function (api/image.ts) and the local dev server.
// The provider isn't chosen yet (Gemini "Nano Banana" or GPT). To add one: set IMAGE_PROVIDER and its
// key in Vercel, and fill in the matching adapter in `generate` below. Until then it answers "not set up".

import { deflateSync } from "node:zlib";

export type ImageRequest = {
  prompt: string; // the model task's concept prompt
  reference?: string; // base64 PNG/JPEG of design/style/reference-<kind>.png, if it exists
  seed?: number; // only used by the fake generator
};

export type ImageResult = { image: Uint8Array; contentType: string };

export function validate(body: unknown): ImageRequest | string {
  const b = body as Partial<ImageRequest>;
  if (typeof b?.prompt !== "string" || !b.prompt.trim()) return "prompt is required";
  if (b.prompt.length > 8000) return "prompt is too long (8000 characters max)";
  if (b.reference !== undefined && (typeof b.reference !== "string" || b.reference.length > 6_000_000)) return "reference must be a base64 image under ~4 MB";
  return { prompt: b.prompt.trim(), reference: b.reference, seed: typeof b.seed === "number" ? b.seed : 0 };
}

export class NotSetUp extends Error {}

export async function generate(_req: ImageRequest, env: Record<string, string | undefined>): Promise<ImageResult> {
  const provider = (env.IMAGE_PROVIDER ?? "").trim().toLowerCase();
  if (!provider) {
    throw new NotSetUp("Concept images aren't set up yet: the image provider (Gemini Nano Banana or GPT) hasn't been chosen. Set IMAGE_PROVIDER and its key in Vercel once it is.");
  }
  // Adapters go here once the provider is chosen, e.g.:
  //   gemini: POST https://generativelanguage.googleapis.com/... with the prompt and the reference image (GEMINI_API_KEY)
  //   openai: POST https://api.openai.com/v1/images/edits with the reference image (OPENAI_API_KEY)
  throw new NotSetUp(`IMAGE_PROVIDER is "${provider}", but that adapter isn't written yet (api/_images.ts).`);
}

/** Local testing only: a 256x256 placeholder "concept" whose colours depend on the seed. */
export function fakeImage(seed = 0): ImageResult {
  const w = 256;
  const h = 256;
  const hue = (seed * 47) % 360;
  const rgb = (hh: number, l: number): [number, number, number] => {
    const c = (1 - Math.abs(2 * l - 1)) * 0.7;
    const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
    const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
    const m = l - c / 2;
    return [r, g, b].map((v) => Math.round((v + m) * 255)) as [number, number, number];
  };
  const body = rgb(hue, 0.5);
  const dark = rgb(hue, 0.3);
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      let px: [number, number, number] = [235, 235, 235];
      const inBody = x > 60 && x < 196 && y > 110 && y < 160; // a blocky "barrel"
      const inGrip = x > 80 && x < 120 && y >= 160 && y < 215;
      const inTop = x > 140 && x < 180 && y > 80 && y <= 110;
      if (inBody || inTop) px = body;
      if (inGrip) px = dark;
      if ((inBody || inGrip || inTop) && (x + y) % 16 === 0) px = dark; // stud-ish speckle
      row[1 + x * 3] = px[0];
      row[2 + x * 3] = px[1];
      row[3 + x * 3] = px[2];
    }
    rows.push(row);
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (tag: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(tag, "ascii"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return { image: new Uint8Array(png), contentType: "image/png" };
}

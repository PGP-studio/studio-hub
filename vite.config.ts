import { execSync } from "node:child_process";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fakeSound, generate, validate } from "./api/_elevenlabs";

// Local development: the browser calls /gh/graphql and this dev server forwards
// it to GitHub with a token from .env.local (GITHUB_TOKEN) or `gh auth token`.
// In production, sign-in gives the browser its own token (step 4 of HUB_APP.md).
function devToken(env: Record<string, string>): string {
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN;
  try {
    return execSync("gh auth token", { encoding: "utf8" }).trim();
  } catch {
    console.warn("No GITHUB_TOKEN in .env.local and `gh auth token` failed; GitHub calls will be anonymous.");
    return "";
  }
}

// Local stand-in for api/sound.ts: uses ELEVENLABS_API_KEY from .env.local if set,
// otherwise returns short fake beeps so the Sounds tab can be tested without credits.
function devSound(env: Record<string, string>): Plugin {
  return {
    name: "dev-sound",
    configureServer(server) {
      server.middlewares.use("/api/sound", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end();
        }
        let raw = "";
        for await (const chunk of req) raw += chunk;
        const parsed = validate(JSON.parse(raw || "null"));
        if (typeof parsed === "string") {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          return res.end(JSON.stringify({ error: parsed }));
        }
        try {
          const out = env.ELEVENLABS_API_KEY ? await generate(parsed, env.ELEVENLABS_API_KEY) : fakeSound(parsed);
          res.setHeader("Content-Type", out.contentType);
          res.end(Buffer.from(out.audio));
        } catch (e) {
          res.statusCode = 502;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
      });
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const token = command === "serve" ? devToken(env) : "";
  return {
    plugins: [react(), devSound(env)],
    server: {
      port: 5173,
      proxy: {
        "/gh": {
          target: "https://api.github.com",
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/gh/, ""),
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      },
    },
  };
});

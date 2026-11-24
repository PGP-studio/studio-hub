import { execSync } from "node:child_process";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

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

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const token = command === "serve" ? devToken(env) : "";
  return {
    plugins: [react()],
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

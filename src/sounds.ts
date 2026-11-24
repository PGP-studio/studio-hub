// Sounds: tasks labelled `sound` whose description is a sound prompt (format: docs/sound-prompt.md in the
// game repo). Approving generates N variations with ElevenLabs (api/sound.ts), each saved to the branch
// sound/<task> as it arrives. Picking one opens a PR that adds only that file to assets/audio/, adds it to
// the Assets board, and deletes the candidates branch.

import { gql, ORG, rest, restJson, sessionToken, setFields, type Game, type Item, type Project } from "./github";

export const SOUND_LABEL = "sound";
export const AUDIO_DIR = "assets/audio";
const CANDIDATES = `${AUDIO_DIR}/candidates`;

export type SoundSpec = {
  kind: "sfx" | "music";
  assetName: string;
  durationSeconds?: number;
  variations: number;
  promptInfluence?: number;
  prompt: string; // sent to ElevenLabs as is
  usage: string; // "Where it's used"
};

export const defaultSpec = (kind: "sfx" | "music" = "sfx"): SoundSpec => ({
  kind,
  assetName: "",
  durationSeconds: kind === "sfx" ? 1.5 : 30,
  variations: kind === "sfx" ? 10 : 3,
  promptInfluence: kind === "sfx" ? 0.3 : undefined,
  prompt: "",
  usage: "",
});

/** The task description for a sound, in the format of docs/sound-prompt.md. */
export function formatSpec(s: SoundSpec): string {
  const lines = [
    "## Sound",
    `- Kind: ${s.kind === "sfx" ? "Sound effect" : "Music"}`,
    `- Asset name: ${s.assetName}`,
    s.durationSeconds ? `- Duration: ${s.durationSeconds} s` : "- Duration: auto",
    `- Variations: ${s.variations}`,
  ];
  if (s.kind === "sfx") lines.push(`- Prompt influence: ${s.promptInfluence ?? 0.3}`);
  lines.push("", "## ElevenLabs prompt", s.prompt.trim(), "", "## Where it's used", s.usage.trim() || "—", "");
  lines.push("## Done when", "- [ ] A variation is picked in the hub (Sounds tab) and its PR is merged.", "");
  return lines.join("\n");
}

/** Read a sound description back. Returns null if it isn't one. */
export function parseSpec(body: string): SoundSpec | null {
  const field = (name: string) => body.match(new RegExp(`^-\\s*${name}:\\s*(.+)$`, "mi"))?.[1].trim();
  const section = (name: string) => body.match(new RegExp(`^##\\s*${name}\\s*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, "mi"))?.[1].trim() ?? "";
  const kindText = field("Kind");
  const prompt = section("ElevenLabs prompt");
  if (!kindText || !prompt) return null;
  const kind = /music/i.test(kindText) ? "music" : "sfx";
  const num = (s?: string) => {
    const n = parseFloat(s ?? "");
    return isFinite(n) ? n : undefined;
  };
  return {
    kind,
    assetName: field("Asset name") ?? "",
    durationSeconds: num(field("Duration")),
    variations: Math.max(1, Math.min(20, Math.round(num(field("Variations")) ?? (kind === "sfx" ? 10 : 3)))),
    promptInfluence: num(field("Prompt influence")),
    prompt,
    usage: section("Where it's used").replace(/^—$/, ""),
  };
}

export const isSoundTask = (t: Item) => t.labels.includes(SOUND_LABEL);
export const candidatesBranch = (t: Item) => `sound/${t.number}`;
export const finalBranch = (t: Item) => `sound-final/${t.number}`;

export function fileSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "sound"
  );
}

// ---------- Progress (outside React, so a card that moves between groups keeps it) ----------

const progressByTask = new Map<number, string>();
const listeners = new Set<() => void>();

export function setProgress(task: number, text: string | null) {
  if (text === null) progressByTask.delete(task);
  else progressByTask.set(task, text);
  listeners.forEach((l) => l());
}

export function subscribeProgress(l: () => void): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

export const getProgress = (task: number) => progressByTask.get(task) ?? null;

// ---------- Generation ----------

async function generateOne(spec: SoundSpec, seed: number): Promise<{ bytes: Uint8Array; ext: string }> {
  const token = sessionToken();
  const res = await fetch("/api/sound", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ kind: spec.kind, prompt: spec.prompt, durationSeconds: spec.durationSeconds, promptInfluence: spec.promptInfluence, seed }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Generation failed (${res.status})`);
  }
  const type = res.headers.get("content-type") ?? "audio/mpeg";
  return { bytes: new Uint8Array(await res.arrayBuffer()), ext: type.includes("wav") ? "wav" : "mp3" };
}

function base64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function branchHead(repo: string, branch: string): Promise<string | null> {
  const res = await rest(`/repos/${ORG}/${repo}/git/ref/heads/${branch}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${res.status} reading ${branch}`);
  return ((await res.json()) as { object: { sha: string } }).object.sha;
}

async function defaultHead(repo: string): Promise<{ name: string; sha: string }> {
  const r = await restJson<{ default_branch: string }>(`/repos/${ORG}/${repo}`);
  const sha = await branchHead(repo, r.default_branch);
  if (!sha) throw new Error("No default branch");
  return { name: r.default_branch, sha };
}

async function ensureBranch(repo: string, branch: string): Promise<void> {
  if (await branchHead(repo, branch)) return;
  const base = await defaultHead(repo);
  await restJson(`/repos/${ORG}/${repo}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: base.sha }) });
}

/** The branch's head through GraphQL: the same view createCommitOnBranch checks against (REST can lag). */
async function graphHead(repo: string, branch: string): Promise<string | null> {
  const d = await gql<{ repository: { ref: { target: { oid: string } } | null } }>(
    `query($o:String!,$n:String!,$r:String!){ repository(owner:$o, name:$n){ ref(qualifiedName:$r){ target{ oid } } } }`,
    { o: ORG, n: repo, r: `refs/heads/${branch}` },
  );
  return d.repository.ref?.target.oid ?? null;
}

// Last commit we made per branch: the next commit builds on it without asking GitHub (which may lag).
const lastCommit = new Map<string, string>();

async function commitFiles(repo: string, branch: string, headline: string, additions: { path: string; contents: string }[], deletions: string[] = []) {
  const key = `${repo}:${branch}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const head = (attempt === 0 && lastCommit.get(key)) || (await graphHead(repo, branch));
    if (!head) {
      if (attempt === 4) throw new Error(`Branch ${branch} is missing`);
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1))); // just created: GitHub may not show it yet
      continue;
    }
    try {
      const d = await gql<{ createCommitOnBranch: { commit: { oid: string } } }>(
        `mutation($i:CreateCommitOnBranchInput!){ createCommitOnBranch(input:$i){ commit{ oid } } }`,
        {
          i: {
            branch: { repositoryNameWithOwner: `${ORG}/${repo}`, branchName: branch },
            expectedHeadOid: head,
            message: { headline },
            fileChanges: { additions, deletions: deletions.map((path) => ({ path })) },
          },
        },
      );
      lastCommit.set(key, d.createCommitOnBranch.commit.oid);
      return;
    } catch (e) {
      lastCommit.delete(key);
      if (attempt === 4 || !/expected|head|oid|stale|update/i.test(String(e))) throw e; // branch moved: retry on its new head
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
}

export type Candidate = { name: string; path: string };

/** The variations on sound/<task>, read through GraphQL (REST's file listing lags right after commits). */
export async function listCandidates(repo: string, t: Item): Promise<Candidate[]> {
  const d = await gql<{ repository: { object: { entries: { name: string; path: string; type: string }[] } | null } }>(
    `query($o:String!,$n:String!,$e:String!){ repository(owner:$o, name:$n){ object(expression:$e){ ... on Tree{ entries{ name path type } } } } }`,
    { o: ORG, n: repo, e: `${candidatesBranch(t)}:${CANDIDATES}/${t.number}` },
  );
  return (d.repository.object?.entries ?? []).filter((f) => f.type === "blob").sort((a, b) => a.name.localeCompare(b.name));
}

/** An audio file from the repo as a playable object URL. */
export async function audioUrl(repo: string, path: string, ref: string): Promise<string> {
  const res = await rest(`/repos/${ORG}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`, { headers: { Accept: "application/vnd.github.raw" } });
  if (!res.ok) throw new Error(`GitHub ${res.status} loading audio`);
  return URL.createObjectURL(await res.blob());
}

/**
 * Generate `count` variations (3 at a time) and commit each to sound/<task> as soon as it arrives,
 * so nothing is lost if the tab closes. `startAt` continues numbering for "Generate more".
 */
export async function generateVariations(
  game: Game,
  t: Item,
  spec: SoundSpec,
  count: number,
  startAt: number,
  progress: (done: number, failed: number) => void,
): Promise<{ made: number; errors: string[] }> {
  const branch = candidatesBranch(t);
  await ensureBranch(game.repo, branch);
  let made = 0;
  const errors: string[] = [];
  let commits = Promise.resolve();
  const jobs = Array.from({ length: count }, (_, i) => startAt + i);
  const worker = async () => {
    for (let idx = jobs.shift(); idx !== undefined; idx = jobs.shift()) {
      try {
        const { bytes, ext } = await generateOne(spec, idx);
        const path = `${CANDIDATES}/${t.number}/v${String(idx).padStart(2, "0")}.${ext}`;
        // Commits go one after another (each needs the branch's latest head); one failure doesn't block the rest.
        const mine = commits.catch(() => {}).then(() => commitFiles(game.repo, branch, `Sound #${t.number}: variation ${idx}`, [{ path, contents: base64(bytes) }]));
        commits = mine;
        await mine;
        made++;
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
      progress(made, errors.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { made, errors };
}

// ---------- Picking ----------

/**
 * Keep one variation: PR that adds only that file to assets/audio/, an Assets item,
 * task → In review, and the candidates branch deleted. Returns the PR URL.
 */
export async function pickVariation(game: Game, tasks: Project, assets: Project | null, t: Item, spec: SoundSpec, c: Candidate, me: string): Promise<string> {
  const repo = game.repo;
  const ext = c.name.split(".").pop() ?? "mp3";
  const target = `${AUDIO_DIR}/${fileSlug(spec.assetName || t.title)}.${ext}`;

  // 1. The chosen file's bytes, from the candidates branch.
  const raw = await rest(`/repos/${ORG}/${repo}/contents/${c.path}?ref=${encodeURIComponent(candidatesBranch(t))}`, { headers: { Accept: "application/vnd.github.raw" } });
  if (!raw.ok) throw new Error(`GitHub ${raw.status} reading the variation`);
  const bytes = new Uint8Array(await raw.arrayBuffer());

  // 2. A clean branch from main with only that file, and a PR (so no candidates ever reach main).
  const branch = finalBranch(t);
  await ensureBranch(repo, branch);
  await commitFiles(repo, branch, `Add sound: ${spec.assetName || t.title}`, [{ path: target, contents: base64(bytes) }]);
  const base = await defaultHead(repo);
  const existing = await restJson<{ html_url: string }[]>(`/repos/${ORG}/${repo}/pulls?head=${ORG}:${encodeURIComponent(branch)}&state=open`);
  const pr =
    existing[0] ??
    (await restJson<{ html_url: string }>(`/repos/${ORG}/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        title: `Sound: ${spec.assetName || t.title}`,
        head: branch,
        base: base.name,
        body: `Closes #${t.number}.\n\nPicked ${c.name} of the ElevenLabs variations in the studio hub by ${me}.\n\n- File: \`${target}\`\n- Kind: ${spec.kind === "sfx" ? "sound effect" : "music"}\n- Prompt: ${spec.prompt}\n\nNext: upload to Roblox and fill in the Roblox ID on the Assets board.`,
      }),
    }));

  // 3. The Assets board.
  if (assets) {
    const typeField = game.config.assetTypeField ?? "Type";
    const types = assets.fields[typeField]?.options?.map((o) => o.name) ?? [];
    const type = spec.kind === "music" ? types.find((x) => /music/i.test(x)) : types.find((x) => /sound/i.test(x));
    const values: Record<string, string> = { "Made by": `${me} + ElevenLabs`, Prompt: spec.prompt.slice(0, 1000) };
    if (type) values[typeField] = type;
    if (assets.fields["Status"]?.options?.some((o) => o.name === "Generated")) values["Status"] = "Generated";
    if (t.values["Area"]) values["Area"] = t.values["Area"];
    const d = await gql<{ addProjectV2DraftIssue: { projectItem: { id: string } } }>(
      `mutation($p:ID!,$t:String!,$b:String){ addProjectV2DraftIssue(input:{projectId:$p, title:$t, body:$b}){ projectItem{ id } } }`,
      { p: assets.id, t: spec.assetName || t.title, b: `File: ${target} (from #${t.number})` },
    );
    await setFields(assets, d.addProjectV2DraftIssue.projectItem.id, values);
  }

  // 4. Task → In review, and the candidates branch goes away.
  await setFields(tasks, t.id, { Status: "In review", Files: target });
  await rest(`/repos/${ORG}/${repo}/git/refs/heads/${candidatesBranch(t)}`, { method: "DELETE" });
  return pr.html_url;
}

/** Throw away all variations (e.g. to change the prompt and start over). */
export async function discardVariations(repo: string, t: Item): Promise<void> {
  const res = await rest(`/repos/${ORG}/${repo}/git/refs/heads/${candidatesBranch(t)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 422 && res.status !== 404) throw new Error(`GitHub ${res.status} deleting variations`);
}

export async function openSoundPR(repo: string, t: Item): Promise<string | null> {
  const prs = await restJson<{ html_url: string }[]>(`/repos/${ORG}/${repo}/pulls?head=${ORG}:${encodeURIComponent(finalBranch(t))}&state=all`);
  return prs[0]?.html_url ?? null;
}

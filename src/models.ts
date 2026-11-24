// Models: tasks labelled `model` whose description is a model prompt (format: docs/model-prompt.md in the
// game repo). Everything for one model lives on the branch model/<task> under assets/models/<asset-slug>/:
//   concepts/c01.png …   generated concept images (deleted once one is picked)
//   concept.png          the approved concept
//   model.json, model.glb  written by Claude with /model-build (tools/models/glb.py)
// Claude opens the PR from that branch; review happens here; a human merges and imports into Roblox.

import { base64, commitFiles, deleteBranch, ensureBranch, listFolder, readFile } from "./branchFiles";
import { gql, ORG, rest, restJson, sessionToken, setFields, type Game, type Item, type Project } from "./github";
import { fileSlug } from "./sounds";

export const MODEL_LABEL = "model";

export type ModelSpec = {
  assetName: string;
  kind: string; // Gun, Animal, Pet, Prop
  concepts: number;
  budget?: number;
  size: string;
  conceptPrompt: string;
  buildNotes: string;
};

export function parseModelSpec(body: string): ModelSpec | null {
  const field = (name: string) => body.match(new RegExp(`^-\\s*${name}:\\s*(.+)$`, "mi"))?.[1].trim();
  const section = (name: string) => body.match(new RegExp(`^##\\s*${name}\\s*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, "mi"))?.[1].trim() ?? "";
  const assetName = field("Asset name");
  const conceptPrompt = section("Concept prompt");
  if (!assetName || !conceptPrompt) return null;
  const n = (s?: string) => {
    const v = parseInt(s ?? "", 10);
    return isFinite(v) ? v : undefined;
  };
  return {
    assetName,
    kind: field("Kind") ?? "Prop",
    concepts: Math.max(1, Math.min(8, n(field("Concept images")) ?? 4)),
    budget: n(field("Triangle budget")),
    size: field("Size") ?? "",
    conceptPrompt,
    buildNotes: section("Build notes"),
  };
}

/** Replace just the concept prompt in a model task's description, keeping everything else. */
export function withConceptPrompt(body: string, prompt: string): string {
  return body.replace(/(^##\s*Concept prompt\s*\n)([\s\S]*?)(?=^##\s|(?![\s\S]))/im, (_m, head) => `${head}${prompt.trim()}\n\n`);
}

export const isModelTask = (t: Item) => t.labels.includes(MODEL_LABEL);
export const modelBranch = (t: Item) => `model/${t.number}`;
export const modelDir = (spec: ModelSpec) => `assets/models/${fileSlug(spec.assetName)}`;

export type ModelState = {
  branchExists: boolean;
  concepts: { name: string; path: string }[];
  concept: string | null; // path of concept.png
  glb: string | null; // path of model.glb
  modelJson: string | null;
};

export async function modelState(repo: string, t: Item, spec: ModelSpec): Promise<ModelState> {
  const dir = modelDir(spec);
  const [files, concepts] = await Promise.all([listFolder(repo, modelBranch(t), dir), listFolder(repo, modelBranch(t), `${dir}/concepts`)]);
  const find = (name: string) => files.find((f) => f.name === name)?.path ?? null;
  return {
    branchExists: files.length > 0 || concepts.length > 0,
    concepts,
    concept: find("concept.png"),
    glb: find("model.glb"),
    modelJson: find("model.json"),
  };
}

/** Triangle count from model.json (box 12, wedge 8, cylinder 4 x sides - 4), same as glb.py. */
export function estimateTriangles(modelJson: string): { parts: number; triangles: number } | null {
  try {
    const parts = (JSON.parse(modelJson).parts ?? []) as { shape?: string; sides?: number }[];
    const tris = parts.reduce((n, p) => n + (p.shape === "wedge" ? 8 : p.shape === "cylinder" ? 4 * Math.max(3, Math.min(32, p.sides ?? 8)) - 4 : 12), 0);
    return { parts: parts.length, triangles: tris };
  } catch {
    return null;
  }
}

// ---------- Concept images ----------

async function referenceImage(game: Game, kind: string): Promise<string | undefined> {
  const res = await rest(`/repos/${ORG}/${game.repo}/contents/design/style/reference-${kind.toLowerCase()}.png`, { headers: { Accept: "application/vnd.github.raw" } });
  if (!res.ok) return undefined; // no reference image yet: the prompt alone is sent
  return base64(new Uint8Array(await res.arrayBuffer()));
}

async function generateOne(prompt: string, reference: string | undefined, seed: number): Promise<Uint8Array> {
  const token = sessionToken();
  const res = await fetch("/api/image", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ prompt, reference, seed }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Image generation failed (${res.status})`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** Generate `count` concepts (2 at a time) and commit each to model/<task> as it arrives. */
export async function generateConcepts(
  game: Game,
  t: Item,
  spec: ModelSpec,
  count: number,
  startAt: number,
  progress: (done: number, failed: number) => void,
): Promise<{ made: number; errors: string[] }> {
  const branch = modelBranch(t);
  await ensureBranch(game.repo, branch);
  const reference = await referenceImage(game, spec.kind);
  let made = 0;
  const errors: string[] = [];
  let commits = Promise.resolve();
  const jobs = Array.from({ length: count }, (_, i) => startAt + i);
  const worker = async () => {
    for (let idx = jobs.shift(); idx !== undefined; idx = jobs.shift()) {
      try {
        const bytes = await generateOne(spec.conceptPrompt, reference, idx);
        const path = `${modelDir(spec)}/concepts/c${String(idx).padStart(2, "0")}.png`;
        const mine = commits.catch(() => {}).then(() => commitFiles(game.repo, branch, `Model #${t.number}: concept ${idx}`, [{ path, contents: base64(bytes) }]));
        commits = mine;
        await mine;
        made++;
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
        if (/isn't set up|isn't written/.test(String(e))) jobs.length = 0; // no point retrying the rest
      }
      progress(made, errors.length);
    }
  };
  await Promise.all([worker(), worker()]);
  return { made, errors };
}

/** Keep one concept as concept.png and delete the others. */
export async function pickConcept(game: Game, t: Item, spec: ModelSpec, chosen: { path: string }, all: { path: string }[]): Promise<void> {
  const bytes = await readFile(game.repo, chosen.path, modelBranch(t));
  await commitFiles(
    game.repo,
    modelBranch(t),
    `Model #${t.number}: concept approved`,
    [{ path: `${modelDir(spec)}/concept.png`, contents: base64(bytes) }],
    all.map((c) => c.path),
  );
}

/** Throw away everything on model/<task> (concepts and any build) to start over with a new prompt. */
export async function discardModelBranch(repo: string, t: Item): Promise<void> {
  await deleteBranch(repo, modelBranch(t));
}

// ---------- Review ----------

type PR = { number: number; html_url: string; node_id: string; draft: boolean; state: string };

export async function modelPR(repo: string, t: Item): Promise<PR | null> {
  const prs = await restJson<PR[]>(`/repos/${ORG}/${repo}/pulls?head=${ORG}:${encodeURIComponent(modelBranch(t))}&state=all`);
  return prs[0] ?? null;
}

/** Feedback for Claude: a comment on the model's PR (or on the task if there's no PR yet). */
export async function requestChanges(repo: string, t: Item, text: string, me: string): Promise<void> {
  const pr = await modelPR(repo, t);
  const target = pr?.number ?? t.number;
  await restJson(`/repos/${ORG}/${repo}/issues/${target}/comments`, {
    method: "POST",
    body: JSON.stringify({ body: `**Changes requested in the hub by ${me}:**\n\n${text.trim()}\n\nRun \`/model-build ${t.number}\` to rebuild.` }),
  });
}

/** Approve: asset → Approved on the Assets board, PR marked ready for review, note on the PR. */
export async function approveModel(game: Game, assets: Project | null, t: Item, spec: ModelSpec, me: string): Promise<void> {
  if (assets) {
    const item = assets.items.find((a) => a.title.toLowerCase() === spec.assetName.toLowerCase());
    if (item && assets.fields["Status"]?.options?.some((o) => o.name === "Approved")) {
      await setFields(assets, item.id, { Status: "Approved", "Made by": `${me} + Claude` });
    }
  }
  const pr = await modelPR(game.repo, t);
  if (pr) {
    if (pr.draft) await gql(`mutation($id:ID!){ markPullRequestReadyForReview(input:{pullRequestId:$id}){ clientMutationId } }`, { id: pr.node_id });
    await restJson(`/repos/${ORG}/${game.repo}/issues/${pr.number}/comments`, {
      method: "POST",
      body: JSON.stringify({
        body: `**Model approved in the hub by ${me}.** Next: merge, import \`${modelDir(spec)}/model.glb\` into Roblox (3D Importer, unit "Stud"), and put its Roblox ID on the Assets board.`,
      }),
    });
  }
}

/** The hub keeps its own edits of the prompt in the task description. */
export async function saveConceptPrompt(t: Item, prompt: string): Promise<string> {
  const body = withConceptPrompt(t.body, prompt);
  await gql(`mutation($id:ID!,$b:String!){ updateIssue(input:{id:$id, body:$b}){ clientMutationId } }`, { id: t.contentId, b: body });
  return body;
}

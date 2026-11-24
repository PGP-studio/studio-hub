// Saving files to branches of a game repo, shared by the Sounds and Models tabs.
// Commits chain on the commit we made last (GitHub's REST views lag right after a commit), and
// heads/listings are read through GraphQL, the same view createCommitOnBranch checks against.

import { gql, ORG, rest, restJson } from "./github";

export function base64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function branchHead(repo: string, branch: string): Promise<string | null> {
  const res = await rest(`/repos/${ORG}/${repo}/git/ref/heads/${branch}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${res.status} reading ${branch}`);
  return ((await res.json()) as { object: { sha: string } }).object.sha;
}

export async function defaultHead(repo: string): Promise<{ name: string; sha: string }> {
  const r = await restJson<{ default_branch: string }>(`/repos/${ORG}/${repo}`);
  const sha = await branchHead(repo, r.default_branch);
  if (!sha) throw new Error("No default branch");
  return { name: r.default_branch, sha };
}

export async function ensureBranch(repo: string, branch: string): Promise<void> {
  if (await branchHead(repo, branch)) return;
  const base = await defaultHead(repo);
  await restJson(`/repos/${ORG}/${repo}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: base.sha }) });
}

/** The branch's head through GraphQL: the same view createCommitOnBranch checks against (REST can lag). */
export async function graphHead(repo: string, branch: string): Promise<string | null> {
  const d = await gql<{ repository: { ref: { target: { oid: string } } | null } }>(
    `query($o:String!,$n:String!,$r:String!){ repository(owner:$o, name:$n){ ref(qualifiedName:$r){ target{ oid } } } }`,
    { o: ORG, n: repo, r: `refs/heads/${branch}` },
  );
  return d.repository.ref?.target.oid ?? null;
}

// Last commit we made per branch: the next commit builds on it without asking GitHub (which may lag).
const lastCommit = new Map<string, string>();

export async function commitFiles(repo: string, branch: string, headline: string, additions: { path: string; contents: string }[], deletions: string[] = []) {
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

/** Files directly inside a folder on a branch (GraphQL: consistent right after commits). */
export async function listFolder(repo: string, ref: string, folder: string): Promise<{ name: string; path: string }[]> {
  const d = await gql<{ repository: { object: { entries: { name: string; path: string; type: string }[] } | null } }>(
    `query($o:String!,$n:String!,$e:String!){ repository(owner:$o, name:$n){ object(expression:$e){ ... on Tree{ entries{ name path type } } } } }`,
    { o: ORG, n: repo, e: `${ref}:${folder}` },
  );
  return (d.repository.object?.entries ?? []).filter((f) => f.type === "blob").sort((a, b) => a.name.localeCompare(b.name));
}

/** Raw bytes of a file on a branch. */
export async function readFile(repo: string, path: string, ref: string): Promise<Uint8Array> {
  const res = await rest(`/repos/${ORG}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`, { headers: { Accept: "application/vnd.github.raw" } });
  if (!res.ok) throw new Error(`GitHub ${res.status} reading ${path}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** A file on a branch as an object URL (for <audio>, <img>, <model-viewer>). */
export async function fileUrl(repo: string, path: string, ref: string, type?: string): Promise<string> {
  const bytes = await readFile(repo, path, ref);
  return URL.createObjectURL(new Blob([bytes], type ? { type } : {}));
}

export async function deleteBranch(repo: string, branch: string): Promise<void> {
  const res = await rest(`/repos/${ORG}/${repo}/git/refs/heads/${branch}`, { method: "DELETE" });
  if (!res.ok && res.status !== 422 && res.status !== 404) throw new Error(`GitHub ${res.status} deleting ${branch}`);
}

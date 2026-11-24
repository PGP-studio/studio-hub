// Data for a game's Overview tab: its description, open and recently merged PRs, and design/docs files.

import { gql, ORG } from "./github";

export type PR = {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  author: string;
  reviewDecision: string | null; // APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED or null
  date: string; // updatedAt (open) or mergedAt (merged)
};

export type RepoFile = { name: string; path: string; url: string };

export type Overview = {
  branch: string;
  description: string; // "The game" section of CLAUDE.md, as markdown-ish text
  openPRs: PR[];
  mergedPRs: PR[];
  files: RepoFile[];
};

type RawPR = {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  author: { login: string } | null;
  reviewDecision: string | null;
  updatedAt: string;
  mergedAt: string | null;
};
type Tree = { entries: { name: string; path: string; type: string }[] } | null;

const PR_FIELDS = "number title url isDraft author{ login } reviewDecision updatedAt mergedAt";

export async function fetchOverview(repo: string): Promise<Overview> {
  const d = await gql<{
    repository: {
      url: string;
      defaultBranchRef: { name: string } | null;
      claude: { text: string } | null;
      design: Tree;
      docs: Tree;
      open: { nodes: RawPR[] };
      merged: { nodes: RawPR[] };
    };
  }>(
    `query($o:String!,$n:String!){ repository(owner:$o, name:$n){
      url defaultBranchRef{ name }
      claude: object(expression:"HEAD:CLAUDE.md"){ ... on Blob{ text } }
      design: object(expression:"HEAD:design"){ ... on Tree{ entries{ name path type } } }
      docs: object(expression:"HEAD:docs"){ ... on Tree{ entries{ name path type } } }
      open: pullRequests(states:OPEN, first:20, orderBy:{field:UPDATED_AT, direction:DESC}){ nodes{ ${PR_FIELDS} } }
      merged: pullRequests(states:MERGED, first:5, orderBy:{field:UPDATED_AT, direction:DESC}){ nodes{ ${PR_FIELDS} } }
    } }`,
    { o: ORG, n: repo },
  );
  const r = d.repository;
  const branch = r.defaultBranchRef?.name ?? "main";
  const pr = (p: RawPR, merged: boolean): PR => ({
    number: p.number,
    title: p.title,
    url: p.url,
    isDraft: p.isDraft,
    author: p.author?.login ?? "?",
    reviewDecision: p.reviewDecision,
    date: (merged ? p.mergedAt : p.updatedAt) ?? p.updatedAt,
  });
  const files = [...(r.design?.entries ?? []), ...(r.docs?.entries ?? [])]
    .filter((e) => e.type === "blob")
    .map((e) => ({ name: e.name, path: e.path, url: `${r.url}/blob/${branch}/${e.path}` }));
  return {
    branch,
    description: gameSection(r.claude?.text ?? ""),
    openPRs: r.open.nodes.map((p) => pr(p, false)),
    mergedPRs: r.merged.nodes.map((p) => pr(p, true)),
    files,
  };
}

/** The "## The game" section of CLAUDE.md, up to the next "## " heading. */
function gameSection(md: string): string {
  const m = md.match(/^## The game[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  return (m?.[1] ?? "").trim();
}

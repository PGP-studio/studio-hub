// Everything the hub knows lives in GitHub. This file is the only place that talks to it.

import { configRef } from "./auth";

export const ORG = "PGP-studio";
export const WORKFLOW_LABEL = "workflow";

const TOKEN_KEY = "gh_token";

export function sessionToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = sessionToken();
  // With a sign-in token, call GitHub directly. Without one (local dev), the Vite dev
  // server proxies /gh to GitHub and adds the developer's token.
  const url = token ? "https://api.github.com/graphql" : "/gh/graphql";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map((e: { message: string }) => e.message).join("; "));
  return json.data as T;
}

/** GitHub REST call (same sign-in / dev-proxy rules as gql). Returns the raw Response. */
export async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const token = sessionToken();
  const url = token ? `https://api.github.com${path}` : `/gh${path}`;
  return fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
}

export async function restJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await rest(path, init);
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (res.status === 204 ? null : await res.json()) as T;
}

// ---------- Types ----------

export type HubConfig = {
  name: string;
  tasksProject: number;
  assetsProject: number;
  assetTypeField?: string;
  systems: string[];
  assetTypes: string[];
  assetStatuses: string[];
  structure: {
    label: string;
    units: string[];
    progress: { label: string; assetType: string }[];
  };
  /** Shown on the Overview tab: Team Create place, test places, Roblox group, docs… */
  links?: { label: string; url: string }[];
};

export type Milestone = { id: string; title: string };

export type Game = {
  repo: string;
  repoId: string;
  url: string;
  config: HubConfig;
  milestones: Milestone[];
};

export type Field = { id: string; name: string; dataType: string; options?: { id: string; name: string }[] };

export type Item = {
  id: string; // project item id
  contentId: string; // issue or draft issue id
  kind: "issue" | "draft";
  number?: number;
  url?: string;
  closed?: boolean;
  title: string;
  body: string;
  values: Record<string, string>; // field name -> text or option name
  labels: string[];
  parent?: number; // workflow (parent issue) number
  subIssues: number[]; // for a workflow: its tasks' issue numbers, in sub-issue order
  isWorkflow: boolean; // issue labelled `workflow`; its tasks are sub-issues
};

export type Project = { id: string; number: number; fields: Record<string, Field>; items: Item[] };

export type Viewer = { login: string; name: string | null; isMember: boolean };

// ---------- Reads ----------

export async function fetchViewer(): Promise<Viewer> {
  const d = await gql<{ viewer: { login: string; name: string | null }; organization: { viewerIsAMember: boolean } | null }>(
    `query($org:String!){ viewer{login name} organization(login:$org){viewerIsAMember} }`,
    { org: ORG },
  );
  return { login: d.viewer.login, name: d.viewer.name, isMember: !!d.organization?.viewerIsAMember };
}

type RepoNode = {
  name: string;
  id: string;
  url: string;
  isArchived: boolean;
  repositoryTopics: { nodes: { topic: { name: string } }[] };
  object: { text: string } | null;
  head: { text: string } | null;
  milestones: { nodes: Milestone[] };
};

/** Games = repos in the org with the topic `game` and a hub.config.json. */
export async function fetchGames(): Promise<Game[]> {
  // Read hub.config.json from the default branch, or from a branch set with VITE_HUB_CONFIG_REF
  // (.env.local) or HUB_CONFIG_REF (Vercel) to try a config that isn't merged yet.
  const expr = `${configRef()}:hub.config.json`;
  const d = await gql<{ organization: { repositories: { nodes: RepoNode[] } } }>(
    `query($org:String!, $expr:String!){ organization(login:$org){ repositories(first:100, orderBy:{field:CREATED_AT, direction:ASC}){ nodes{
      name id url isArchived
      repositoryTopics(first:20){ nodes{ topic{ name } } }
      object(expression:$expr){ ... on Blob{ text } }
      head: object(expression:"HEAD:hub.config.json"){ ... on Blob{ text } }
      milestones(first:20, states:OPEN, orderBy:{field:NUMBER, direction:ASC}){ nodes{ id title } }
    } } } }`,
    { org: ORG, expr },
  );
  const games: Game[] = [];
  for (const r of d.organization.repositories.nodes) {
    const cfg = r.object ?? r.head; // the branch override only applies to repos that have that branch
    if (r.isArchived || !cfg) continue;
    if (!r.repositoryTopics.nodes.some((t) => t.topic.name === "game")) continue;
    try {
      games.push({ repo: r.name, repoId: r.id, url: r.url, config: JSON.parse(cfg.text), milestones: r.milestones.nodes });
    } catch {
      console.warn(`${r.name}: hub.config.json is not valid JSON`);
    }
  }
  return games;
}

const PROJECT_QUERY = `query($org:String!, $num:Int!, $after:String){ organization(login:$org){ projectV2(number:$num){
  id
  fields(first:50){ nodes{ ... on ProjectV2FieldCommon{ id name dataType } ... on ProjectV2SingleSelectField{ options{ id name } } } }
  items(first:100, after:$after){
    pageInfo{ hasNextPage endCursor }
    nodes{
      id isArchived
      content{
        __typename
        ... on Issue{ id number title url closed body labels(first:10){ nodes{ name } } parent{ number } subIssues(first:50){ nodes{ number } } }
        ... on DraftIssue{ id title body }
      }
      fieldValues(first:20){ nodes{
        __typename
        ... on ProjectV2ItemFieldTextValue{ text field{ ... on ProjectV2FieldCommon{ name } } }
        ... on ProjectV2ItemFieldSingleSelectValue{ name field{ ... on ProjectV2FieldCommon{ name } } }
        ... on ProjectV2ItemFieldMilestoneValue{ milestone{ title } field{ ... on ProjectV2FieldCommon{ name } } }
      } }
    }
  }
} } }`;

type RawValue = { text?: string; name?: string; milestone?: { title: string }; field?: { name: string } };
type RawItem = {
  id: string;
  isArchived: boolean;
  content: {
    __typename: string;
    id: string;
    number?: number;
    title: string;
    url?: string;
    closed?: boolean;
    body: string;
    labels?: { nodes: { name: string }[] };
    parent?: { number: number } | null;
    subIssues?: { nodes: { number: number }[] };
  } | null;
  fieldValues: { nodes: RawValue[] };
};

export async function fetchProject(number: number): Promise<Project> {
  let after: string | null = null;
  let id = "";
  const fields: Record<string, Field> = {};
  const items: Item[] = [];
  do {
    type R = {
      organization: {
        projectV2: {
          id: string;
          fields: { nodes: Field[] };
          items: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: RawItem[] };
        };
      };
    };
    const d: R = await gql<R>(PROJECT_QUERY, { org: ORG, num: number, after });
    const p = d.organization.projectV2;
    id = p.id;
    for (const f of p.fields.nodes) if (f.name) fields[f.name] = f;
    for (const n of p.items.nodes) {
      if (n.isArchived || !n.content) continue;
      const values: Record<string, string> = {};
      for (const v of n.fieldValues.nodes) {
        const name = v.field?.name;
        if (!name) continue;
        const val = v.text ?? v.name ?? v.milestone?.title;
        if (val != null) values[name] = val;
      }
      const c = n.content;
      items.push({
        id: n.id,
        contentId: c.id,
        kind: c.__typename === "Issue" ? "issue" : "draft",
        number: c.number,
        url: c.url,
        closed: c.closed,
        title: c.title,
        body: c.body ?? "",
        values,
        labels: c.labels?.nodes.map((l) => l.name) ?? [],
        parent: c.parent?.number,
        subIssues: c.subIssues?.nodes.map((n) => n.number) ?? [],
        isWorkflow: !!c.labels?.nodes.some((l) => l.name === WORKFLOW_LABEL),
      });
    }
    after = p.items.pageInfo.hasNextPage ? p.items.pageInfo.endCursor : null;
  } while (after);
  return { id, number, fields, items };
}

// ---------- Writes ----------

/** Set a project field by name. Empty value clears it. Single-select values are option names. */
export async function setField(project: Project, itemId: string, fieldName: string, value: string): Promise<void> {
  const field = project.fields[fieldName];
  if (!field) throw new Error(`Project has no field "${fieldName}"`);
  if (!value) {
    await gql(
      `mutation($p:ID!,$i:ID!,$f:ID!){ clearProjectV2ItemFieldValue(input:{projectId:$p, itemId:$i, fieldId:$f}){ clientMutationId } }`,
      { p: project.id, i: itemId, f: field.id },
    );
    return;
  }
  let v: Record<string, string>;
  if (field.options) {
    const opt = field.options.find((o) => o.name === value);
    if (!opt) throw new Error(`"${value}" is not an option of ${fieldName}`);
    v = { singleSelectOptionId: opt.id };
  } else {
    v = { text: value };
  }
  await gql(
    `mutation($p:ID!,$i:ID!,$f:ID!,$v:ProjectV2FieldValue!){ updateProjectV2ItemFieldValue(input:{projectId:$p, itemId:$i, fieldId:$f, value:$v}){ clientMutationId } }`,
    { p: project.id, i: itemId, f: field.id, v },
  );
}

export async function setFields(project: Project, itemId: string, values: Record<string, string>): Promise<void> {
  for (const [k, v] of Object.entries(values)) await setField(project, itemId, k, v);
}

/** Replace a draft item's description (Assets board: the asset's description). */
export async function setDraftBody(item: Item, body: string): Promise<void> {
  if (item.kind !== "draft") return;
  await gql(`mutation($id:ID!,$b:String!){ updateProjectV2DraftIssue(input:{draftIssueId:$id, body:$b}){ draftIssue{ id } } }`, { id: item.contentId, b: body });
}

/** Replace an issue's description: for tasks and workflows, that's their prompt. */
export async function setIssueBody(item: Item, body: string): Promise<void> {
  if (item.kind !== "issue") return;
  await gql(`mutation($id:ID!,$b:String!){ updateIssue(input:{id:$id, body:$b}){ clientMutationId } }`, { id: item.contentId, b: body });
}

export async function renameItem(item: Item, title: string): Promise<void> {
  if (item.kind === "issue") {
    await gql(`mutation($id:ID!,$t:String!){ updateIssue(input:{id:$id, title:$t}){ clientMutationId } }`, { id: item.contentId, t: title });
  } else {
    await gql(`mutation($id:ID!,$t:String!){ updateProjectV2DraftIssue(input:{draftIssueId:$id, title:$t}){ clientMutationId } }`, {
      id: item.contentId,
      t: title,
    });
  }
}

/** Remove an item from a project. For a draft (assets) this deletes it for good. */
export async function deleteItem(project: Project, item: Item): Promise<void> {
  await gql(`mutation($p:ID!,$i:ID!){ deleteProjectV2Item(input:{projectId:$p, itemId:$i}){ deletedItemId } }`, { p: project.id, i: item.id });
}

/**
 * "Delete" a task: close its issue as not planned and take it off the board.
 * The issue itself stays in the repo (reopen it there if it was a mistake); really
 * deleting issues is admin-only and permanent, so the hub never does that.
 */
export async function removeTask(project: Project, item: Item): Promise<void> {
  if (item.kind === "issue" && !item.closed) {
    await gql(`mutation($id:ID!){ closeIssue(input:{issueId:$id, stateReason:NOT_PLANNED}){ clientMutationId } }`, { id: item.contentId });
  }
  await deleteItem(project, item);
}

export async function setIssueClosed(item: Item, closed: boolean): Promise<void> {
  if (item.kind !== "issue") return;
  const m = closed ? "closeIssue(input:{issueId:$id})" : "reopenIssue(input:{issueId:$id})";
  await gql(`mutation($id:ID!){ ${m}{ clientMutationId } }`, { id: item.contentId });
}

/** New task = new issue in the game repo, added to its Tasks project, then fields set. */
export type NewTask = {
  title: string;
  body?: string;
  milestoneId?: string | null;
  values: Record<string, string>; // project fields
  workflow?: Item | null; // parent workflow; the new issue becomes its sub-issue
  asWorkflow?: boolean; // create a workflow (issue labelled `workflow`) instead of a task
  labels?: string[]; // extra labels, e.g. "sound"
};

export async function createTask(game: Game, project: Project, t: NewTask): Promise<void> {
  const names = [...(t.asWorkflow ? [WORKFLOW_LABEL] : []), ...(t.labels ?? [])];
  const labelIds = names.length ? await Promise.all(names.map((n) => labelId(game, n))) : null;
  const d = await gql<{ createIssue: { issue: { id: string } } }>(
    `mutation($r:ID!,$t:String!,$b:String,$m:ID,$l:[ID!]){ createIssue(input:{repositoryId:$r, title:$t, body:$b, milestoneId:$m, labelIds:$l}){ issue{ id } } }`,
    { r: game.repoId, t: t.title, b: t.body || "Created from the hub.", m: t.milestoneId || null, l: labelIds },
  );
  const issueId = d.createIssue.issue.id;
  const a = await gql<{ addProjectV2ItemById: { item: { id: string } } }>(
    `mutation($p:ID!,$c:ID!){ addProjectV2ItemById(input:{projectId:$p, contentId:$c}){ item{ id } } }`,
    { p: project.id, c: issueId },
  );
  await setFields(project, a.addProjectV2ItemById.item.id, t.values);
  if (t.workflow) await addSubIssue(t.workflow.contentId, issueId);
}

async function addSubIssue(parentIssueId: string, childIssueId: string): Promise<void> {
  await gql(`mutation($p:ID!,$c:ID!){ addSubIssue(input:{issueId:$p, subIssueId:$c, replaceParent:true}){ clientMutationId } }`, {
    p: parentIssueId,
    c: childIssueId,
  });
}

/** Move a task into another workflow, or out of its workflow (to = null). */
export async function setWorkflow(task: Item, from: Item | null, to: Item | null): Promise<void> {
  if (task.kind !== "issue") return;
  if (to) {
    await addSubIssue(to.contentId, task.contentId);
  } else if (from) {
    await gql(`mutation($p:ID!,$c:ID!){ removeSubIssue(input:{issueId:$p, subIssueId:$c}){ clientMutationId } }`, {
      p: from.contentId,
      c: task.contentId,
    });
  }
}

const LABELS: Record<string, { color: string; description: string }> = {
  [WORKFLOW_LABEL]: { color: "5B3FB0", description: "A list of tasks (sub-issues)" },
  sound: { color: "C26A1A", description: "A sound effect or music track generated in the hub's Sounds tab" },
};

/** A repo label's ID, created on first use. */
export async function labelId(game: Game, name: string): Promise<string> {
  type L = { repository: { label: { id: string } | null } };
  const q = `query($o:String!,$n:String!,$l:String!){ repository(owner:$o, name:$n){ label(name:$l){ id } } }`;
  const found = await gql<L>(q, { o: ORG, n: game.repo, l: name });
  if (found.repository.label) return found.repository.label.id;
  const meta = LABELS[name] ?? { color: "CFCBC2", description: "" };
  const made = await gql<{ createLabel: { label: { id: string } } }>(
    `mutation($r:ID!,$n:String!,$c:String!,$d:String){ createLabel(input:{repositoryId:$r, name:$n, color:$c, description:$d}){ label{ id } } }`,
    { r: game.repoId, n: name, c: meta.color, d: meta.description },
  );
  return made.createLabel.label.id;
}

export async function createAsset(project: Project, title: string, values: Record<string, string>): Promise<void> {
  const d = await gql<{ addProjectV2DraftIssue: { projectItem: { id: string } } }>(
    `mutation($p:ID!,$t:String!){ addProjectV2DraftIssue(input:{projectId:$p, title:$t}){ projectItem{ id } } }`,
    { p: project.id, t: title },
  );
  await setFields(project, d.addProjectV2DraftIssue.projectItem.id, values);
}

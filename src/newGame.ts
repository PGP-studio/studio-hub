// "New game": a private repo from game-template with the topic `game`, its Tasks and Assets
// Projects with the standard fields, and hub.config.json / default.project.json / wally.toml
// filled in. Defaults (systems, asset types, areas) come from the template's hub.config.json,
// so editing the template changes what new games start with.

import { gql, ORG, type HubConfig } from "./github";

const TEMPLATE_REPO = "game-template";
const TASK_STATUSES = ["Ready", "In progress", "In review", "Done"];
const COLORS = ["GRAY", "BLUE", "YELLOW", "GREEN", "ORANGE", "PURPLE", "PINK", "RED"];

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function createGame(name: string, step: (text: string) => void): Promise<string> {
  const slug = slugify(name);
  if (!slug) throw new Error("Give the game a name with letters or numbers.");

  step("Checking the name…");
  if (await repoExists(slug)) throw new Error(`A repo called ${slug} already exists.`);
  const ids = await gql<{ organization: { id: string }; repository: { id: string } }>(
    `query($org:String!,$t:String!){ organization(login:$org){ id } repository(owner:$org, name:$t){ id } }`,
    { org: ORG, t: TEMPLATE_REPO },
  );
  const ownerId = ids.organization.id;

  step("Creating the repo from game-template…");
  const repo = await gql<{ cloneTemplateRepository: { repository: { id: string } } }>(
    `mutation($t:ID!,$o:ID!,$n:String!,$d:String){
      cloneTemplateRepository(input:{repositoryId:$t, ownerId:$o, name:$n, description:$d, visibility:PRIVATE}){ repository{ id } } }`,
    { t: ids.repository.id, o: ownerId, n: slug, d: `${name}: a PGP-studio Roblox game` },
  );
  const repoId = repo.cloneTemplateRepository.repository.id;
  await gql(`mutation($r:ID!){ updateTopics(input:{repositoryId:$r, topicNames:["game"]}){ clientMutationId } }`, { r: repoId });

  step("Waiting for the repo's files…");
  const head = await waitForFiles(repoId);
  const cfg = JSON.parse(head.config) as HubConfig;

  step("Creating the Tasks board…");
  const tasks = await createProject(ownerId, repoId, `${name} · Tasks`, TASK_STATUSES, ["GRAY", "BLUE", "YELLOW", "GREEN"]);
  await addField(tasks.id, "Worker");
  await addField(tasks.id, "Files");
  await addField(tasks.id, "System", cfg.systems);
  await addField(tasks.id, "Area", cfg.structure.units);

  step("Creating the Assets board…");
  const assets = await createProject(ownerId, repoId, `${name} · Assets`, cfg.assetStatuses, ["GRAY", "YELLOW", "BLUE", "GREEN"]);
  await addField(assets.id, cfg.assetTypeField ?? "Asset type", cfg.assetTypes);
  await addField(assets.id, "Area", cfg.structure.units);
  await addField(assets.id, "Made by");
  await addField(assets.id, "Prompt");
  await addField(assets.id, "Roblox ID");

  step("Writing hub.config.json…");
  const newCfg = { ...cfg, name, tasksProject: tasks.number, assetsProject: assets.number };
  const files = [{ path: "hub.config.json", contents: base64(JSON.stringify(newCfg, null, 2) + "\n") }];
  if (head.project) files.push({ path: "default.project.json", contents: base64(head.project.replace(/"name": "[^"]*"/, `"name": "${slug}"`)) });
  if (head.wally) files.push({ path: "wally.toml", contents: base64(head.wally.replace(/name = "pgp-studio\/[^"]*"/, `name = "pgp-studio/${slug}"`)) });
  await gql(`mutation($i:CreateCommitOnBranchInput!){ createCommitOnBranch(input:$i){ commit{ oid } } }`, {
    i: {
      branch: { repositoryNameWithOwner: `${ORG}/${slug}`, branchName: head.branch },
      expectedHeadOid: head.oid,
      message: {
        headline: `Set up ${name} for the studio hub`,
        body: `Tasks project #${tasks.number}, Assets project #${assets.number}. Created by the hub's New game button.`,
      },
      fileChanges: { additions: files },
    },
  });
  return slug;
}

async function repoExists(name: string): Promise<boolean> {
  try {
    const d = await gql<{ repository: { id: string } | null }>(`query($o:String!,$n:String!){ repository(owner:$o, name:$n){ id } }`, { o: ORG, n: name });
    return !!d.repository;
  } catch (e) {
    if (/Could not resolve to a Repository/.test(String(e))) return false;
    throw e;
  }
}

type Head = { branch: string; oid: string; config: string; project?: string; wally?: string };

/** Cloning from a template is asynchronous: wait until the new repo has its first commit. */
async function waitForFiles(repoId: string): Promise<Head> {
  type R = {
    node: {
      defaultBranchRef: { name: string; target: { oid: string } } | null;
      config: { text: string } | null;
      project: { text: string } | null;
      wally: { text: string } | null;
    };
  };
  for (let i = 0; i < 20; i++) {
    if (i) await new Promise((r) => setTimeout(r, 1500));
    const n = (
      await gql<R>(
        `query($r:ID!){ node(id:$r){ ... on Repository{ defaultBranchRef{ name target{ oid } }
          config: object(expression:"HEAD:hub.config.json"){ ... on Blob{ text } }
          project: object(expression:"HEAD:default.project.json"){ ... on Blob{ text } }
          wally: object(expression:"HEAD:wally.toml"){ ... on Blob{ text } } } } }`,
        { r: repoId },
      )
    ).node;
    if (n.defaultBranchRef && n.config) {
      return { branch: n.defaultBranchRef.name, oid: n.defaultBranchRef.target.oid, config: n.config.text, project: n.project?.text, wally: n.wally?.text };
    }
  }
  throw new Error("The new repo still has no files after 30 s. It exists on GitHub; try again or finish it by hand.");
}

function options(names: string[], colors = COLORS) {
  return names.map((name, i) => ({ name, color: colors[i % colors.length], description: "" }));
}

async function createProject(ownerId: string, repoId: string, title: string, statuses: string[], statusColors: string[]) {
  const d = await gql<{ createProjectV2: { projectV2: { id: string; number: number } } }>(
    `mutation($o:ID!,$r:ID!,$t:String!){ createProjectV2(input:{ownerId:$o, repositoryId:$r, title:$t}){ projectV2{ id number } } }`,
    { o: ownerId, r: repoId, t: title },
  );
  const p = d.createProjectV2.projectV2;
  const s = await gql<{ node: { field: { id: string } | null } }>(
    `query($p:ID!){ node(id:$p){ ... on ProjectV2{ field(name:"Status"){ ... on ProjectV2SingleSelectField{ id } } } } }`,
    { p: p.id },
  );
  if (s.node.field) {
    await gql(
      `mutation($f:ID!,$o:[ProjectV2SingleSelectFieldOptionInput!]){ updateProjectV2Field(input:{fieldId:$f, singleSelectOptions:$o}){ clientMutationId } }`,
      { f: s.node.field.id, o: options(statuses, statusColors) },
    );
  }
  return p;
}

async function addField(projectId: string, name: string, choices?: string[]) {
  await gql(
    `mutation($p:ID!,$n:String!,$t:ProjectV2CustomFieldType!,$o:[ProjectV2SingleSelectFieldOptionInput!]){
      createProjectV2Field(input:{projectId:$p, name:$n, dataType:$t, singleSelectOptions:$o}){ clientMutationId } }`,
    { p: projectId, n: name, t: choices ? "SINGLE_SELECT" : "TEXT", o: choices ? options(choices) : null },
  );
}

function base64(text: string): string {
  let bin = "";
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}

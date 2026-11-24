import { useState } from "react";
import type { Run } from "../App";
import { createTask, removeTask, renameItem, setFields, setIssueBody, type Game, type Item, type Project } from "../github";
import { copyCommandFor, pill, status, STATUSES } from "../lib";
import { TEAM } from "../team";
import Markdown from "./Markdown";
import PromptEditor, { promptOf, WORKFLOW_TEMPLATE } from "./PromptEditor";
import TaskDialog from "./TaskDialog";

// A workflow is an issue labelled `workflow` on the Tasks board; its tasks are its sub-issues, in order.
// Its Worker field holds the owner (e.g. "Dev C"). Its description is the feature's brief; each task's
// description is that task's prompt. `/workflow <name>` in Claude Code runs the tasks one by one.

type Props = {
  game: Game;
  project: Project;
  me: string; // e.g. "George's Claude"
  run: Run;
  notify: (text: string) => void;
  patch: (fn: (p: Project) => Project) => void;
  showOnBoard: (workflowNumber: number) => void;
};

export default function Workflows(props: Props) {
  const { game, project, run, notify } = props;
  const workflows = project.items.filter((i) => i.isWorkflow && !i.closed);
  const [creating, setCreating] = useState(false);
  const [planName, setPlanName] = useState("");
  const copyCommand = copyCommandFor(game, notify);

  return (
    <>
      <div className="card plan-card">
        <div>
          <b>Plan a feature with Claude</b>
          <p className="small" style={{ margin: "2px 0 0" }}>
            Claude proposes the tasks with a prompt for each, you approve, then it creates the workflow here. Then press <b>Run with Claude</b>.
          </p>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <input className="input" style={{ flex: "1 1 160px" }} placeholder="Feature, e.g. Pets" value={planName} onChange={(e) => setPlanName(e.target.value)} />
          <button className="btn" disabled={!planName.trim()} onClick={() => copyCommand(`/plan-workflow ${planName.trim()}`)}>
            Plan with Claude
          </button>
          <button className="btn-primary" onClick={() => setCreating((x) => !x)}>
            New workflow by hand
          </button>
        </div>
      </div>
      {creating ? <WorkflowForm game={game} project={project} run={run} done={() => setCreating(false)} /> : null}
      {!workflows.length && !creating ? <p className="empty">No workflows yet. Make one for each big feature, e.g. World creation, Animals, Guns.</p> : null}
      <div className="workflows">
        {workflows.map((w) => (
          <WorkflowCard key={w.id} {...props} workflow={w} copyCommand={copyCommand} />
        ))}
      </div>
    </>
  );
}

function WorkflowForm({ game, project, run, done, workflow }: { game: Game; project: Project; run: Run; done: () => void; workflow?: Item }) {
  const original = promptOf(workflow?.body ?? "");
  const [title, setTitle] = useState(workflow?.title ?? "");
  const [owner, setOwner] = useState(workflow?.values["Worker"] ?? "");
  const [system, setSystem] = useState(workflow?.values["System"] ?? "");
  const [prompt, setPrompt] = useState(original);
  const [busy, setBusy] = useState(false);
  const systems = project.fields["System"]?.options?.map((o) => o.name) ?? game.config.systems;

  const save = async () => {
    if (!title.trim()) return;
    setBusy(true);
    const values: Record<string, string> = { Worker: owner.trim(), System: system };
    const ok = workflow
      ? await run("Workflow saved", async () => {
          if (title.trim() !== workflow.title) await renameItem(workflow, title.trim());
          if (prompt.trim() !== original) await setIssueBody(workflow, prompt.trim());
          await setFields(project, workflow.id, values);
        })
      : await run("Workflow created", () =>
          createTask(game, project, {
            title: title.trim(),
            body: prompt.trim() || "A workflow: its tasks are the sub-issues below.",
            values: Object.fromEntries(Object.entries(values).filter(([, v]) => v)),
            asWorkflow: true,
          }),
        );
    setBusy(false);
    if (ok) done();
  };

  return (
    <div className="card" style={{ background: "var(--bg)", gap: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <input className="input" style={{ flex: "2 1 180px" }} placeholder="Workflow name, e.g. Animals" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        <input className="input" style={{ flex: "1 1 120px" }} list="team-names" placeholder="Owner" value={owner} onChange={(e) => setOwner(e.target.value)} />
        <datalist id="team-names">
          {TEAM.map((m) => (
            <option key={m.name} value={m.name} />
          ))}
        </datalist>
        <select className="input" value={system} onChange={(e) => setSystem(e.target.value)} aria-label="System">
          <option value="">System</option>
          {systems.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <PromptEditor
        label="Workflow prompt (the feature's brief)"
        value={prompt}
        onChange={setPrompt}
        template={WORKFLOW_TEMPLATE}
        hint="Claude reads this before every task in the workflow."
      />
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button className="btn" onClick={done}>
          Cancel
        </button>
        <button className="btn-primary" disabled={busy || !title.trim()} onClick={save}>
          {busy ? "Saving…" : workflow ? "Save" : "Create"}
        </button>
      </div>
    </div>
  );
}

function WorkflowCard({ game, project, workflow: w, me, run, notify, patch, showOnBoard, copyCommand }: Props & { workflow: Item; copyCommand: (c: string) => void }) {
  const [mode, setMode] = useState<"" | "edit" | "bulk">("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const order = new Map(w.subIssues.map((n, i) => [n, i]));
  const tasks = project.items
    .filter((t) => t.parent === w.number && !t.isWorkflow)
    .sort((a, b) => (order.get(a.number!) ?? 1e6) - (order.get(b.number!) ?? 1e6) || (a.number ?? 0) - (b.number ?? 0));
  const workflows = project.items.filter((i) => i.isWorkflow && !i.closed);
  const done = tasks.filter((t) => status(t) === "Done").length;
  const busy = tasks.filter((t) => status(t) === "In progress");
  const workers = [...new Set(busy.map((t) => t.values["Worker"]).filter(Boolean))];
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const missing = tasks.filter((t) => status(t) !== "Done" && !promptOf(t.body)).length;
  const brief = promptOf(w.body);

  const del = async () => {
    if (!confirm(`Delete the workflow "${w.title}"?\n\nIts ${tasks.length} tasks stay on the board, just without a workflow. The workflow's issue is closed as "not planned".`)) return;
    await run("Workflow deleted", () => removeTask(project, w));
  };

  const runWithClaude = () => {
    copyCommand(`/workflow ${w.title}`);
    if (missing) notify(`Copied /workflow ${w.title}. ${missing} task${missing === 1 ? " has" : "s have"} no prompt yet; Claude will offer to write them first.`);
  };

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <b style={{ fontSize: 15 }}>{w.title}</b>
        <span className="small">{w.values["Worker"] ? `Owner: ${w.values["Worker"]}` : "No owner"}</span>
      </div>
      <div className="tags">
        {w.values["System"] ? <span className="tag sys">{w.values["System"]}</span> : null}
        {STATUSES.map((s) => {
          const n = tasks.filter((t) => status(t) === s).length;
          return n ? (
            <span key={s} className="tag ms">
              {s} {n}
            </span>
          ) : null;
        })}
        {missing ? <span className="tag no-prompt-tag">{missing} without prompt</span> : null}
      </div>
      <div className="meter">
        <span>
          {done} of {tasks.length} tasks done
        </span>
        <div className="track">
          <div style={{ width: `${pct}%`, background: "var(--blue)" }} />
        </div>
      </div>
      <div className="small">{workers.length ? `${workers.join(", ")} working on it now` : "Nobody working on it now"}</div>

      <div className="card-actions" style={{ flexWrap: "wrap" }}>
        <button className="act run-act" disabled={!tasks.length} title={tasks.length ? "Copies /workflow <name>: Claude runs the tasks one by one" : "Add tasks first"} onClick={runWithClaude}>
          Run with Claude
        </button>
        <button className="act small-act" onClick={() => setOpen((x) => !x)} aria-expanded={open}>
          {open ? "Hide tasks" : `Tasks and prompts (${tasks.length})`}
        </button>
        <button className="act small-act" onClick={() => showOnBoard(w.number!)}>
          Show on board
        </button>
      </div>

      {open ? (
        <div className="wf-detail">
          <div className="wf-brief">
            <div className="card-head">
              <span className="sub-title" style={{ margin: 0 }}>
                Workflow prompt
              </span>
              <button className="row-del" onClick={() => setMode(mode === "edit" ? "" : "edit")}>
                {mode === "edit" ? "Close" : "Edit"}
              </button>
            </div>
            {mode === "edit" ? (
              <WorkflowForm game={game} project={project} run={run} workflow={w} done={() => setMode("")} />
            ) : brief ? (
              <Markdown text={brief} />
            ) : (
              <p className="empty">No brief yet. Edit to add the feature's goal and rules.</p>
            )}
          </div>
          <span className="sub-title">Tasks, in the order Claude runs them</span>
          {tasks.length ? (
            <ol className="wf-tasks">
              {tasks.map((t) => {
                const [bg, fg] = pill(status(t) === "Done" ? "Approved" : status(t) === "In progress" ? "In Studio" : status(t) === "In review" ? "Generated" : "Idea");
                return (
                  <li key={t.id}>
                    <button className="wf-task" onClick={() => setEditing(t)} title="Read or edit this task's prompt">
                      <span className="wf-task-title">
                        {t.title} <span className="small">#{t.number}</span>
                      </span>
                      <span style={{ display: "flex", gap: 4, alignItems: "center", flex: "none" }}>
                        {!promptOf(t.body) && status(t) !== "Done" ? <span className="tag no-prompt-tag">no prompt</span> : null}
                        <span className="tag" style={{ background: bg, color: fg }}>
                          {status(t)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="empty">No tasks yet.</p>
          )}
          <span className="small">To change the order, drag the sub-issues on the workflow's GitHub issue.</span>
          <div className="card-actions" style={{ flexWrap: "wrap" }}>
            <button className="act small-act" onClick={() => setEditing("new")}>
              Add task
            </button>
            <button className="act small-act" onClick={() => setMode(mode === "bulk" ? "" : "bulk")}>
              One per {game.config.structure.label.replace(/s$/, "").toLowerCase()}
            </button>
            {w.url ? (
              <a className="act small-act" href={w.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none", color: "inherit" }}>
                Open on GitHub
              </a>
            ) : null}
            <button className="act small-act" onClick={del}>
              Delete workflow
            </button>
          </div>
          {mode === "bulk" ? <AddPerArea game={game} project={project} workflow={w} run={run} notify={notify} done={() => setMode("")} /> : null}
        </div>
      ) : null}

      {editing ? (
        <TaskDialog
          game={game}
          project={project}
          task={editing === "new" ? null : editing}
          workflows={workflows}
          defaultWorkflow={w.number}
          me={me}
          run={run}
          hide={(id) => patch((p) => ({ ...p, items: p.items.filter((i) => i.id !== id) }))}
          copyCommand={copyCommand}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

/** One task per area from a title template like "{area}: build sections 1–5". Prompts are written afterwards (or by /workflow). */
function AddPerArea(p: { game: Game; project: Project; workflow: Item; run: Run; notify: (t: string) => void; done: () => void }) {
  const cfg = p.game.config;
  const one = cfg.structure.label.replace(/s$/, "").toLowerCase();
  const placeholder = `{${one}}`;
  const [title, setTitle] = useState(`${placeholder}: ${p.workflow.title.toLowerCase()}`);
  const [files, setFiles] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const units = p.project.fields["Area"]?.options?.map((o) => o.name) ?? cfg.structure.units;
  const system = p.workflow.values["System"] ?? "";

  const add = async () => {
    if (!title.trim()) return;
    const list = units.map((u) => ({ title: title.split(placeholder).join(u), area: u }));
    if (!confirm(`Create ${list.length} tasks in "${p.workflow.title}", e.g. "${list[0].title}"?\n\nThey start without prompts; write them in the task list or let /workflow write them for approval.`)) return;
    let made = 0;
    const ok = await p.run(`Added ${list.length} tasks to ${p.workflow.title}`, async () => {
      for (const t of list) {
        setBusy(`Creating ${made + 1} of ${list.length}…`);
        const values: Record<string, string> = { Status: "Ready", Area: t.area };
        if (system) values["System"] = system;
        if (files.trim()) values["Files"] = files.trim().split(placeholder).join(t.area);
        await createTask(p.game, p.project, { title: t.title, values, workflow: p.workflow });
        made++;
      }
    });
    setBusy(null);
    if (!ok && made) p.notify(`Stopped after ${made} of ${list.length} tasks; the rest weren't created.`);
    if (ok) p.done();
  };

  return (
    <div className="card" style={{ background: "var(--bg)", gap: 8 }}>
      <input className="input" placeholder={`Title with ${placeholder}`} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input
          className="input mono"
          style={{ flex: "1 1 180px" }}
          placeholder={`Files (optional, ${placeholder} allowed)`}
          value={files}
          onChange={(e) => setFiles(e.target.value)}
        />
        <button className="btn" onClick={p.done} disabled={!!busy}>
          Cancel
        </button>
        <button className="btn-primary" disabled={!!busy || !title.trim()} onClick={add}>
          {busy ?? `Create ${units.length} tasks`}
        </button>
      </div>
    </div>
  );
}

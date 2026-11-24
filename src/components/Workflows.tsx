import { useState } from "react";
import type { Run } from "../App";
import { createTask, removeTask, renameItem, setFields, type Game, type Item, type Project } from "../github";
import { status, STATUSES } from "../lib";
import { TEAM } from "../team";

// A workflow is an issue labelled `workflow` on the Tasks board; its tasks are its sub-issues.
// Its Worker field holds the owner (e.g. "Dev C"); that person's Claude works through it with /next-task.

type Props = {
  game: Game;
  project: Project;
  run: Run;
  notify: (text: string) => void;
  showOnBoard: (workflowNumber: number) => void;
};

export default function Workflows({ game, project, run, notify, showOnBoard }: Props) {
  const workflows = project.items.filter((i) => i.isWorkflow && !i.closed);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <span className="small">
          A workflow is one feature's list of tasks. Its owner's Claude works through it with <code>/next-task</code>.
        </span>
        <button className="btn-primary" onClick={() => setCreating((x) => !x)}>
          New workflow
        </button>
      </div>
      {creating ? <WorkflowForm game={game} project={project} run={run} done={() => setCreating(false)} /> : null}
      {!workflows.length && !creating ? <p className="empty">No workflows yet. Make one for each big feature, e.g. World creation, Animals, Guns.</p> : null}
      <div className="workflows">
        {workflows.map((w) => (
          <WorkflowCard key={w.id} game={game} project={project} workflow={w} run={run} notify={notify} showOnBoard={showOnBoard} />
        ))}
      </div>
    </>
  );
}

function WorkflowForm({ game, project, run, done, workflow }: { game: Game; project: Project; run: Run; done: () => void; workflow?: Item }) {
  const [title, setTitle] = useState(workflow?.title ?? "");
  const [owner, setOwner] = useState(workflow?.values["Worker"] ?? "");
  const [system, setSystem] = useState(workflow?.values["System"] ?? "");
  const [busy, setBusy] = useState(false);
  const systems = project.fields["System"]?.options?.map((o) => o.name) ?? game.config.systems;

  const save = async () => {
    if (!title.trim()) return;
    setBusy(true);
    const values: Record<string, string> = { Worker: owner.trim(), System: system };
    const ok = workflow
      ? await run("Workflow saved", async () => {
          if (title.trim() !== workflow.title) await renameItem(workflow, title.trim());
          await setFields(project, workflow.id, values);
        })
      : await run("Workflow created", () =>
          createTask(game, project, {
            title: title.trim(),
            body: "A workflow: its tasks are the sub-issues below.",
            values: Object.fromEntries(Object.entries(values).filter(([, v]) => v)),
            asWorkflow: true,
          }),
        );
    setBusy(false);
    if (ok) done();
  };

  return (
    <div className="card" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center" }}>
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
      <button className="btn" onClick={done}>
        Cancel
      </button>
      <button className="btn-primary" disabled={busy || !title.trim()} onClick={save}>
        {busy ? "Saving…" : workflow ? "Save" : "Create"}
      </button>
    </div>
  );
}

function WorkflowCard({ game, project, workflow: w, run, notify, showOnBoard }: { workflow: Item } & Omit<Props, "project"> & { project: Project }) {
  const [mode, setMode] = useState<"" | "edit" | "add" | "bulk">("");
  const tasks = project.items.filter((t) => t.parent === w.number && !t.isWorkflow);
  const done = tasks.filter((t) => status(t) === "Done").length;
  const busy = tasks.filter((t) => status(t) === "In progress");
  const workers = [...new Set(busy.map((t) => t.values["Worker"]).filter(Boolean))];
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

  const del = async () => {
    if (!confirm(`Delete the workflow "${w.title}"?\n\nIts ${tasks.length} tasks stay on the board, just without a workflow. The workflow's issue is closed as "not planned".`)) return;
    await run("Workflow deleted", () => removeTask(project, w));
  };

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <b style={{ fontSize: 15 }}>
          {w.title} <span className="small">#{w.number}</span>
        </b>
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
        <button className="act" onClick={() => showOnBoard(w.number!)}>
          Show on board
        </button>
        <button className="act small-act" onClick={() => setMode(mode === "add" ? "" : "add")}>
          Add task
        </button>
        <button className="act small-act" onClick={() => setMode(mode === "bulk" ? "" : "bulk")}>
          One per {game.config.structure.label.replace(/s$/, "").toLowerCase()}
        </button>
        <button className="act small-act" onClick={() => setMode(mode === "edit" ? "" : "edit")}>
          Edit
        </button>
        <button className="act small-act" onClick={del}>
          Delete
        </button>
      </div>
      {mode === "edit" ? <WorkflowForm game={game} project={project} run={run} workflow={w} done={() => setMode("")} /> : null}
      {mode === "add" ? <AddTasks game={game} project={project} workflow={w} run={run} notify={notify} bulk={false} done={() => setMode("")} /> : null}
      {mode === "bulk" ? <AddTasks game={game} project={project} workflow={w} run={run} notify={notify} bulk done={() => setMode("")} /> : null}
    </div>
  );
}

/** Add one task to a workflow, or one task per area from a title template like "{area}: build sections 1–5". */
function AddTasks(p: { game: Game; project: Project; workflow: Item; run: Run; notify: (t: string) => void; bulk: boolean; done: () => void }) {
  const cfg = p.game.config;
  const one = cfg.structure.label.replace(/s$/, "").toLowerCase();
  const [title, setTitle] = useState(p.bulk ? `{${one}}: ${p.workflow.title.toLowerCase()}` : "");
  const [area, setArea] = useState("");
  const [files, setFiles] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const units = p.project.fields["Area"]?.options?.map((o) => o.name) ?? cfg.structure.units;
  const placeholder = `{${one}}`;
  const system = p.workflow.values["System"] ?? "";

  const add = async () => {
    if (!title.trim()) return;
    const list = p.bulk ? units.map((u) => ({ title: title.split(placeholder).join(u), area: u })) : [{ title: title.trim(), area }];
    if (p.bulk && !confirm(`Create ${list.length} tasks in "${p.workflow.title}", e.g. "${list[0].title}"?`)) return;
    let made = 0;
    const ok = await p.run(`Added ${list.length} task${list.length === 1 ? "" : "s"} to ${p.workflow.title}`, async () => {
      for (const t of list) {
        setBusy(`Creating ${made + 1} of ${list.length}…`);
        const values: Record<string, string> = { Status: "Ready" };
        if (system) values["System"] = system;
        if (t.area) values["Area"] = t.area;
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
      <input
        className="input"
        placeholder={p.bulk ? `Title with ${placeholder}, e.g. ${placeholder}: build sections 1–5` : "Task title"}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
      />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {!p.bulk ? (
          <select className="input" value={area} onChange={(e) => setArea(e.target.value)} aria-label="Area">
            <option value="">whole game</option>
            {units.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        ) : null}
        <input
          className="input mono"
          style={{ flex: "1 1 180px" }}
          placeholder={p.bulk ? `Files (optional, ${placeholder} allowed)` : "Files (optional)"}
          value={files}
          onChange={(e) => setFiles(e.target.value)}
        />
        <button className="btn" onClick={p.done} disabled={!!busy}>
          Cancel
        </button>
        <button className="btn-primary" disabled={!!busy || !title.trim()} onClick={add}>
          {busy ?? (p.bulk ? `Create ${units.length} tasks` : "Add task")}
        </button>
      </div>
      {p.bulk ? (
        <span className="small">
          Makes one Ready task per {one} ({units.length}), each with its {one} set, in this workflow. Individual animals, guns and zones stay in Assets.
        </span>
      ) : null}
    </div>
  );
}

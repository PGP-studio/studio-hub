import { useState } from "react";
import type { Run } from "../App";
import { createTask, removeTask, renameItem, setFields, setIssueClosed, type Game, type Item, type Project } from "../github";
import { overlaps, replaceItem, status, STATUSES } from "../lib";

type Props = {
  game: Game;
  project: Project;
  me: string;
  run: Run;
  notify: (text: string) => void;
  patch: (fn: (p: Project) => Project) => void;
};

export default function Board({ game, project, me, run, notify, patch }: Props) {
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const tasks = project.items;
  const myWorker = `${me}'s Claude`;

  // Change fields locally first so the card moves at once, then write to GitHub.
  const update = (t: Item, values: Record<string, string>, label: string, close?: boolean) => {
    patch((p) => replaceItem(p, t.id, (i) => ({ ...i, values: { ...i.values, ...values }, closed: close ?? i.closed })));
    return run(label, async () => {
      await setFields(project, t.id, values);
      if (close !== undefined && close !== !!t.closed) await setIssueClosed(t, close);
    });
  };

  // A web page can't open Claude Code, so "Start with Claude" copies the command to paste into it.
  // Claude then claims the task itself (checking file overlaps first) and opens the branch and PR.
  const copyCommand = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      notify(`Copied ${command}. Paste it into Claude Code in the ${game.repo} folder.`);
    } catch {
      notify(`Type ${command} in Claude Code in the ${game.repo} folder.`);
    }
  };

  const actionFor = (t: Item): [string, () => void] | null => {
    switch (status(t)) {
      case "Ready":
        return t.number ? ["Start with Claude", () => copyCommand(`/task ${t.number}`)] : null;
      case "In progress":
        return ["Send to review", () => update(t, { Status: "In review" }, "Sent to review")];
      case "In review":
        return ["Mark done", () => update(t, { Status: "Done" }, "Marked done", true)];
      default:
        return null;
    }
  };

  return (
    <>
      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <span className="small">
          {tasks.length} tasks in {game.config.name} · Tasks. Click a title to edit.
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn" title="Claude picks the next Ready task from your workflow and starts it" onClick={() => copyCommand("/next-task")}>
            Next task with Claude
          </button>
          <button className="btn-primary" onClick={() => setEditing("new")}>
            New task
          </button>
        </div>
      </div>
      <div className="columns">
        {STATUSES.map((col) => {
          const cards = tasks.filter((t) => status(t) === col);
          return (
            <section key={col} className="column">
              <div className="column-head">
                <h3>{col}</h3>
                <span className="sub">{cards.length}</span>
              </div>
              {cards.map((t) => {
                const clash = overlaps(t, tasks);
                const act = actionFor(t);
                const worker = t.values["Worker"];
                return (
                  <article key={t.id} className={"task" + (col === "In progress" ? " busy" : "")}>
                    <button className="task-title" onClick={() => setEditing(t)}>
                      {t.title}
                      {t.number ? <span className="small"> #{t.number}</span> : null}
                    </button>
                    <div className="tags">
                      {t.values["System"] ? <span className="tag sys">{t.values["System"]}</span> : null}
                      <span className="tag area">{t.values["Area"] || "whole game"}</span>
                      {t.values["Milestone"] ? <span className="tag ms">{t.values["Milestone"]}</span> : null}
                    </div>
                    <div className="small" style={{ fontSize: 13 }}>
                      {worker ? (col === "Done" ? `Done · ${worker}` : worker) : "Nobody yet"}
                    </div>
                    {t.values["Files"] ? <div className="files">{t.values["Files"]}</div> : null}
                    {clash.length ? <div className="warn">Same files as: {clash.map((c) => c.title).join(", ")}</div> : null}
                    <div className="card-actions">
                      {act ? (
                        <button className="act" onClick={act[1]}>
                          {act[0]}
                        </button>
                      ) : null}
                      {col === "Ready" ? (
                        <button
                          className="act small-act"
                          title="Mark it as yours without starting Claude (e.g. working by hand)"
                          onClick={() => update(t, { Status: "In progress", Worker: t.values["Worker"] || myWorker }, "Claimed")}
                        >
                          Claim
                        </button>
                      ) : null}
                      <button className="act small-act" onClick={() => setEditing(t)} aria-label={`Edit ${t.title}`}>
                        Edit
                      </button>
                    </div>
                  </article>
                );
              })}
              {!cards.length ? <p className="empty">Nothing here.</p> : null}
            </section>
          );
        })}
      </div>
      {editing ? (
        <TaskDialog
          game={game}
          project={project}
          task={editing === "new" ? null : editing}
          me={myWorker}
          run={run}
          hide={(id) => patch((p) => ({ ...p, items: p.items.filter((i) => i.id !== id) }))}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function TaskDialog({
  game,
  project,
  task,
  me,
  run,
  hide,
  onClose,
}: {
  game: Game;
  project: Project;
  task: Item | null;
  me: string;
  run: Run;
  hide: (itemId: string) => void;
  onClose: () => void;
}) {
  const v = task?.values ?? {};
  const [title, setTitle] = useState(task?.title ?? "");
  const [body, setBody] = useState("");
  const [form, setForm] = useState<Record<string, string>>({
    Status: v["Status"] || "Ready",
    System: v["System"] || "",
    Area: v["Area"] || "",
    Worker: v["Worker"] || "",
    Files: v["Files"] || "",
  });
  const [milestoneId, setMilestoneId] = useState(game.milestones[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const set = (k: string, val: string) => setForm((f) => ({ ...f, [k]: val }));
  const options = (name: string) => project.fields[name]?.options?.map((o) => o.name) ?? [];
  const units = options("Area").length ? options("Area") : game.config.structure.units;
  const systems = options("System").length ? options("System") : game.config.systems;

  const save = async () => {
    if (!title.trim()) return;
    setBusy(true);
    let ok: boolean;
    if (!task) {
      const values = Object.fromEntries(Object.entries(form).filter(([, x]) => x));
      ok = await run("Task created", () => createTask(game, project, title.trim(), body, milestoneId || null, values));
    } else {
      const changed = Object.fromEntries(Object.entries(form).filter(([k, x]) => x !== (v[k] || "")));
      ok = await run("Task saved", async () => {
        if (title.trim() !== task.title) await renameItem(task, title.trim());
        await setFields(project, task.id, changed);
        const shouldClose = form.Status === "Done";
        if (task.kind === "issue" && shouldClose !== !!task.closed && "Status" in changed) await setIssueClosed(task, shouldClose);
      });
    }
    setBusy(false);
    if (ok) onClose();
  };

  const deleteTask = async () => {
    if (!task) return;
    if (!confirm(`Delete "${task.title}"?\n\nIts issue is closed as "not planned" and it leaves the board. You can reopen the issue on GitHub if this was a mistake.`)) return;
    setBusy(true);
    hide(task.id);
    const ok = await run("Task deleted", () => removeTask(project, task));
    setBusy(false);
    if (ok) onClose();
  };

  const closeTask = async () => {
    if (!task) return;
    setBusy(true);
    const closing = !task.closed;
    const ok = await run(closing ? "Task closed" : "Task reopened", async () => {
      await setIssueClosed(task, closing);
      if (closing && form.Status !== "Done") await setFields(project, task.id, { Status: "Done" });
    });
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label={task ? "Edit task" : "New task"}>
        <h2>{task ? "Edit task" : `New task in ${game.config.name}`}</h2>
        <label className="form-row">
          <span>Title</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>
        {!task ? (
          <label className="form-row">
            <span>Description (optional)</span>
            <textarea className="input" rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
        ) : null}
        <div className="form-grid">
          <label className="form-row">
            <span>Status</span>
            <select className="input" value={form.Status} onChange={(e) => set("Status", e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="form-row">
            <span>System</span>
            <select className="input" value={form.System} onChange={(e) => set("System", e.target.value)}>
              <option value="">—</option>
              {systems.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="form-row">
            <span>{game.config.structure.label.replace(/s$/, "")}</span>
            <select className="input" value={form.Area} onChange={(e) => set("Area", e.target.value)}>
              <option value="">whole game</option>
              {units.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          {!task ? (
            <label className="form-row">
              <span>Milestone</span>
              <select className="input" value={milestoneId} onChange={(e) => setMilestoneId(e.target.value)}>
                <option value="">none</option>
                {game.milestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="form-row">
              <span>Milestone</span>
              <input className="input" value={v["Milestone"] || "none"} disabled />
            </label>
          )}
        </div>
        <label className="form-row">
          <span>Worker</span>
          <div style={{ display: "flex", gap: 6 }}>
            <input className="input" style={{ flex: 1 }} value={form.Worker} placeholder="Nobody yet" onChange={(e) => set("Worker", e.target.value)} />
            <button className="btn" type="button" onClick={() => set("Worker", me)}>
              Me
            </button>
          </div>
        </label>
        <label className="form-row">
          <span>Files (comma separated; folder/* for a whole folder)</span>
          <input className="input mono" value={form.Files} onChange={(e) => set("Files", e.target.value)} />
        </label>
        <div className="dialog-actions">
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {task ? (
              <button className="btn danger" disabled={busy} onClick={deleteTask}>
                Delete
              </button>
            ) : null}
            {task?.kind === "issue" ? (
              <>
                <button className="btn" disabled={busy} onClick={closeTask}>
                  {task.closed ? "Reopen issue" : "Close issue"}
                </button>
                <a className="small" href={task.url} target="_blank" rel="noreferrer">
                  Open #{task.number}
                </a>
              </>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary" disabled={busy || !title.trim()} onClick={save}>
              {busy ? "Saving…" : task ? "Save" : "Create task"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

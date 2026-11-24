import { useState } from "react";
import type { Run } from "../App";
import {
  createTask,
  removeTask,
  renameItem,
  setFields,
  setIssueBody,
  setIssueClosed,
  setWorkflow,
  type Game,
  type Item,
  type Project,
} from "../github";
import { STATUSES } from "../lib";
import PromptEditor, { promptOf, TASK_TEMPLATE } from "./PromptEditor";

/** Create or edit a task: fields, workflow, and its prompt (the issue description Claude follows). */
export default function TaskDialog({
  game,
  project,
  task,
  workflows,
  defaultWorkflow,
  me,
  run,
  hide,
  copyCommand,
  onClose,
}: {
  game: Game;
  project: Project;
  task: Item | null;
  workflows: Item[];
  defaultWorkflow?: number;
  me: string;
  run: Run;
  hide: (itemId: string) => void;
  copyCommand: (command: string) => void;
  onClose: () => void;
}) {
  const v = task?.values ?? {};
  const original = promptOf(task?.body ?? "");
  const [title, setTitle] = useState(task?.title ?? "");
  const [prompt, setPrompt] = useState(original);
  const [form, setForm] = useState<Record<string, string>>({
    Status: v["Status"] || "Ready",
    System: v["System"] || "",
    Area: v["Area"] || "",
    Worker: v["Worker"] || "",
    Files: v["Files"] || "",
  });
  const [wf, setWf] = useState<string>(String(task ? (task.parent ?? "") : (defaultWorkflow ?? "")));
  const [milestoneId, setMilestoneId] = useState(game.milestones[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const set = (k: string, val: string) => setForm((f) => ({ ...f, [k]: val }));
  const options = (name: string) => project.fields[name]?.options?.map((o) => o.name) ?? [];
  const units = options("Area").length ? options("Area") : game.config.structure.units;
  const systems = options("System").length ? options("System") : game.config.systems;
  const dirty =
    !task ||
    title.trim() !== task.title ||
    prompt.trim() !== original ||
    wf !== String(task.parent ?? "") ||
    Object.entries(form).some(([k, x]) => x !== (v[k] || ""));

  const save = async () => {
    if (!title.trim()) return false;
    setBusy(true);
    let ok: boolean;
    if (!task) {
      const values = Object.fromEntries(Object.entries(form).filter(([, x]) => x));
      const workflow = workflows.find((w) => String(w.number) === wf) ?? null;
      ok = await run("Task created", () => createTask(game, project, { title: title.trim(), body: prompt.trim(), milestoneId, values, workflow }));
    } else {
      const changed = Object.fromEntries(Object.entries(form).filter(([k, x]) => x !== (v[k] || "")));
      ok = await run("Task saved", async () => {
        if (title.trim() !== task.title) await renameItem(task, title.trim());
        if (prompt.trim() !== original) await setIssueBody(task, prompt.trim());
        await setFields(project, task.id, changed);
        const shouldClose = form.Status === "Done";
        if (task.kind === "issue" && shouldClose !== !!task.closed && "Status" in changed) await setIssueClosed(task, shouldClose);
        if (wf !== String(task.parent ?? "")) {
          const from = workflows.find((w) => w.number === task.parent) ?? null;
          const to = workflows.find((w) => String(w.number) === wf) ?? null;
          await setWorkflow(task, from, to);
        }
      });
    }
    setBusy(false);
    return ok;
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

  // Save first if anything changed, so Claude runs exactly the prompt shown here.
  const start = async () => {
    if (!task?.number) return;
    if (dirty && !(await save())) return;
    copyCommand(`/task ${task.number}`);
    onClose();
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide" role="dialog" aria-label={task ? "Edit task" : "New task"}>
        <h2>{task ? `Task #${task.number ?? ""}` : `New task in ${game.config.name}`}</h2>
        <label className="form-row">
          <span>Title</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus={!task} />
        </label>
        <PromptEditor
          value={prompt}
          onChange={setPrompt}
          template={TASK_TEMPLATE}
          hint="This is exactly what Claude follows when someone runs /task or /workflow. It's the issue's description on GitHub."
        />
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
          <label className="form-row">
            <span>Workflow</span>
            <select className="input" value={wf} onChange={(e) => setWf(e.target.value)}>
              <option value="">No workflow</option>
              {workflows.map((w) => (
                <option key={w.id} value={String(w.number)}>
                  {w.title}
                </option>
              ))}
            </select>
          </label>
          <label className="form-row">
            <span>Worker</span>
            <div style={{ display: "flex", gap: 6 }}>
              <input className="input" style={{ flex: 1, minWidth: 0 }} value={form.Worker} placeholder="Nobody yet" onChange={(e) => set("Worker", e.target.value)} />
              <button className="btn" type="button" onClick={() => set("Worker", me)}>
                Me
              </button>
            </div>
          </label>
        </div>
        <label className="form-row">
          <span>Files (comma separated; folder/* for a whole folder)</span>
          <input className="input mono" value={form.Files} onChange={(e) => set("Files", e.target.value)} />
        </label>
        <div className="dialog-actions">
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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
                  Open #{task.number} on GitHub
                </a>
              </>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            {task?.number && !task.closed && (v["Status"] || "Ready") === "Ready" ? (
              <button
                className="btn"
                disabled={busy || !prompt.trim()}
                title={prompt.trim() ? "Saves, then copies /task N to paste into Claude Code" : "Write a prompt first"}
                onClick={start}
              >
                {dirty ? "Save and start with Claude" : "Start with Claude"}
              </button>
            ) : null}
            <button
              className="btn-primary"
              disabled={busy || !title.trim() || (task !== null && !dirty)}
              onClick={async () => {
                if (await save()) onClose();
              }}
            >
              {busy ? "Saving…" : task ? "Save" : "Create task"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

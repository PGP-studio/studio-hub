import { useState } from "react";
import type { Run } from "../App";
import { setFields, setIssueClosed, type Game, type Item, type Project } from "../github";
import { copyCommandFor, overlaps, replaceItem, status, STATUSES } from "../lib";
import TaskDialog from "./TaskDialog";
import { promptOf } from "./PromptEditor";
import { isSoundTask } from "../sounds";
import { isModelTask } from "../models";

type Props = {
  game: Game;
  project: Project;
  me: string;
  run: Run;
  notify: (text: string) => void;
  patch: (fn: (p: Project) => Project) => void;
  workflowFilter: string; // "" = all, "none" = tasks without a workflow, else workflow issue number
  setWorkflowFilter: (v: string) => void;
  openSounds: () => void;
  openModels: () => void;
};

export default function Board({ game, project, me, run, notify, patch, workflowFilter, setWorkflowFilter, openSounds, openModels }: Props) {
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const workflows = project.items.filter((i) => i.isWorkflow);
  const wfTitle = (n?: number) => workflows.find((w) => w.number === n)?.title;
  const tasks = project.items.filter((i) => !i.isWorkflow); // workflows have their own tab
  const shown = tasks.filter((t) =>
    !workflowFilter ? true : workflowFilter === "none" ? !t.parent : String(t.parent) === workflowFilter,
  );
  const myWorker = `${me}'s Claude`;

  // Change fields locally first so the card moves at once, then write to GitHub.
  const update = (t: Item, values: Record<string, string>, label: string, close?: boolean) => {
    patch((p) => replaceItem(p, t.id, (i) => ({ ...i, values: { ...i.values, ...values }, closed: close ?? i.closed })));
    return run(label, async () => {
      await setFields(project, t.id, values);
      if (close !== undefined && close !== !!t.closed) await setIssueClosed(t, close);
    });
  };

  const copyCommand = copyCommandFor(game, notify);

  const actionFor = (t: Item): [string, () => void] | null => {
    switch (status(t)) {
      case "Ready":
        if (!t.number) return null;
        if (isSoundTask(t)) return ["Open in Sounds", openSounds]; // generated in the hub, not by Claude
        if (isModelTask(t)) return ["Open in Models", openModels]; // concept in the hub, then /model-build
        // No prompt yet: write one first, so Claude doesn't have to guess.
        return promptOf(t.body) ? ["Start with Claude", () => copyCommand(`/task ${t.number}`)] : ["Write prompt", () => setEditing(t)];
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
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select className="input" aria-label="Filter by workflow" value={workflowFilter} onChange={(e) => setWorkflowFilter(e.target.value)}>
            <option value="">All workflows</option>
            {workflows.map((w) => (
              <option key={w.id} value={String(w.number)}>
                {w.title}
              </option>
            ))}
            <option value="none">No workflow</option>
          </select>
          <span className="small">
            {shown.length} of {tasks.length} tasks
          </span>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
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
          const cards = shown.filter((t) => status(t) === col);
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
                      {t.parent && wfTitle(t.parent) ? <span className="tag wf">{wfTitle(t.parent)}</span> : null}
                      {t.values["Milestone"] ? <span className="tag ms">{t.values["Milestone"]}</span> : null}
                    </div>
                    <div className="small" style={{ fontSize: 13 }}>
                      {worker ? (col === "Done" ? `Done · ${worker}` : worker) : "Nobody yet"}
                    </div>
                    {t.values["Files"] ? <div className="files">{t.values["Files"]}</div> : null}
                    {clash.length ? <div className="warn">Same files as: {clash.map((c) => c.title).join(", ")}</div> : null}
                    {col !== "Done" && !promptOf(t.body) ? <div className="no-prompt">No prompt yet</div> : null}
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
                      <button className="act small-act" onClick={() => setEditing(t)} aria-label={`Open ${t.title}: prompt and fields`}>
                        Prompt / edit
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
          workflows={workflows}
          defaultWorkflow={workflowFilter && workflowFilter !== "none" ? Number(workflowFilter) : undefined}
          me={myWorker}
          run={run}
          hide={(id) => patch((p) => ({ ...p, items: p.items.filter((i) => i.id !== id) }))}
          copyCommand={copyCommand}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

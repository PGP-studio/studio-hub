import { createElement, useEffect, useState, useSyncExternalStore } from "react";
import type { Run } from "../App";
import { fileUrl, readFile } from "../branchFiles";
import { removeTask, setFields, type Game, type Item, type Project } from "../github";
import { copyCommandFor, replaceItem, status } from "../lib";
import {
  approveModel,
  discardModelBranch,
  estimateTriangles,
  generateConcepts,
  isModelTask,
  modelBranch,
  modelDir,
  modelPR,
  modelState,
  parseModelSpec,
  pickConcept,
  requestChanges,
  saveConceptPrompt,
  type ModelState,
} from "../models";
import Markdown from "./Markdown";

type Props = {
  game: Game;
  tasks: Project;
  assets: Project | null;
  me: string;
  run: Run;
  notify: (text: string) => void;
  patch: (fn: (p: Project) => Project) => void;
};

// Generation progress outside React, so a card that moves between groups keeps it (same as Sounds).
const progress = new Map<number, string>();
const listeners = new Set<() => void>();
const setProgress = (n: number, text: string | null) => {
  if (text === null) progress.delete(n);
  else progress.set(n, text);
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** <model-viewer> (Google) renders .glb in the browser; loaded on first use. */
function useModelViewer() {
  useEffect(() => {
    if (customElements.get("model-viewer") || document.getElementById("model-viewer-js")) return;
    const s = document.createElement("script");
    s.id = "model-viewer-js";
    s.type = "module";
    s.src = "https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js";
    document.head.appendChild(s);
  }, []);
}

export default function Models(props: Props) {
  const { game, tasks, notify } = props;
  const [draft, setDraft] = useState("");
  const [showDone, setShowDone] = useState(false);
  const copyCommand = copyCommandFor(game, notify);
  useModelViewer();
  const models = tasks.items.filter((t) => isModelTask(t) && !t.isWorkflow);
  const open = models.filter((t) => !t.closed && status(t) !== "Done");
  const groups: [string, string, Item[]][] = [
    ["approve", "Waiting for your approval", open.filter((t) => status(t) === "Ready")],
    ["work", "Concepts and 3D build", open.filter((t) => status(t) === "In progress")],
    ["review", "Review the 3D model", open.filter((t) => status(t) === "In review")],
  ];
  const done = models.filter((t) => t.closed || status(t) === "Done");

  return (
    <>
      <div className="card plan-card">
        <div>
          <b>3D models</b>
          <p className="small" style={{ margin: "2px 0 0" }}>
            Claude writes the concept prompt from the asset's description → you approve → concept images → you pick one → Claude builds the <code>.glb</code> → you review it in
            3D → approve, merge, import into Roblox.
          </p>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <input className="input" style={{ flex: "1 1 200px" }} placeholder="Asset name(s), e.g. Slingshot" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button className="btn-primary" disabled={!draft.trim()} onClick={() => copyCommand(`/model ${draft.trim()}`)}>
            Write prompts with Claude
          </button>
        </div>
      </div>

      {groups.map(([key, title, list]) =>
        list.length ? (
          <section key={key} className="sound-group">
            <h3 className="sub-title">
              {title} ({list.length})
            </h3>
            <div className="sounds">
              {list.map((t) => (
                <ModelCard key={t.id} {...props} task={t} copyCommand={copyCommand} />
              ))}
            </div>
          </section>
        ) : null,
      )}
      {!open.length ? <p className="empty">No models in progress. Type an asset name above and let Claude write its concept prompt.</p> : null}

      {done.length ? (
        <section className="sound-group">
          <button className="row-del" onClick={() => setShowDone((x) => !x)}>
            {showDone ? "Hide" : "Show"} done ({done.length})
          </button>
          {showDone ? (
            <ul className="list">
              {done.map((t) => (
                <li key={t.id}>
                  {t.title} <span className="small">#{t.number}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function ModelCard(props: Props & { task: Item; copyCommand: (c: string) => void }) {
  const { game, tasks, assets, me, run, notify, patch, task: t, copyCommand } = props;
  const spec = parseModelSpec(t.body);
  const st = status(t);
  const [state, setState] = useState<ModelState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [promptText, setPromptText] = useState(spec?.conceptPrompt ?? "");
  const [feedback, setFeedback] = useState("");
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const generating = useSyncExternalStore(subscribe, () => progress.get(t.number!) ?? null);
  const working = generating ?? busy;

  const refresh = async () => {
    if (!spec) return;
    try {
      setState(await modelState(game.repo, t, spec));
    } catch (e) {
      notify(String(e instanceof Error ? e.message : e));
    }
  };
  useEffect(() => {
    if (!generating) refresh();
    if (st === "In review") modelPR(game.repo, t).then((p) => setPrUrl(p?.html_url ?? null), () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st, t.number, generating]);

  if (!spec) {
    return (
      <div className="card sound-card">
        <b>
          {t.title} <span className="small">#{t.number}</span>
        </b>
        <p className="warn">This task's description isn't in the model format (docs/model-prompt.md). Ask Claude to rewrite it with /model.</p>
      </div>
    );
  }

  const setStatus = async (Status: string, Worker?: string) => {
    patch((p) => replaceItem(p, t.id, (i) => ({ ...i, values: { ...i.values, Status, ...(Worker !== undefined ? { Worker } : {}) } })));
    await setFields(tasks, t.id, { Status, ...(Worker !== undefined ? { Worker } : {}) });
  };

  const generate = async (count: number, startAt: number, prompt = spec.conceptPrompt) => {
    const n = t.number!;
    setProgress(n, `Generating 0 of ${count}…`);
    const r = await generateConcepts(game, t, { ...spec, conceptPrompt: prompt }, count, startAt, (made, failed) =>
      setProgress(n, `Generating ${made + failed} of ${count}…${failed ? ` (${failed} failed)` : ""}`),
    );
    setProgress(n, null);
    if (r.errors.length) notify(`${r.made} of ${count} made. ${r.errors[0]}`);
    else notify(`${r.made} concepts ready for “${spec.assetName}”.`);
  };

  const approvePrompt = async () => {
    if (!confirm(`Generate ${spec.concepts} concept image${spec.concepts === 1 ? "" : "s"} of “${spec.assetName}”? This uses image credits.`)) return;
    await run("Approved", () => setStatus("In progress", `${me} (models)`));
    await generate(spec.concepts, 1);
  };

  const savePrompt = async (regenerate: boolean) => {
    const text = promptText.trim();
    if (!text) return;
    const ok = await run("Prompt saved", async () => {
      const body = await saveConceptPrompt(t, text);
      patch((p) => replaceItem(p, t.id, (i) => ({ ...i, body })));
    });
    if (!ok) return;
    setEditing(false);
    if (regenerate) {
      const next = (state?.concepts ?? []).reduce((m, c) => Math.max(m, parseInt(c.name.replace(/\D/g, ""), 10) || 0), 0) + 1;
      await generate(spec.concepts, next, text);
    }
  };

  const pick = async (c: { path: string; name: string }) => {
    if (!state) return;
    if (!confirm(`Use ${c.name} as the concept for “${spec.assetName}”? The other concepts are deleted.`)) return;
    setBusy("Saving your pick…");
    await run("Concept approved", () => pickConcept(game, t, spec, c, state.concepts));
    setBusy(null);
    refresh();
  };

  const startOver = async () => {
    if (!confirm("Delete all concepts (and any 3D build) for this model and go back to the prompt?")) return;
    await run("Started over", async () => {
      await discardModelBranch(game.repo, t);
      await setStatus("Ready", "");
    });
    setState(null);
  };

  const sendFeedback = async () => {
    if (!feedback.trim()) return;
    const ok = await run("Feedback sent to Claude", () => requestChanges(game.repo, t, feedback, me));
    if (ok) {
      setFeedback("");
      copyCommand(`/model-build ${t.number}`);
      notify(`Feedback posted. Copied /model-build ${t.number}: paste it into Claude Code to rebuild.`);
    }
  };

  const approve = async () => {
    if (!confirm(`Approve the model of “${spec.assetName}”? It's marked Approved on the Assets board and its PR is ready to merge.`)) return;
    await run("Model approved", () => approveModel(game, assets, t, spec, me));
  };

  const del = async () => {
    if (!confirm(`Delete the model task “${t.title}”?`)) return;
    patch((p) => ({ ...p, items: p.items.filter((i) => i.id !== t.id) }));
    await run("Model task deleted", async () => {
      await discardModelBranch(game.repo, t);
      await removeTask(tasks, t);
    });
  };

  const asset = assets?.items.find((a) => a.title.toLowerCase() === spec.assetName.toLowerCase());
  const approved = asset?.values["Status"] === "Approved";

  return (
    <div className={"card sound-card" + (st === "In progress" ? " busy-card" : "")}>
      <div className="card-head">
        <b>
          {spec.assetName} <span className="small">#{t.number}</span>
        </b>
        <span className="tag sys">{spec.kind}</span>
      </div>
      <div className="small">
        {spec.size ? `${spec.size} · ` : ""}
        {spec.budget ? `≤ ${spec.budget} triangles · ` : ""}
        {spec.concepts} concept{spec.concepts === 1 ? "" : "s"}
      </div>

      {editing ? (
        <div className="form-row">
          <span>Concept prompt (sent to the image model as written)</span>
          <textarea className="input prompt-text" style={{ minHeight: 140 }} value={promptText} onChange={(e) => setPromptText(e.target.value)} />
          <div className="card-actions">
            <button className="act small-act" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button className="act small-act" onClick={() => savePrompt(false)}>
              Save
            </button>
            {st !== "Ready" ? (
              <button className="act run-act" onClick={() => savePrompt(true)}>
                Save and generate {spec.concepts} more
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <details className="prompt-details" open={st === "Ready"}>
          <summary className="small">Concept prompt</summary>
          <blockquote className="sound-prompt">{spec.conceptPrompt}</blockquote>
          {spec.buildNotes ? <Markdown text={spec.buildNotes} /> : null}
        </details>
      )}

      {working ? <p className="badge">{working}</p> : null}

      {st === "Ready" ? (
        <div className="card-actions">
          <button className="act run-act" disabled={!!working} onClick={approvePrompt}>
            Approve & generate {spec.concepts}
          </button>
          <button className="act small-act" onClick={() => setEditing(true)}>
            Edit prompt
          </button>
          <button className="act small-act" onClick={del}>
            Delete
          </button>
        </div>
      ) : null}

      {st === "In progress" && state && !state.concept ? (
        <>
          {state.concepts.length ? (
            <div className="concepts">
              {state.concepts.map((c) => (
                <Concept key={c.path} game={game} task={t} path={c.path} label={c.name} disabled={!!working} onPick={() => pick(c)} />
              ))}
            </div>
          ) : !working ? (
            <p className="empty">No concepts yet. Generation may have been interrupted, or the image provider isn't set up.</p>
          ) : null}
          <div className="card-actions">
            <button className="act small-act" disabled={!!working} onClick={() => generate(spec.concepts, (state.concepts.length || 0) + 1)}>
              Generate {spec.concepts} {state.concepts.length ? "more" : ""}
            </button>
            <button className="act small-act" disabled={!!working} onClick={() => setEditing(true)}>
              Change prompt
            </button>
            <button className="act small-act" disabled={!!working} onClick={startOver}>
              Start over
            </button>
          </div>
        </>
      ) : null}

      {st === "In progress" && state?.concept ? (
        <>
          <Concept game={game} task={t} path={state.concept} label="Approved concept" />
          {state.glb ? (
            <p className="small">A build is on the branch; Claude sets this to In review when it opens the PR.</p>
          ) : (
            <p className="small">Concept approved. Next, Claude builds the 3D model from it.</p>
          )}
          <div className="card-actions">
            <button className="act run-act" onClick={() => copyCommand(`/model-build ${t.number}`)}>
              Build 3D with Claude
            </button>
            <button className="act small-act" onClick={startOver}>
              Start over
            </button>
          </div>
        </>
      ) : null}

      {st === "In review" && state ? (
        <>
          <div className="model-review">
            {state.concept ? <Concept game={game} task={t} path={state.concept} label="Concept" small /> : null}
            {state.glb ? <GlbViewer game={game} task={t} path={state.glb} /> : <p className="empty">No model.glb on the branch yet.</p>}
          </div>
          {state.modelJson ? <ModelStats game={game} task={t} path={state.modelJson} budget={spec.budget} /> : null}
          {approved ? (
            <p className="small">
              ✅ Approved. Next: merge the{" "}
              {prUrl ? (
                <a href={prUrl} target="_blank" rel="noreferrer">
                  PR
                </a>
              ) : (
                "PR"
              )}
              , import <span className="mono">{modelDir(spec)}/model.glb</span> into Roblox (3D Importer, unit "Stud") and put its Roblox ID on the Assets board.
            </p>
          ) : (
            <>
              <textarea
                className="input"
                rows={3}
                placeholder="What should Claude change? e.g. thicker band, darker wood, leaf on the left fork"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
              />
              <div className="card-actions">
                <button className="act small-act" disabled={!feedback.trim()} onClick={sendFeedback}>
                  Request changes
                </button>
                <button className="act run-act pick" disabled={!state.glb} onClick={approve}>
                  Approve model
                </button>
                {prUrl ? (
                  <a className="act small-act" href={prUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none", color: "inherit" }}>
                    PR
                  </a>
                ) : null}
              </div>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

function Concept({ game, task, path, label, disabled, onPick, small }: { game: Game; task: Item; path: string; label: string; disabled?: boolean; onPick?: () => void; small?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    fileUrl(game.repo, path, modelBranch(task), "image/png").then(
      (u) => {
        made = u;
        if (alive) setUrl(u);
      },
      () => {},
    );
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [game.repo, path, task]);
  return (
    <figure className={"concept" + (small ? " small-concept" : "")}>
      {url ? <img src={url} alt={label} /> : <div className="concept-loading">Loading…</div>}
      <figcaption>
        <span className="small mono">{label}</span>
        {onPick ? (
          <button className="act small-act pick" disabled={disabled} onClick={onPick}>
            Use this concept
          </button>
        ) : null}
      </figcaption>
    </figure>
  );
}

function GlbViewer({ game, task, path }: { game: Game; task: Item; path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let made: string | null = null;
    fileUrl(game.repo, path, modelBranch(task), "model/gltf-binary").then((u) => setUrl((made = u)), () => {});
    return () => void (made && URL.revokeObjectURL(made));
  }, [game.repo, path, task]);
  if (!url) return <div className="glb-view concept-loading">Loading 3D model…</div>;
  return createElement("model-viewer", {
    class: "glb-view",
    src: url,
    "camera-controls": true,
    "auto-rotate": true,
    "shadow-intensity": "0.6",
    exposure: "1.1",
    "interaction-prompt": "none",
    alt: "3D model preview",
  });
}

function ModelStats({ game, task, path, budget }: { game: Game; task: Item; path: string; budget?: number }) {
  const [stats, setStats] = useState<{ parts: number; triangles: number } | null>(null);
  useEffect(() => {
    readFile(game.repo, path, modelBranch(task)).then((b) => setStats(estimateTriangles(new TextDecoder().decode(b))), () => {});
  }, [game.repo, path, task]);
  if (!stats) return null;
  const over = budget !== undefined && stats.triangles > budget;
  return (
    <div className={"small" + (over ? " warn" : "")}>
      {stats.parts} parts · ≈{stats.triangles} triangles{budget ? ` of ${budget}` : ""}
      {over ? " (over budget)" : ""}
    </div>
  );
}

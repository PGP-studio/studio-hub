import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Run } from "../App";
import { createTask, removeTask, renameItem, setFields, setIssueBody, type Game, type Item, type Project } from "../github";
import { copyCommandFor, replaceItem, status } from "../lib";
import {
  audioUrl,
  candidatesBranch,
  defaultSpec,
  discardVariations,
  formatSpec,
  generateVariations,
  getProgress,
  isSoundTask,
  listCandidates,
  openSoundPR,
  parseSpec,
  pickVariation,
  setProgress,
  SOUND_LABEL,
  subscribeProgress,
  type Candidate,
  type SoundSpec,
} from "../sounds";

type Props = {
  game: Game;
  tasks: Project;
  assets: Project | null;
  me: string; // e.g. "George"
  run: Run;
  notify: (text: string) => void;
  patch: (fn: (p: Project) => Project) => void;
};

/** Sound effects and music: approve a prompt, generate variations with ElevenLabs, pick one. */
export default function Sounds(props: Props) {
  const { game, tasks, notify } = props;
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [showDone, setShowDone] = useState(false);
  const copyCommand = copyCommandFor(game, notify);
  const sounds = tasks.items.filter((t) => isSoundTask(t) && !t.isWorkflow);
  const open = sounds.filter((t) => !t.closed);
  const groups: [string, string, Item[]][] = [
    ["approve", "Waiting for your approval", open.filter((t) => status(t) === "Ready")],
    ["pick", "Pick a variation", open.filter((t) => status(t) === "In progress")],
    ["review", "Saved, waiting for review", open.filter((t) => status(t) === "In review")],
  ];
  const done = sounds.filter((t) => t.closed || status(t) === "Done");

  return (
    <>
      <div className="card plan-card">
        <div>
          <b>Sound effects and music</b>
          <p className="small" style={{ margin: "2px 0 0" }}>
            Claude writes the prompts, you approve, the hub makes variations with ElevenLabs (10 per sound effect, 3 per song), you pick one, and it lands in{" "}
            <code>assets/audio/</code> and on the Assets board.
          </p>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <input className="input" style={{ flex: "1 1 200px" }} placeholder="e.g. slingshot shot, forest ambience loop" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button className="btn" disabled={!draft.trim()} onClick={() => copyCommand(`/sound ${draft.trim()}`)}>
            Draft with Claude
          </button>
          <button className="btn-primary" onClick={() => setCreating(true)}>
            New sound by hand
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
                <SoundCard key={t.id} {...props} task={t} />
              ))}
            </div>
          </section>
        ) : null,
      )}
      {!open.length ? <p className="empty">No sounds in progress. Draft some with Claude, or add one by hand.</p> : null}

      {done.length ? (
        <section className="sound-group">
          <button className="row-del" onClick={() => setShowDone((x) => !x)}>
            {showDone ? "Hide" : "Show"} done ({done.length})
          </button>
          {showDone ? (
            <ul className="list">
              {done.map((t) => (
                <li key={t.id}>
                  <span>
                    {t.title} <span className="small">#{t.number}</span>
                  </span>
                  <span className="small mono">{t.values["Files"] ?? ""}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {creating ? <SoundDialog {...props} task={null} onClose={() => setCreating(false)} /> : null}
    </>
  );
}

function SoundCard(props: Props & { task: Item }) {
  const { game, tasks, assets, me, run, notify, patch, task: t } = props;
  const spec = parseSpec(t.body);
  const st = status(t);
  const [editing, setEditing] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [localBusy, setBusy] = useState<string | null>(null);
  const [pr, setPr] = useState<string | null>(null);
  // Generation progress lives outside React: the card is rebuilt when it moves between groups.
  const generating = useSyncExternalStore(subscribeProgress, () => getProgress(t.number!));
  const busy = generating ?? localBusy;

  const refresh = async () => {
    try {
      setCandidates(await listCandidates(game.repo, t));
    } catch (e) {
      notify(String(e instanceof Error ? e.message : e));
    }
  };
  useEffect(() => {
    if (st === "In progress" && !generating) refresh();
    if (st === "In review") openSoundPR(game.repo, t).then(setPr, () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st, t.number, generating]);

  const generate = async (count: number, startAt: number) => {
    if (!spec || !t.number) return;
    const n = t.number;
    setProgress(n, `Generating 0 of ${count}…`);
    const r = await generateVariations(game, t, spec, count, startAt, (made, failed) =>
      setProgress(n, `Generating ${made + failed} of ${count}…${failed ? ` (${failed} failed)` : ""}`),
    );
    setProgress(n, null); // the (possibly new) card refreshes its list when this clears
    if (r.errors.length) notify(`${r.made} of ${count} made. ${r.errors[0]}`);
    else notify(`${r.made} variations ready for “${spec.assetName || t.title}”.`);
  };

  const approve = async () => {
    if (!spec) return;
    const credits = spec.kind === "music" ? "music uses a lot of credits" : "uses ElevenLabs credits";
    if (!confirm(`Generate ${spec.variations} variation${spec.variations === 1 ? "" : "s"} of “${spec.assetName || t.title}”? This ${credits}.`)) return;
    patch((p) => replaceItem(p, t.id, (i) => ({ ...i, values: { ...i.values, Status: "In progress", Worker: `${me} (sounds)` } })));
    await run("Approved", () => setFields(tasks, t.id, { Status: "In progress", Worker: `${me} (sounds)` }));
    await generate(spec.variations, 1);
  };

  const more = () => {
    if (!spec || !candidates) return;
    const next = candidates.reduce((m, c) => Math.max(m, parseInt(c.name.replace(/\D/g, ""), 10) || 0), 0) + 1;
    if (!confirm(`Generate ${spec.variations} more variations? This uses ElevenLabs credits.`)) return;
    generate(spec.variations, next);
  };

  const pick = async (c: Candidate) => {
    if (!spec) return;
    if (!confirm(`Keep ${c.name} for “${spec.assetName || t.title}”?\n\nThe other variations are deleted, and a PR adds this one to assets/audio/.`)) return;
    setBusy("Saving your pick…");
    let url = "";
    const ok = await run("Saved: PR opened and added to Assets", async () => {
      url = await pickVariation(game, tasks, assets, t, spec, c, me);
    });
    setBusy(null);
    if (ok) {
      patch((p) => replaceItem(p, t.id, (i) => ({ ...i, values: { ...i.values, Status: "In review" } })));
      setPr(url);
    }
  };

  const startOver = async () => {
    if (!confirm("Delete all variations and go back to editing the prompt?")) return;
    patch((p) => replaceItem(p, t.id, (i) => ({ ...i, values: { ...i.values, Status: "Ready" } })));
    await run("Variations deleted", async () => {
      await discardVariations(game.repo, t);
      await setFields(tasks, t.id, { Status: "Ready", Worker: "" });
    });
    setCandidates(null);
  };

  return (
    <div className={"card sound-card" + (st === "In progress" ? " busy-card" : "")}>
      <div className="card-head">
        <b>
          {spec?.assetName || t.title} <span className="small">#{t.number}</span>
        </b>
        <span className={"tag " + (spec?.kind === "music" ? "wf" : "sys")}>{spec?.kind === "music" ? "Music" : "Sound effect"}</span>
      </div>
      {spec ? (
        <>
          <blockquote className="sound-prompt">{spec.prompt}</blockquote>
          <div className="small">
            {spec.durationSeconds ? `${spec.durationSeconds} s` : "auto length"} · {spec.variations} variation{spec.variations === 1 ? "" : "s"}
            {spec.kind === "sfx" ? ` · influence ${spec.promptInfluence ?? 0.3}` : ""}
            {t.values["Area"] ? ` · ${t.values["Area"]}` : ""}
          </div>
          {spec.usage ? <div className="small">Used: {spec.usage}</div> : null}
        </>
      ) : (
        <p className="warn">This task's description isn't in the sound format yet. Edit it to fill in the prompt.</p>
      )}

      {st === "Ready" ? (
        <div className="card-actions">
          <button className="act run-act" disabled={!spec || !!busy} onClick={approve}>
            {busy ?? `Approve & generate ${spec?.variations ?? ""}`}
          </button>
          <button className="act small-act" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button
            className="act small-act"
            onClick={async () => {
              if (!confirm(`Delete the sound “${t.title}”?`)) return;
              patch((p) => ({ ...p, items: p.items.filter((i) => i.id !== t.id) }));
              await run("Sound deleted", () => removeTask(tasks, t));
            }}
          >
            Delete
          </button>
        </div>
      ) : null}

      {st === "In progress" ? (
        <>
          {busy ? <p className="badge">{busy}</p> : null}
          {candidates === null ? (
            <p className="empty">Loading variations…</p>
          ) : candidates.length ? (
            <ol className="candidates">
              {candidates.map((c) => (
                <CandidateRow key={c.path} game={game} task={t} candidate={c} disabled={!!busy} onPick={() => pick(c)} />
              ))}
            </ol>
          ) : !busy ? (
            <p className="empty">No variations yet. Generation may have been interrupted.</p>
          ) : null}
          <div className="card-actions">
            {candidates && !candidates.length && !busy ? (
              <button className="act run-act" onClick={() => spec && generate(spec.variations, 1)}>
                Generate {spec?.variations}
              </button>
            ) : null}
            {candidates?.length ? (
              <button className="act small-act" disabled={!!busy} onClick={more}>
                Generate {spec?.variations} more
              </button>
            ) : null}
            <button className="act small-act" disabled={!!busy} onClick={refresh}>
              Refresh
            </button>
            <button className="act small-act" disabled={!!busy} onClick={startOver}>
              Change prompt and start over
            </button>
          </div>
        </>
      ) : null}

      {st === "In review" ? (
        <div className="small">
          Saved to <span className="mono">{t.values["Files"]}</span>.{" "}
          {pr ? (
            <a href={pr} target="_blank" rel="noreferrer">
              PR waiting for review
            </a>
          ) : (
            "PR waiting for review."
          )}{" "}
          Next: upload it to Roblox and fill in its Roblox ID on the Assets board.
        </div>
      ) : null}

      {editing ? <SoundDialog {...props} task={t} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}

function CandidateRow({ game, task, candidate, disabled, onPick }: { game: Game; task: Item; candidate: Candidate; disabled: boolean; onPick: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  const play = async () => {
    if (url) return audio.current?.play();
    setLoading(true);
    try {
      setUrl(await audioUrl(game.repo, candidate.path, candidatesBranch(task)));
    } finally {
      setLoading(false);
    }
  };
  return (
    <li className="candidate">
      <span className="mono small">{candidate.name}</span>
      {url ? <audio ref={audio} src={url} controls autoPlay /> : <button className="act small-act" onClick={play} disabled={loading}>{loading ? "Loading…" : "▶ Play"}</button>}
      <button className="act small-act pick" disabled={disabled} onClick={onPick}>
        Use this one
      </button>
    </li>
  );
}

function SoundDialog({ game, tasks, run, task, onClose }: Props & { task: Item | null; onClose: () => void }) {
  const initial = (task && parseSpec(task.body)) || defaultSpec();
  const [spec, setSpec] = useState<SoundSpec>({ ...initial, assetName: initial.assetName || task?.title || "" });
  const [area, setArea] = useState(task?.values["Area"] ?? "");
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof SoundSpec>(k: K, v: SoundSpec[K]) => setSpec((s) => ({ ...s, [k]: v }));
  const units = tasks.fields["Area"]?.options?.map((o) => o.name) ?? game.config.structure.units;
  const hasAudio = tasks.fields["System"]?.options?.some((o) => o.name === "audio");
  const ok = spec.assetName.trim() && spec.prompt.trim();

  const switchKind = (kind: "sfx" | "music") => {
    const d = defaultSpec(kind);
    setSpec((s) => ({ ...s, kind, durationSeconds: d.durationSeconds, variations: d.variations, promptInfluence: d.promptInfluence }));
  };

  const save = async () => {
    if (!ok) return;
    setBusy(true);
    const body = formatSpec({ ...spec, assetName: spec.assetName.trim() });
    const done = task
      ? await run("Sound saved", async () => {
          if (spec.assetName.trim() !== task.title) await renameItem(task, spec.assetName.trim());
          await setIssueBody(task, body);
          if (area !== (task.values["Area"] ?? "")) await setFields(tasks, task.id, { Area: area });
        })
      : await run("Sound added", () =>
          createTask(game, tasks, {
            title: spec.assetName.trim(),
            body,
            labels: [SOUND_LABEL],
            values: { Status: "Ready", ...(hasAudio ? { System: "audio" } : {}), ...(area ? { Area: area } : {}) },
          }),
        );
    setBusy(false);
    if (done) onClose();
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide" role="dialog" aria-label={task ? "Edit sound" : "New sound"}>
        <h2>{task ? `Sound #${task.number}` : "New sound"}</h2>
        <div className="seg" style={{ alignSelf: "flex-start" }}>
          <button type="button" className={spec.kind === "sfx" ? "on" : ""} onClick={() => switchKind("sfx")}>
            Sound effect
          </button>
          <button type="button" className={spec.kind === "music" ? "on" : ""} onClick={() => switchKind("music")}>
            Music
          </button>
        </div>
        <label className="form-row">
          <span>Asset name (becomes the file name and the Assets item)</span>
          <input className="input" value={spec.assetName} onChange={(e) => set("assetName", e.target.value)} placeholder="e.g. Slingshot shot" autoFocus />
        </label>
        <label className="form-row">
          <span>ElevenLabs prompt (sent exactly as written)</span>
          <textarea
            className="input prompt-text"
            style={{ minHeight: 110 }}
            rows={5}
            value={spec.prompt}
            onChange={(e) => set("prompt", e.target.value)}
            placeholder={
              spec.kind === "sfx"
                ? "Cartoon slingshot snap with a rubbery twang, short and punchy, dry, no reverb"
                : "Light, playful forest adventure loop, marimba and pizzicato strings, 100 bpm, loopable, no vocals"
            }
          />
        </label>
        <div className="form-grid">
          <label className="form-row">
            <span>Length in seconds ({spec.kind === "sfx" ? "0.5–30" : "3–600"}, empty = auto)</span>
            <input
              className="input"
              type="number"
              step="0.5"
              min={spec.kind === "sfx" ? 0.5 : 3}
              max={spec.kind === "sfx" ? 30 : 600}
              value={spec.durationSeconds ?? ""}
              onChange={(e) => set("durationSeconds", e.target.value ? Number(e.target.value) : undefined)}
            />
          </label>
          <label className="form-row">
            <span>Variations</span>
            <input className="input" type="number" min={1} max={20} value={spec.variations} onChange={(e) => set("variations", Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
          </label>
          {spec.kind === "sfx" ? (
            <label className="form-row">
              <span>Prompt influence (0–1; lower = more varied)</span>
              <input
                className="input"
                type="number"
                step="0.1"
                min={0}
                max={1}
                value={spec.promptInfluence ?? 0.3}
                onChange={(e) => set("promptInfluence", Math.max(0, Math.min(1, Number(e.target.value))))}
              />
            </label>
          ) : null}
          <label className="form-row">
            <span>{game.config.structure.label.replace(/s$/, "")}</span>
            <select className="input" value={area} onChange={(e) => setArea(e.target.value)}>
              <option value="">whole game</option>
              {units.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="form-row">
          <span>Where it's used</span>
          <input className="input" value={spec.usage} onChange={(e) => set("usage", e.target.value)} placeholder="e.g. client, when the player fires the Slingshot" />
        </label>
        <div className="dialog-actions">
          <span className="small">Saved as the task's description, in the format of docs/sound-prompt.md.</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary" disabled={busy || !ok} onClick={save}>
              {busy ? "Saving…" : task ? "Save" : "Add sound"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { createGame, slugify } from "../newGame";

/** Ask for a name, then create the repo, both boards and hub.config.json (see newGame.ts). */
export default function NewGameDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (slug: string) => void }) {
  const [name, setName] = useState("");
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const slug = slugify(name);

  const create = async () => {
    setError(null);
    try {
      const repo = await createGame(name.trim(), setStep);
      onCreated(repo);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep(null);
    }
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !step && onClose()}>
      <div className="dialog" role="dialog" aria-label="New game">
        <h2>New game</h2>
        <label className="form-row">
          <span>Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fishing game" autoFocus disabled={!!step} />
        </label>
        <p className="small" style={{ margin: 0 }}>
          Creates the private repo <b>PGP-studio/{slug || "…"}</b> from game-template with the topic “game”, its <b>{name.trim() || "…"} · Tasks</b> and{" "}
          <b>{name.trim() || "…"} · Assets</b> boards with the standard fields, and a hub.config.json with defaults to edit afterwards (systems, asset types,
          areas). Takes about half a minute.
        </p>
        {step ? <p className="badge">{step}</p> : null}
        {error ? <p className="warn">{error}</p> : null}
        <div className="dialog-actions">
          <span />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={onClose} disabled={!!step}>
              Cancel
            </button>
            <button className="btn-primary" onClick={create} disabled={!!step || !slug}>
              {step ? "Creating…" : "Create game"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

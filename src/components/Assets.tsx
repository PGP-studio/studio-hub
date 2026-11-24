import { useEffect, useMemo, useState } from "react";
import type { Run } from "../App";
import { createAsset, renameItem, setField, type Game, type Item, type Project } from "../github";
import { pill, plural, replaceItem } from "../lib";

type Props = { game: Game; project: Project; run: Run; patch: (fn: (p: Project) => Project) => void };
const PAGE = 100;

export default function Assets({ game, project, run, patch }: Props) {
  const cfg = game.config;
  const typeField = cfg.assetTypeField ?? "Type";
  const [type, setType] = useState<string>("All");
  const [area, setArea] = useState("");
  const [st, setSt] = useState("");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [adding, setAdding] = useState(false);
  useEffect(() => setLimit(PAGE), [type, area, st, q]);

  const opts = (f: string, fallback: string[]) => project.fields[f]?.options?.map((o) => o.name) ?? fallback;
  const types = opts(typeField, cfg.assetTypes);
  const areas = opts("Area", cfg.structure.units);
  const statuses = opts("Status", cfg.assetStatuses);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return project.items.filter(
      (a) =>
        (type === "All" || a.values[typeField] === type) &&
        (!area || (area === "-" ? !a.values["Area"] : a.values["Area"] === area)) &&
        (!st || a.values["Status"] === st) &&
        (!needle ||
          a.title.toLowerCase().includes(needle) ||
          (a.values["Made by"] ?? "").toLowerCase().includes(needle) ||
          (a.values["Prompt"] ?? "").toLowerCase().includes(needle)),
    );
  }, [project.items, type, area, st, q, typeField]);

  const edit = (a: Item, field: string, value: string) => {
    if ((field === "Title" ? a.title : a.values[field] ?? "") === value) return;
    patch((p) =>
      replaceItem(p, a.id, (i) => (field === "Title" ? { ...i, title: value } : { ...i, values: { ...i.values, [field]: value } })),
    );
    run(`Saved ${field.toLowerCase()} of ${a.title}`, () => (field === "Title" ? renameItem(a, value) : setField(project, a.id, field, value)));
  };

  const counts = (t: string) => project.items.filter((a) => a.values[typeField] === t).length;

  return (
    <>
      <div className="toolbar">
        {["All", ...types].map((t) => (
          <button key={t} className={"chip" + (type === t ? " on" : "")} onClick={() => setType(t)}>
            {t === "All" ? `All (${project.items.length})` : `${plural(t)} (${counts(t)})`}
          </button>
        ))}
      </div>
      <div className="toolbar">
        <input className="input" style={{ flex: "1 1 200px" }} placeholder="Search name, made by or prompt" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={area} onChange={(e) => setArea(e.target.value)} aria-label="Filter by area">
          <option value="">Every {cfg.structure.label.replace(/s$/, "").toLowerCase()}</option>
          <option value="-">whole game</option>
          {areas.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <select className="input" value={st} onChange={(e) => setSt(e.target.value)} aria-label="Filter by status">
          <option value="">Any status</option>
          {statuses.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <button className="btn-primary" onClick={() => setAdding((x) => !x)}>
          Add asset
        </button>
      </div>
      {adding ? <AddAsset types={types} areas={areas} statuses={statuses} typeField={typeField} project={project} run={run} done={() => setAdding(false)} /> : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>{cfg.structure.label.replace(/s$/, "")}</th>
              <th>Status</th>
              <th>Made by</th>
              <th>Roblox ID</th>
              <th>Prompt</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, limit).map((a) => (
              <tr key={a.id}>
                <td className="name" title={a.body}>
                  <TextCell value={a.title} onSave={(x) => x.trim() && edit(a, "Title", x.trim())} />
                </td>
                <td>
                  <SelectCell value={a.values[typeField] ?? ""} options={types} onSave={(x) => edit(a, typeField, x)} />
                </td>
                <td>
                  <SelectCell value={a.values["Area"] ?? ""} options={areas} empty="whole game" onSave={(x) => edit(a, "Area", x)} />
                </td>
                <td>
                  <StatusCell value={a.values["Status"] ?? ""} options={statuses} onSave={(x) => edit(a, "Status", x)} />
                </td>
                <td>
                  <TextCell value={a.values["Made by"] ?? ""} placeholder="—" onSave={(x) => edit(a, "Made by", x)} />
                </td>
                <td className="mono">
                  <TextCell value={a.values["Roblox ID"] ?? ""} placeholder="—" onSave={(x) => edit(a, "Roblox ID", x.trim())} />
                </td>
                <td style={{ minWidth: 180 }}>
                  <TextCell value={a.values["Prompt"] ?? ""} placeholder="—" onSave={(x) => edit(a, "Prompt", x)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <p className="small" style={{ margin: 0 }}>
          Showing {Math.min(limit, shown.length)} of {shown.length} matching · {project.items.length} assets in {cfg.name} · Assets. Click any cell to edit.
        </p>
        {shown.length > limit ? (
          <button className="btn" onClick={() => setLimit((l) => l + PAGE * 3)}>
            Show more
          </button>
        ) : null}
      </div>
    </>
  );
}

function TextCell({ value, placeholder, onSave }: { value: string; placeholder?: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      className="cell"
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onSave(v)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setV(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function SelectCell({ value, options, empty = "—", onSave }: { value: string; options: string[]; empty?: string; onSave: (v: string) => void }) {
  return (
    <select className="cell" value={value} onChange={(e) => onSave(e.target.value)}>
      <option value="">{empty}</option>
      {options.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  );
}

function StatusCell({ value, options, onSave }: { value: string; options: string[]; onSave: (v: string) => void }) {
  const [bg, fg] = pill(value);
  return (
    <select className="status-pill" style={{ background: bg, color: fg }} value={value} onChange={(e) => onSave(e.target.value)} aria-label="Status">
      {!value ? <option value="">—</option> : null}
      {options.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  );
}

function AddAsset(props: {
  types: string[];
  areas: string[];
  statuses: string[];
  typeField: string;
  project: Project;
  run: Run;
  done: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState(props.types[0] ?? "");
  const [area, setArea] = useState("");
  const [madeBy, setMadeBy] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const values: Record<string, string> = { [props.typeField]: type, Status: props.statuses[0] ?? "" };
    if (area) values["Area"] = area;
    if (madeBy) values["Made by"] = madeBy;
    const ok = await props.run(`Added ${name.trim()}`, () => createAsset(props.project, name.trim(), values));
    setBusy(false);
    if (ok) {
      setName("");
      props.done();
    }
  };
  return (
    <div className="card" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center" }}>
      <input className="input" style={{ flex: "2 1 180px" }} placeholder="Asset name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <select className="input" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
        {props.types.map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>
      <select className="input" value={area} onChange={(e) => setArea(e.target.value)} aria-label="Area">
        <option value="">whole game</option>
        {props.areas.map((a) => (
          <option key={a}>{a}</option>
        ))}
      </select>
      <input className="input" style={{ flex: "1 1 120px" }} placeholder="Made by" value={madeBy} onChange={(e) => setMadeBy(e.target.value)} />
      <button className="btn-primary" disabled={busy || !name.trim()} onClick={add}>
        {busy ? "Adding…" : "Add"}
      </button>
    </div>
  );
}

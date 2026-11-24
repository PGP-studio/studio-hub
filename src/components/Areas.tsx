import { useState } from "react";
import type { Game, Project } from "../github";
import { isBuilt, pill, status } from "../lib";

const COLORS = ["#3B5BDB", "#2F9E6E", "#C26A1A", "#5B3FB0", "#9A4A12"];

export default function Areas({ game, tasks, assets }: { game: Game; tasks: Project; assets: Project }) {
  const cfg = game.config;
  const typeField = cfg.assetTypeField ?? "Type";
  const [picked, setPicked] = useState<string | null>(null);
  const one = cfg.structure.label.replace(/s$/, "");

  const cards = cfg.structure.units.map((unit, i) => {
    const unitAssets = assets.items.filter((a) => a.values["Area"] === unit);
    const meters = cfg.structure.progress.map((p, j) => {
      const all = unitAssets.filter((a) => a.values[typeField] === p.assetType);
      const done = all.filter((a) => isBuilt(a.values["Status"] ?? "", cfg.assetStatuses)).length;
      return { label: p.label, done, total: all.length, color: COLORS[j % COLORS.length] };
    });
    const busy = tasks.items.filter((t) => t.values["Area"] === unit && status(t) === "In progress");
    const workers = [...new Set(busy.map((t) => t.values["Worker"]).filter(Boolean))];
    const open = tasks.items.filter((t) => t.values["Area"] === unit && status(t) !== "Done").length;
    const claim = workers.length
      ? `${workers.join(", ")} working here`
      : open
        ? `${open} open task${open === 1 ? "" : "s"}`
        : meters.some((m) => m.done)
          ? "Nobody working now"
          : "Not started";
    return { unit, n: i + 1, meters, claim, active: busy.length > 0 };
  });

  return (
    <>
      <div className="areas">
        {cards.map((c) => (
          <button
            key={c.unit}
            className={"area" + (c.active ? " active" : "") + (picked === c.unit ? " picked" : "")}
            onClick={() => setPicked(picked === c.unit ? null : c.unit)}
            aria-pressed={picked === c.unit}
          >
            <div className="area-top" style={{ width: "100%" }}>
              <span style={{ fontWeight: 600 }}>{c.unit}</span>
              <span className="small">
                {one} {c.n}
              </span>
            </div>
            {c.meters.map((m) => (
              <div key={m.label} className="meter" style={{ width: "100%" }}>
                <span>
                  {m.label} {m.done}/{m.total}
                </span>
                <div className="track">
                  <div style={{ width: `${m.total ? Math.round((m.done / m.total) * 100) : 0}%`, background: m.color }} />
                </div>
              </div>
            ))}
            <div className="small">{c.claim}</div>
          </button>
        ))}
      </div>
      {picked ? <AreaDetail unit={picked} game={game} tasks={tasks} assets={assets} onClose={() => setPicked(null)} /> : null}
    </>
  );
}

function AreaDetail({ unit, game, tasks, assets, onClose }: { unit: string; game: Game; tasks: Project; assets: Project; onClose: () => void }) {
  const cfg = game.config;
  const typeField = cfg.assetTypeField ?? "Type";
  const unitTasks = tasks.items.filter((t) => t.values["Area"] === unit);
  const unitAssets = assets.items.filter((a) => a.values["Area"] === unit);
  const types = cfg.assetTypes.filter((t) => unitAssets.some((a) => a.values[typeField] === t));
  return (
    <div className="card" style={{ gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ fontSize: 18 }}>{unit}</h2>
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="detail">
        <div>
          <h3 style={{ margin: "0 0 8px", fontSize: 13 }}>Tasks ({unitTasks.length})</h3>
          {unitTasks.length ? (
            <ul className="list">
              {unitTasks.map((t) => (
                <li key={t.id}>
                  <span>
                    {t.url ? (
                      <a href={t.url} target="_blank" rel="noreferrer">
                        {t.title}
                      </a>
                    ) : (
                      t.title
                    )}
                    {t.values["Worker"] ? <span className="small"> · {t.values["Worker"]}</span> : null}
                  </span>
                  <span className="small">{status(t)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">No tasks for {unit} yet.</p>
          )}
        </div>
        {types.map((type) => (
          <div key={type}>
            <h3 style={{ margin: "0 0 8px", fontSize: 13 }}>
              {type} ({unitAssets.filter((a) => a.values[typeField] === type).length})
            </h3>
            <ul className="list">
              {unitAssets
                .filter((a) => a.values[typeField] === type)
                .map((a) => {
                  const [bg, fg] = pill(a.values["Status"] ?? "");
                  return (
                    <li key={a.id} title={a.body}>
                      <span>{a.title}</span>
                      <span className="tag" style={{ background: bg, color: fg, borderRadius: 999 }}>
                        {a.values["Status"] || "—"}
                      </span>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

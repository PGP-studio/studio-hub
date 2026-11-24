import type { Game, Item, Project } from "../github";
import { status } from "../lib";
import { memberForWorker, TEAM, type Member } from "../team";

type Busy = { task: Item; game: Game };

/** Who's working now: every In-progress task across all games, grouped by person. */
export default function SidePanel({ games, tasks }: { games: Game[]; tasks: Record<string, Project> | null }) {
  const busy: Busy[] = [];
  for (const g of games) for (const t of tasks?.[g.repo]?.items ?? []) if (status(t) === "In progress" && !t.isWorkflow) busy.push({ task: t, game: g });

  const byMember = new Map<Member, Busy[]>(TEAM.map((m) => [m, []]));
  const others = new Map<string, Busy[]>();
  for (const b of busy) {
    const worker = b.task.values["Worker"] || "Nobody named";
    const m = memberForWorker(worker);
    if (m) byMember.get(m)!.push(b);
    else others.set(worker, [...(others.get(worker) ?? []), b]);
  }
  const multi = games.length > 1;

  return (
    <aside className="side">
      <h2>Who's working now</h2>
      {[...byMember].map(([m, list]) => (
        <PersonCard key={m.name} initials={initials(m.name)} name={m.name} owns={m.owns} bg={m.bg} fg={m.fg} list={list} multi={multi} />
      ))}
      {[...others].map(([w, list]) => (
        <PersonCard key={w} initials={initials(w)} name={w} owns="Not on the team list" bg="#EFEDE8" fg="#5E5B55" list={list} multi={multi} />
      ))}
      {!tasks ? <p className="empty">Loading…</p> : null}
    </aside>
  );
}

function PersonCard(p: { initials: string; name: string; owns: string; bg: string; fg: string; list: Busy[]; multi: boolean }) {
  const workers = [...new Set(p.list.map((b) => b.task.values["Worker"]))];
  return (
    <div className="card">
      <div className="person">
        <div className="avatar" style={{ background: p.bg, color: p.fg }}>
          {p.initials}
        </div>
        <div className="person-name">
          <b>{p.name}</b>
          <span className="small">{p.owns}</span>
        </div>
      </div>
      <div className="dot-line">
        <span className="dot" style={{ background: p.list.length ? "#2F9E6E" : "#CFCBC2" }} />
        <span>{p.list.length ? workers.join(", ") : "Nothing in progress"}</span>
      </div>
      {p.list.length ? (
        p.list.map((b) => (
          <div key={b.task.id} className="task-chip">
            On: {b.task.url ? <a href={b.task.url} target="_blank" rel="noreferrer">{b.task.title}</a> : b.task.title}
            <div className="small">
              {b.game.config.name}
              {b.task.values["Files"] ? ` · ${b.task.values["Files"]}` : ""}
            </div>
          </div>
        ))
      ) : (
        <div className="task-chip">Free: pick a Ready task</div>
      )}
    </div>
  );
}

function initials(name: string): string {
  const words = name.replace(/'s\b.*$/, "").split(/\s+/).filter(Boolean);
  if (words.length > 1 && words[1].length === 1) return words[1].toUpperCase(); // "Dev B" -> "B"
  return (words[0]?.[0] ?? "?").toUpperCase();
}

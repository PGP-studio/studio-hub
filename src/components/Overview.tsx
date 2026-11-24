import { ORG, type Game, type Project } from "../github";
import { fetchOverview, type PR } from "../overview";
import { usePoll } from "../usePoll";
import { isBuilt, pill, status, STATUSES } from "../lib";
import Markdown from "./Markdown";

/** A game's home: what it is, where everything lives, how far along it is, and what's waiting for review. */
export default function Overview({ game, tasks, assets }: { game: Game; tasks: Project; assets: Project | null }) {
  const ov = usePoll(() => fetchOverview(game.repo), 60_000, `overview:${game.repo}`);
  const cfg = game.config;
  const typeField = cfg.assetTypeField ?? "Type";
  const projectUrl = (n: number) => `https://github.com/orgs/${ORG}/projects/${n}`;
  const editConfigUrl = `${game.url}/edit/${ov.data?.branch ?? "main"}/hub.config.json`;

  const taskItems = tasks.items.filter((t) => !t.isWorkflow);
  const workflows = tasks.items.filter((t) => t.isWorkflow && !t.closed);

  return (
    <div className="overview">
      <section className="card span-2">
        <h2 className="card-title">About {cfg.name}</h2>
        {ov.data ? (
          ov.data.description && !/^_Fill this in/.test(ov.data.description) ? (
            <Markdown text={ov.data.description} />
          ) : (
            <p className="empty">
              No description yet. Fill in “The game” in{" "}
              <a href={`${game.url}/blob/${ov.data.branch}/CLAUDE.md`} target="_blank" rel="noreferrer">
                CLAUDE.md
              </a>
              .
            </p>
          )
        ) : (
          <p className="empty">{ov.error ? `Couldn't load: ${ov.error}` : "Loading…"}</p>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Links</h2>
          <a className="small" href={editConfigUrl} target="_blank" rel="noreferrer" title="Opens hub.config.json on GitHub; saving proposes a change">
            Edit links
          </a>
        </div>
        <ul className="list">
          {(cfg.links ?? []).map((l) => (
            <li key={l.url}>
              <a href={l.url} target="_blank" rel="noreferrer">
                {l.label}
              </a>
            </li>
          ))}
          <li>
            <a href={game.url} target="_blank" rel="noreferrer">
              Code: PGP-studio/{game.repo}
            </a>
          </li>
          <li>
            <a href={projectUrl(cfg.tasksProject)} target="_blank" rel="noreferrer">
              Tasks board on GitHub
            </a>
          </li>
          <li>
            <a href={projectUrl(cfg.assetsProject)} target="_blank" rel="noreferrer">
              Assets board on GitHub
            </a>
          </li>
        </ul>
        {!cfg.links?.length ? (
          <p className="small" style={{ margin: 0 }}>
            Add the Team Create place, everyone's test places and the Roblox group under <code>"links"</code> in hub.config.json.
          </p>
        ) : null}
      </section>

      <section className="card">
        <h2 className="card-title">Progress</h2>
        <Bars
          title={`Tasks (${taskItems.length})`}
          rows={STATUSES.map((s) => ({ label: s, n: taskItems.filter((t) => status(t) === s).length }))}
          total={taskItems.length}
        />
        <p className="small" style={{ margin: 0 }}>
          {workflows.length
            ? workflows
                .map((w) => {
                  const sub = taskItems.filter((t) => t.parent === w.number);
                  return `${w.title}: ${sub.filter((t) => status(t) === "Done").length}/${sub.length}`;
                })
                .join(" · ")
            : "No workflows yet."}
        </p>
        {assets ? (
          <Bars
            title={`Assets (${assets.items.length}), ${assets.items.filter((a) => isBuilt(a.values["Status"] ?? "", cfg.assetStatuses)).length} in Studio or approved`}
            rows={cfg.assetStatuses.map((s) => ({ label: s, n: assets.items.filter((a) => a.values["Status"] === s).length, color: pill(s)[1] }))}
            total={assets.items.length}
          />
        ) : (
          <p className="empty">Loading assets…</p>
        )}
        {assets ? (
          <p className="small" style={{ margin: 0 }}>
            {cfg.assetTypes
              .map((t) => [t, assets.items.filter((a) => a.values[typeField] === t).length] as const)
              .filter(([, n]) => n)
              .map(([t, n]) => `${n} ${t.toLowerCase()}${n === 1 ? "" : "s"}`)
              .join(" · ") || "No assets yet."}
          </p>
        ) : null}
      </section>

      <section className="card">
        <h2 className="card-title">Waiting for review ({ov.data?.openPRs.filter((p) => !p.isDraft).length ?? "…"})</h2>
        <PRList prs={ov.data?.openPRs.filter((p) => !p.isDraft)} empty="Nothing waiting for review." />
        {ov.data?.openPRs.some((p) => p.isDraft) ? (
          <>
            <h3 className="sub-title">Drafts (work in progress)</h3>
            <PRList prs={ov.data.openPRs.filter((p) => p.isDraft)} empty="" />
          </>
        ) : null}
        <h3 className="sub-title">Recently merged</h3>
        <PRList prs={ov.data?.mergedPRs} empty="Nothing merged yet." />
      </section>

      <section className="card">
        <h2 className="card-title">Design and docs</h2>
        {ov.data?.files.length ? (
          <ul className="list">
            {ov.data.files.map((f) => (
              <li key={f.path}>
                <a href={f.url} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 12 }}>
                  {f.path}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">{ov.data ? "No files in design/ or docs/ yet." : "Loading…"}</p>
        )}
      </section>
    </div>
  );
}

function Bars({ title, rows, total }: { title: string; rows: { label: string; n: number; color?: string }[]; total: number }) {
  return (
    <div className="meter">
      <span style={{ color: "var(--ink)", fontWeight: 500 }}>{title}</span>
      <div className="track stacked">
        {rows.map((r, i) =>
          r.n ? (
            <div
              key={r.label}
              title={`${r.label}: ${r.n}`}
              style={{ width: `${(r.n / Math.max(total, 1)) * 100}%`, background: r.color ?? ["#CFCBC2", "#3B5BDB", "#C26A1A", "#2F9E6E"][i % 4] }}
            />
          ) : null,
        )}
      </div>
      <span>{rows.map((r) => `${r.label} ${r.n}`).join(" · ")}</span>
    </div>
  );
}

const REVIEW: Record<string, string> = { APPROVED: "Approved", CHANGES_REQUESTED: "Changes requested", REVIEW_REQUIRED: "Needs review" };

function PRList({ prs, empty }: { prs?: PR[]; empty: string }) {
  if (!prs) return <p className="empty">Loading…</p>;
  if (!prs.length) return empty ? <p className="empty">{empty}</p> : null;
  return (
    <ul className="list">
      {prs.map((p) => (
        <li key={p.number}>
          <span>
            <a href={p.url} target="_blank" rel="noreferrer">
              #{p.number} {p.title}
            </a>
            <span className="small">
              {" "}
              · {p.author} · {new Date(p.date).toLocaleDateString()}
            </span>
          </span>
          {p.reviewDecision ? <span className="tag ms">{REVIEW[p.reviewDecision] ?? p.reviewDecision}</span> : null}
        </li>
      ))}
    </ul>
  );
}

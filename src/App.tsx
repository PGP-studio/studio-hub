import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchGames, fetchProject, fetchViewer, type Game, type Project, type Viewer } from "./github";
import { usePoll } from "./usePoll";
import { status } from "./lib";
import { memberForLogin } from "./team";
import Board from "./components/Board";
import Assets from "./components/Assets";
import Areas from "./components/Areas";
import SidePanel from "./components/SidePanel";

const POLL_MS = 10_000;
const LAST_GAME = "hub.lastGame";
type Tab = "board" | "assets" | "areas";

export type Run = (label: string, fn: () => Promise<void>) => Promise<boolean>;

export default function App() {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  useEffect(() => {
    fetchViewer().then(setViewer, (e) => setViewerError(String(e.message ?? e)));
  }, []);

  if (viewerError) {
    return (
      <div className="center">
        <h1>Studio hub</h1>
        <p className="sub">Couldn't reach GitHub: {viewerError}</p>
      </div>
    );
  }
  if (!viewer) return <div className="center sub">Connecting to GitHub…</div>;
  if (!viewer.isMember) {
    return (
      <div className="center">
        <h1>Studio hub</h1>
        <p>You're signed in as {viewer.login}, but you're not in the studio's GitHub organization.</p>
        <p className="sub">Ask George to add you to the organization.</p>
      </div>
    );
  }
  return <Hub viewer={viewer} />;
}

function Hub({ viewer }: { viewer: Viewer }) {
  const games = usePoll(fetchGames, 60_000, "games");
  const [repo, setRepo] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LAST_GAME);
    } catch {
      return null;
    }
  });
  const [tab, setTab] = useState<Tab>("board");
  const [toast, setToast] = useState<{ text: string; err?: boolean } | null>(null);

  const game: Game | undefined = games.data?.find((g) => g.repo === repo) ?? games.data?.[0];
  const pick = (r: string) => {
    setRepo(r);
    try {
      localStorage.setItem(LAST_GAME, r);
    } catch {
      /* private window: fine */
    }
  };

  // Tasks of every game (the side panel shows who's working across all of them).
  const gameList = games.data ?? [];
  const tasksKey = gameList.map((g) => `${g.repo}:${g.config.tasksProject}`).join(",");
  const loadTasks = useMemo(
    () =>
      gameList.length
        ? async () => {
            const entries = await Promise.all(gameList.map(async (g) => [g.repo, await fetchProject(g.config.tasksProject)] as const));
            return Object.fromEntries(entries) as Record<string, Project>;
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasksKey],
  );
  const tasks = usePoll(loadTasks, POLL_MS, tasksKey);

  // Assets of the picked game: every 10 s on the screens that show them, else every minute.
  const assetsNum = game?.config.assetsProject;
  const loadAssets = useMemo(() => (assetsNum ? () => fetchProject(assetsNum) : null), [assetsNum]);
  const assets = usePoll(loadAssets, tab === "board" ? 60_000 : POLL_MS, `${game?.repo}:${assetsNum}:${tab === "board"}`);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.err ? 8000 : 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const run: Run = useCallback(
    async (label, fn) => {
      try {
        await fn();
        setToast({ text: label });
        return true;
      } catch (e) {
        tasks.dropPatches();
        assets.dropPatches();
        setToast({ text: `${label} failed: ${e instanceof Error ? e.message : e}`, err: true });
        return false;
      } finally {
        tasks.refresh();
        assets.refresh();
      }
    },
    [tasks, assets],
  );

  const me = memberForLogin(viewer.login)?.name ?? viewer.name ?? viewer.login;
  const tasksProject = game ? tasks.data?.[game.repo] : undefined;

  // Header progress: the game's first open milestone.
  const milestone = game?.milestones[0];
  const msItems = tasksProject?.items.filter((t) => milestone && t.values["Milestone"] === milestone.title) ?? [];
  const msDone = msItems.filter((t) => status(t) === "Done").length;

  const error = games.error || tasks.error || assets.error;

  if (games.data && !games.data.length) {
    return (
      <div className="center">
        <h1>Studio hub</h1>
        <p className="sub">No games yet. A game is a repo in the organization with the topic “game” and a hub.config.json.</p>
      </div>
    );
  }

  const unitLabel = game?.config.structure.label ?? "Areas";
  const units = game?.config.structure.units.length ?? 0;
  const tabs: [Tab, string][] = [
    ["board", "Tasks board"],
    ["assets", "Assets"],
    ["areas", `${unitLabel} 1 to ${units}`],
  ];

  return (
    <div className="page">
      <header className="header">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="title-row">
            {gameList.length > 1 ? (
              <select className="picker" aria-label="Game" value={game?.repo ?? ""} onChange={(e) => pick(e.target.value)}>
                {gameList.map((g) => (
                  <option key={g.repo} value={g.repo}>
                    {g.config.name}
                  </option>
                ))}
              </select>
            ) : null}
            <h1>{game ? `${game.config.name} hub` : "Studio hub"}</h1>
            <button className="btn" disabled title="Coming in step 5: creates a repo from game-template">
              New game
            </button>
            {error ? (
              <span className="badge err" title={error}>
                Sync problem
              </span>
            ) : (
              <span className="badge" title={tasks.loadedAt ? `Last synced ${tasks.loadedAt.toLocaleTimeString()}` : ""}>
                {tasks.loadedAt ? "Live" : "Loading…"}
              </span>
            )}
          </div>
          <p className="sub">Live for all three of you. Tasks, assets and {unitLabel.toLowerCase()}, synced from GitHub.</p>
        </div>
        {milestone ? (
          <div className="milestone">
            <div className="milestone-top">
              <span style={{ fontWeight: 500 }}>{milestone.title}</span>
              <span className="sub">
                {msDone} of {msItems.length} done
              </span>
            </div>
            <div className="bar">
              <div style={{ width: `${msItems.length ? Math.round((msDone / msItems.length) * 100) : 0}%` }} />
            </div>
          </div>
        ) : null}
      </header>

      <nav className="tabs" aria-label="Hub views">
        {tabs.map(([k, label]) => (
          <button key={k} className={"tab" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
        <span className="spacer" />
        {game ? (
          <a className="small" href={game.url} target="_blank" rel="noreferrer">
            {game.repo} on GitHub
          </a>
        ) : null}
      </nav>

      <div className="layout">
        <SidePanel games={gameList} tasks={tasks.data} />
        <main className="main">
          {!game || !tasksProject ? (
            <p className="empty">Loading tasks…</p>
          ) : tab === "board" ? (
            <Board game={game} project={tasksProject} me={me} run={run} patch={(fn) => tasks.patch((all) => ({ ...all, [game.repo]: fn(all[game.repo]) }))} />
          ) : !assets.data ? (
            <p className="empty">Loading assets…</p>
          ) : tab === "assets" ? (
            <Assets game={game} project={assets.data} run={run} patch={assets.patch} />
          ) : (
            <Areas game={game} tasks={tasksProject} assets={assets.data} />
          )}
        </main>
      </div>

      {toast ? <div className={"toast" + (toast.err ? " err" : "")}>{toast.text}</div> : null}
    </div>
  );
}

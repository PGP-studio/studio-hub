import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchGames, fetchProject, fetchViewer, type Game, type Project, type Viewer } from "./github";
import { usePoll } from "./usePoll";
import { finishSignIn, hasToken, loadSettings, signIn, signOut, usesDevProxy } from "./auth";
import { status } from "./lib";
import { memberForLogin } from "./team";
import Board from "./components/Board";
import Assets from "./components/Assets";
import Areas from "./components/Areas";
import SidePanel from "./components/SidePanel";
import Workflows from "./components/Workflows";
import NewGameDialog from "./components/NewGameDialog";

const POLL_MS = 10_000;
const ASSETS_POLL_MS = 30_000;
const LAST_GAME = "hub.lastGame";
type Tab = "board" | "workflows" | "assets" | "areas";

export type Run = (label: string, fn: () => Promise<void>) => Promise<boolean>;

export default function App() {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);

  useEffect(() => {
    (async () => {
      await loadSettings();
      if (!usesDevProxy) {
        const err = await finishSignIn();
        if (err) setError(err);
        if (!hasToken()) {
          setNeedsSignIn(true);
          return;
        }
      }
      try {
        setViewer(await fetchViewer());
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/GitHub 401/.test(msg) && !usesDevProxy) {
          // Token expired or was revoked: sign in again.
          sessionStorage.removeItem("gh_token");
          setNeedsSignIn(true);
        } else {
          setError(msg);
        }
      }
    })();
  }, []);

  if (needsSignIn) {
    return (
      <div className="center">
        <h1>Studio hub</h1>
        <p className="sub">Tasks, assets and areas for every PGP-studio game, synced from GitHub.</p>
        {error ? <p className="warn">{error}</p> : null}
        <div>
          <button className="btn-primary" onClick={signIn}>
            Sign in with GitHub
          </button>
        </div>
        <p className="small">Only members of the PGP-studio organization can use the hub.</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="center">
        <h1>Studio hub</h1>
        <p className="sub">Couldn't reach GitHub: {error}</p>
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
        {!usesDevProxy ? (
          <div>
            <button className="btn" onClick={signOut}>
              Sign out
            </button>
          </div>
        ) : null}
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
  const [workflowFilter, setWorkflowFilter] = useState("");
  const [creatingGame, setCreatingGame] = useState(false);
  const [toast, setToast] = useState<{ text: string; err?: boolean } | null>(null);

  const game: Game | undefined = games.data?.find((g) => g.repo === repo) ?? games.data?.[0];
  const pick = (r: string) => {
    setRepo(r);
    setWorkflowFilter("");
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

  // Assets of the picked game. A full load of ~750 items costs ~9 GraphQL points, so poll it
  // every 30 s on the screens that show it and every 5 min otherwise (GitHub allows 5000/hour).
  // Your own edits still show at once.
  const assetsNum = game?.config.assetsProject;
  const loadAssets = useMemo(() => (assetsNum ? () => fetchProject(assetsNum) : null), [assetsNum]);
  const assetsVisible = tab === "assets" || tab === "areas";
  const assets = usePoll(loadAssets, assetsVisible ? ASSETS_POLL_MS : 300_000, `${game?.repo}:${assetsNum}:${assetsVisible}`);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.err ? 8000 : 4500);
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
  const msItems = tasksProject?.items.filter((t) => !t.isWorkflow && milestone && t.values["Milestone"] === milestone.title) ?? [];
  const msDone = msItems.filter((t) => status(t) === "Done").length;

  const error = games.error || tasks.error || assets.error;

  const newGameDialog = creatingGame ? (
    <NewGameDialog
      onClose={() => setCreatingGame(false)}
      onCreated={async (slug) => {
        setCreatingGame(false);
        await games.refresh();
        pick(slug);
        setToast({ text: `Created ${slug}. Fill in "The game" in its CLAUDE.md and its areas in hub.config.json.` });
      }}
    />
  ) : null;

  if (games.data && !games.data.length) {
    return (
      <div className="center">
        <h1>Studio hub</h1>
        <p className="sub">No games yet. A game is a repo in the organization with the topic “game” and a hub.config.json.</p>
        <div>
          <button className="btn-primary" onClick={() => setCreatingGame(true)}>
            New game
          </button>
        </div>
        {newGameDialog}
      </div>
    );
  }

  const unitLabel = game?.config.structure.label ?? "Areas";
  const units = game?.config.structure.units.length ?? 0;
  const tabs: [Tab, string][] = [
    ["board", "Tasks board"],
    ["workflows", "Workflows"],
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
            <button className="btn" onClick={() => setCreatingGame(true)} title="Creates a repo from game-template with its Tasks and Assets boards">
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
        <span className="small">· {viewer.login}</span>
        {!usesDevProxy ? (
          <button className="row-del" onClick={signOut}>
            Sign out
          </button>
        ) : null}
      </nav>

      <div className="layout">
        <SidePanel games={gameList} tasks={tasks.data} />
        <main className="main">
          {!game || !tasksProject ? (
            <p className="empty">Loading tasks…</p>
          ) : tab === "board" ? (
            <Board
              game={game}
              project={tasksProject}
              me={me}
              run={run}
              notify={(text) => setToast({ text })}
              workflowFilter={workflowFilter}
              setWorkflowFilter={setWorkflowFilter}
              patch={(fn) => tasks.patch((all) => ({ ...all, [game.repo]: fn(all[game.repo]) }))} />
          ) : tab === "workflows" ? (
            <Workflows
              game={game}
              project={tasksProject}
              run={run}
              notify={(text) => setToast({ text })}
              showOnBoard={(n) => {
                setWorkflowFilter(String(n));
                setTab("board");
              }}
            />
          ) : !assets.data ? (
            <p className="empty">Loading assets…</p>
          ) : tab === "assets" ? (
            <Assets game={game} project={assets.data} run={run} patch={assets.patch} />
          ) : (
            <Areas game={game} tasks={tasksProject} assets={assets.data} />
          )}
        </main>
      </div>

      {newGameDialog}
      {toast ? <div className={"toast" + (toast.err ? " err" : "")}>{toast.text}</div> : null}
    </div>
  );
}

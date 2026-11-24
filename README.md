# Studio hub

One web app for every game the studio makes: a Tasks board, Assets and Areas per game, plus who's working now across all games. **GitHub is the database**; the hub stores nothing of its own. The full spec is `HUB_APP.md` in the `hunting-game` repo.

## Run it locally

```sh
npm install
npm run dev      # http://localhost:5173
```

The dev server forwards `/gh/*` to `api.github.com` and adds your token, so it never reaches the browser. It uses `GITHUB_TOKEN` from `.env.local`, or `gh auth token` if that's empty. The token needs `repo`, `read:org` and `project`. See `.env.example`.

## How games show up

A game is any repo in `PGP-studio` with the topic `game` and a `hub.config.json` at its root (project numbers, systems, asset types, areas). Set `VITE_HUB_CONFIG_REF=<branch>` in `.env.local` to test a config that isn't on the default branch yet.

## Code map

- `src/github.ts`: every GitHub GraphQL read and write.
- `src/App.tsx`: game picker, tabs, polling (every 10 s while the tab is visible), header milestone.
- `src/components/Board.tsx`: Tasks board and task dialog (create, edit, claim, move, close).
- `src/components/Assets.tsx`: filters, search, inline edit, add.
- `src/components/Areas.tsx`: progress per area from the config's `structure`; click for detail.
- `src/components/SidePanel.tsx`: In-progress tasks across all games, grouped by person.
- `src/team.ts`: the team list (names, GitHub logins, colours).
- `src/styles.css`: colours and layout, matching `design/hub-prototype.html`.

## Not done yet

- Sign-in with a GitHub OAuth App and a Vercel function (step 4). Until then it only runs locally.
- The "New game" button (step 5, needs `game-template`).

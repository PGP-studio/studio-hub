# Studio hub — rules for Claude

- Read `README.md` first. The spec is `HUB_APP.md` in `PGP-studio/hunting-game`; the look is `design/hub-prototype.html` there.
- GitHub is the only database. Don't add a backend store; all reads and writes go through `src/github.ts`.
- Keep it simple and easy to change: plain React state, no state or UI libraries unless the team agrees.
- Never commit tokens. `.env` and `.env.local` stay local; secrets for the deployed app live in Vercel.
- One task = one issue = one branch = one PR. Run `npm run build` before pushing.

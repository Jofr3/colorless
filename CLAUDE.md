# colorless

- Start at `docs/status.md` (current state, open items), then follow the resume protocol in
  `docs/README.md`; its Common tasks table says where each recipe lives.
- `bun run check` is the gate (`docs/status.md`, "Working on it"). After adding a `docs/decisions.md`
  entry, run `bun run docs:index`.
- A worktree needs only `bun install`; run tools through `bun run`/`bunx`, not bare names.
- Comments follow the minimal-comments rule in `docs/conventions.md`, "Code & quality".
- Production writes go only through `bun run release` or `apps/api/scripts/with-deploy-token.ts`;
  never a raw remote `wrangler` write (README.md, "Deployment").

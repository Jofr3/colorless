// bunfig.toml preloads this for `bun test`, which would otherwise run Bun's own runner over every
// test file under tmp/ and the worktrees as well as the repo's, and fail on Vitest-only APIs.
console.error(
  "This repo's tests run under Vitest: `bun run test:run [path]` or `bunx vitest run [path] [-t name]`.",
);
process.exit(1);

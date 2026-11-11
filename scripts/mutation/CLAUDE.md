# scripts/mutation

- How mutant rows are written, run, declared and merged: `docs/conventions.md`, "Mutants are
  DECLARED, not narrated".
- Append rows to `mutants.ts` with ids prefixed by their decision; after a conflicted merge run
  `bun scripts/mutation/merge-corpus.ts`, never a hand merge of the tail.
- `bun run mutants:precheck` after any edit to a file a row quotes; `bun run mutants --decision <id>`
  runs a decision's rows.

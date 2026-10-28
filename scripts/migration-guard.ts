#!/usr/bin/env bun
/**
 * Fails on a D1 migration that rebuilds a table, unless the file is listed in REVIEWED. D1 runs
 * each migration file in a transaction with foreign keys enforced, so the `PRAGMA foreign_keys=OFF`
 * that drizzle-kit writes around a rebuild does nothing, and its `DROP TABLE` fires the dropped
 * table's ON DELETE actions: rebuilding `users` or `decks` deletes every child row. A rebuild must
 * follow the recipe in docs/conventions.md "Database migrations" and pass
 * `apps/api/src/db/migrations.d1.test.ts` before it is added here.
 *
 * Also fails on a migration that drops or renames a column or renames a table, unless the file is
 * listed in CONTRACTS_REVIEWED. `release` migrates before it deploys, so the Worker still serving
 * reads the old name until the deploy finishes, and 500s on it (expand, then contract).
 */

import { readdirSync, readFileSync } from "node:fs";
import { type Report, runReport } from "./lib/cli";
import { repoPath } from "./lib/repo";

const DIR = "apps/api/drizzle";

/** Migration files allowed to rebuild a table, each with why it is safe. */
const REVIEWED: Readonly<Record<string, string>> = {};

/** Migration files allowed to drop or rename, each with the deployed commit since which no code
    reads the old name ("code stopped reading it in <commit>"). */
const CONTRACTS_REVIEWED: Readonly<Record<string, string>> = {
  "0001_elite_jackpot.sql":
    "drops the R2 url columns in the commit that stopped reading them (d7a4506f), " +
    "the API's first deploy, so no older Worker ever read them",
};

type Marker = { label: string; pattern: RegExp };

const REBUILD_MARKERS: readonly Marker[] = [
  { label: "PRAGMA foreign_keys", pattern: /\bPRAGMA\s+foreign_keys\b/i },
  { label: "DROP TABLE", pattern: /\bDROP\s+TABLE\b/i },
  { label: "__new_ table", pattern: /`?__new_\w+/ },
];

// A rebuild's own `ALTER TABLE __new_x RENAME TO x` is the rebuild check's concern.
const CONTRACT_MARKERS: readonly Marker[] = [
  { label: "DROP COLUMN", pattern: /\bALTER\s+TABLE\s+\S+\s+DROP\b/i },
  { label: "RENAME", pattern: /\bALTER\s+TABLE\s+(?![`"]?__new_)\S+\s+RENAME\b/i },
];

export type MigrationSource = { name: string; sql: string };

function flagged(
  files: readonly MigrationSource[],
  markers: readonly Marker[],
  reviewed: Readonly<Record<string, string>>,
): string[] {
  return files.flatMap(({ name, sql }) => {
    if (name in reviewed) return [];
    const found = markers.filter((m) => m.pattern.test(sql)).map((m) => m.label);
    return found.length === 0 ? [] : [`  ${DIR}/${name}: ${found.join(", ")}`];
  });
}

export function migrationGuardReport(files: readonly MigrationSource[]): Report {
  const rebuilds = flagged(files, REBUILD_MARKERS, REVIEWED);
  const contracts = flagged(files, CONTRACT_MARKERS, CONTRACTS_REVIEWED);
  const lines = [
    ...(rebuilds.length === 0
      ? []
      : [
          "migration-guard: FAIL — these migrations rebuild a table, which on D1 deletes the rows",
          "that reference it (ON DELETE CASCADE / SET NULL fire inside the migration's transaction):",
          ...rebuilds,
          'Follow docs/conventions.md "Database migrations" (keep the child rows, restore them after),',
          "prove it with apps/api/src/db/migrations.d1.test.ts, then list the file in REVIEWED.",
        ]),
    ...(contracts.length === 0
      ? []
      : [
          "migration-guard: FAIL — these migrations drop or rename, which breaks the Worker still",
          "serving while `release` migrates (it reads the old name until the deploy finishes):",
          ...contracts,
          "Ship the code that stops reading the old name one release earlier, then list the file in",
          'CONTRACTS_REVIEWED with "code stopped reading it in <commit>".',
        ]),
  ];
  if (lines.length > 0) return { ok: false, lines };
  return {
    ok: true,
    lines: [`${files.length} migrations, none rebuilds a table or drops or renames unreviewed`],
  };
}

function migrationFiles(): MigrationSource[] {
  return readdirSync(repoPath(DIR))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(repoPath(`${DIR}/${name}`), "utf8") }));
}

if (import.meta.main) runReport("migration-guard", () => migrationGuardReport(migrationFiles()));

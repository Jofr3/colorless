#!/usr/bin/env bun
/**
 * Fails on a D1 migration that rebuilds a table, unless the file is listed in REVIEWED. D1 runs
 * each migration file in a transaction with foreign keys enforced, so the `PRAGMA foreign_keys=OFF`
 * that drizzle-kit writes around a rebuild does nothing, and its `DROP TABLE` fires the dropped
 * table's ON DELETE actions: rebuilding `users` or `decks` deletes every child row. A rebuild must
 * follow the recipe in docs/conventions.md "Database migrations" and pass
 * `apps/api/src/db/migrations.d1.test.ts` before it is added here.
 */

import { readdirSync, readFileSync } from "node:fs";
import { type Report, runReport } from "./lib/cli";
import { repoPath } from "./lib/repo";

const DIR = "apps/api/drizzle";

/** Migration files allowed to rebuild a table, each with why it is safe. */
const REVIEWED: Readonly<Record<string, string>> = {};

const REBUILD_MARKERS: readonly { label: string; pattern: RegExp }[] = [
  { label: "PRAGMA foreign_keys", pattern: /\bPRAGMA\s+foreign_keys\b/i },
  { label: "DROP TABLE", pattern: /\bDROP\s+TABLE\b/i },
  { label: "__new_ table", pattern: /`?__new_\w+/ },
];

export type MigrationSource = { name: string; sql: string };

export function migrationGuardReport(files: readonly MigrationSource[]): Report {
  const problems = files.flatMap(({ name, sql }) => {
    if (name in REVIEWED) return [];
    const found = REBUILD_MARKERS.filter((m) => m.pattern.test(sql)).map((m) => m.label);
    return found.length === 0 ? [] : [`  ${DIR}/${name}: ${found.join(", ")}`];
  });
  if (problems.length > 0) {
    return {
      ok: false,
      lines: [
        "migration-guard: FAIL — these migrations rebuild a table, which on D1 deletes the rows",
        "that reference it (ON DELETE CASCADE / SET NULL fire inside the migration's transaction):",
        ...problems,
        'Follow docs/conventions.md "Database migrations" (keep the child rows, restore them after),',
        "prove it with apps/api/src/db/migrations.d1.test.ts, then list the file in REVIEWED.",
      ],
    };
  }
  return { ok: true, lines: [`${files.length} migrations, none rebuilds a table unreviewed`] };
}

function migrationFiles(): MigrationSource[] {
  return readdirSync(repoPath(DIR))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(repoPath(`${DIR}/${name}`), "utf8") }));
}

if (import.meta.main) runReport("migration-guard", () => migrationGuardReport(migrationFiles()));

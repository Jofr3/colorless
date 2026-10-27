// Read-only checks `bun run release` and the API deploy run against production before they write.
// Each named step runs in order; the first failure exits 1.
//
//   bun scripts/release-gate.ts bookmark print-keys   # release, before the remote migrations
//   bun scripts/release-gate.ts migrations            # `deploy`, before wrangler deploy
//
// bookmark    Records the remote database's Time Travel bookmark (scripts/d1.ts recordBookmark).
// print-keys  The local and remote catalogs agree on every card's print_key. The engine's
//             PROGRAM_ALIAS table is generated from the LOCAL catalog (scripts/registry-aliases.ts),
//             so a release built on a stale local ingest ships aliases production does not match.
// migrations  Every file in drizzle/ is applied remotely, and nothing else is: a Worker deployed
//             ahead of its migrations 500s the endpoints that read the new columns (D203).

import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { API_ROOT, type D1Target, d1Query, recordBookmark } from "./d1";

const STEPS: Record<string, () => void> = {
  bookmark: () => {
    recordBookmark("release");
  },
  "print-keys": () => {
    const keys = (target: D1Target) =>
      (d1Query(target, "SELECT id, print_key FROM cards ORDER BY id")[0] ?? []).map(
        (row) => `${String(row.id)} ${String(row.print_key)}`,
      );
    const local = keys("--local");
    const remote = keys("--remote");
    const digest = (lines: string[]) => createHash("sha256").update(lines.join("\n")).digest("hex");
    if (local.length > 0 && digest(local) === digest(remote)) {
      console.log(`print-keys: OK — ${local.length} cards agree locally and remotely`);
      return;
    }
    const remoteSet = new Set(remote);
    const localSet = new Set(local);
    const onlyLocal = local.filter((line) => !remoteSet.has(line));
    const onlyRemote = remote.filter((line) => !localSet.has(line));
    throw new Error(
      [
        `print-keys: FAIL — local (${local.length} cards) and remote (${remote.length}) differ:`,
        ...onlyLocal.slice(0, 5).map((line) => `  local only:  ${line}`),
        ...onlyRemote.slice(0, 5).map((line) => `  remote only: ${line}`),
        "Re-ingest locally (the sets production has), run `bun scripts/registry-aliases.ts`",
        "from the repo root, commit, and release again.",
      ].join("\n"),
    );
  },
  migrations: () => {
    const files = readdirSync(join(API_ROOT, "drizzle"))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const applied = (
      d1Query("--remote", "SELECT name FROM d1_migrations ORDER BY id")[0] ?? []
    ).map((row) => String(row.name));
    const pending = files.filter((name) => !applied.includes(name));
    const unknown = applied.filter((name) => !files.includes(name));
    if (pending.length === 0 && unknown.length === 0) {
      console.log(`migrations: OK — all ${files.length} applied remotely`);
      return;
    }
    throw new Error(
      [
        "migrations: FAIL — the remote database does not match drizzle/:",
        ...pending.map((name) => `  not applied remotely: ${name}`),
        ...unknown.map((name) => `  applied remotely but not in drizzle/: ${name}`),
        "Deploy through `bun run release` (it migrates first), or run `bun run db:migrate:remote`.",
      ].join("\n"),
    );
  },
};

const requested = process.argv.slice(2);
const unknownSteps = requested.filter((step) => !(step in STEPS));
if (requested.length === 0 || unknownSteps.length > 0) {
  console.error(`release-gate: name steps from ${Object.keys(STEPS).join(", ")}`);
  process.exit(1);
}
try {
  for (const step of requested) STEPS[step]?.();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

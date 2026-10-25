// The local D1 catalog sqlite: wrangler dev state, absent on a fresh clone and in CI.

import { readdirSync, statSync } from "node:fs";
import { repoPath } from "./repo";

export const D1_DIR = "apps/api/.wrangler/state/v3/d1/miniflare-D1DatabaseObject";

/** Overrides the default location, e.g. to read the main checkout's file from a worktree. */
export const D1_ENV = "COLORLESS_D1_SQLITE";

/**
 * The sqlite to read: `$COLORLESS_D1_SQLITE`, else the one database file under `D1_DIR`
 * (Miniflare names it after a hash of the database id). `undefined` when there is none; more
 * than one database file is an error.
 */
export function findLocalD1(): string | undefined {
  const override = process.env[D1_ENV];
  if (override !== undefined && override !== "") {
    if (!statSync(override, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`${D1_ENV}=${override} is not a file`);
    }
    return override;
  }
  let names: string[];
  try {
    names = readdirSync(repoPath(D1_DIR));
  } catch {
    return undefined;
  }
  const dbs = names.filter((n) => n.endsWith(".sqlite") && n !== "metadata.sqlite");
  if (dbs.length === 0) return undefined;
  if (dbs.length !== 1) {
    throw new Error(`expected one D1 sqlite in ${D1_DIR}, found ${dbs.length}: ${dbs.join(", ")}`);
  }
  return repoPath(`${D1_DIR}/${dbs[0]}`);
}

/** The path a generated file records: from `D1_DIR` on, so it reads the same on every machine. */
export function shownD1Path(path: string): string {
  const at = path.indexOf(D1_DIR);
  return at === -1 ? path : path.slice(at);
}

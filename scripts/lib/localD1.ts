// The local D1 catalog sqlite: wrangler dev state, absent on a fresh clone and in CI.

import { readdirSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { mainCheckout, REPO_ROOT } from "./repo";

export const D1_DIR = "apps/api/.wrangler/state/v3/d1/miniflare-D1DatabaseObject";

/** Overrides the default location, e.g. to read a copy elsewhere. */
export const D1_ENV = "COLORLESS_D1_SQLITE";

/**
 * The sqlite to read: `$COLORLESS_D1_SQLITE`, else this checkout's database file under `D1_DIR`
 * (Miniflare names it after a hash of the database id), else the main checkout's. A worktree's own
 * D1 is empty until something ingests into it (`api:dev` migrates an empty one), so one with no
 * catalog rows counts as absent. Callers open it read-only: the main checkout's file belongs to
 * whatever dev server runs there. `undefined` when there is none; more than one database file in a
 * directory is an error.
 */
export function findLocalD1(
  own = REPO_ROOT,
  main: string | undefined = mainCheckout(own),
): string | undefined {
  const override = process.env[D1_ENV];
  if (override !== undefined && override !== "") {
    if (!statSync(override, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`${D1_ENV}=${override} is not a file`);
    }
    return override;
  }
  const mine = catalogIn(own);
  if (mine !== undefined || main === undefined) return mine;
  return catalogIn(main);
}

/** The one database file under `root`'s `D1_DIR`, when it holds catalog rows. */
function catalogIn(root: string): string | undefined {
  const dir = join(root, D1_DIR);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return undefined;
  }
  const dbs = names.filter((n) => n.endsWith(".sqlite") && n !== "metadata.sqlite");
  if (dbs.length === 0) return undefined;
  if (dbs.length !== 1) {
    throw new Error(`expected one D1 sqlite in ${dir}, found ${dbs.length}: ${dbs.join(", ")}`);
  }
  const path = join(dir, dbs[0] ?? "");
  return hasCards(path) ? path : undefined;
}

function hasCards(path: string): boolean {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare("select 1 from cards limit 1").get() !== undefined;
  } catch {
    return false;
  } finally {
    db.close();
  }
}

/** The path a generated file records: from `D1_DIR` on, so it reads the same on every machine. */
export function shownD1Path(path: string): string {
  const at = path.indexOf(D1_DIR);
  return at === -1 ? path : path.slice(at);
}

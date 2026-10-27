// Where the ingest CLI writes each SQL file it applies. Labels carry upstream set ids, which the
// tcgdex schemas already hold to a safe shape; the label is encoded and the path checked as well,
// so no label can place a file outside the run's directory (`drizzle/`, say, where wrangler would
// take it for a migration). Not re-exported from ./index.ts: it needs node:path, which the Worker
// does not have.

import { isAbsolute, relative, resolve } from "node:path";

/** `{dir}/{ordinal}-{label}.sql` with the label percent-encoded, or a throw if it would leave
    `dir`. */
export function sqlFilePath(dir: string, ordinal: number, label: string): string {
  const name = `${String(ordinal).padStart(3, "0")}-${encodeURIComponent(label)}.sql`;
  const root = resolve(dir);
  const path = resolve(root, name);
  const inside = relative(root, path);
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside) || inside.includes("/")) {
    throw new Error(`refusing to write the SQL file ${JSON.stringify(name)} outside ${root}`);
  }
  return path;
}

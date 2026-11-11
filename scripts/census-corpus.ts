#!/usr/bin/env bun
// Writes the census's committed attack corpora, `packages/engine/src/censusAttackCorpus.ts` (the
// `sv` serie) and `censusAttackCorpusMe.ts` (`me`), from the local D1 catalog. Only each file's
// corpus literal is rewritten; the code around it is left alone.
//
//   bun scripts/census-corpus.ts            # rewrite both corpora
//   bun scripts/census-corpus.ts --check    # exit 1 if either would change
//
// Without a local D1 (`scripts/lib/localD1.ts`), `--check` skips and says so, and a rewrite fails.

import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { committedText } from "./lib/generated";
import { D1_DIR, D1_ENV, findLocalD1 } from "./lib/localD1";
import { repoPath } from "./lib/repo";

/** Each corpus: the file, the template literal it holds the records in, and the serie it counts. */
export const CORPORA = [
  { out: "packages/engine/src/censusAttackCorpus.ts", literal: "CORPUS", serie: "sv" },
  { out: "packages/engine/src/censusAttackCorpusMe.ts", literal: "CORPUS_ME", serie: "me" },
] as const;

/**
 * A serie's Standard-legal Pokémon attack column, one row per distinct effect sentence with the
 * number of legal printings that carry it, sorted by sentence in SQLite's binary order. An attack
 * with no effect text (null or empty) is left out.
 */
export const CORPUS_SQL = `
  SELECT COUNT(*) AS n, json_extract(j.value, '$.effect') AS s
    FROM cards c, json_each(c.attacks_json) j
   WHERE c.legal_standard = 1
     AND c.category = 'Pokemon'
     AND c.set_id IN (SELECT id FROM sets WHERE serie_id = ?)
     AND json_extract(j.value, '$.effect') NOT IN ('')
   GROUP BY s ORDER BY s`;

/** The corpus records, `<printings> <sentence>` a line, for `serie`. */
export function corpusRecords(db: DatabaseSync, serie: string): string {
  const rows = db.prepare(CORPUS_SQL).all(serie) as { n: number; s: string }[];
  for (const { s } of rows) {
    // The records sit in a template literal and are split on spaces and newlines.
    if (/[`\\\n]|\$\{/.test(s) || s !== s.trim()) {
      throw new Error(`a ${serie} sentence cannot be a corpus record: ${JSON.stringify(s)}`);
    }
  }
  return rows.map(({ n, s }) => `${n} ${s}`).join("\n");
}

/** `source` with the body of its `const <literal> = \`` template literal replaced by `records`. */
export function withRecords(source: string, literal: string, records: string): string {
  const open = `const ${literal} = \`\n`;
  const start = source.indexOf(open);
  const end = start === -1 ? -1 : source.indexOf("\n`;", start + open.length - 1);
  if (start === -1 || end === -1 || source.indexOf(open, start + 1) !== -1) {
    throw new Error(`expected one \`${open.trim()}\` ... \`;\` block`);
  }
  return `${source.slice(0, start + open.length)}${records}${source.slice(end)}`;
}

/** Each corpus file as the catalog at `dbPath` would write it, beside its committed text. */
export function regenerated(
  dbPath: string,
  read: (out: string) => string = committedText,
): { out: string; committed: string; body: string }[] {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return CORPORA.map(({ out, literal, serie }) => {
      const committed = read(out);
      return { out, committed, body: withRecords(committed, literal, corpusRecords(db, serie)) };
    });
  } finally {
    db.close();
  }
}

/** Checks or rewrites the corpora from the catalog at `dbPath`; the exit status. */
export function main(argv: readonly string[], dbPath: string | undefined): number {
  const check = argv.includes("--check");
  if (dbPath === undefined) {
    const where = `no local D1 sqlite under ${D1_DIR} (set ${D1_ENV} to read another)`;
    if (check) {
      console.log(`census corpora: freshness check SKIPPED — ${where}.`);
      return 0;
    }
    console.error(`census corpora: cannot generate — ${where}.`);
    return 1;
  }
  const files = regenerated(dbPath);
  const stale = files.filter((file) => file.body !== file.committed);
  if (check) {
    for (const { out } of stale) {
      console.error(`${out} is STALE — run: bun scripts/census-corpus.ts`);
    }
    if (stale.length > 0) return 1;
    console.log(`census corpora are current (${files.map((f) => f.out).join(", ")}).`);
    return 0;
  }
  for (const { out, body } of stale) writeFileSync(repoPath(out), body);
  console.log(`census corpora: ${stale.length} of ${files.length} rewritten.`);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2), findLocalD1()));

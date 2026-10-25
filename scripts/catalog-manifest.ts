#!/usr/bin/env bun
// Generates `packages/engine/src/catalogManifest.ts`, a committed snapshot of the local D1 catalog.
//
//   bun run scripts/catalog-manifest.ts            # rewrite the manifest
//   bun run scripts/catalog-manifest.ts --check    # exit 1 if it would change
//
// The local D1 is dev state absent on a fresh clone and in CI, so tests check against this snapshot
// instead; re-run the script to re-measure. The manifest records the sqlite's size and mtime.

import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { FIXTURE_POOL } from "@colorless/engine/testing";
import { localBin, REPO_ROOT, repoPath } from "./lib/repo";

const D1_DIR = "apps/api/.wrangler/state/v3/d1/miniflare-D1DatabaseObject";

/** Miniflare names the local D1 file after a hash of the database id, so it is
    found rather than hard-coded; exactly one database file must exist. */
function localD1Path(): string {
  let names: string[];
  try {
    names = readdirSync(repoPath(D1_DIR));
  } catch {
    throw new Error(`no local D1 at ${D1_DIR}; run the catalog ingest first`);
  }
  const dbs = names.filter((n) => n.endsWith(".sqlite") && n !== "metadata.sqlite");
  if (dbs.length !== 1) {
    throw new Error(`expected one D1 sqlite in ${D1_DIR}, found ${dbs.length}: ${dbs.join(", ")}`);
  }
  return `${D1_DIR}/${dbs[0]}`;
}

const DB_PATH = localD1Path();
const OUT = "packages/engine/src/catalogManifest.ts";

/**
 * A fixture id naming a real printing (not a synthetic `fix-*` body). An unknown id shape fails the
 * suite rather than being skipped.
 */
const REAL_ID = /^(sv|swsh|me\d|mep-|mee-|30th)/;

/**
 * The six sets the older catalog held, as a slice of today's file, so older counts reconcile
 * against a live measurement.
 */
const SIX_SETS = ["sv01", "sv02", "sv03", "sv06.5", "sve", "swsh10.5"] as const;
const SIX = `set_id in (${SIX_SETS.map((s) => `'${s}'`).join(", ")})`;

interface Row {
  id: string;
  set_id: string;
  name: string;
  category: string;
  types_json: string | null;
  attacks_json: string | null;
  abilities_json: string | null;
}

/** Row predicates: the text column holds something. */
const HAS_ATTACKS = "(attacks_json is not null and attacks_json <> '[]')";
const HAS_ABILITIES = "(abilities_json is not null and abilities_json <> '[]')";
const HAS_EFFECT = "(effect is not null and effect <> '')";
const HAS_ANY_TEXT = `(${HAS_ATTACKS} or ${HAS_ABILITIES} or ${HAS_EFFECT})`;

const db = new Database(repoPath(DB_PATH), { readonly: true });
const stat = statSync(repoPath(DB_PATH));
const q = <T>(sql: string): T[] => db.query(sql).all() as T[];

/** A query's single `n` column. */
function one(sql: string): number {
  const row = db.query(sql).get();
  const n = typeof row === "object" && row !== null && "n" in row ? row.n : undefined;
  if (typeof n !== "number") throw new Error(`expected a numeric \`n\` from: ${sql}`);
  return n;
}

const rows = one("select count(*) as n from cards");
const perSet = q<{ set_id: string; n: number }>(
  "select set_id, count(*) as n from cards group by set_id order by set_id",
);
const perCategory = q<{ category: string; n: number }>(
  "select category, count(*) as n from cards group by category order by category",
);
const distinctNames = one("select count(distinct name) as n from cards");
const withEffect = one(`select count(*) as n from cards where ${HAS_EFFECT}`);
const withAttacks = one(`select count(*) as n from cards where ${HAS_ATTACKS}`);
const withAbilities = one(`select count(*) as n from cards where ${HAS_ABILITIES}`);
const withAnyText = one(`select count(*) as n from cards where ${HAS_ANY_TEXT}`);
const straightApostropheInAttacks = one(
  "select count(*) as n from cards where attacks_json like '%''%'",
);
const curlyApostropheAnywhere = one(
  `select count(*) as n from cards where effect like '%'||char(8217)||'%'
     or attacks_json like '%'||char(8217)||'%'
     or abilities_json like '%'||char(8217)||'%'
     or name like '%'||char(8217)||'%'`,
);
const legalStandardZero = one("select count(*) as n from cards where legal_standard = 0");
const setRows = one("select count(*) as n from sets");
const serieRows = one("select count(*) as n from series");

/**
 * The restored set's contribution to each count, measured on four axes so a re-ingest of different
 * rows fails reconciliation.
 */
const RESTORED_SET = "swsh10.5";
const restoredRows = one(`select count(*) as n from cards where set_id = '${RESTORED_SET}'`);
const restoredLegalStandardZero = one(
  `select count(*) as n from cards where set_id = '${RESTORED_SET}' and legal_standard = 0`,
);
const restoredWithAttacks = one(
  `select count(*) as n from cards where set_id = '${RESTORED_SET}' and ${HAS_ATTACKS}`,
);
const restoredStraightApostrophe = one(
  `select count(*) as n from cards where set_id = '${RESTORED_SET}' and attacks_json like '%''%'`,
);
/** The six-set slice's own counts. */
const sixRows = one(`select count(*) as n from cards where ${SIX}`);
const sixLegalStandardZero = one(
  `select count(*) as n from cards where ${SIX} and legal_standard = 0`,
);
const sixWithAttacks = one(`select count(*) as n from cards where ${SIX} and ${HAS_ATTACKS}`);
const sixStraightApostrophe = one(
  `select count(*) as n from cards where ${SIX} and attacks_json like '%''%'`,
);
const sixDistinctNames = one(`select count(distinct name) as n from cards where ${SIX}`);
const sixWithEffect = one(`select count(*) as n from cards where ${SIX} and ${HAS_EFFECT}`);
const sixWithAbilities = one(`select count(*) as n from cards where ${SIX} and ${HAS_ABILITIES}`);
const sixWithAnyText = one(`select count(*) as n from cards where ${SIX} and ${HAS_ANY_TEXT}`);
const sixPerCategory = q<{ category: string; n: number }>(
  `select category, count(*) as n from cards where ${SIX} group by category order by category`,
);

/**
 * Trainer rows that print a Pokémon face (`hp`, `abilities`, `attacks`), verbatim. Engine suites
 * build their fossil and machine fixtures from this block.
 */
const trainerFaceRows = q<{
  id: string;
  name: string;
  legal_standard: number;
  hp: number | null;
  abilities_json: string | null;
  attacks_json: string | null;
}>(
  `select id, name, legal_standard, hp, abilities_json, attacks_json from cards
     where category = 'Trainer' and (hp is not null or abilities_json is not null or attacks_json is not null)
     order by id`,
);

/**
 * Pokémon rows with no attacks at all (e.g. Ditto `swsh10.5-053`); measured rather than assumed
 * zero.
 */
const pokemonWithoutAttacks = q<{ id: string; name: string }>(
  `select id, name from cards where category = 'Pokemon'
     and (attacks_json is null or attacks_json = '[]') order by id`,
);

const catalog = new Map(q<Row>("select * from cards").map((r) => [r.id, r]));
const names = (json: string | null): string[] =>
  json === null ? [] : (JSON.parse(json) as { name: string }[]).map((a) => a.name);

const printed: Record<
  string,
  { name: string; types: string[]; attacks: string[]; abilities: string[] }
> = {};
const absent: string[] = [];
for (const id of Object.keys(FIXTURE_POOL).sort()) {
  if (!REAL_ID.test(id)) continue;
  const row = catalog.get(id);
  if (row === undefined) {
    absent.push(id);
    continue;
  }
  printed[id] = {
    name: row.name,
    types: row.types_json === null ? [] : (JSON.parse(row.types_json) as string[]),
    attacks: names(row.attacks_json),
    abilities: names(row.abilities_json),
  };
}

const j = (v: unknown) => JSON.stringify(v);
const setLine = perSet.map((s) => `${s.set_id}|${s.n}`).join("  ");

const source = `// Generated by \`bun run scripts/catalog-manifest.ts\`; do not edit by hand.
//
// A committed snapshot of the local D1 catalog. \`catalogManifest.test.ts\` checks
// fixtures against it, since the sqlite is \`.wrangler/\` dev state and may be
// absent or stale on other machines.
//
//   select set_id, count(*) from cards group by set_id;   -- ${setLine}
//   select count(*) from cards;                           -- ${rows}
//
// Test-only: not exported from the package index, like \`testFixtures.ts\`.

/** Measured catalog counts. \`rows\`/\`sets\` describe the whole file, \`sixSet\` the
    older six-set slice, and \`history\` a period when one of those sets was missing. */
export const CATALOG_MANIFEST = {
  /** The file measured. \`mtime\` is the sqlite's last write, not the generation date. */
  source: {
    path: ${j(DB_PATH)},
    mtime: ${j(stat.mtime.toISOString())},
    bytes: ${stat.size},
    generated: ${j(new Date().toISOString().slice(0, 10))},
  },
  /** \`select count(*) from cards\`. */
  rows: ${rows},
  /** \`select set_id, count(*) from cards group by set_id\`. */
  sets: {
${perSet.map((s) => `    ${j(s.set_id)}: ${s.n},`).join("\n")}
  } as Record<string, number>,
  /** \`select category, count(*) from cards group by category\`. */
  categories: {
${perCategory.map((c) => `    ${j(c.category)}: ${c.n},`).join("\n")}
  } as Record<string, number>,
  /** \`select count(distinct name) from cards\`; below \`rows\` because a card is a printing. */
  distinctNames: ${distinctNames},
  /** Rows where each text column is present and non-empty. */
  textColumns: {
    effect: ${withEffect},
    attacksJson: ${withAttacks},
    abilitiesJson: ${withAbilities},
    /** Rows with text in at least one of the three columns. */
    any: ${withAnyText},
  },
  /** Rows whose \`attacks_json\` contains a straight apostrophe (U+0027). */
  straightApostropheInAttacks: ${straightApostropheInAttacks},
  /** Rows with a curly apostrophe (U+2019) in \`effect\`, \`attacks_json\`,
      \`abilities_json\` or \`name\`; the apostrophe fold guards against a re-ingest adding some. */
  curlyApostropheAnywhere: ${curlyApostropheAnywhere},
  /** \`select count(*) from cards where legal_standard = 0\`. */
  legalStandardZero: ${legalStandardZero},
  /** Pokémon rows with no attacks of their own, by id (e.g. a Pokémon whose Ability
      borrows attacks from elsewhere). */
  pokemonWithoutAttacks: ${j(pokemonWithoutAttacks.map((r) => r.id))} as readonly string[],
  /** Rows in \`sets\` and \`series\`. */
  setRows: ${setRows},
  serieRows: ${serieRows},
  /** The same counts for the older six-set slice (\`${SIX_SETS.join("`, `")}\`), which
      older counts in comments refer to. */
  sixSet: {
    sets: ${j([...SIX_SETS])} as readonly string[],
    rows: ${sixRows},
    categories: {
${sixPerCategory.map((c) => `      ${j(c.category)}: ${c.n},`).join("\n")}
    } as Record<string, number>,
    distinctNames: ${sixDistinctNames},
    textColumns: { effect: ${sixWithEffect}, attacksJson: ${sixWithAttacks}, abilitiesJson: ${sixWithAbilities}, any: ${sixWithAnyText} },
    straightApostropheInAttacks: ${sixStraightApostrophe},
    legalStandardZero: ${sixLegalStandardZero},
  },
  /** A period when the local file lacked \`${RESTORED_SET}\` (its ingest sat in an
      uncheckpointed write-ahead log). Counts taken then are lower bounds; the test
      checks \`sixSet - contributes === shrunken\` on every axis, so a re-ingest of
      different rows fails. */
  history: {
    /** The set that went missing and was restored. */
    set: ${j(RESTORED_SET)},
    /** Last date the set was seen in the catalog. */
    lastSeen: "2026-08-02",
    /** First date the set was found missing. */
    firstMissing: "2026-08-03",
    /** Date the set was re-ingested and the write-ahead log checkpointed. */
    restored: "2026-08-03",
    /** What \`${RESTORED_SET}\` contributes to each count, measured from the current file. */
    contributes: {
      rows: ${restoredRows},
      legalStandardZero: ${restoredLegalStandardZero},
      rowsWithAttacks: ${restoredWithAttacks},
      straightApostropheInAttacks: ${restoredStraightApostrophe},
    },
    /** Counts recorded while the set was missing; they can no longer be measured. */
    shrunken: {
      rows: 890,
      setCount: 5,
      legalStandardZero: 763,
      rowsWithAttacks: 736,
      straightApostropheInAttacks: 326,
    },
    /** Decisions whose counts were taken against \`shrunken\` and are lower bounds. */
    censusedInTheGap: ["D154", "D155", "D156", "D157", "D158", "D159"] as readonly string[],
  },
  /** Each real-card fixture id in \`FIXTURE_POOL\` with a catalog row: its printed
      types and its attack and Ability names in printed order. The order matters
      because attacks are addressed by index, so a dropped attack renumbers the rest. */
  printed: {
${Object.entries(printed)
  .map(
    ([id, p]) =>
      `    ${j(id)}: { name: ${j(p.name)}, types: ${j(p.types)}, attacks: ${j(p.attacks)}, abilities: ${j(p.abilities)} },`,
  )
  .join("\n")}
  } as Record<string, { name: string; types: string[]; attacks: string[]; abilities: string[] }>,
  /** Real-card fixture ids with no catalog row; expected to be empty. */
  absent: ${j(absent)} as readonly string[],
  /** Trainer rows that print a Pokémon face, verbatim. \`legal\` is \`legal_standard\`. */
  trainerFaces: {
${trainerFaceRows
  .map(
    (r) =>
      `    ${j(r.id)}: { name: ${j(r.name)}, legal: ${r.legal_standard === 1}, hp: ${j(r.hp)}, abilities: ${r.abilities_json ?? "null"}, attacks: ${r.attacks_json ?? "null"} },`,
  )
  .join("\n")}
  } as Record<
    string,
    {
      name: string;
      legal: boolean;
      hp: number | null;
      abilities: { type?: string; name: string; effect?: string }[] | null;
      attacks: { cost?: string[]; name: string; effect?: string; damage?: number | string }[] | null;
    }
  >,
} as const;
`;

/** The generated module as `biome format` would write it, so the committed file
    passes the format check and `--check` compares like with like. Formats a temp
    file in place (biome's stdin mode mangles emoji). */
function formatted(source: string): string {
  const temp = repoPath(`${OUT}.tmp.ts`);
  writeFileSync(temp, source);
  try {
    const run = spawnSync(localBin("biome"), ["format", "--write", temp], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    if (run.status !== 0) throw new Error(`biome format failed: ${run.stderr}`);
    return readFileSync(temp, "utf8");
  } finally {
    rmSync(temp, { force: true });
  }
}

const body = formatted(source);

/** The committed manifest, or "" when there is none yet. */
function currentManifest(): string {
  try {
    return readFileSync(repoPath(OUT), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

if (process.argv.includes("--check")) {
  const current = currentManifest();
  // The provenance stamps (local file name, mtime, run date) differ per machine and
  // per run; compare everything else.
  const strip = (s: string) => s.replace(/(path|mtime|generated): "[^"]*"/g, "");
  if (strip(current) !== strip(body)) {
    console.error(`${OUT} is STALE — run: bun run scripts/catalog-manifest.ts`);
    process.exit(1);
  }
  console.log(`${OUT} is current (${rows} rows, sqlite mtime ${stat.mtime.toISOString()}).`);
} else {
  writeFileSync(repoPath(OUT), body);
  console.log(
    `${OUT} written — ${rows} rows, ${perSet.length} sets, ${Object.keys(printed).length} fixture rows, ${absent.length} absent.`,
  );
}

#!/usr/bin/env bun
// GENERATOR for `packages/engine/src/catalogManifest.ts` — the committed
// snapshot of the local D1 that the engine suite checks its catalog claims
// against (D156).
//
//   bun run scripts/catalog-manifest.ts            # rewrite the manifest
//   bun run scripts/catalog-manifest.ts --check    # exit 1 if it would change
//
// WHY A GENERATED SNAPSHOT AND NOT A TEST THAT READS THE SQLITE.
// The local D1 lives under `apps/api/.wrangler/state/` — dev state written by
// `wrangler dev`, not a build input. It is absent on a fresh clone, absent in
// CI, and its contents depend on when someone last ran the ingest script. A
// vitest case that opened it would be flaky by construction: green here, red or
// (worse) VACUOUSLY green anywhere else. So the sqlite is read ONCE, by hand,
// by this script; the numbers land in a committed TypeScript file; and the
// suite checks the FIXTURES and the ENGINE'S OWN COMMENTS against that file.
//
// THE TRADEOFF, STATED: the manifest can go stale relative to the sqlite and no
// test can see it. What a test CAN see is every consequence of the manifest —
// a fixture that omits a printed attack, a fixture id with no catalog row, a
// census comment quoting a number the manifest does not contain. Re-running
// this script is the only way to re-measure, and `--check` makes "is the
// manifest current?" a one-command question for anyone who has the file.
//
// The manifest records the sqlite's SIZE and MTIME so the next reader knows
// exactly what population the numbers describe (D154's rule: a census owes its
// SCOPE; D155's: a number nothing reads is the one that never gets re-measured).
//
// ⚠️ AND IT RECORDS A SECOND CATALOG STATE, WHICH IS D156's HEADLINE. The "978
// cards" D155 called fiction was a real measurement of a catalog that HELD
// `swsh10.5` — 890 + 88 = 978, and 763 + 88 = 851 on `legal_standard = 0`, the
// two other numbers the docs quote. The set is gone from this file (no `cards`
// rows, no `sets` row, no `series` row) and the main .sqlite's mtime never moved,
// so the ingest lived in a WAL that was never checkpointed and has since been
// discarded. THE CATALOG SHRANK; the count was never invented. `priorState`
// below is that population, INHERITED rather than measured, so a census comment
// dated before the loss can be read against the population it actually queried.

import { Database } from "bun:sqlite";
import { statSync, writeFileSync } from "node:fs";
import { FIXTURE_POOL } from "../packages/engine/src/testFixtures";

const DB_PATH =
  "apps/api/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/8437d86672ef67002c76a06d8e29643de1a9c95e9422816cce0e554c6c5b7286.sqlite";
const OUT = "packages/engine/src/catalogManifest.ts";

/** A fixture id that names a real printing (as opposed to a synthetic `fix-*`
    body). The three prefixes are the only real-card id shapes the pool uses —
    the manifest asserts the classification back, so a fourth-era id added to
    the pool fails the suite rather than being silently skipped. */
const REAL_ID = /^(sv|swsh)/;

interface Row {
  id: string;
  set_id: string;
  name: string;
  category: string;
  attacks_json: string | null;
  abilities_json: string | null;
}

const db = new Database(DB_PATH, { readonly: true });
const stat = statSync(DB_PATH);
const q = <T>(sql: string): T[] => db.query(sql).all() as T[];
const one = (sql: string): number => (db.query(sql).get() as { n: number }).n;

const rows = one("select count(*) as n from cards");
const perSet = q<{ set_id: string; n: number }>(
  "select set_id, count(*) as n from cards group by set_id order by set_id",
);
const perCategory = q<{ category: string; n: number }>(
  "select category, count(*) as n from cards group by category order by category",
);
const distinctNames = one("select count(distinct name) as n from cards");
const withEffect = one("select count(*) as n from cards where effect is not null and effect <> ''");
const withAttacks = one(
  "select count(*) as n from cards where attacks_json is not null and attacks_json <> '[]'",
);
const withAbilities = one(
  "select count(*) as n from cards where abilities_json is not null and abilities_json <> '[]'",
);
const withAnyText = one(
  `select count(*) as n from cards where (attacks_json is not null and attacks_json <> '[]')
     or (abilities_json is not null and abilities_json <> '[]')
     or (effect is not null and effect <> '')`,
);
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

const catalog = new Map(q<Row>("select * from cards").map((r) => [r.id, r]));
const names = (json: string | null): string[] =>
  json === null ? [] : (JSON.parse(json) as { name: string }[]).map((a) => a.name);

const printed: Record<string, { name: string; attacks: string[]; abilities: string[] }> = {};
const absent: string[] = [];
for (const id of Object.keys(FIXTURE_POOL).sort()) {
  if (!REAL_ID.test(id)) continue;
  const row = catalog.get(id);
  if (row === undefined) {
    absent.push(id);
    continue;
  }
  printed[id] = { name: row.name, attacks: names(row.attacks_json), abilities: names(row.abilities_json) };
}

const j = (v: unknown) => JSON.stringify(v);
const setLine = perSet.map((s) => `${s.set_id}|${s.n}`).join("  ");

const body = `// GENERATED by \`bun run scripts/catalog-manifest.ts\` — DO NOT EDIT BY HAND.
//
// The committed measurement of the local D1 (D156). Every catalog claim the
// engine's comments and fixtures make is checked against this file by
// \`catalogManifest.test.ts\`; the sqlite itself is read only by the generator,
// because it is \`.wrangler/\` dev state and may be absent or stale on any other
// machine (see the script's header for the tradeoff that buys).
//
//   select set_id, count(*) from cards group by set_id;   -- ${setLine}
//   select count(*) from cards;                           -- ${rows}
//
// TEST-ONLY: not exported from the package index, exactly like \`testFixtures.ts\`.

/** The catalog census, MEASURED — never copied forward, and never quoted without
    its SCOPE. Two states live here: \`rows\`/\`sets\` describe the file on disk
    today, and \`priorState\` describes the SIX-set catalog every census comment
    dated 2026-08-02 or earlier actually queried. Both are real; what was missing
    from ~20 comments was which one they meant. */
export const CATALOG_MANIFEST = {
  /** Which file the numbers below describe. \`mtime\` is the sqlite's last write,
      NOT the day the manifest was generated — the catalog is ingest output and
      does not drift on its own, so the mtime is the honest provenance. */
  source: {
    path: ${j(DB_PATH)},
    mtime: ${j(stat.mtime.toISOString())},
    bytes: ${stat.size},
    generated: ${j(new Date().toISOString().slice(0, 10))},
  },
  /** \`select count(*) from cards\`. */
  rows: ${rows},
  /** \`select set_id, count(*) from cards group by set_id\` — THE SCOPE. D154's
      finding: the local D1 holds these five sets and NOTHING ELSE, while
      \`FIXTURE_POOL\` fields cards from \`swsh10.5\`, which is not here. Any census
      run against this file is blind to that population by construction. */
  sets: {
${perSet.map((s) => `    ${j(s.set_id)}: ${s.n},`).join("\n")}
  } as Record<string, number>,
  /** \`select category, count(*) from cards group by category\`. */
  categories: {
${perCategory.map((c) => `    ${j(c.category)}: ${c.n},`).join("\n")}
  } as Record<string, number>,
  /** \`select count(distinct name) from cards\` — a card is a PRINTING, so this
      is well below \`rows\` (D135/D145: two printings can agree on everything but
      the set and the attacks). */
  distinctNames: ${distinctNames},
  /** The THREE text columns a census must search. Every one of them has been
      missed by a census that searched only one, which is why they are counted
      separately here: rows where the column is present and non-empty. */
  textColumns: {
    effect: ${withEffect},
    attacksJson: ${withAttacks},
    abilitiesJson: ${withAbilities},
    /** Rows carrying text in AT LEAST ONE of the three — the real denominator
        for "N printings out of M" claims. */
    any: ${withAnyText},
  },
  /** Rows whose \`attacks_json\` contains a STRAIGHT apostrophe (U+0027) — the
      population D137's apostrophe fold is about. */
  straightApostropheInAttacks: ${straightApostropheInAttacks},
  /** Rows carrying a CURLY apostrophe (U+2019) in \`effect\`, \`attacks_json\`,
      \`abilities_json\` or \`name\`. D137's claim is that this is ZERO — the fold
      exists against a future re-ingest, not against today's bytes. */
  curlyApostropheAnywhere: ${curlyApostropheAnywhere},
  /** \`select count(*) from cards where legal_standard = 0\` — D113's "not a
      slice-selection criterion" number, and the THIRD corroboration of the set
      loss below (851 − 88 = ${legalStandardZero}). */
  legalStandardZero: ${legalStandardZero},
  /** Rows in \`sets\` and \`series\`. A card's \`set_id\` FKs to \`sets\` and a set's
      \`serie_id\` to \`series\`, so a missing SET is a missing row in all three
      tables — which is what makes the loss below a structural fact rather than a
      filtered query. */
  setRows: ${setRows},
  serieRows: ${serieRows},
  /** ⚠️ THE CATALOG THIS FILE USED TO HOLD — INHERITED, NOT MEASURED BY D156.
      Every number here is read off the repo's own record, not off a query, and
      it is marked so because that is the distinction D155 collapsed.

      D112 (2026-08-01) wrote the breakdown down explicitly: *"The local pool is
      978 cards over SIX sets, not 890 over five — sv01/sv02/sv03/sv06.5/sve PLUS
      swsh10.5 (Pokémon GO, 88 cards, reg-mark F, legal_standard=0), which every
      prior census silently omitted."* Three independent arithmetics agree:
      890 + 88 = 978 (the count ~20 comments quote), ${legalStandardZero} + 88 = 851 (the
      \`legal_standard = 0\` count the docs quote), and D147's census table
      (2026-08-02) lists Pidove \`swsh10.5-061\` as a QUERY RESULT, so the rows
      were still there on that date. D154 (2026-08-03) is the first slice to find
      them gone.

      So the loss is bounded to 2026-08-02 → 2026-08-03, and the main .sqlite's
      mtime never moved: the swsh10.5 ingest lived in a write-ahead log that was
      never checkpointed and has since been discarded. **The catalog SHRANK. 978
      was a measurement, and D155's "978 matches no table in the file" is true of
      today's file and false as a claim about who measured what.**

      The consequence that matters for reading old comments: a census run on or
      before 2026-08-02 saw 978/6, and its counts are right for THAT population —
      including §D149's "5 printings" and §D151's "six rows", both of which D155
      "corrected" downward by counting Pidove as fixture-only. It is a real card;
      the catalog lost it. */
  priorState: {
    rows: 978,
    setCount: 6,
    missingSet: "swsh10.5",
    missingRows: 88,
    legalStandardZero: 851,
    /** The two sub-population counts §D129/§D130 and §D137 quote, both measured
        against the six-set catalog: rows with attacks, and rows whose
        \`attacks_json\` carries a straight apostrophe. Today's file gives
        ${withAttacks} and ${straightApostropheInAttacks}. */
    rowsWithAttacks: 809,
    straightApostropheInAttacks: 359,
    lastSeen: "2026-08-02",
    firstMissing: "2026-08-03",
  },
  /** Every REAL-card fixture id in \`FIXTURE_POOL\` that HAS a catalog row, with
      the printed attack and Ability NAMES in printed ORDER. The order is
      load-bearing: an attack's INDEX is what the \`attack\` action, the registry's
      \`attack\` map and D154/D155's \`attackIndex\` all key on, and a fixture that
      drops a LEADING attack silently renumbers every one after it. */
  printed: {
${Object.entries(printed)
  .map(
    ([id, p]) =>
      `    ${j(id)}: { name: ${j(p.name)}, attacks: ${j(p.attacks)}, abilities: ${j(p.abilities)} },`,
  )
  .join("\n")}
  } as Record<string, { name: string; attacks: string[]; abilities: string[] }>,
  /** Real-card fixture ids with NO catalog row at all — the population D154
      found and nobody had enumerated. Every one is \`swsh10.5\`, a set this D1
      does not hold, so NOTHING about these fixtures has ever been checked
      against a catalog and no census that quotes this file has ever seen them. */
  absent: ${j(absent)} as readonly string[],
} as const;
`;

if (process.argv.includes("--check")) {
  const current = await Bun.file(OUT)
    .text()
    .catch(() => "");
  // The `generated` stamp moves every run; compare everything else.
  const strip = (s: string) => s.replace(/generated: "[^"]*"/, "");
  if (strip(current) !== strip(body)) {
    console.error(`${OUT} is STALE — run: bun run scripts/catalog-manifest.ts`);
    process.exit(1);
  }
  console.log(`${OUT} is current (${rows} rows, sqlite mtime ${stat.mtime.toISOString()}).`);
} else {
  writeFileSync(OUT, body);
  console.log(`${OUT} written — ${rows} rows, ${perSet.length} sets, ${Object.keys(printed).length} fixture rows, ${absent.length} absent.`);
}

#!/usr/bin/env bun
// GENERATOR for `packages/engine/src/catalogManifest.ts` — the committed
// snapshot of the local D1 that the engine suite checks its catalog claims
// against (D156).
//
//   bun run scripts/catalog-manifest.ts            # rewrite the manifest
//   bun run scripts/catalog-manifest.ts --check    # exit 1 if it would change
//
// Deliberately OUTSIDE tsconfig's `include` and vitest's globs (bun executes it
// directly), mirroring apps/api/scripts/ingest.ts. Biome lints it — but only
// SINCE D212: `files.include` did not reach the repo root, so this file was the
// one the convention was untrue about, from the day it was written until then.
// `bun run lint:coverage` is what stops that happening again.
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
// ⚠️ AND IT RECORDS THE EPISODE THE CATALOG HAS ALREADY COME OUT OF, WHICH IS
// D160's REWORK OF D156's HEADLINE. D156 found the file holding 890 rows over
// five sets where ~20 census comments said 978 over six, proved from the repo's
// own record that 978 had been MEASURED (890 + 88 = 978; 763 + 88 = 851 on
// `legal_standard = 0`), and concluded the `swsh10.5` ingest had lived in a
// write-ahead log that was never checkpointed. **THE SET HAS SINCE BEEN
// RE-INGESTED AND CHECKPOINTED. The catalog is 978 / 6 again, and the twelve
// `swsh10.5` fixtures have catalog rows for the first time in this repo's life.**
//
// So the second state is now HISTORY rather than a live divergence, and it is
// emitted as `history` rather than as `priorState`: the set that was lost and
// returned, the dates that bound the outage, what the restored set CONTRIBUTES to
// every count above (measured), and the shrunken catalog as D156 committed it
// (RECORDED — nothing can query it now). The reconciliation runs by SUBTRACTION
// on four independent axes, so a re-ingest that brought back a different pool than
// the one that went missing goes red instead of being absorbed.
//
// ⚠️ AND THE OUTAGE IS THE POINT, BECAUSE THE COMMENTS WRITTEN INSIDE IT SURVIVE
// IT. Every census dated 2026-08-03 in this repo — D154's, D155's, D156's own,
// D157's, D158's and D159's — queried the 890 / 5 catalog. Those counts are
// FLOORS against the six-set pool, not totals. `history.shrunken` is what makes
// them readable; `history.censusedInTheGap` is who owes a re-run.

import { Database } from "bun:sqlite";
import { statSync, writeFileSync } from "node:fs";
import { FIXTURE_POOL } from "../packages/engine/src/testFixtures";

const DB_PATH =
  "apps/api/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/8437d86672ef67002c76a06d8e29643de1a9c95e9422816cce0e554c6c5b7286.sqlite";
const OUT = "packages/engine/src/catalogManifest.ts";

/** A fixture id that names a real printing (as opposed to a synthetic `fix-*`
    body). The prefixes are the real-card id shapes the catalog holds — the
    manifest asserts the classification back, so an id shape added to the pool
    that this does not know fails the suite rather than being silently skipped.
    🆕 D581 — widened to the Mega Evolution serie's ids (`me01-`…`me05-`,
    `me02.5-`, `mep-`, `mee-`, `30th-`, `30th-c-`), ingested for the first time. */
const REAL_ID = /^(sv|swsh|me\d|mep-|mee-|30th)/;

/** 🆕 D581 — THE SIX SETS THE CATALOG HELD FROM D112 TO D580 (978 rows), as a SLICE of
    today's file. The catalog grew (the whole \`sv\` serie, then the \`me\` serie), so the
    whole-file totals no longer describe the population every census comment dated before
    D581 measured; the six-set slice does, and it is MEASURED, so the history block below
    still reconciles by subtraction against a live number rather than a copied one. */
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

/** ⚠️ THE RESTORED SET'S OWN CONTRIBUTION TO EVERY COUNT ABOVE (D160). Measured
    against TODAY's file, one query per axis, so that `live − contributes` can be
    checked against D156's committed record of the shrunken catalog. Four axes
    rather than one, because a re-ingest that brought back a DIFFERENT 88 rows
    would reconcile on the row count alone. */
const RESTORED_SET = "swsh10.5";
const restoredRows = one(`select count(*) as n from cards where set_id = '${RESTORED_SET}'`);
const restoredLegalStandardZero = one(
  `select count(*) as n from cards where set_id = '${RESTORED_SET}' and legal_standard = 0`,
);
const restoredWithAttacks = one(
  `select count(*) as n from cards where set_id = '${RESTORED_SET}'
     and attacks_json is not null and attacks_json <> '[]'`,
);
const restoredStraightApostrophe = one(
  `select count(*) as n from cards where set_id = '${RESTORED_SET}' and attacks_json like '%''%'`,
);
/** 🆕 D581 — the six-set slice's own counts (see \`SIX_SETS\`), on the axes the history
    block reconciles and the census comments quote. */
const sixRows = one(`select count(*) as n from cards where ${SIX}`);
const sixLegalStandardZero = one(`select count(*) as n from cards where ${SIX} and legal_standard = 0`);
const sixWithAttacks = one(
  `select count(*) as n from cards where ${SIX} and attacks_json is not null and attacks_json <> '[]'`,
);
const sixStraightApostrophe = one(`select count(*) as n from cards where ${SIX} and attacks_json like '%''%'`);
const sixDistinctNames = one(`select count(distinct name) as n from cards where ${SIX}`);
const sixWithEffect = one(`select count(*) as n from cards where ${SIX} and effect is not null and effect <> ''`);
const sixWithAbilities = one(
  `select count(*) as n from cards where ${SIX} and abilities_json is not null and abilities_json <> '[]'`,
);
const sixWithAnyText = one(
  `select count(*) as n from cards where ${SIX} and ((attacks_json is not null and attacks_json <> '[]')
     or (abilities_json is not null and abilities_json <> '[]')
     or (effect is not null and effect <> ''))`,
);
const sixPerCategory = q<{ category: string; n: number }>(
  `select category, count(*) as n from cards where ${SIX} group by category order by category`,
);

/** 🆕 D581 — THE TRAINER ROWS THAT PRINT A POKÉMON FACE (\`apps/api/src/ingest/map.ts\` keeps
    \`hp\` / \`abilities\` / \`attacks\` on a Trainer since D581): every one, legal or not, with
    the face verbatim. The engine reads these off the catalog \`Card\` (fossils.ts, the Tool
    section of continuous.ts \`attackMenuOf\`), and its suites build their fossil / machine rows
    from THIS block, so a fixture face that drifts from the print fails rather than passes. */
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

/** Pokémon rows carrying NO attacks at all. D156 asserted this was ZERO — true of
    the five-set catalog and FALSE of the six-set one, so it is measured rather
    than assumed (Ditto `swsh10.5-053`, whose Ability borrows attacks from the
    discard pile, prints none of its own). */
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
    its SCOPE. \`rows\`/\`sets\` describe the file on disk today. \`sixSet\` (D581) is the
    six-set slice every census comment dated before D581 measured. \`history\` describes
    the interval in which it held ONE SET FEWER: a census comment dated 2026-08-03
    was measuring THAT population, and its counts are floors against this one.
    All are real; what was missing from ~20 comments was which one they meant. */
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
  /** \`select set_id, count(*) from cards group by set_id\` — THE SCOPE, and the
      first thing a census owes (D154). 🆕 D581 — ${perSet.length} sets: the whole \`sv\`
      serie, the \`me\` serie (ingested at D581) and \`${RESTORED_SET}\`. The six sets
      \`sixSet\` names are the catalog D112 → D580 measured; a census dated 2026-08-03
      saw five of them ONLY, which is what \`history\` exists to say. */
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
      slice-selection criterion" number. The restoration reconciles on the SIX-SET
      slice's own count (${sixLegalStandardZero} − ${restoredLegalStandardZero} = ${sixLegalStandardZero - restoredLegalStandardZero}, the count D156
      committed for the shrunken catalog). */
  legalStandardZero: ${legalStandardZero},
  /** Pokémon rows carrying NO attacks at all, by id. ⚠️ D156 ASSERTED THIS WAS
      EMPTY — \`attacksJson\` equals the \`Pokemon\` category count — and that was
      true of the FIVE-set catalog and is FALSE of the six-set one. The restored set
      brought the counterexample with it, so the claim is now a measured list
      rather than an equality: a Pokémon whose Ability borrows its attacks from
      elsewhere prints none of its own. */
  pokemonWithoutAttacks: ${j(pokemonWithoutAttacks.map((r) => r.id))} as readonly string[],
  /** Rows in \`sets\` and \`series\`. A card's \`set_id\` FKs to \`sets\` and a set's
      \`serie_id\` to \`series\`, so a set is a row in all three tables — which is
      what made the loss recorded below a STRUCTURAL fact rather than a filtered
      query, and what makes the restoration one too (\`serieRows\` went 1 → 2: the
      \`swsh\` serie had to come back before its set could; 🆕 D581 — 3, with \`me\`). */
  setRows: ${setRows},
  serieRows: ${serieRows},
  /** 🆕 D581 — THE SIX-SET SLICE (\`${SIX_SETS.join("\`, \`")}\`), MEASURED off today's file:
      the catalog this manifest described from D160 to D580 (978 rows / 6 sets), which
      every census comment dated before D581 quotes. The whole \`sv\` serie and the \`me\`
      serie arrived around it without touching a row of it, so these are the same
      numbers that manifest committed — measured again, not carried. */
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
  /** ⚠️ THE SET THIS CATALOG LOST AND GOT BACK — HISTORY, NOT A LIVE DIVERGENCE
      (D160). Read this block as a record of an episode that is OVER: \`sixSet\`
      above is the six-set catalog, exactly as ~20 census comments always said.

      WHAT HAPPENED. D112 (2026-08-01) wrote the breakdown down explicitly: *"The
      local pool is 978 cards over SIX sets, not 890 over five —
      sv01/sv02/sv03/sv06.5/sve PLUS swsh10.5 (Pokémon GO, 88 cards, reg-mark F,
      legal_standard=0), which every prior census silently omitted."* D147
      (2026-08-02) lists Pidove \`swsh10.5-061\` as a QUERY RESULT, so the rows were
      still there that day. D154 (2026-08-03) is the first slice to find them gone
      — no \`cards\` rows, no \`sets\` row, no \`series\` row, and the main .sqlite's
      mtime unmoved: the ingest had lived in a write-ahead log that was never
      checkpointed. D155 read the survivors' "978" as fiction; D156 proved by
      arithmetic that it had been a MEASUREMENT and built this manifest so a
      scopeless count could never pass again. **D160 re-ingested the set and
      checkpointed it (\`PRAGMA wal_checkpoint(TRUNCATE)\`), which is why \`sixSet.rows\`
      is ${sixRows} above.** 🆕 D581 — the set was absent from the local file AGAIN before
      D581 (the whole-\`sv\` ingest rebuilt it without \`${RESTORED_SET}\`; the remote D1 kept
      it, 3,786 rows / 20 sets at D190) and was re-ingested by D581 with the same ingest.

      ⚠️ WHY THE BLOCK STAYS AFTER THE RESTORE, WHICH IS THE WHOLE POINT. The rows
      came back; the COMMENTS WRITTEN WHILE THEY WERE GONE did not change. Every
      census in this repo dated 2026-08-03 — D154's, D155's, D156's own, and
      D157's, D158's and D159's, which all state "890 rows / 5 sets" in their own
      headers — queried \`shrunken\`. **Those counts are FLOORS against this
      catalog, not totals**, and \`censusedInTheGap\` names who owes a re-run.
      D160 settled two of them by measurement: §D149's "5 printings" and §D151's
      "six rows" are BOTH exact against the restored catalog, and D155's downward
      corrections of them (to 4 and 5) were the outage speaking.

      ⚠️ AND THE RECONCILIATION IS BY SUBTRACTION ON FOUR AXES, NOT ONE.
      \`contributes\` is measured off today's file; \`shrunken\` is what D156
      committed. \`sixSet − contributes === shrunken\` on rows, \`legal_standard = 0\`,
      rows-with-attacks and straight-apostrophe rows. A re-ingest that restored a
      DIFFERENT 88 rows would reconcile on the row count alone and fail the other
      three, which is the only check available for a population nothing can query
      any more. */
  history: {
    /** The set that went missing and returned. */
    set: ${j(RESTORED_SET)},
    /** Last date a census in this repo saw it (D147's table). */
    lastSeen: "2026-08-02",
    /** First date a census found it gone (D154). */
    firstMissing: "2026-08-03",
    /** Date it was re-ingested and the WAL checkpointed (D160). */
    restored: "2026-08-03",
    /** MEASURED off today's file: what \`${RESTORED_SET}\` contributes to each
        count above. The subtrahend of the reconciliation. */
    contributes: {
      rows: ${restoredRows},
      legalStandardZero: ${restoredLegalStandardZero},
      rowsWithAttacks: ${restoredWithAttacks},
      straightApostropheInAttacks: ${restoredStraightApostrophe},
    },
    /** RECORDED, NOT MEASURED — D156's committed census of the catalog during the
        outage, which nothing can query now. This is the population every census
        comment dated 2026-08-03 was actually describing. */
    shrunken: {
      rows: 890,
      setCount: 5,
      legalStandardZero: 763,
      rowsWithAttacks: 736,
      straightApostropheInAttacks: 326,
    },
    /** The decisions whose censuses ran against \`shrunken\` and are therefore
        FLOORS. A future session re-running any of these should say so. */
    censusedInTheGap: ["D154", "D155", "D156", "D157", "D158", "D159"] as readonly string[],
  },
  /** Every REAL-card fixture id in \`FIXTURE_POOL\` that HAS a catalog row, with
      the printed attack and Ability NAMES in printed ORDER. The order is
      load-bearing: an attack's INDEX is what the \`attack\` action, the registry's
      \`attack\` map and D154/D155's \`attackIndex\` all key on, and a fixture that
      drops a LEADING attack silently renumbers every one after it. [🆕🆕🆕 D578 (D539): the \`attack\` action's index is now the flat ATTACK MENU index (\`attackMenuOf\`) — the printed index for every printed attack, which come first; a Memory Dive or Technical Machine row has no index on the holder's printed list.]

      \`types\` is here since D173, and it is the first field on this row that is
      NOT a list of names. It was added because the wrong-index sweep turned up a
      fixture (Klefki sv01-096) carrying a type the card does not print, and
      NOTHING in this repo could see it: the manifest only ever recorded names, so
      \`catalogManifest.test.ts\` could prove a fixture carried the right ATTACKS
      while it carried the wrong ELEMENT. A value no census records is a value no
      census can contradict. */
  printed: {
${Object.entries(printed)
  .map(
    ([id, p]) =>
      `    ${j(id)}: { name: ${j(p.name)}, types: ${j(p.types)}, attacks: ${j(p.attacks)}, abilities: ${j(p.abilities)} },`,
  )
  .join("\n")}
  } as Record<string, { name: string; types: string[]; attacks: string[]; abilities: string[] }>,
  /** Real-card fixture ids with NO catalog row at all — the population D154 found
      and D156 enumerated at TWELVE, every one \`swsh10.5\`. **EMPTY since D160's
      re-ingest**, and the emptiness is the finding: those twelve were the only
      surviving copies of catalog rows nothing could check, and their "verbatim off
      the local D1" doc blocks became checkable for the first time. Kept as a field
      rather than deleted because a fixture id with no row is exactly the defect
      this manifest exists to surface, and a list that can only ever be empty is
      one nobody re-reads. */
  absent: ${j(absent)} as readonly string[],
  /** 🆕 D581 — every Trainer row that prints a Pokémon face, verbatim (see the generator's
      \`trainerFaceRows\`). \`legal\` is \`legal_standard\`. */
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

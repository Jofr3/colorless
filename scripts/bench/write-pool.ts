#!/usr/bin/env bun
// Writes `packages/engine/src/fixtures/benchPool.json`, the real-card pool and four archetype decks
// `bun run bench` and `actionFuzzReal.test.ts` play. The local D1 is absent on a fresh clone, so the
// snapshot is committed; re-run this after an ingest that should change what the benchmark plays
// (the fingerprint changes with it).
//
//   bun scripts/bench/write-pool.ts     # COLORLESS_D1_SQLITE=<path> reads another sqlite

import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import type { Card } from "@colorless/schema";
import { D1_DIR, findLocalD1 } from "../lib/localD1";
import { localBin, REPO_ROOT, repoPath } from "../lib/repo";

export const POOL_PATH = "packages/engine/src/fixtures/benchPool.json";

const DB_PATH = findLocalD1();
if (DB_PATH === undefined)
  throw new Error(`no local D1 at ${D1_DIR}; run the catalog ingest first`);

interface Row {
  id: string;
  set_id: string;
  local_id: string;
  name: string;
  category: string;
  illustrator: string | null;
  rarity: string | null;
  regulation_mark: string | null;
  hp: number | null;
  stage: string | null;
  evolve_from: string | null;
  types_json: string | null;
  retreat: number | null;
  abilities_json: string | null;
  attacks_json: string | null;
  weaknesses_json: string | null;
  resistances_json: string | null;
  trainer_type: string | null;
  energy_type: string | null;
  effect: string | null;
  legal_standard: number;
  legal_expanded: number;
  legal_standard_effective: number | null;
  legal_expanded_effective: number | null;
  variants_json: string | null;
  image_url: string | null;
}

// A copy of `normalizeSentinel` (apps/api/src/sentinel.ts) and `mapCardRow`
// (apps/api/src/catalog/map.ts) over raw sqlite columns, since the API has no package entry: keep
// them in step, or a regenerated pool differs from what the API serves.
const sentinel = (v: string | null) =>
  v === null || v.trim().toLowerCase() === "none" || v.trim() === "" ? null : v;
const json = (v: string | null) => (v === null ? null : JSON.parse(v));

/** The face the API serves for a row. */
function cardOf(r: Row): Card {
  return {
    id: r.id,
    setId: r.set_id,
    localId: r.local_id,
    name: r.name,
    category: r.category,
    image: r.image_url === null ? null : `/assets/cards/${r.id}`,
    illustrator: sentinel(r.illustrator),
    rarity: sentinel(r.rarity),
    regulationMark: sentinel(r.regulation_mark),
    hp: r.hp,
    stage: sentinel(r.stage),
    evolveFrom: sentinel(r.evolve_from),
    types: json(r.types_json),
    retreat: r.retreat,
    abilities: json(r.abilities_json),
    attacks: json(r.attacks_json),
    weaknesses: json(r.weaknesses_json),
    resistances: json(r.resistances_json),
    trainerType: sentinel(r.trainer_type),
    energyType: sentinel(r.energy_type),
    effect: r.effect,
    legal: {
      standard: (r.legal_standard_effective ?? r.legal_standard) === 1,
      expanded: (r.legal_expanded_effective ?? r.legal_expanded) === 1,
    },
    variants: json(r.variants_json),
  } as Card;
}

const db = new Database(DB_PATH, { readonly: true });
const byName = db.query(
  `select * from cards where name = ?
   order by coalesce(legal_standard_effective, legal_standard) desc, id asc limit 1`,
);

const pool: Record<string, Card> = {};

/** A decklist as `[id, count]` rows in list order. */
function deck(spec: readonly (readonly [string, number])[]): [string, number][] {
  const out: [string, number][] = [];
  for (const [name, count] of spec) {
    const row = byName.get(name) as Row | null;
    if (row === null) throw new Error(`no catalog row named ${name}`);
    pool[row.id] = cardOf(row);
    out.push([row.id, count]);
  }
  const size = out.reduce((n, [, count]) => n + count, 0);
  if (size !== 60) throw new Error(`deck has ${size} cards, not 60`);
  return out;
}

const STAPLES = [
  ["Professor's Research", 3],
  ["Iono", 3],
  ["Boss's Orders", 2],
  ["Nest Ball", 3],
  ["Ultra Ball", 3],
  ["Switch", 2],
  ["Night Stretcher", 2],
  ["Super Rod", 1],
  ["Earthen Vessel", 2],
] as const;

const decks = {
  charizard: deck([
    ["Charmander", 4],
    ["Charmeleon", 2],
    ["Charizard ex", 3],
    ["Pidgey", 2],
    ["Pidgeotto", 1],
    ["Pidgeot ex", 2],
    ["Fezandipiti ex", 1],
    ["Rare Candy", 4],
    ["Arven", 2],
    ["Buddy-Buddy Poffin", 2],
    ["Artazon", 1],
    ["Defiance Band", 1],
    ...STAPLES,
    ["Fire Energy", 14],
  ]),
  gardevoir: deck([
    ["Ralts", 4],
    ["Kirlia", 3],
    ["Gardevoir ex", 2],
    ["Munkidori", 1],
    ["Lillie's Clefairy ex", 1],
    ["Rare Candy", 2],
    ["Bravery Charm", 1],
    ["Technical Machine: Evolution", 2],
    ["Artazon", 2],
    ["Counter Catcher", 1],
    ["Pal Pad", 1],
    ["Rescue Board", 1],
    ...STAPLES,
    ["Psychic Energy", 18],
  ]),
  dragapult: deck([
    ["Dreepy", 4],
    ["Drakloak", 4],
    ["Dragapult ex", 3],
    ["Fezandipiti ex", 1],
    ["Rare Candy", 3],
    ["Buddy-Buddy Poffin", 3],
    ["Arven", 2],
    ["Area Zero Underdepths", 1],
    ["Prime Catcher", 1],
    ["Sparkling Crystal", 1],
    ["Briar", 1],
    ...STAPLES,
    ["Fire Energy", 8],
    ["Psychic Energy", 7],
  ]),
  miraidon: deck([
    ["Miraidon ex", 4],
    ["Iron Hands ex", 3],
    ["Squawkabilly ex", 2],
    ["Fezandipiti ex", 1],
    ["Electric Generator", 4],
    ["Arven", 2],
    ["Prime Catcher", 1],
    ["Town Store", 1],
    ["Rescue Board", 2],
    ["Neutralization Zone", 1],
    ["Jet Energy", 2],
    ["Bravery Charm", 1],
    ...STAPLES,
    ["Lightning Energy", 15],
  ]),
};

const sorted = Object.fromEntries(Object.entries(pool).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(repoPath(POOL_PATH), `${JSON.stringify({ decks, pool: sorted })}\n`);
const format = spawnSync(localBin("biome"), ["format", "--write", POOL_PATH], {
  cwd: REPO_ROOT,
  encoding: "utf8",
});
if (format.status !== 0) throw new Error(`biome format failed: ${format.stderr}`);
console.log(`${POOL_PATH} written: ${Object.keys(pool).length} cards, 4 decks.`);

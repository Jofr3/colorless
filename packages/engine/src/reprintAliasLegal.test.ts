import { describe, expect, it } from "vitest";
import { CATALOG_MANIFEST as M } from "./catalogManifest";
import type { GameEvent, GameState } from "./index";
import { programFor } from "./registry";
import {
  ALWAYS_ON_REDUCTION_DECK,
  ATTACH_FROM_DECK_DECK,
  COUNTERATTACK_DECK,
  COVERAGE_DECK,
  DISCARD_RETRIEVAL_DECK,
  FIXTURE_POOL,
  LOOK_AT_TOP_DECK,
  SCORCHING_ARMOR_DECK,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  discardFromDeck,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// D190 — THE **STANDARD-LEGAL** REPRINT-ALIAS MAP. Tier 0 of
// `docs/reference/coverage-backlog-legal.md`: 22 printings whose byte-identical
// twin is already authored, on card ids the registry map did not name. Nine map
// targets, no new op, no new field, no new program — the reprint idiom the map
// has carried since M4 (`sv01-189`/`-190`/`-240`/`-241` share ONE
// `PROFESSORS_RESEARCH`).
//
// ⚠️ NO ENGINE VERSION BUMP HERE, AND THE REASON IS MECHANICAL RATHER THAN
// DOCTRINAL: `packages/engine/src/index.ts` and `packages/engine/package.json`
// were both being edited by a CONCURRENT slice (D189, the attack tail) at the
// moment this landed, and the two must move in step. The ascending changelog
// block for this slice is owed at merge, not skipped.
//
// ⚠️ THE SWEEP WAS RE-RUN, NOT CARRIED — WHICH IS THE ONE THING D180 COULD NOT
// DO AND ITS OWN TEST FILE ASKED THE NEXT SESSION TO DO. The text-equality sweep
// of unbuilt-against-built ran on 2026-08-04 against the REMOTE D1 `luminous`
// (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`), **3,786 rows / 20 sets, of which
// 2,021 are `legal_standard = 1`** — the same population and the same predicate
// the census used. Both axes are reported on every row below, because a count
// without both is not a fact in this repo.
//
// ⚠️ THE READ PREDICATE IS PER-COLUMN, WHICH IS D180'S OWN CORRECTION APPLIED TO
// THE CATALOG RATHER THAN TO `FIXTURE_POOL`. The `abilities_json` sweep joins
// only against the texts of ids whose program carries `abilities`/`passive`/
// `triggered`; the `effect` sweep only against ids carrying `trainer`/`stadium`/
// `rareCandy`/`energy`/`passive`/`triggered`. Asking the cheaper question ("does
// `programFor(id)` exist") is what produced D180's two false positives.
//
// THE SWEEP **MATCHED THE CENSUS EXACTLY** — 9 sentences, 22 legal printings,
// nothing else in any of the three columns. `attacks_json` returns exactly ONE
// group (Hail Blade's text on two `swsh10.5` rows) and **zero** legal printings,
// so the census's "zero attack aliases exist" also holds.
//
// ⚠️ AND THE THING THIS SLICE EXISTS TO NOT REPEAT: **D180's four rows serve ZERO
// Standard-legal printings.** `sv02-245` is mark G, `swsh10.5-*` is mark F. A
// DERIVER ARM is a text parser and its sentences transfer across sets, so it is
// worth building regardless; a REGISTRY ROW is keyed by CARD ID and serves
// exactly the ids it names, so legality is a HARD filter. Every row this slice
// lands therefore carries a MEASURED legal printing count, and four candidate
// sentences whose legal count measured **0** were SKIPPED — they are named below
// so the skip is checkable rather than remembered.

/** The 22 rows this slice added: the new (legal) id, the already-authored id
    whose program it now shares, and the MEASURED counts for its sentence —
    `legal` is `legal_standard = 1` printings still unauthored before this slice,
    `catalog` is the same over all 3,786 rows. The right-hand id is the WARRANT. */
const ALIASES = [
  // "This Pokémon takes 30 less damage from attacks (after applying Weakness and
  // Resistance)." — 8 legal of 14 catalog printings.
  { id: "sv06-002", twin: "sv02-150", card: "Tangrowth — Thicket Body", legal: 8, catalog: 14 },
  { id: "sv07-125", twin: "sv02-150", card: "Dubwool — Soft Wool", legal: 8, catalog: 14 },
  { id: "sv08-054", twin: "sv02-150", card: "Cetitan — Solid Body", legal: 8, catalog: 14 },
  { id: "sv08-201", twin: "sv02-150", card: "Cetitan — Solid Body", legal: 8, catalog: 14 },
  { id: "sv10-108", twin: "sv02-150", card: "Mudsdale — Mud Coat", legal: 8, catalog: 14 },
  { id: "sv10.5w-077", twin: "sv02-150", card: "Bouffalant ex — Bouffer", legal: 8, catalog: 14 },
  { id: "sv10.5w-162", twin: "sv02-150", card: "Bouffalant ex — Bouffer", legal: 8, catalog: 14 },
  { id: "sv10.5w-170", twin: "sv02-150", card: "Bouffalant ex — Bouffer", legal: 8, catalog: 14 },
  // "…takes 20 less damage…" — 2 legal of 2.
  { id: "sv05-010", twin: "sv01-121", card: "Turtwig — Solid Shell", legal: 2, catalog: 2 },
  { id: "sv08.5-088", twin: "sv01-121", card: "Furfrou — Fur Coat", legal: 2, catalog: 2 },
  // "…put 3 damage counters on the Attacking Pokémon." — 3 legal of 4.
  { id: "sv05-139", twin: "sv01-005", card: "Iron Jugulis — Automated Combat", legal: 3, catalog: 4 },
  { id: "sv08-049", twin: "sv01-005", card: "Bruxish — Counterattack", legal: 3, catalog: 4 },
  { id: "sv08-200", twin: "sv01-005", card: "Bruxish — Counterattack", legal: 3, catalog: 4 },
  // "…the Attacking Pokémon is now Burned." — 1 legal of 1.
  { id: "sv06-123", twin: "sv03-044", card: "Heatran — Incandescent Body", legal: 1, catalog: 1 },
  // "All of your Pokémon take 10 less damage…" — 1 legal of 1.
  { id: "sv08.5-067", twin: "sv02-113", card: "Bronzong — Protective Bell", legal: 1, catalog: 1 },
  // Trainers. "Draw 3 cards." — 3 legal of 6, on two card NAMES that are neither
  // of them Nemona: the SENTENCE is the key, not the name.
  { id: "sv08.5-109", twin: "sv01-180", card: "Friends in Paldea", legal: 3, catalog: 6 },
  { id: "sv08.5-137", twin: "sv01-180", card: "Friends in Paldea", legal: 3, catalog: 6 },
  { id: "sv10.5w-081", twin: "sv01-180", card: "Cheren", legal: 3, catalog: 6 },
  // Janine's Secret Art — 2 legal of 2 beyond the two already authored.
  { id: "sv08.5-112", twin: "sv06.5-059", card: "Janine's Secret Art", legal: 2, catalog: 2 },
  { id: "sv08.5-173", twin: "sv06.5-059", card: "Janine's Secret Art", legal: 2, catalog: 2 },
  // Energy Retrieval — 1 legal of 1.
  { id: "sv10.5w-082", twin: "sv01-171", card: "Energy Retrieval", legal: 1, catalog: 1 },
  // Pokégear 3.0 — 1 legal of 1.
  { id: "sv10.5b-084", twin: "sv01-186", card: "Pokégear 3.0", legal: 1, catalog: 1 },
] as const;

/** The candidate sentences the SAME sweep returned that this slice DELIBERATELY
    did not land, because their measured `legal_standard = 1` count is **0**.
    Every one of them IS a real reprint-alias gap in the playable catalog and
    would have been a correct row — and every one of them is exactly the D180
    outcome this slice was written to avoid repeating. The ids are the unbuilt
    rows the sweep named; the assertion below is that they stayed unbuilt. */
const SKIPPED_ZERO_LEGAL = [
  {
    sentence: '"Discard your hand and draw 7 cards." (Professor\'s Research, sv01-189)',
    catalog: 11,
    // ⚠️ AND THIS IS THE CENSUS'S "QUALIFIED" ADDENDUM MADE CONCRETE: modern
    // REPRINTS sitting in sv08.5 / sv09 / sv10.5b carry regulation mark **G**,
    // so the biggest alias group in the catalog buys nothing in Standard.
    ids: [
      "sv04.5-087", "sv04.5-088", "sv08.5-122", "sv08.5-123", "sv08.5-124",
      "sv08.5-125", "sv09-155", "sv10.5b-085", "svp-221", "svp-222", "svp-223",
    ],
  },
  {
    sentence:
      '"Prevent all damage done to this Pokémon by attacks from your opponent\'s Pokémon ex and Pokémon V." (Mimikyu Safeguard, sv02-097)',
    catalog: 6,
    ids: ["sv04-134", "sv04-210", "sv04.5-037", "sv04.5-160", "svp-060", "svp-075"],
  },
  {
    sentence:
      '"This Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance)." — the SAME sentence eight rows above',
    catalog: 14,
    // The sharpest form of the rule: one sentence, 14 catalog printings, of which
    // 8 are legal and land above while these 6 are mark G and do not.
    ids: ["sv03.5-009", "sv03.5-184", "sv03.5-200", "sv04-128", "sv04-209", "sv07-030"],
  },
  {
    sentence:
      '"You must discard a card from your hand in order to use this Ability. Once during your turn, you may draw 3 cards." (Tinkaton, sv02-105)',
    catalog: 2,
    ids: ["sv04.5-167", "svp-020"],
  },
] as const;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

const bite = { type: "attack", seat: "p1", index: 0 } as const; // fix-attacker Bite [C] 30

/** Setup, then open P1's turn (P2 went first and passed). */
function openOn(seed: number, deck: typeof COVERAGE_DECK): GameState {
  const state = driveSetup(seed, { p1: deck, p2: deck }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields fix-attacker with one {C} attached (pays Bite); P2 fields `defender`. */
function fight(state: GameState, defender: string): GameState {
  let next = setActiveFromDeck(state, "p1", "fix-attacker");
  next = attachFromDeck(next, "p1", "fix-energy", 1);
  return setActiveFromDeck(next, "p2", defender);
}

describe("D190 — the 22 STANDARD-LEGAL reprint aliases", () => {
  it("resolves every new id to the SAME PROGRAM OBJECT as its twin", () => {
    // `toBe`, not `toEqual`: the map's documented idiom is that reprints of one
    // SENTENCE share the program object, and a second literal that happened to be
    // deep-equal today is exactly the drift this refuses. It is also the assertion
    // that kills the realistic authoring mistake here — copying the neighbouring
    // line and leaving it pointed at the neighbour's program.
    for (const { id, twin, card } of ALIASES) {
      expect(programFor(id), `${id} (${card}) has no program`).toBeDefined();
      expect(programFor(id), `${id} (${card}) does not SHARE ${twin}'s program`).toBe(
        programFor(twin),
      );
    }
  });

  it("lands exactly 22 printings over 9 program targets — the census's Tier 0 total", () => {
    expect(ALIASES).toHaveLength(22);
    // Nine DISTINCT program objects, reached through nine distinct anchor ids —
    // both counted, because a copy-pasted literal would keep the id count at 9
    // while the object count went to 10.
    expect(new Set(ALIASES.map((a) => a.twin)).size).toBe(9);
    expect(new Set(ALIASES.map((a) => programFor(a.twin))).size).toBe(9);
    // Every row's measured legal count is at least the number of rows this slice
    // lands for that sentence — the census's per-family totals, re-derived from
    // the table rather than restated.
    for (const twin of new Set(ALIASES.map((a) => a.twin))) {
      const rows = ALIASES.filter((a) => a.twin === twin);
      expect(rows[0]?.legal).toBe(rows.length);
      expect(rows[0]?.catalog).toBeGreaterThanOrEqual(rows[0]?.legal ?? 0);
    }
  });

  it("pins the NINE targets' actual shapes — the thing every alias inherits", () => {
    // An alias is only as good as what it points at, so the targets are named
    // here: a change to any one of them changes up to eight more cards than its
    // author may have in mind. These are also the assertions that separate the
    // 30-less family from the 20-less one, which is the single most likely
    // mis-aim in a 22-row block of near-identical lines.
    expect(programFor("sv06-002")?.passive).toEqual({ damageReductionAfterWR: 30 });
    expect(programFor("sv05-010")?.passive).toEqual({ damageReductionAfterWR: 20 });
    expect(programFor("sv05-139")?.passive).toEqual({ damageAttacker: { amount: 30 } });
    expect(programFor("sv06-123")?.triggered).toEqual([
      {
        name: "Scorching Armor",
        trigger: "onDamagedByAttack",
        activeOnly: true,
        program: [{ op: "applyStatus", target: "defender", status: "burned" }],
      },
    ]);
    expect(programFor("sv08.5-067")?.passive).toEqual({
      // 🆕 D321 — a RECORD rather than a bare number: the field gained four
      // riders with Stone Palace / Curly Wall and Hariyama prints none of them,
      // so the unmarked print is now `{ amount }` alone.
      seatDamageReductionAfterWR: { amount: 10 },
    });
    expect(programFor("sv08.5-109")?.trainer).toEqual([{ op: "drawCards", count: 3 }]);
    expect(programFor("sv08.5-112")?.trainer?.[0]).toMatchObject({ op: "attachFromDeck" });
    expect(programFor("sv10.5w-082")?.trainer).toEqual([
      { op: "discardPileRetrieval", filter: { kind: "basicEnergy" }, dest: "hand", max: 2 },
    ]);
    expect(programFor("sv10.5b-084")?.trainer).toEqual([
      // `reveal: true` — D225's rider for the printed "You may reveal a
      // Supporter card you find there"; the alias inherits it with the program.
      { op: "lookAtTopN", n: 7, filter: { kind: "supporter" }, max: 1, reveal: true },
      { op: "shuffleDeck" },
    ]);
  });

  it("keeps every PRE-EXISTING print of the same nine sentences on that one program", () => {
    // The aliases are additions, not a re-pointing: the rows that were already
    // there must still resolve to the same object, or this slice has MOVED a card
    // while claiming to have added one. D180's four rows ride here too.
    for (const ids of [
      ["sv02-150", "sv02-245", "sv06-002", "sv10.5w-170"],
      ["sv01-121", "sv05-010", "sv08.5-088"],
      ["sv01-005", "sv01-006", "sv05-139", "sv08-200"],
      ["sv03-044", "sv06-123"],
      ["sv02-113", "sv08.5-067"],
      ["sv01-180", "sv08.5-109", "sv10.5w-081"],
      ["sv06.5-059", "sv06.5-088", "sv08.5-112", "sv08.5-173"],
      ["sv01-171", "sv10.5w-082"],
      ["sv01-186", "sv10.5b-084"],
      // untouched by this slice, and named so a stray edit to the block above
      // cannot silently re-point them:
      ["sv01-189", "sv01-190", "sv01-240", "sv01-241", "swsh10.5-078", "swsh10.5-084"],
      ["sv01-191", "sv01-256", "swsh10.5-069"],
    ]) {
      const first = programFor(ids[0] as string);
      expect(first, `${ids[0]} lost its program`).toBeDefined();
      for (const id of ids) expect(programFor(id), `${id} left the group`).toBe(first);
    }
  });

  it("has NO fixture and NO manifest row for any of the 22 — the reason there is no TEXT pin here", () => {
    // The load-bearing negative, and it is why this file pins the alias RELATION
    // and the TWINS' behaviour rather than the reprints' bytes. A fixture id
    // naming a real printing must appear in `CATALOG_MANIFEST` (catalogManifest
    // .test.ts case (c)), and regenerating that manifest reads the LOCAL sqlite —
    // absent in this clone (`bun run scripts/catalog-manifest.ts` dies
    // SQLITE_CANTOPEN). Worse, the manifest measures a 978-row / 6-set catalog
    // that holds NONE of these sets: every id here is `sv05`–`sv10.5w`. So the
    // printed bytes live in the remote D1, in the registry's comments and in the
    // decision record; this goes red on the day someone with the local file
    // fixtures one of them, which is exactly when a text pin becomes possible.
    for (const { id } of ALIASES) {
      expect(FIXTURE_POOL[id], `${id} is now a fixture — pin its TEXT`).toBeUndefined();
      expect(M.printed[id]).toBeUndefined();
      expect(M.absent).not.toContain(id);
    }
    expect(M.rows).toBe(978);
    expect(Object.keys(M.sets)).toHaveLength(6);
  });
});

describe("the SKIPPED candidates — correct aliases with ZERO Standard-legal payoff", () => {
  it("leaves all four unregistered, and says what each would have bought", () => {
    // ⚠️ THIS IS THE MOST USEFUL ASSERTION IN THE FILE. The same per-column sweep
    // that produced the 22 rows above ALSO returned these four groups: real
    // byte-identical text, really unbuilt, really aliasable — and `SUM(legal_
    // standard = 1) = 0` on every one. They are D180's outcome exactly, and the
    // rule they establish is that a registry row's price is its LEGAL count, not
    // its catalog count. If a future re-ingest makes any of them legal, this test
    // is where the decision gets revisited rather than rediscovered.
    for (const { ids, sentence } of SKIPPED_ZERO_LEGAL) {
      for (const id of ids) {
        expect(programFor(id), `${id} (${sentence}) was landed with 0 legal printings`).toBeUndefined();
      }
    }
  });
});

// ── D290 — THE COMPLETE PER-PRINTING CENSUS, AND WHY IT SHIPS ZERO REGISTRY ROWS. ──
//
// 🛑 **THE SLICE THIS BLOCK WAS SENT TO BUILD WAS A FOLD, AND THE MEASUREMENT
// REFUSED IT.** D286 found Rare Candy `sv04.5-089` by accident and recorded it as
// "the cheapest measured row on the page — one line"; D287, D288 and D289 all
// carried that forward, and D289 sent the next slice to run *"the same 'does the
// registry hold every printing of a card it authors' scan across the WHOLE
// non-attack registry"* and to ship *"N one-line rows"*. **THE SCAN RAN. N IS 81.
// AND THE RIGHT NUMBER OF ROWS TO SHIP IS ZERO**, because of a rule this repo
// wrote down in D190 and nobody in the four-slice chain re-read: **a registry
// row's price is its LEGAL count, not its catalog count** (see
// `SKIPPED_ZERO_LEGAL` above). Every one of the 81 measures `legal_standard = 0`.
//
// ⚠️ **THE CENSUS, MEASURED — remote D1 `luminous`
// (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`, 3,786 rows / 2,021 `legal_standard`),
// 2026-08-08.** One query, one row per catalog IDENTITY, keyed on
// `name, category, effect, abilities_json, attacks_json, hp, stage, evolve_from,
// trainer_type, types_json, suffix` and filtered to groups holding at least one
// of the **452** `nonAttackRegistryIds()`:
//   * **884** identity groups in the catalog hold more than one printing;
//   * **140** of them contain a non-attack registry id;
//   * **44** of those 140 are INCOMPLETE — the registry authors some printings of
//     the card and not others;
//   * **81** printings are unauthored, and they are the table below.
// 🛑 **AND THE ONE NUMBER THAT DECIDED THE SLICE**: over those 81 ids,
// `sum(legal_standard)` = **0**, `sum(legal_expanded)` = **81**, and
// `count(DISTINCT regulation_mark)` = **1** — every single one is mark **G**.
// Not a majority, not "mostly promos": the whole population, one mark, zero
// Standard payoff. D190's four hand-found skips were a SAMPLE of this.
//
// ⚠️ **WHERE THEY LIVE**, since D289 predicted the misses would cluster on the
// promo/special sets: `sv04.5` **42**, `svp` **19**, `sv08.5` **8**, `sv04` 2,
// `mfb` 2, `sv10` 2, and one each in `sv03.5`, `sv06`, `sv07`, `sv08`, `sv09`,
// `sv10.5b`. **69 of 81 (85%) are Paldean Fates, promos or the 151-style
// special set** — which is the same fact as the mark-G one seen from the set axis.
//
// 🛑 **THE TWO CENSUSES ARE DIFFERENT SCOPES AND NEITHER SUBSUMES THE OTHER**, and
// this is the part that would have been invisible without running both. D190's
// sweep is keyed on the printed SENTENCE and crosses card names (one "takes 30
// less damage" text over Tangrowth / Dubwool / Cetitan / Mudsdale / Bouffalant);
// this one is keyed on the PRINTING and crosses set codes (one Rare Candy over
// four ids). **They agree on 16 ids, this one adds 65 D190 never recorded, and
// D190 holds 9 this one cannot reach at any width** — `SENTENCE_ONLY_SKIPS`
// below, all of them a DIFFERENT CARD sharing a text. So `SKIPPED_ZERO_LEGAL`'s
// 25 ids and this table's 81 union to **90**, and the union is what "the registry
// is not printing-complete" actually costs.
//
// ✅ **WHAT THIS BLOCK IS FOR, AND IT IS NOT A TRANSCRIPTION CHECK.** Before it,
// NOTHING in the tree stopped a future slice adding `"sv04.5-089": RARE_CANDY` —
// D190's assertion covers 25 ids and this id is not one of them, which is exactly
// how a four-slice-old "cheapest row on the page" survived unchallenged. The
// assertion below is the standing refusal made LOAD-BEARING over the COMPLETE
// measured population: folding any of the 81 in reddens here, by name, with the
// reason attached. ⚠️ **AND IT IS THE ONE SHAPE A `survives` CORPUS ROW COULD NOT
// CARRY** — there is no behaviour to break, only a decision to keep.

/** The 44 INCOMPLETE identities, measured 2026-08-08 (see the block above).
    `authored` is one registry id the census matched the group on — the WARRANT
    that this is a real registry family and not a phantom; `unauthored` are the
    printings of that same card the registry map does not name. All 81 are
    `legal_standard = 0`, regulation mark G. */
const PRINTING_ALIAS_CENSUS = [
  { card: "Arboliva", authored: "sv01-023", unauthored: ["sv04.5-104"] },
  { card: "Armarouge", authored: "sv01-041", unauthored: ["sv04.5-015", "sv04.5-115"] },
  { card: "Artazon", authored: "sv02-171", unauthored: ["sv04.5-076"] },
  { card: "Baxcalibur", authored: "sv02-060", unauthored: ["svp-019", "sv04.5-130"] },
  { card: "Beach Court", authored: "sv01-167", unauthored: ["sv04-263"] },
  { card: "Brassius", authored: "sv03-187", unauthored: ["sv08.5-135"] },
  { card: "Bravery Charm", authored: "sv02-173", unauthored: ["sv07-175"] },
  { card: "Charizard ex", authored: "sv03-125", unauthored: ["svp-056", "svp-074", "svp-196", "sv04.5-054", "sv04.5-234"] },
  { card: "Chien-Pao ex", authored: "sv02-061", unauthored: ["svp-030", "sv04.5-242"] },
  { card: "Dachsbun", authored: "sv01-099", unauthored: ["sv04.5-039", "sv04.5-161"] },
  { card: "Earthen Vessel", authored: "sv06.5-096", unauthored: ["sv04-163", "sv08.5-106"] },
  { card: "Electric Generator", authored: "sv01-170", unauthored: ["sv04.5-079"] },
  { card: "Entei", authored: "sv03-030", unauthored: ["sv04.5-112"] },
  { card: "Flamigo", authored: "sv02-170", unauthored: ["sv04.5-211"] },
  { card: "Gardevoir ex", authored: "sv01-086", unauthored: ["sv04.5-029", "sv04.5-217", "sv04.5-233"] },
  { card: "Garganacl", authored: "sv02-123", unauthored: ["sv04.5-178"] },
  { card: "Giacomo", authored: "sv02-182", unauthored: ["sv08.5-138"] },
  { card: "Hawlucha", authored: "sv01-118", unauthored: ["svp-007", "sv04.5-175"] },
  { card: "Iono", authored: "sv02-185", unauthored: ["svp-124", "sv04.5-080", "sv04.5-237"] },
  { card: "Jet Energy", authored: "sv02-190", unauthored: ["sv08-252"] },
  { card: "Judge", authored: "sv01-176", unauthored: ["sv04.5-228", "sv10-167", "sv10-222"] },
  { card: "Klefki", authored: "sv01-096", unauthored: ["sv04.5-159"] },
  { card: "Koraidon ex", authored: "sv01-125", unauthored: ["svp-029", "sv04.5-245"] },
  { card: "Luminous Energy", authored: "sv02-191", unauthored: ["sv06-226"] },
  { card: "Mawile", authored: "sv03-143", unauthored: ["svp-039"] },
  { card: "Meowscarada ex", authored: "sv02-015", unauthored: ["svp-033", "svp-078"] },
  { card: "Mimikyu", authored: "sv02-097", unauthored: ["svp-075", "sv04.5-037", "sv04.5-160"] },
  { card: "Nemona", authored: "sv01-180", unauthored: ["sv04.5-082", "sv04.5-229", "sv04.5-238"] },
  { card: "Nest Ball", authored: "sv01-181", unauthored: ["sv04.5-084"] },
  { card: "Ortega", authored: "sv03-190", unauthored: ["sv08.5-141"] },
  { card: "Pachirisu", authored: "sv01-068", unauthored: ["sv04.5-138"] },
  { card: "Pawmot", authored: "sv01-076", unauthored: ["svp-006", "sv04.5-144"] },
  { card: "Potion", authored: "sv01-188", unauthored: ["mfb-33"] },
  { card: "Professor's Research", authored: "sv01-189", unauthored: ["svp-221", "svp-222", "svp-223", "sv04.5-087", "sv04.5-088", "sv08.5-122", "sv08.5-123", "sv08.5-124", "sv08.5-125", "sv09-155", "sv10.5b-085"] },
  { card: "Quaquaval", authored: "sv01-054", unauthored: ["svp-005"] },
  // 🛑 THE ROW THE SLICE WAS SENT TO FOLD IN. The four printings' `effect` bytes
  // were RE-READ against remote D1 on 2026-08-08 rather than inherited: all four
  // are `trainer_type = "Item"`, `length(effect) = 287`, and the string is
  // character-identical — D286's claim HELD. It is still not built, and now for a
  // stated reason instead of for want of a slice.
  { card: "Rare Candy", authored: "sv01-191", unauthored: ["sv04.5-089"] },
  { card: "Revavroom", authored: "sv01-142", unauthored: ["svp-008", "sv04.5-065", "sv04.5-193"] },
  { card: "Skwovet", authored: "sv01-151", unauthored: ["sv04.5-205"] },
  { card: "Spiritomb", authored: "sv02-089", unauthored: ["sv04.5-158"] },
  { card: "Switch", authored: "sv01-194", unauthored: ["sv03.5-206", "mfb-34"] },
  { card: "Thundurus", authored: "sv03-070", unauthored: ["sv04.5-139"] },
  { card: "Ting-Lu ex", authored: "sv02-127", unauthored: ["sv04.5-244"] },
  { card: "Tinkaton", authored: "sv02-105", unauthored: ["svp-020", "sv04.5-167"] },
  { card: "Ultra Ball", authored: "sv01-196", unauthored: ["sv04.5-091"] },
] as const;

/** The nine ids `SKIPPED_ZERO_LEGAL` holds that a PRINTING-keyed census cannot
    reach AT ANY WIDTH, because each is a DIFFERENT CARD that happens to print a
    sentence the registry already authors — Aegislash and Ferrothorn under
    Mimikyu's Safeguard text, Blastoise ex under the 30-less text. Re-queried
    2026-08-08: all nine are `legal_standard = 0`, regulation mark G. They are
    named here so the two scopes stay distinguishable instead of merging into one
    number that is wrong for both. */
const SENTENCE_ONLY_SKIPS = [
  "sv04-134", "sv04-210", "svp-060",
  "sv03.5-009", "sv03.5-184", "sv03.5-200", "sv04-128", "sv04-209", "sv07-030",
] as const;

describe("D290 — the COMPLETE per-printing reprint census", () => {
  const flat = PRINTING_ALIAS_CENSUS.flatMap((r) => r.unauthored as readonly string[]);

  it("is 44 incomplete identities over 81 unauthored printings, with no id counted twice", () => {
    expect(PRINTING_ALIAS_CENSUS).toHaveLength(44);
    expect(flat).toHaveLength(81);
    // A duplicated id would inflate the 81 while leaving every other assertion
    // in this block green — the census's own transcription control.
    expect(new Set(flat).size).toBe(81);
    // …and no identity may be listed twice under two names, which is the other
    // way the table could double-count.
    expect(new Set(PRINTING_ALIAS_CENSUS.map((r) => r.authored)).size).toBe(44);
  });

  it("leaves every one of the 81 UNAUTHORED — the standing refusal, complete rather than sampled", () => {
    // 🛑 THE LOAD-BEARING ASSERTION OF THE SLICE. `SKIPPED_ZERO_LEGAL` above makes
    // this claim for 25 ids that a SENTENCE sweep happened to surface; this makes
    // it for the complete measured PRINTING population, `sv04.5-089` included.
    // Adding any of these to `REGISTRY` reddens here with the id in the message.
    for (const { card, unauthored } of PRINTING_ALIAS_CENSUS) {
      for (const id of unauthored) {
        expect(
          programFor(id),
          `${id} (${card}) was landed with 0 Standard-legal printings — D190's rule`,
        ).toBeUndefined();
      }
    }
  });

  it("every row's AUTHORED anchor really carries a non-attack registry program — the attribution control", () => {
    // Without this the block above would pass just as happily on 44 invented card
    // names: "these ids have no program" is trivially true of ids that are not in
    // the catalog at all. The anchor is what makes each row a claim about a
    // registry FAMILY, and `nonAttackRegistryIds()`'s own predicate is re-applied
    // here rather than assumed — a key other than `attack`.
    for (const { card, authored } of PRINTING_ALIAS_CENSUS) {
      const program = programFor(authored);
      expect(program, `${authored} (${card}) anchors a census row and has no program`).toBeDefined();
      expect(
        Object.keys(program ?? {}).some((key) => key !== "attack"),
        `${authored} (${card}) is attack-only and cannot anchor a NON-ATTACK census row`,
      ).toBe(true);
    }
  });

  it("D190's SKIPPED_ZERO_LEGAL is a 16-of-25 SAMPLE of this census, and neither scope subsumes the other", () => {
    const sampled = SKIPPED_ZERO_LEGAL.flatMap((s) => s.ids as readonly string[]);
    expect(new Set(sampled).size).toBe(25);
    const here = new Set(flat);
    // The overlap, and the two remainders — all three derived from the constants
    // rather than restated, so a future edit to either list moves these numbers.
    expect(sampled.filter((id) => here.has(id))).toHaveLength(16);
    expect(sampled.filter((id) => !here.has(id)).sort()).toEqual([...SENTENCE_ONLY_SKIPS].sort());
    expect(flat.filter((id) => !sampled.includes(id))).toHaveLength(65);
    // The union is the real cost of "the registry is not printing-complete".
    expect(new Set([...sampled, ...flat]).size).toBe(90);
    // The nine sentence-only ids stay unbuilt too — this block does not license
    // them by describing them.
    for (const id of SENTENCE_ONLY_SKIPS) expect(programFor(id)).toBeUndefined();
  });

  it("the census is DISJOINT from the 22 aliases D190 DID land — refusal and build do not overlap", () => {
    // The two tables in this file answer the same question with opposite verdicts,
    // so an id appearing in both would mean one of them is a lie. It also catches
    // the realistic authoring mistake: pasting a landed alias into the refusal
    // table, which would make the block above go red for the right reason on the
    // wrong id.
    const landed = new Set<string>(ALIASES.map((a) => a.id));
    for (const id of flat) expect(landed.has(id), `${id} is BOTH landed and refused`).toBe(false);
    for (const id of SENTENCE_ONLY_SKIPS) expect(landed.has(id)).toBe(false);
  });

  it("Rare Candy's THREE authored printings still share ONE program while the fourth stays unbuilt", () => {
    // The named row, driven as a relation rather than as a comment: the census's
    // claim about `sv04.5-089` is only meaningful if the other three really are
    // one family. `toBe`, not `toEqual`, for the reason the alias block gives.
    const first = programFor("sv01-191");
    expect(first?.rareCandy).toBe(true);
    for (const id of ["sv01-256", "swsh10.5-069"]) expect(programFor(id)).toBe(first);
    expect(programFor("sv04.5-089")).toBeUndefined();
    // And it is a census row, by name — so deleting the row to make the line above
    // pass costs a red in the count assertion at the top of this block.
    expect(PRINTING_ALIAS_CENSUS.find((r) => r.card === "Rare Candy")?.unauthored).toEqual([
      "sv04.5-089",
    ]);
  });
});

// ── The nine inherited programs, DRIVEN THROUGH THE REAL ENGINE. ──
//
// ⚠️ THE ALIASES THEMSELVES CANNOT BE FIELDED (no fixture, see above), so what is
// driven is the PROGRAM each of them now resolves to, through its already-
// fixtured twin. Taken with the `toBe` identity above, that is the whole claim:
// the 22 ids resolve to these nine objects, and these nine objects do this.

describe("the inherited programs still run end to end (the twins, through the engine)", () => {
  it("damageReductionAfterWR 30 — Bite's 30 is fully absorbed", () => {
    const state = fight(openOn(2, COVERAGE_DECK), "sv02-150");
    deepFreeze(state);
    const { state: after, events } = mustApply(state, bite);
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 30, reduction: 30, dealt: 0 });
    expect(after.players.p2.active?.damage).toBe(0);
  });

  it("damageReductionAfterWR 20 — Bite's 30 lands as 10", () => {
    const state = fight(openOn(3, COVERAGE_DECK), "sv01-121");
    deepFreeze(state);
    const { state: after, events } = mustApply(state, bite);
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 30, reduction: 20, dealt: 10 });
    expect(after.players.p2.active?.damage).toBe(10);
  });

  it("damageAttacker 30 — the defender puts 3 counters back on the Attacking Pokémon", () => {
    const state = fight(openOn(1, COUNTERATTACK_DECK), "sv01-005");
    deepFreeze(state);
    const { state: after, events } = mustApply(state, bite);
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 30 });
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({ seat: "p1", amount: 30 });
    expect(after.players.p1.active?.damage).toBe(30);
  });

  it("the onDamagedByAttack trigger — the Attacking Pokémon is now Burned", () => {
    const state = fight(openOn(1, SCORCHING_ARMOR_DECK), "sv03-044");
    deepFreeze(state);
    const { state: after, events } = mustApply(state, bite);
    expect(find(events, "ABILITY_TRIGGERED")).toMatchObject({
      seat: "p2",
      ability: "Scorching Armor",
    });
    expect(find(events, "STATUS_APPLIED")).toMatchObject({ seat: "p1", status: "burned" });
    expect(after.players.p1.active?.conditions.burned).toBe(true);
  });

  it("seatDamageReductionAfterWR 10 — a BENCHED source shields the seat's Active", () => {
    let state = openOn(1, ALWAYS_ON_REDUCTION_DECK);
    state = fight(state, "fix-bigbody");
    state = benchFromDeck(state, "p2", "sv02-113"); // Hariyama on the BENCH — the aura is seat-wide
    deepFreeze(state);
    const { events } = mustApply(state, bite);
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 30, reduction: 10, dealt: 20 });
  });

  it("drawCards 3 — the Supporter draws exactly three", () => {
    let state = openOn(1, COVERAGE_DECK);
    state = handFromDeck(state, "p1", "sv01-180", 1);
    const uid = handUid(state, "p1", "sv01-180");
    const before = state.players.p1.hand.length;
    deepFreeze(state);
    const { state: after, events } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expect(find(events, "CARDS_DRAWN")?.uids).toHaveLength(3);
    expect(after.players.p1.hand.length).toBe(before - 1 + 3); // −1 played, +3 drawn
  });

  it("discardPileRetrieval — Energy Retrieval parks on up to 2 Basic Energy", () => {
    let state = openOn(1, DISCARD_RETRIEVAL_DECK);
    state = discardFromDeck(state, "p1", "fix-fire-energy", 1);
    state = discardFromDeck(state, "p1", "fix-water-energy", 1);
    state = discardFromDeck(state, "p1", "fix-basic-1", 1); // a Pokémon — excluded
    state = handFromDeck(state, "p1", "sv01-171", 1);
    const uid = handUid(state, "p1", "sv01-171");
    deepFreeze(state);
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(parked.phase.prompt.dest).toBe("hand");
    expect(parked.phase.prompt.max).toBe(2);
    expect(parked.phase.prompt.candidates).toHaveLength(2); // the two Energy, not the Pokémon
  });

  it("lookAtTopN — Pokégear 3.0 parks on the top 7's Supporters only", () => {
    let state = openOn(1, LOOK_AT_TOP_DECK);
    state = handFromDeck(state, "p1", "sv01-186", 1);
    const uid = handUid(state, "p1", "sv01-186");
    deepFreeze(state);
    const { state: after } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    // Seed 1 puts at least one Supporter in the top 7, so the park is the
    // deterministic outcome and no "…or it whiffed" escape hatch is offered —
    // that branch would make the case vacuously green if the op stopped running.
    expect(after.phase.kind).toBe("effect:choose");
    if (after.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (after.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(after.phase.prompt.max).toBe(1);
    expect(after.phase.prompt.dest).toBe("hand");
    expect(after.phase.prompt.candidates.length).toBeGreaterThan(0);
    for (const candidate of after.phase.prompt.candidates) {
      // the `supporter` filter, proved on the candidates rather than assumed
      expect(FIXTURE_POOL[after.cardIdByUid[candidate] ?? ""]?.trainerType).toBe("Supporter");
    }
  });

  it("attachFromDeck — Janine's Secret Art parks on the deck's Basic {D} Energy", () => {
    let state = openOn(1, ATTACH_FROM_DECK_DECK);
    state = setActiveFromDeck(state, "p1", "fix-dark-1"); // a {D} body, so targetType admits it
    state = handFromDeck(state, "p1", "sv06.5-059", 1);
    const uid = handUid(state, "p1", "sv06.5-059");
    deepFreeze(state);
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.prompt.kind).toBe("attachCards");
  });
});

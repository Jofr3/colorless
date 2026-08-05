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
    expect(programFor("sv08.5-067")?.passive).toEqual({ seatDamageReductionAfterWR: 10 });
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

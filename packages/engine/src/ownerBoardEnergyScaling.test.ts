import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { countEnergyInPlay } from "./continuous";
import {
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackEffect,
} from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.368.0 → 0.369.0 — 🆕🆕 D470: THE BOARD-WIDE OWN-SIDE ENERGY COUNT, NARROWED BY
// THE PRINTED NOUN THAT NAMES A SUBGROUP OF THE ZONE.
//
//   "This attack does 20 more damage for each {L} Energy attached to all of your
//    Iono's Pokémon."
//     — `censusAttackCorpus.ts` **FILE LINE 558**, 1 sentence / **1 Standard-legal
//       printing**, the ADDITIVE fold.
//
// THE COST TABLE: **1 whole-sentence anchor (`SELF_ENERGY_FILTERED_SCALE`), 1 reader
// arm in `deriveAttackDamageBonus`, 1 OPTIONAL field on the SHIPPED `energyOnSelf`
// member (`filter?: CardFilter`), 1 evaluator branch in `scaledAttackDamage`, and 1
// OPTIONAL parameter on the SHARED `countEnergyInPlay`**. ZERO new `EffectOp`
// members, op fields, op values, prompts, events, error codes, registry rows,
// `CardFilter` members, `packages/schema` bytes, `redact.ts` bytes, `GameState`
// fields or `FIXTURE_POOL` ids.
//
// 🛑 **THE ROW PASSES D468's SCHEMA TEST, WHICH IS WHY IT IS THIS ONE.** The residue
// classifier names a TOKEN, and the token may name a COLUMN (buildable) or a BANNER
// (data-blocked, D468's `Ancient`/`Future`). *"Iono's"* names a COLUMN:
// `CardFilter.ownerPokemon` has read `Card.name` since D242, `Card.name` is one of
// `cardSchema`'s 21 keys, and `inPlayBodyFilter`'s owner branch already resolves the
// printed noun. So this filter counts real bodies on real boards rather than 0
// forever (D190b/D199's strictly-worse-than-unbuilt).
//
// 🛑 **THE SHARED HELPER IS THE IMPLEMENTATION OF EVERY OP THAT CALLS IT (D454), SO
// THE CALLERS WERE ENUMERATED BEFORE A BYTE WAS WRITTEN.** `countEnergyInPlay` has
// exactly THREE call sites at this head — `attack.ts`'s `energyOnOpponent` board arm,
// its `energyOnSelf` board arm, and `interpreter.ts`'s `yourEnergyInPlayAtLeast`
// board condition. The third is NOT an op and no brief had named it. All three pass
// THREE arguments and are byte-identical after this slice, because the new parameter
// is OPTIONAL and `undefined` is every body — the same widening this function's own
// doc block already made for `energy: null` at D193. §7 drives that rather than
// asserting it.
//
// ⚠️ **DISJOINTNESS IS STRUCTURAL, AND D467/D468 REQUIRE SAYING WHICH KIND.**
// `SELF_ENERGY_FILTERED_SCALE` and the shipped `SELF_ENERGY_SCALE` are both `^…$`
// over the whole sentence and disagree on a MANDATORY run of bytes at the same
// position: this one demands `[^.]+ Pokémon` after `all of your `, a run ending in a
// SPACE that the shipped literal `all of your Pokémon` cannot spend. No string
// matches both, so the arm ORDER is legibility and the corpus's order-swap row is a
// DECLARED `equivalent` survivor with no companion deletion row — correctly none, a
// guard there would be D205/D208's vacuous guard.
//
// 🛑 **THE `(?!opponent)` LOOKAHEAD IS A DIFFERENT GUARD, AND IT IS KILLABLE.** It
// refuses *"…attached to all of your opponent's Pokémon."* — a SEAT, not a subgroup —
// which would otherwise resolve to `{kind: "ownerPokemon", owner: "opponent"}` and
// score 0 forever while the census recorded the sentence BUILT. §2 drives it, and
// `boardWideEnergyScaling.test.ts` §2 has asserted that same `null` since D407.
//
// ⚠️ **NO NEW `FIXTURE_POOL` ID** — a file-local `cardPool` (D414), so
// `opponentResistanceBonus.test.ts`'s pool-size pin and its ladder take a **0** term
// (D452/D465). §9 asserts that rather than promising it.
//
// ⚠️ **`MATCH_RECORD_VERSION` STAYS 29** on the SERIALIZED-ALPHABET argument (D462),
// in its strongest form — *there is no carrier at all* — and DRIVEN over the bytes in
// §8. No `CardFilter` MEMBER is added, which is the half that would have cost a bump
// (D446: `CardFilter` IS persisted, on nine `EffectOp` fields); `ownerPokemon` has
// been an inhabitant a v29 record could hold since D242.
//
// SEED-FREE beyond the shuffles setup needs: the sentence carries no coin.

// ─────────────────────────────────────────────────────────────────────────────
// The printed bytes
// ─────────────────────────────────────────────────────────────────────────────

/** The printed sentence, verbatim off `censusAttackCorpus.ts` file line 558. The
    possessive is ASCII U+0027 and the é in `Pokémon` is U+00E9 — asserted on the
    BYTES in §1 rather than eyeballed (D137/D227). */
const OWNER_BOARD =
  "This attack does 20 more damage for each {L} Energy attached to all of your Iono's Pokémon.";

/** The sentence ONE WORD NARROWER — D407's board-wide spelling, shipped since then
    and printed 4 times with `{G}`. It is the NEAREST WRONG SIBLING of this slice's
    row at the TEXT level, and the control for the filter's whole job: on every board
    below it answers a different number, and if it did not, the filter would be
    invisible. */
const SHIPPED_BOARD =
  "This attack does 20 more damage for each {L} Energy attached to all of your Pokémon.";

/** The ZONE-LESS spelling this member has read since D196 — one body, the attacker.
    It is what makes §4's zero-match board distinguishable from a dead reader. */
const SHIPPED_SELF =
  "This attack does 20 more damage for each {L} Energy attached to this Pokémon.";

/** The `×` twin of this slice's sentence. **Printed ZERO times** — asserted over the
    legal column in §6, not assumed. */
const OWNER_BOARD_MULTIPLY =
  "This attack does 20 damage for each {L} Energy attached to all of your Iono's Pokémon.";

/** The SEAT spelling the `(?!opponent)` lookahead exists to refuse. Printed on the
    `×` fold only (file lines 581/584/610/614) and NOWHERE on the additive one, which
    §6 measures. `boardWideEnergyScaling.test.ts` §2 has pinned its `null` since
    D407, so the lookahead's deletion reddens an EXISTING rung as well as this one. */
const OPPONENT_SEAT_BOARD =
  "This attack does 20 more damage for each {L} Energy attached to all of your opponent's Pokémon.";

/** The BODY-vocabulary refusal — D468's data-blocked banner in this anchor's noun
    slot. `inPlayBodyFilter` answers `null`, so the sentence stays on the loud
    ATTACK_EFFECT_SKIPPED path instead of counting 0 forever. */
const ANCIENT_NOUN =
  "This attack does 20 more damage for each {L} Energy attached to all of your Ancient Pokémon.";

/** The ENERGY-vocabulary probe, one guard over. ⚠️ **D500 CHANGED ITS SIGN**: it was
    the refusal — `attachedEnergyFilter` answered `undefined` for "Basic Energy" — and
    `Basic` is in `CLAUSE_ENERGY_TOKENS` now, so it RESOLVES, exactly as it does for
    the two shipped arms above this one. The name is kept (D438: re-point, do not
    rename away the trail) and the assertion moved. **0 legal printings either way** —
    this composition is constructed, and the refusal it used to carry was always about
    the vocabulary rather than about this anchor. */
const BASIC_ENERGY_NOUN =
  "This attack does 20 more damage for each Basic Energy attached to all of your Iono's Pokémon.";

/** U+2019, spelled as an escape — the two apostrophes render nearly identically, so
    the curly one is always written where a reader can see it. */
const RSQUO = "’";

/** The corpus FILE LINE of the row this slice claims (`fileLine = index + 53`,
    D448's convention, broken twice since — D459). */
const OWNER_BOARD_FILE_LINE = 558;

// ─────────────────────────────────────────────────────────────────────────────
// The pool — FILE-LOCAL (D414), so `FIXTURE_POOL` is byte-unchanged
// ─────────────────────────────────────────────────────────────────────────────

/** The four sentences this file compares sit on ONE body at fixed indices, so every
    "this clause and not that one" case is a same-fixture, same-board comparison. All
    four cost one {C} and print the same base 10, so a difference in `dealt` is a
    difference in the CLAUSE and in nothing else. */
const ATTACKS = [
  { cost: ["Colorless"], name: "Iono Surge", damage: 10, effect: OWNER_BOARD },
  { cost: ["Colorless"], name: "Board Surge", damage: 10, effect: SHIPPED_BOARD },
  { cost: ["Colorless"], name: "Self Surge", damage: 10, effect: SHIPPED_SELF },
  { cost: ["Colorless"], name: "Plain Surge", damage: 10 },
];

/** The attacker that IS one of *"your Iono's Pokémon"* — it counts ITSELF, which is
    `fix-tr-mewtwo`'s own shape (D440) and is the axis §3's Active/Bench split needs. */
const IONO_ATTACKER: Card = battler("fix-ionobolt", {
  name: "Iono's Fixibolt",
  hp: 200,
  types: ["Lightning"],
  attacks: [...ATTACKS],
});

/** The SAME four attacks on a body that is NOT one. Two attackers rather than one,
    because §4's zero-match board needs an attacker the filter refuses and this
    family's sentence is printed on a body that its own clause counts. */
const PLAIN_ATTACKER: Card = battler("fix-plainbolt", {
  name: "Fixibolt",
  hp: 200,
  types: ["Lightning"],
  attacks: [...ATTACKS],
});

/** A benched Iono's body. */
const IONO_BENCH: Card = battler("fix-ionochu", {
  name: "Iono's Fixichu",
  hp: 120,
  types: ["Lightning"],
});

/** A benched body with NO prefix at all — the plain negative. */
const PLAIN_BENCH: Card = battler("fix-plainmander", { name: "Fixidos", hp: 120 });

/** 🛑 **THE SUBSTRING NEAR MISS, AND IT IS AN INVENTED CARD ON PURPOSE** (D260's
    `Fix` convention). Its name CONTAINS `Iono's ` and does not BEGIN with it, so a
    filter written with `includes` instead of `startsWith` counts it and a correct one
    does not. `matchesFilter`'s `ownerPokemon` arm reads a PREFIX (cards.ts), and this
    is the body that makes the difference a number rather than a claim. */
const RIVAL_BENCH: Card = battler("fix-rivalono", {
  name: "Rival of Iono's Fixiton",
  hp: 120,
  types: ["Lightning"],
});

/** The DEFENDER's Iono's body. The printed word is *"all of YOUR … Pokémon"*, so the
    subgroup narrows WHICH of your bodies count and never WHOSE — this fixture is
    what makes a seat inversion answer a different number instead of the same one. */
const IONO_FOE: Card = battler("fix-ionogar", {
  name: "Iono's Fixigar",
  hp: 340,
  types: ["Lightning"],
});

/** 🛑 **THE EVOLUTION TOP-CARD PROBE.** `countEnergyInPlay`'s filter reads the TOP
    card (§1.2), not the bottom of the stack, so an Iono's Basic that has evolved into
    a body WITHOUT the prefix has stopped being one of *"your Iono's Pokémon"*. §5
    stacks this card onto an Iono's body and watches the count drop. */
const EVOLVED_TOP: Card = battler("fix-plainvolt", {
  name: "Fixivolt",
  hp: 160,
  types: ["Lightning"],
  stage: "Stage1",
  evolveFrom: "Iono's Fixichu",
});

const LOCAL_CARDS: Record<string, Card> = {
  "fix-ionobolt": IONO_ATTACKER,
  "fix-plainbolt": PLAIN_ATTACKER,
  "fix-ionochu": IONO_BENCH,
  "fix-plainmander": PLAIN_BENCH,
  "fix-rivalono": RIVAL_BENCH,
  "fix-ionogar": IONO_FOE,
  "fix-plainvolt": EVOLVED_TOP,
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  "fix-ionobolt": 2,
  "fix-plainbolt": 2,
  "fix-ionochu": 2,
  "fix-plainmander": 2,
  "fix-rivalono": 2,
  "fix-ionogar": 2,
  "fix-plainvolt": 2,
  "fix-basic-1": 4,
  "fix-lightning-energy": 24,
  "fix-water-energy": 6,
  "fix-energy": 12,
});

/** Attack indices, named rather than remembered (§1 pins each against the fixture's
    own `attacks` array). */
const IONO = 0;
const BOARD = 1;
const SELF = 2;
const PLAIN = 3;

/** One seed for the whole suite. Nothing here flips a coin and every body and every
    attachment is placed by surgery, so a seed table would describe a shuffle rather
    than a rule (D143). */
const SEED = 7;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(
      applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

/** `by` is about to attack. The FOE opens and passes, so the attacking seat carries
    no §4 first-turn restriction; BOTH Benches are cleared, because every number this
    family reads is a BOARD TALLY and a body the setup shuffle happened to seat would
    move it silently. The defender's Active is an Iono's body carrying SIX {L}: it is
    the seat control, present on every board in this file, contributing 0 to every
    correct answer. */
function bare(attacker: string, by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(localSetup(SEED, by === "p1" ? "p2" : "p1"), { type: "endTurn", seat: foe }),
  );
  state = setActiveFromDeck(state, by, attacker);
  state = clearBench(state, by);
  state = setActiveFromDeck(state, foe, "fix-ionogar");
  state = clearBench(state, foe);
  return attachFromDeck(state, foe, "fix-lightning-energy", 6);
}

/** Bench `ids` in order and attach `energy[i]` (a list of card ids) to each. */
function benchWith(
  state: GameState,
  seat: Seat,
  rows: readonly (readonly [string, readonly string[]])[],
): GameState {
  let next = state;
  for (const [index, [id, cards]] of rows.entries()) {
    next = benchFromDeck(next, seat, id);
    for (const card of cards) next = attachBenchFromDeck(next, seat, index, card, 1);
  }
  return next;
}

/** 🛑 **THE MIXED BOARD — the one every number in §3 is measured on, built so that
    EIGHT plausible implementations answer EIGHT DIFFERENT numbers on this ONE setup.**

      attacker's side (p1)                              defender's side (p2)
        Active  Iono's Fixibolt         2 {L} + 1 {C}     Iono's Fixigar   6 {L}
        Bench 0 Iono's Fixichu          1 {L}
        Bench 1 Fixidos                 3 {L}
        Bench 2 Rival of Iono's Fixiton 2 {L}

    The correct answer is the {L} attached to the ATTACKER's bodies whose name BEGINS
    `Iono's `, over Active + Bench: 2 + 1 = **3** counters → `scaled` 10 + 60 = 70.

      • the FILTER dropped (D407's whole board)                → 8
      • the ENERGY TYPE dropped (any Energy on those bodies)   → 4
      • the ZONE dropped (the attacking body alone)            → 2
      • the ACTIVE dropped from the holder list (Bench only)   → 1
      • `includes` where the arm reads `startsWith`            → 5
      • the SEAT inverted (the defender's Iono's bodies)       → 6
      • the filter asked of the ENERGY uid, not of the BODY    → 0

    Eight values, all distinct, on one setup — which is why `Rival of Iono's Fixiton`
    and the {C} on the Active are both there. */
function mixed(by: Seat = "p1"): GameState {
  let state = bare("fix-ionobolt", by);
  state = attachFromDeck(state, by, "fix-lightning-energy", 2);
  state = attachFromDeck(state, by, "fix-energy", 1);
  return benchWith(state, by, [
    ["fix-ionochu", ["fix-lightning-energy"]],
    ["fix-plainmander", ["fix-lightning-energy", "fix-lightning-energy", "fix-lightning-energy"]],
    ["fix-rivalono", ["fix-lightning-energy", "fix-lightning-energy"]],
  ]);
}

/** 🛑 **ZERO-MATCH, ROUTE ONE: NO BODY MATCHES.** The attacker's side carries SEVEN
    {L} Energy and not one of the bodies holding them is an Iono's Pokémon — the
    attacker included. The correct answer is 0 and the board is loud with the
    resource, which is what separates it from route three. */
function zeroNoBody(by: Seat = "p1"): GameState {
  let state = bare("fix-plainbolt", by);
  state = attachFromDeck(state, by, "fix-lightning-energy", 2);
  state = attachFromDeck(state, by, "fix-energy", 1);
  return benchWith(state, by, [
    ["fix-plainmander", ["fix-lightning-energy", "fix-lightning-energy", "fix-lightning-energy"]],
    ["fix-rivalono", ["fix-lightning-energy", "fix-lightning-energy"]],
  ]);
}

/** 🛑 **ZERO-MATCH, ROUTE TWO: THE BODIES MATCH AND THEIR ENERGY IS THE WRONG TYPE.**
    Two Iono's bodies, three {W} and one {C} between them, and a THIRD body that is
    not an Iono's carrying three {L} — so the unfiltered sibling answers 3 on this
    very board while the filtered one answers 0, and the 0 belongs to the FILTER
    rather than to an empty board. */
function zeroWrongEnergy(by: Seat = "p1"): GameState {
  let state = bare("fix-ionobolt", by);
  state = attachFromDeck(state, by, "fix-water-energy", 2);
  state = attachFromDeck(state, by, "fix-energy", 1);
  return benchWith(state, by, [
    ["fix-ionochu", ["fix-water-energy"]],
    ["fix-plainmander", ["fix-lightning-energy", "fix-lightning-energy", "fix-lightning-energy"]],
  ]);
}

/** 🛑 **ZERO-MATCH, ROUTE THREE: THE BOARD IS EMPTY.** One Iono's body, one {C} to
    pay the cost, a swept Bench. 0 because there is nothing to count — the same
    number as routes one and two and not the same fact, which is the whole reason all
    three are here (D469's convention, one resource over). */
function zeroEmpty(by: Seat = "p1"): GameState {
  const state = bare("fix-ionobolt", by);
  return attachFromDeck(state, by, "fix-energy", 1);
}

/** TEST SURGERY: push a fresh copy of `cardId` onto bench[index]'s STACK, which is
    what an evolution does to the body it lands on (bottom → top). Local to this file
    because the top-card reading is local to this slice's claim. */
function stackOnto(state: GameState, seat: Seat, index: number, cardId: string): GameState {
  const side = state.players[seat];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined) throw new Error(`${seat} deck has no ${cardId}`);
  const body = side.bench[index];
  if (body === undefined) throw new Error(`${seat} has no bench[${index}]`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((u) => u !== uid),
        bench: side.bench.map((p, i) => (i === index ? { ...p, stack: [...p.stack, uid] } : p)),
      },
    },
  };
}

function swing(state: GameState, index: number, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index });
}

function dealt(state: GameState, index: number, seat: Seat = "p1"): number | undefined {
  return find(swing(state, index, seat).events, "DAMAGE_DEALT")?.dealt;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE PRINTED BYTES AND THE CORPUS ROW
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the sentence, its corpus row, and the fixtures that print it", () => {
  it("is corpus FILE LINE 558, ONE sentence and ONE Standard-legal printing", () => {
    const corpus = legalAttackCorpus();
    const row = corpus.find(([, s]) => s === OWNER_BOARD);
    expect(row).toBeDefined();
    expect(row?.[0]).toBe(1);
    expect(corpus.indexOf(row as (typeof corpus)[number]) + 53).toBe(OWNER_BOARD_FILE_LINE);
  });

  it("the possessive is ASCII U+0027 and the é is U+00E9 — on the BYTES", () => {
    expect(OWNER_BOARD).toContain("Iono's");
    expect(OWNER_BOARD).not.toContain(RSQUO);
    expect(OWNER_BOARD).toContain("Pokémon");
    expect(OWNER_BOARD.charCodeAt(OWNER_BOARD.indexOf("Iono") + 4)).toBe(0x27);
  });

  it("the corpus row was UNREAD before this slice and is READ after it", () => {
    // `resolvedByAnyReader` is the census's own predicate — the one whose answer
    // moves RESIDUE. ⚠️ **AND IT IS NOT ENOUGH BY ITSELF** (D469): a census sees
    // whether a sentence is CLAIMED, never whether it is claimed CORRECTLY, which is
    // what §3 and §4 exist to answer.
    expect(resolvedByAnyReader(OWNER_BOARD)).toBe(true);
  });

  it("both attackers print all four sentences at the indices this file names", () => {
    for (const card of [IONO_ATTACKER, PLAIN_ATTACKER]) {
      const attacks = card.attacks ?? [];
      expect(attacks[IONO]?.effect, card.name).toBe(OWNER_BOARD);
      expect(attacks[BOARD]?.effect, card.name).toBe(SHIPPED_BOARD);
      expect(attacks[SELF]?.effect, card.name).toBe(SHIPPED_SELF);
      expect(attacks[PLAIN]?.effect, card.name).toBeUndefined();
      expect(attacks.map((a) => a.damage), card.name).toEqual([10, 10, 10, 10]);
    }
  });

  it("the fixture NAMES are what the filter reads, and the near miss is a near miss", () => {
    // `ownerPokemon` is an exact-case PREFIX on `Card.name` (cards.ts). These four
    // names are the whole of §3's filter axis, so they are asserted rather than read.
    expect(IONO_ATTACKER.name.startsWith("Iono's ")).toBe(true);
    expect(IONO_BENCH.name.startsWith("Iono's ")).toBe(true);
    expect(PLAIN_ATTACKER.name.startsWith("Iono's ")).toBe(false);
    expect(PLAIN_BENCH.name.startsWith("Iono's ")).toBe(false);
    expect(RIVAL_BENCH.name.includes("Iono's ")).toBe(true);
    expect(RIVAL_BENCH.name.startsWith("Iono's ")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE READER, ITS THREE GUARDS AND THE FIELD'S POLARITY
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — deriveAttackDamageBonus: the noun the zone did not have", () => {
  it("reads the printed sentence as energyOnSelf, board zone, {L}, ownerPokemon Iono", () => {
    expect(deriveAttackDamageBonus(OWNER_BOARD)).toEqual({
      per: 20,
      count: {
        kind: "energyOnSelf",
        zone: "board",
        energyType: "Lightning",
        filter: { kind: "ownerPokemon", owner: "Iono" },
      },
    });
  });

  it("🛑 the two SHIPPED spellings keep their exact shapes — the field's polarity", () => {
    // The whole reason the field is OPTIONAL: `undefined` is EVERY body in the zone,
    // so the 25 printings that reached this member before D470 — 21 zone-less and
    // D407's 4 board-wide — are byte-identical afterwards. A producer that emitted a
    // filter unconditionally, or an evaluator that read `undefined` as something
    // other than "every body", is what this rung goes red for.
    const board = deriveAttackDamageBonus(SHIPPED_BOARD);
    expect(board).toEqual({
      per: 20,
      count: { kind: "energyOnSelf", zone: "board", energyType: "Lightning" },
    });
    expect(board?.count).not.toHaveProperty("filter");
    const self = deriveAttackDamageBonus(SHIPPED_SELF);
    expect(self).toEqual({ per: 20, count: { kind: "energyOnSelf", energyType: "Lightning" } });
    expect(self?.count).not.toHaveProperty("filter");
    expect(self?.count).not.toHaveProperty("zone");
    // …and the real printed 4-printing row is unmoved too, byte for byte.
    expect(
      deriveAttackDamageBonus(
        "This attack does 30 more damage for each {G} Energy attached to all of your Pokémon.",
      ),
    ).toEqual({ per: 30, count: { kind: "energyOnSelf", zone: "board", energyType: "Grass" } });
  });

  it("🛑 GUARD 1 — the SEAT spelling is refused by the `(?!opponent)` lookahead", () => {
    // Not a subgroup: `owner: "opponent"` would name cards whose NAME begins
    // "opponent's ", of which the catalog has none, so the sentence would score 0 on
    // every board forever while the census recorded it BUILT. Deleting the lookahead
    // reddens THIS rung and `boardWideEnergyScaling.test.ts` §2's, which has asserted
    // the same null since D407.
    expect(deriveAttackDamageBonus(OPPONENT_SEAT_BOARD)).toBeNull();
    expect(deriveAttackDamageMultiplier(OPPONENT_SEAT_BOARD)).toBeNull();
    // …and the shipped opponent-side reading is untouched, so the null above is a
    // statement about THIS anchor and not about a dead family.
    expect(
      deriveAttackDamageBonus(
        "This attack does 30 more damage for each Energy attached to your opponent's Active Pokémon.",
      )?.count,
    ).toEqual({ kind: "energyOnOpponent", zone: "active", energyType: null });
  });

  it("🛑 GUARD 2 — the BODY vocabulary refuses, and the sentence stays LOUD", () => {
    // D468's data-blocked banner in this anchor's noun slot: `inPlayBodyFilter`
    // answers null, so the arm falls through to `return null` rather than emitting a
    // filter that counts 0 on every board.
    expect(deriveAttackDamageBonus(ANCIENT_NOUN)).toBeNull();
    expect(deriveAttackEffect(ANCIENT_NOUN)).toBeNull();
    expect(deriveAttackDamagePenalty(ANCIENT_NOUN)).toBeNull();
  });

  it("🛑 GUARD 3 — the ENERGY vocabulary, and it refuses exactly what it cannot read", () => {
    // 🆕🆕 **D500 — `Basic` MOVED FROM THE REFUSED SIDE TO THE ADMITTED SIDE, AND THE
    // GUARD IS UNCHANGED.** `attachedEnergyFilter` gained no branch; the shared
    // `CLAUSE_ENERGY_TOKENS` gained a row, so the token now resolves to the card
    // CATEGORY `"basic"` here for the same reason it resolves on the two arms above.
    // This composition is CONSTRUCTED and 0 legal — no printing spells a `Basic`
    // energy count on an owner-prefixed subgroup — and it is admitted rather than
    // guarded out for D470's own stated reason at this anchor: *a reader is a function
    // of TEXT, and a noun the column does not print simply never arrives*.
    //
    // 🛑 **AND THE GUARD'S POLARITY IS STILL WHAT THIS RUNG TESTS.** Guard 3 is
    // `energyType !== undefined`; `D470-owner-board-arm-confuses-null-with-undefined-in-the-energy-guard`
    // flips it to `!== null`. That row's `what` names TWO halves and D500 retires one
    // of them — `Basic` is no longer an unresolvable token — so the row is now killed
    // by the UNTYPED half alone: `OWNER_BOARD` below carries no token, resolves to
    // `null`, and `!== null` refuses it. The row's `find`/`replace` are byte-unchanged
    // (D496/D499: fix the suite, not the row) and the `{C}` case beside this one is
    // what keeps the unresolvable half of the guard driven at all.
    expect(deriveAttackDamageBonus(BASIC_ENERGY_NOUN)).toEqual({
      per: 20,
      count: {
        kind: "energyOnSelf",
        zone: "board",
        energyType: "basic",
        filter: { kind: "ownerPokemon", owner: "Iono" },
      },
    });
    expect(
      deriveAttackDamageBonus(
        "This attack does 20 more damage for each {C} Energy attached to all of your Iono's Pokémon.",
      ),
    ).toBeNull();
    // …and the ABSENT token is the UNTYPED reading rather than a refusal, which is
    // the same asymmetry `SELF_ENERGY_SCALE` carries and is why guard 3 tests
    // `!== undefined` rather than `!== null`.
    expect(
      deriveAttackDamageBonus(
        "This attack does 20 more damage for each Energy attached to all of your Iono's Pokémon.",
      )?.count,
    ).toEqual({
      kind: "energyOnSelf",
      zone: "board",
      energyType: null,
      filter: { kind: "ownerPokemon", owner: "Iono" },
    });
  });

  it("the printed-zero guard, and the whole-sentence anchor at both ends", () => {
    expect(
      deriveAttackDamageBonus(
        "This attack does 0 more damage for each {L} Energy attached to all of your Iono's Pokémon.",
      ),
    ).toBeNull();
    expect(deriveAttackDamageBonus(`${OWNER_BOARD} Then, draw a card.`)).toBeNull();
    expect(deriveAttackDamageBonus(`Before this, ${OWNER_BOARD}`)).toBeNull();
    expect(deriveAttackDamageBonus(OWNER_BOARD.replace(/\.$/, ""))).toBeNull();
    expect(deriveAttackDamageBonus(OWNER_BOARD.toLowerCase())).toBeNull();
  });

  it("🛑 DISJOINTNESS IS STRUCTURAL — neither anchor can match the other's sentence", () => {
    // D468's kind, not D467's: both patterns are `^…$` and disagree on a mandatory
    // run of bytes at the same position. The FILTERED one demands `[^.]+ Pokémon`
    // after `all of your `, a run that must end in a SPACE; the shipped literal
    // `all of your Pokémon` spends none, and `this Pokémon` does not begin
    // `all of your ` at all. Measured over the whole additive family rather than
    // asserted on two specimens.
    const family = legalAttackCorpus()
      .map(([, s]) => s)
      .filter((s) => /more damage for each (?:.+ )?Energy attached to (?:this Pokémon|all of your)/.test(s));
    expect(family.length).toBeGreaterThan(0);
    for (const sentence of family) {
      const bonus = deriveAttackDamageBonus(sentence);
      if (bonus === null) continue;
      const count = bonus.count;
      expect(count.kind, sentence).toBe("energyOnSelf");
      // Exactly one of the two readings claims each sentence — never both, never
      // neither, and the filter is present iff the sentence names a subgroup.
      const filtered = count.kind === "energyOnSelf" && count.filter !== undefined;
      expect(filtered, sentence).toBe(/all of your [^.]+ Pokémon\.$/.test(sentence));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE MIXED BOARD: EIGHT READINGS, EIGHT NUMBERS
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the fold on a real board, where every wrong reading lands elsewhere", () => {
  it("the correct answer is 3 counters → 10 + 60 = 70", () => {
    expect(dealt(mixed(), IONO)).toBe(70);
  });

  it("🛑 the FILTER-LESS sibling answers 8 on the SAME board — 10 + 160 = 170", () => {
    // The one number that matters most: it is the sentence one word narrower, on the
    // same setup, and it is what a dropped filter would produce.
    expect(dealt(mixed(), BOARD)).toBe(170);
  });

  it("🛑 the ZONE-LESS sibling answers 2 — 10 + 40 = 50", () => {
    expect(dealt(mixed(), SELF)).toBe(50);
  });

  it("the clauseless attack answers the printed base alone — 10", () => {
    // So the 70 above is the CLAUSE and not the board (D469's control).
    expect(dealt(mixed(), PLAIN)).toBe(10);
  });

  it("🛑 the six remaining misreads are SIX DIFFERENT NUMBERS, driven on the counter", () => {
    // `countEnergyInPlay` is where each of these would actually be made, so they are
    // measured through it rather than described. Every value is distinct from the
    // correct 3 AND from every other, which is what makes the suite discriminate
    // instead of merely pass.
    const state = mixed();
    const IONOS = { kind: "ownerPokemon", owner: "Iono" } as const;
    expect(countEnergyInPlay(state, "p1", "Lightning", IONOS)).toBe(3); // correct
    expect(countEnergyInPlay(state, "p1", "Lightning")).toBe(8); // filter dropped
    expect(countEnergyInPlay(state, "p1", null, IONOS)).toBe(4); // type dropped
    expect(countEnergyInPlay(state, "p2", "Lightning", IONOS)).toBe(6); // seat inverted
    expect(countEnergyInPlay(state, "p1", "Lightning", { kind: "anyPokemon" })).toBe(8);
    // `includes` where the arm reads `startsWith` — spelled as the filter that WOULD
    // count the rival body, so the difference is a value and not a story.
    const byName = { kind: "byName", name: "Rival of Iono's Fixiton" } as const;
    expect(countEnergyInPlay(state, "p1", "Lightning", byName)).toBe(2);
    expect(3 + 2).toBe(5); // …so an `includes` reading would answer 5, not 3.
    // the ACTIVE dropped from the holder list: the Bench half of the correct answer.
    const benchOnly = state.players.p1.bench.reduce(
      (total, p) =>
        total + (p.stack.some((u) => state.cardIdByUid[u] === "fix-ionochu") ? p.energy.length : 0),
      0,
    );
    expect(benchOnly).toBe(1);
  });

  it("the DEFENDER's six {L} on an Iono's body contribute NOTHING", () => {
    // The seat control, asserted on the swing rather than on the counter: it is
    // present on every board in this file precisely so that a seat inversion is a
    // wrong NUMBER rather than an unobservable one.
    const state = mixed();
    expect(countEnergyInPlay(state, "p2", "Lightning")).toBe(6);
    expect(dealt(state, IONO)).toBe(70);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE ZERO-MATCH BOARDS: ONE NUMBER, THREE FACTS
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — 0 is not one fact, so three boards reach it three ways", () => {
  it("ROUTE 1 — no body matches, and the board is LOUD with {L}", () => {
    const state = zeroNoBody();
    expect(dealt(state, IONO)).toBe(10);
    // …and on that very board the filter-less sibling adds 140, so the silence is
    // SPECIFIC rather than global (D469's control, at a second address).
    expect(dealt(state, BOARD)).toBe(150);
    expect(dealt(state, SELF)).toBe(50);
    expect(countEnergyInPlay(state, "p1", "Lightning")).toBe(7);
  });

  it("ROUTE 2 — the bodies match and their Energy is the WRONG TYPE", () => {
    const state = zeroWrongEnergy();
    expect(dealt(state, IONO)).toBe(10);
    // The unfiltered sibling answers 3 on this board, so the 0 belongs to the FILTER
    // and not to an empty board — and the {W} on the matching bodies is what makes
    // route 2 a different fact from route 1.
    expect(dealt(state, BOARD)).toBe(70);
    expect(countEnergyInPlay(state, "p1", null, { kind: "ownerPokemon", owner: "Iono" })).toBe(4);
    expect(countEnergyInPlay(state, "p1", "Lightning", { kind: "ownerPokemon", owner: "Iono" })).toBe(
      0,
    );
  });

  it("ROUTE 3 — the board is EMPTY, which is the number's third route", () => {
    const state = zeroEmpty();
    expect(dealt(state, IONO)).toBe(10);
    expect(dealt(state, BOARD)).toBe(10);
    expect(dealt(state, SELF)).toBe(10);
    expect(state.players.p1.bench).toEqual([]);
  });

  it("🛑 the three routes are DISTINGUISHABLE, which is the point of having three", () => {
    // 0-because-nothing-matches, 0-because-the-wrong-resource and 0-because-empty are
    // the same number and not the same fact. The discriminant is what the UNFILTERED
    // sibling says on each board.
    expect([zeroNoBody(), zeroWrongEnergy(), zeroEmpty()].map((s) => dealt(s, IONO))).toEqual([
      10, 10, 10,
    ]);
    expect([zeroNoBody(), zeroWrongEnergy(), zeroEmpty()].map((s) => dealt(s, BOARD))).toEqual([
      150, 70, 10,
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE TOP CARD, NOT THE BOTTOM OF THE STACK
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the filter reads the TOP card (§1.2), and evolving is what proves it", () => {
  it("an Iono's Basic that evolves into a body WITHOUT the prefix stops counting", () => {
    // `benchBodies`' own reading (D466), one resource over. The stack is bottom →
    // top, so pushing `Fixivolt` onto `Iono's Fixichu` is exactly what an evolution
    // does — and a filter reading `stack[0]` would keep counting the {L} underneath.
    const before = mixed();
    expect(dealt(before, IONO)).toBe(70);
    const after = stackOnto(before, "p1", 0, "fix-plainvolt");
    // The Energy has not moved — evolving carries it — so a change here is the
    // FILTER's reading and nothing else.
    expect(after.players.p1.bench[0]?.energy).toEqual(before.players.p1.bench[0]?.energy);
    expect(dealt(after, IONO)).toBe(50);
    // …and the filter-less sibling is UNMOVED at 8, which is what says the drop is
    // the filter's and not the board's.
    expect(dealt(after, BOARD)).toBe(170);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE EMPTY CELLS, MEASURED
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — the cells this slice leaves EMPTY are measurements, not omissions", () => {
  it("🛑 the `×` spelling of this sentence is printed ZERO times", () => {
    // D435: not incrementing is a measurement. `SELF_ENERGY_MULTIPLY` keeps its bare
    // "this Pokémon" tail, and the day a `×` board-wide own-side row is ingested this
    // rung goes red and names it.
    expect(
      legalAttackCorpus().filter(([, s]) =>
        /^This attack does \d+ damage for each (?:.+ )?Energy attached to all of your (?!opponent)(?:[^.]+ )?Pokémon\.$/.test(
          s,
        ),
      ),
    ).toEqual([]);
    expect(deriveAttackDamageMultiplier(OWNER_BOARD_MULTIPLY)).toBeNull();
    expect(deriveAttackDamageBonus(OWNER_BOARD_MULTIPLY)).toBeNull();
  });

  it("🛑 the OPPONENT-side board spelling is printed on the `×` fold ONLY", () => {
    // The measurement the `(?!opponent)` lookahead rests on: four rows, all of them
    // bare-fold, none of them additive. If an additive one is ever ingested this rung
    // names it and the lookahead has to be re-argued rather than silently swallow it.
    const rows = legalAttackCorpus()
      .map(([, s]) => s)
      .filter((s) => s.includes("Energy attached to all of your opponent"));
    expect(rows).toHaveLength(4);
    expect(rows.filter((s) => s.includes("more damage"))).toEqual([]);
  });

  it("the whole of `Energy attached to all of your` is SEVEN rows, and the split is 2/5", () => {
    // A DERIVED list rather than a remembered count (D466), and it is the census's own
    // population for this anchor: two own-side rows (D407's and this slice's) and five
    // opponent-side ones — of which four are the `×` seat spelling above and one is
    // D406's Pokémon TOOL sentence, which counts no Energy at all.
    const rows = legalAttackCorpus()
      .map(([, s]) => s)
      .filter((s) => s.includes("attached to all of your"));
    expect(rows).toHaveLength(7);
    expect(rows).toContain(OWNER_BOARD);
    // Every one of the seven that is READ, read: the two own-side Energy rows plus
    // D406's Tool row. The four `×` opponent rows are `energyOnOpponent`'s and are
    // read too, so this list is the anchor's population and not its residue.
    expect(rows.filter((s) => resolvedByAnyReader(s))).toHaveLength(7);
  });

  it("the `less` spelling of this sentence is printed ZERO times", () => {
    expect(
      legalAttackCorpus().filter(([, s]) =>
        /less damage for each .*Energy attached to all of your/.test(s),
      ),
    ).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — THE SHARED HELPER AND ITS THREE SHIPPED CALLERS
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — `countEnergyInPlay`, widened without moving a caller", () => {
  it("the new parameter is OPTIONAL and the 3-argument call is the old one", () => {
    // D454: a shared helper is the implementation of every op that calls it. The
    // three shipped call sites — `energyOnOpponent`'s board arm, `energyOnSelf`'s,
    // and `yourEnergyInPlayAtLeast` — all pass three arguments, so this equality IS
    // their behaviour.
    const state = mixed();
    expect(countEnergyInPlay(state, "p1", "Lightning", undefined)).toBe(
      countEnergyInPlay(state, "p1", "Lightning"),
    );
    expect(countEnergyInPlay(state, "p1", null, undefined)).toBe(
      countEnergyInPlay(state, "p1", null),
    );
    expect(countEnergyInPlay(state, "p2", "special", undefined)).toBe(
      countEnergyInPlay(state, "p2", "special"),
    );
  });

  it("the filter is asked PER HOLDER and BEFORE the provision question", () => {
    // A body the filter refuses contributes nothing whatever its attachments say, so
    // the untyped read over a filtered board is the sum of the matching bodies alone.
    const state = mixed();
    expect(countEnergyInPlay(state, "p1", null)).toBe(9);
    expect(countEnergyInPlay(state, "p1", null, { kind: "ownerPokemon", owner: "Iono" })).toBe(4);
  });

  it("a MISSING Active is handled inside the walk, filtered as well as not", () => {
    const state = mixed();
    const headless: GameState = {
      ...state,
      players: { ...state.players, p1: { ...state.players.p1, active: null } },
    };
    expect(countEnergyInPlay(headless, "p1", "Lightning")).toBe(6);
    expect(countEnergyInPlay(headless, "p1", "Lightning", { kind: "ownerPokemon", owner: "Iono" })).toBe(
      1,
    );
  });

  it("a filter that matches NOTHING is 0, and an EMPTY board is 0 too", () => {
    expect(
      countEnergyInPlay(mixed(), "p1", "Lightning", { kind: "byName", name: "Nobody" }),
    ).toBe(0);
    expect(
      countEnergyInPlay(zeroEmpty(), "p1", "Lightning", { kind: "ownerPokemon", owner: "Iono" }),
    ).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — THE PERSISTED QUESTION AND THE VERSION
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — `MATCH_RECORD_VERSION` STAYS 29, driven over the bytes", () => {
  it("🛑 DIRECTION 1 — there is NO CARRIER AT ALL", () => {
    // D427: choosing a carrier does not duck persistence, so this is asserted over
    // the SERIALIZED board rather than reasoned from the type's name. An
    // `AttackDamageBonus` is a LOCAL inside `attack()`; the reader runs at
    // declaration and the value is discarded before the function returns. `CardFilter`
    // IS persisted (D446) — on nine `EffectOp` fields — which is exactly why this
    // slice adds no MEMBER to it: `ownerPokemon` has been an inhabitant since D242.
    const before = mixed();
    const after = swing(before, IONO).state;
    for (const [label, state] of [
      ["before", before],
      ["after", after],
    ] as const) {
      const wire = JSON.stringify(state);
      expect(wire, label).not.toContain("energyOnSelf");
      expect(wire, label).not.toContain("ownerPokemon");
    }
    expect(after.pending).toEqual([]);
  });

  it("🛑 DIRECTION 2 — a v29 record round-trips and the NEXT swing reads the same", () => {
    const first = swing(mixed(), IONO);
    expect(find(first.events, "DAMAGE_DEALT")?.dealt).toBe(70);
    const saved = JSON.parse(JSON.stringify(first.state)) as GameState;
    expect(saved).toEqual(first.state);
    // …and the parsed record is a LIVE board: hand the turn back and swing the same
    // clause off the bytes that came out of `JSON.parse`, after one more {L} lands on
    // an Iono's body, so the SAME clause reads a bigger board and says so.
    const returned = mustApply(saved, { type: "endTurn", seat: "p2" }).state;
    const grown = attachBenchFromDeck(returned, "p1", 0, "fix-lightning-energy", 1);
    expect(find(swing(grown, IONO).events, "DAMAGE_DEALT")?.dealt).toBe(10 + 20 * 4);
  });

  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.400.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — THE POOL TAX THIS SLICE DOES NOT PAY
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 — no new `FIXTURE_POOL` id", () => {
  it("the local ids are LOCAL", () => {
    // D452/D465: a `FIXTURE_POOL` id is a census entry with a tax of its own —
    // `opponentResistanceBonus.test.ts`'s pool-size pin and its ladder. A file-local
    // pool takes a 0 term, and that is asserted rather than promised.
    for (const id of Object.keys(LOCAL_CARDS)) expect(FIXTURE_POOL[id], id).toBeUndefined();
    expect(Object.keys(LOCAL_CARDS)).toHaveLength(7);
  });

  it("no POOLED card prints this sentence, so the pool sweeps are unmoved", () => {
    const carriers = Object.keys(FIXTURE_POOL).filter((id) =>
      (FIXTURE_POOL[id]?.attacks ?? []).some((attack) => attack.effect === OWNER_BOARD),
    );
    expect(carriers).toEqual([]);
    // …and the new FIELD has exactly ZERO producers in the pool, which is what keeps
    // `boardWideEnergyScaling.test.ts`'s and `selfEnergyScaling.test.ts`'s producer
    // sweeps byte-identical.
    const produced: string[] = [];
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const [index, attack] of (card.attacks ?? []).entries()) {
        const count = deriveAttackDamageBonus(attack.effect ?? "")?.count;
        if (count?.kind === "energyOnSelf" && count.filter !== undefined) {
          produced.push(`${id}[${index}]`);
        }
      }
    }
    expect(produced).toEqual([]);
  });
});

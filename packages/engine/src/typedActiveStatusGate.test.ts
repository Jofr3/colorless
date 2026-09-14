import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackDiscardScaledBoost,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackRequirement,
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
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

// 0.369.0 → 0.370.0 — 🆕🆕 D472: THE BOARD-CLAUSE GATE OVER THIS FAMILY'S STATUS
// CONSEQUENT.
//
//   "If your opponent's Active Pokémon is a {N} Pokémon, it is now Paralyzed."
//     — `censusAttackCorpus.ts` **FILE LINE 384**, 1 sentence / **2 Standard-legal
//       printings**, the joint-highest printing count in D471's `MULTI-2` shortlist
//       that is not blocked on a schema column or on an owed negative-control home.
//
// THE COST TABLE: **1 whole-sentence anchor (`CLAUSE_GATED_DEFENDER_NOW`) and 1
// reader arm in `deriveAttackEffect`.** ZERO new `EffectOp` members, op fields, op
// values, `BoardCondition` members, `CardFilter` members, clause-table rows, type
// tokens, prompts, events, error codes, registry rows, `packages/schema` bytes,
// `redact.ts` bytes, `GameState` fields or `FIXTURE_POOL` ids. The reader surface
// stands still at 13.
//
// 🛑 **THE PROGRAM IS TWO SHIPPED ARMS' HALVES JOINED, WHICH IS WHY THE COST TABLE
// IS TWO LINES LONG.** The consequent is arm 1's (`DEFENDER_NOW`) byte for byte —
// `applyStatus { target: "defender", status }` — and the gate is arm 6a's
// (`OPPONENT_ACTIVE_BASIC_KO`, D414) byte for byte, `conditionGate { cond, then }`.
// Arm 2 is this same composition with a COIN in place of the board clause.
//
// 🛑 **IT PASSES D468's SCHEMA TEST, WHICH IS WHY IT IS THIS ROW AND NOT THE THREE
// `Tera` ROWS BESIDE IT IN `MULTI-2`.** The residue classifier names a TOKEN, and a
// token may name a COLUMN (buildable) or a BANNER (data-blocked). `{N}` names a
// COLUMN: `POKEMON_TYPE_BY_CODE` has mapped `N` → `Dragon` since D234, `Dragon` is a
// `PokemonType`, and `conditionHolds`'s `opponentActiveHasType` arm reads
// `Card.types` — one of `cardSchema`'s 21 keys, and the same read Weakness and
// Resistance make two lines later. `Tera` names a BANNER that no ingested column
// classifies (D207/D468), so a filter over it would count 0 on every board forever
// while `BUILT.attack` stepped for it — strictly worse than an unbuilt sentence
// (D190b/D199). §3 drives that refusal on a real board rather than asserting it.
//
// ⚠️ **THIS IS THE FIRST PRINTING TO INHABIT THE `{N}` ENTRY OF
// `CLAUSE_POKEMON_TYPES`.** D367's own doc block says `{C}` and `{N}` are carried
// though no printing spells them in a clause; that sentence was true when it was
// written and this row falsifies its `{N}` half. §2 says so as a measurement over
// the whole column rather than as prose.
//
// 🛑 **THE NARROW SUBJECT BUYS ZERO PRINTINGS AND IS STILL LOAD-BEARING, WHICH IS
// THE ONLY REAL DESIGN CALL IN THIS SLICE.** Measured over all 640 corpus rows, a
// bare `^If (.+), it is now (STATUS)\.$` claims exactly the same 1 sentence / 2
// printings. The subject is spelled out because the printed consequent is an
// ANAPHOR: *"it"* has exactly one antecedent — the noun phrase the clause just named
// — and `applyStatus { target: "defender" }` is the right resolution only when that
// noun phrase IS the opponent's Active Pokémon. §4 drives the wide anchor's
// counterexample: *"If you have any {M} Pokémon on your Bench, it is now
// Paralyzed."* would resolve under it and paralyse the DEFENDER off a pronoun
// pointing at the attacker's own Bench. Arm 6a resolves the identical anaphor the
// identical way and spells its subject for the identical reason.
//
// ⚠️ **EVERY REFUSAL IN THIS FILE IS DRIVEN SYNTHETICALLY, AND THAT IS DECLARED
// RATHER THAN DISCOVERED** (D440/D462's standing). Measured over all 640 rows,
// EVERY single-axis loosening of the anchor — and every two-axis pair of them —
// still claims exactly this one row, so the corpus contains no near miss for any of
// them. §4 states the measurement beside the constructed strings.
//
// ⚠️ **DISJOINTNESS IS STRUCTURAL AND D467/D468 REQUIRE SAYING WHICH KIND.** Against
// arm 6a, both anchors are `^…$` and disagree on a MANDATORY run of bytes at the
// same position (`now ` against `Knocked Out.`), so no string can match both; against
// the six older `is now` anchors, they open `^Your opponent` / `^Flip a coin.` or
// demand a `,`, a ` and ` or a `.` immediately after their last status word. **No
// lookahead on either side and correctly none** — a guard here would be unkillable
// by construction, which is D205/D208's vacuous guard. §4 drives the pair as an
// INEQUALITY of derived programs (D449), not as a `toBeNull` on a sentence the
// catalog prints.
//
// ⚠️ **NO NEW `FIXTURE_POOL` ID** — a file-local `cardPool` (D414), so
// `opponentResistanceBonus.test.ts`'s pool-size pin and its eleven-deep ladder take
// a **0** term (D452/D465). §8 asserts that rather than promising it.
//
// ⚠️ **`MATCH_RECORD_VERSION` STAYS 29**, on the SERIALIZED-ALPHABET argument (D462)
// with the REACHABILITY half driven beside it (D452's rule: state both). §7.
//
// SEED-FREE beyond the shuffles setup needs: the sentence carries no coin.

// ─────────────────────────────────────────────────────────────────────────────
// The printed bytes
// ─────────────────────────────────────────────────────────────────────────────

/** The printed sentence, verbatim off `censusAttackCorpus.ts` file line 384. The
    possessive is ASCII U+0027 and the é in `Pokémon` is U+00E9 — asserted on the
    BYTES in §1 rather than eyeballed (D137/D421/D456). */
const GATED = "If your opponent's Active Pokémon is a {N} Pokémon, it is now Paralyzed.";

/** The UNGATED sibling — arm 1's shape, claimed by `DEFENDER_NOW` since 0.x. It is
    the discriminant that runs through every board in §5: wherever the gated sentence
    stays silent, this one lands on the same board with the same op, so a silence is
    the CLAUSE's rather than the op's, the board's or the seat's.

    ⚠️ **THIS EXACT STRING IS CONSTRUCTED, AND THE FIRST DRAFT OF THIS COMMENT SAID
    "printed 21 times" FROM MEMORY (D421/D425: a doc figure rots, including the one
    you are writing).** Measured over all 640 corpus rows, the bare `^Your opponent's
    Active Pokémon is now <STATUS>.$` shape carries **4 sentences / 74 printings** —
    Asleep 15, Burned 14, Confused 31, Poisoned 14 — and `Paralyzed` is **not among
    them**: the pool prints bare-Paralyzed only behind a leading clause. So the SHAPE
    is heavily printed and this SLOT is not, which is exactly the standing D440
    admission and is pinned as a rung in §2 rather than left as prose. */
const BARE = "Your opponent's Active Pokémon is now Paralyzed.";

/** The printed near miss ONE TOKEN over. `Tera` is on 4 corpus rows and is not a
    `Card.types` value, so it reaches `CLAUSE_POKEMON_TYPES`, misses, and the
    sentence stays LOUD. This exact string prints NOWHERE — the corpus's Tera rows
    carry damage consequents — so it is a constructed near miss and is labelled one
    (D440). */
const TERA = "If your opponent's Active Pokémon is a Tera Pokémon, it is now Paralyzed.";

/** Arm 6a's printed sentence, 2 legal printings, shipped since D414. Same subject,
    same anaphor, DIFFERENT consequent — the pair §4 asserts as an inequality of
    derived programs. */
const BASIC_KO = "If your opponent's Active Pokémon is a Basic Pokémon, it is Knocked Out.";

const GATED_FILE_LINE = 384;

/** The thirteen live readers, run as one — the same set `censusAtHead.test.ts` uses.
    Written out so §2's "every OTHER reader still refuses" is a claim about the
    surface rather than about a list somebody remembered. */
const READERS: readonly (readonly [string, (text: string) => unknown])[] = [
  ["deriveAttackBonusConsequent", deriveAttackBonusConsequent],
  ["deriveAttackCancelRequirement", deriveAttackCancelRequirement],
  ["deriveAttackCoinFlip", deriveAttackCoinFlip],
  ["deriveAttackDamageBonus", deriveAttackDamageBonus],
  ["deriveAttackDamageMultiplier", deriveAttackDamageMultiplier],
  ["deriveAttackDamagePenalty", deriveAttackDamagePenalty],
  ["deriveAttackDamageSuppression", deriveAttackDamageSuppression],
  ["deriveAttackDiscardScaledBoost", deriveAttackDiscardScaledBoost],
  ["deriveAttackEffect", deriveAttackEffect],
  ["deriveAttackOptionalBoost", deriveAttackOptionalBoost],
  ["deriveAttackOptionalCostBoost", deriveAttackOptionalCostBoost],
  ["deriveAttackPreDamage", deriveAttackPreDamage],
  ["deriveAttackRequirement", deriveAttackRequirement],
];

/** The program the printed sentence must derive to, spelled once. */
const GATED_PROGRAM = [
  {
    op: "conditionGate",
    cond: { kind: "opponentActiveHasType", type: "Dragon" },
    // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
    then: [{ op: "applyStatus", target: "defender", status: "paralyzed" }],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// The pool — FILE-LOCAL (D414), so `FIXTURE_POOL` is byte-unchanged
// ─────────────────────────────────────────────────────────────────────────────

/** The four sentences this file compares sit on ONE body at fixed indices, so every
    "this clause and not that one" case is a same-fixture, same-board comparison. All
    four cost one {C} and print the same base 10, so a difference in the BOARD is a
    difference in the CLAUSE and in nothing else — and the 10 is what tells "the
    condition was false" from "the attack never ran". */
const SWINGS = [
  { cost: ["Colorless"], name: "Drake Lock", damage: 10, effect: GATED },
  { cost: ["Colorless"], name: "Plain Lock", damage: 10, effect: BARE },
  { cost: ["Colorless"], name: "Bare Swipe", damage: 10 },
  { cost: ["Colorless"], name: "Banner Lock", damage: 10, effect: TERA },
];

/** The attacker that IS a `{N}` Pokémon. The printed clause reads the OPPONENT's
    Active, so this body contributes nothing to a correct answer and everything to a
    seat inversion — which is exactly its job on board B. */
const DRAGON_SWINGER: Card = battler("fix-d472-drakeswing", {
  name: "Fixidraco",
  hp: 200,
  types: ["Dragon"],
  attacks: [...SWINGS],
});

/** The same four attacks on a body that is NOT a `{N}` Pokémon. Two attackers rather
    than one, because the seat axis needs the attacker's own type to vary while every
    other fact on the board holds still. */
const WATER_SWINGER: Card = battler("fix-d472-tideswing", {
  name: "Fixitide",
  hp: 200,
  types: ["Water"],
  attacks: [...SWINGS],
});

/** The DEFENDING body the printed clause is TRUE of. */
const DRAGON_FOE: Card = battler("fix-d472-drakefoe", {
  name: "Fixigon",
  hp: 340,
  types: ["Dragon"],
});

/** The DEFENDING body the printed clause is FALSE of. */
const WATER_FOE: Card = battler("fix-d472-tidefoe", {
  name: "Fixiluga",
  hp: 340,
  types: ["Water"],
});

/** 🛑 **THE DUAL-TYPE DEFENDER, AND `Dragon` IS DELIBERATELY SECOND.** `types` is an
    ARRAY and dual types are a real printing, so `includes` and `types[0] === …` agree
    on every single-typed body and disagree here. Without this fixture the
    "reads only the first type" build answers the same number as the correct one on
    every board in the file. */
const DUAL_FOE: Card = battler("fix-d472-dualfoe", {
  name: "Fixidrake",
  hp: 340,
  types: ["Water", "Dragon"],
});

/** A benched `{N}` body — the fixture that separates the printed ACTIVE SPOT reading
    from the two "in play" members sitting beside it in the same union
    (`opponentInPlayHasType`, `yourBenchHasType`). It is benched on BOTH sides across
    the board family, because those two members read different seats. */
const DRAGON_SITTER: Card = battler("fix-d472-drakesit", {
  name: "Fixibagon",
  hp: 120,
  types: ["Dragon"],
});

/** A benched body of the wrong type — the control that makes a benched Dragon a
    variable rather than a constant. */
const WATER_SITTER: Card = battler("fix-d472-tidesit", {
  name: "Fixidra",
  hp: 120,
  types: ["Water"],
});

const LOCAL_CARDS: Record<string, Card> = {
  "fix-d472-drakeswing": DRAGON_SWINGER,
  "fix-d472-tideswing": WATER_SWINGER,
  "fix-d472-drakefoe": DRAGON_FOE,
  "fix-d472-tidefoe": WATER_FOE,
  "fix-d472-dualfoe": DUAL_FOE,
  "fix-d472-drakesit": DRAGON_SITTER,
  "fix-d472-tidesit": WATER_SITTER,
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  "fix-d472-drakeswing": 4,
  "fix-d472-tideswing": 4,
  "fix-d472-drakefoe": 4,
  "fix-d472-tidefoe": 4,
  "fix-d472-dualfoe": 4,
  "fix-d472-drakesit": 4,
  "fix-d472-tidesit": 4,
  "fix-basic-1": 4,
  "fix-energy": 28,
});

/** Attack indices, named rather than remembered (§1 pins each against the fixture's
    own `attacks` array). */
const DRAKE_LOCK = 0;
const PLAIN_LOCK = 1;
const BARE_SWIPE = 2;
const BANNER_LOCK = 3;

/** One seed for the whole suite. Nothing here flips a coin and every body is placed
    by surgery, so a seed table would describe a shuffle rather than a rule (D143). */
const SEED = 11;

function pick<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function every<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function localSetup(first: Seat): GameState {
  const created = createGame({ seed: SEED, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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

interface Table {
  /** the ATTACKER's Active */
  swinger: string;
  /** the ATTACKER's one benched body, or none */
  ourBench?: string;
  /** the DEFENDER's Active */
  foe: string;
  /** the DEFENDER's one benched body, or none */
  theirBench?: string;
  by?: Seat;
}

/** Builds a table with exactly the four bodies named. The FOE opens and passes, so
    the attacking seat carries no §4 first-turn restriction; BOTH Benches are cleared
    first, because every reading this file separates is a BOARD read and a body the
    setup shuffle happened to seat would move it silently. One {C} pays every cost. */
function table({ swinger, ourBench, foe, theirBench, by = "p1" }: Table): GameState {
  const other: Seat = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(localSetup(by === "p1" ? "p2" : "p1"), { type: "endTurn", seat: other }),
  );
  state = setActiveFromDeck(state, by, swinger);
  state = clearBench(state, by);
  state = setActiveFromDeck(state, other, foe);
  state = clearBench(state, other);
  if (ourBench !== undefined) state = benchFromDeck(state, by, ourBench);
  if (theirBench !== undefined) state = benchFromDeck(state, other, theirBench);
  return attachFromDeck(state, by, "fix-energy", 1);
}

function swing(state: GameState, index: number, by: Seat = "p1") {
  return mustApply(state, { type: "attack", seat: by, index });
}

function conditionsOf(state: GameState, seat: Seat) {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active`);
  return active.conditions;
}

/** 🛑 **THE FIVE-BOARD FAMILY, AND IT IS THIS SLICE'S "ONE BOARD, N READINGS, N
    DIFFERENT NUMBERS".** A status consequent has no amount, so the observable is a
    BOOLEAN per board rather than a number on one board. Five boards, each varying
    ONE fact, give a five-bit signature — a number in 0..31 — and eight plausible
    builds answer eight DIFFERENT numbers on it.

      #   attacker      our bench     defender's Active     their bench
      A   Water         Water         **Dragon**            Water
      B   **Dragon**    Water         Water                 Water
      C   Water         **Dragon**    Water                 Water
      D   Water         Water         Water                 **Dragon**
      E   Water         Water         **[Water, Dragon]**    Water

    Reading the bits A..E as MSB..LSB, "the defender's Active ends Paralyzed":

      • CORRECT — the defender's Active `types` includes Dragon   1,0,0,0,1 → **17**
      • the GATE DROPPED (arm 1's bare program)                   1,1,1,1,1 → **31**
      • the SEAT INVERTED (the attacker's own Active)             0,1,0,0,0 → **8**
      • `opponentInPlayHasType` (their whole board)               1,0,0,1,1 → **19**
      • `yourBenchHasType` (our Bench)                            0,0,1,0,0 → **4**
      • `types[0]` instead of `types.includes`                    1,0,0,0,0 → **16**
      • the TYPE CONSTANT wrong (`Colorless`, D234's neighbour)   0,0,0,0,0 → **0**
      • the CONDITION INVERTED                                    0,1,1,1,0 → **14**

    Eight readings, eight distinct values, on one family — which is why board E's
    defender is dual-typed with `Dragon` SECOND and why a Dragon sits on each Bench
    in turn. ⚠️ **The ninth axis needs a second signature**: `target: "self"` leaves
    the defender at 0 and moves the ATTACKER's signature to 17, so §6 reports the
    PAIR and the wrong-constant build (0, 0) cannot impersonate it.

    🛑 **THE SEVEN WRONG VALUES ARE MEASURED, NOT ARITHMETIC IN A COMMENT** (D439: a
    surviving mutant is a claim about your prose as often as about your tests). Each
    was evaluated over these five REAL boards by handing the corresponding member to
    the exported `conditionHolds` — `opponentActiveHasType` from the other seat for
    the inversion, the two live `…InPlayHasType` / `yourBenchHasType` siblings
    verbatim, `Colorless` for D234's neighbouring map row, the negation for the
    inverted gate — and by reading `types[0]` off the defender's top card. All seven
    came back exactly as tabulated. Four of them are ALSO driven from inside this
    file as real programs: 17 (§6), 31 (the ungated sibling), and 0 twice (the
    data-blocked banner and the clauseless attack). */
const BOARDS: readonly (readonly [string, Table])[] = [
  ["A — their Active is the Dragon", { swinger: "fix-d472-tideswing", ourBench: "fix-d472-tidesit", foe: "fix-d472-drakefoe", theirBench: "fix-d472-tidesit" }],
  ["B — OUR Active is the Dragon", { swinger: "fix-d472-drakeswing", ourBench: "fix-d472-tidesit", foe: "fix-d472-tidefoe", theirBench: "fix-d472-tidesit" }],
  ["C — OUR Bench holds the Dragon", { swinger: "fix-d472-tideswing", ourBench: "fix-d472-drakesit", foe: "fix-d472-tidefoe", theirBench: "fix-d472-tidesit" }],
  ["D — THEIR Bench holds the Dragon", { swinger: "fix-d472-tideswing", ourBench: "fix-d472-tidesit", foe: "fix-d472-tidefoe", theirBench: "fix-d472-drakesit" }],
  ["E — their Active is dual, Dragon SECOND", { swinger: "fix-d472-tideswing", ourBench: "fix-d472-tidesit", foe: "fix-d472-dualfoe", theirBench: "fix-d472-tidesit" }],
];

/** The five-bit signature of "seat's Active ends Paralyzed", A..E as MSB..LSB. */
function signature(seat: "defender" | "attacker", index: number, by: Seat = "p1"): number {
  const other: Seat = by === "p1" ? "p2" : "p1";
  let bits = 0;
  for (const [, spec] of BOARDS) {
    const { state } = swing(table({ ...spec, by }), index, by);
    const read = conditionsOf(state, seat === "defender" ? other : by);
    bits = bits * 2 + (read.rotation === "paralyzed" ? 1 : 0);
  }
  return bits;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE PRINTED BYTES AND THE CORPUS ROW
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the sentence, its corpus row, and the fixtures that print it", () => {
  it("is corpus FILE LINE 384, ONE sentence and TWO Standard-legal printings", () => {
    const corpus = legalAttackCorpus();
    const row = corpus.find(([, s]) => s === GATED);
    expect(row).toBeDefined();
    expect(row?.[0]).toBe(2);
    expect(corpus.indexOf(row as (typeof corpus)[number]) + 53).toBe(GATED_FILE_LINE);
  });

  it("the BYTES are the printed ones — U+0027 and U+00E9, measured not eyeballed", () => {
    // D421's rule: an apostrophe asserted from memory is the cheapest defect there
    // is to inject. `codePointAt`, never a look.
    expect(GATED.codePointAt(GATED.indexOf("'"))).toBe(0x27);
    expect(GATED.includes("’")).toBe(false);
    expect(GATED.codePointAt(GATED.indexOf("Pok") + 3)).toBe(0xe9);
  });

  it("the corpus totals STAND STILL — this slice adds no catalog row", () => {
    // Every figure §2 measures is a fraction of these two, so a corpus that moved
    // would make a reader step look like a transcription change.
    const corpus = legalAttackCorpus();
    expect(corpus.length).toBe(640);
    expect(corpus.reduce((sum, [units]) => sum + units, 0)).toBe(1732);
  });

  it("the local fixtures carry the four sentences at the indices this file names", () => {
    for (const card of [DRAGON_SWINGER, WATER_SWINGER]) {
      expect(card.attacks?.[DRAKE_LOCK]?.effect).toBe(GATED);
      expect(card.attacks?.[PLAIN_LOCK]?.effect).toBe(BARE);
      expect(card.attacks?.[BARE_SWIPE]?.effect).toBeUndefined();
      expect(card.attacks?.[BANNER_LOCK]?.effect).toBe(TERA);
    }
    // The types are the whole subject of this file, so they are pinned rather than
    // trusted to `battler`'s default (which is `["Colorless"]` for an invented id).
    expect(DRAGON_SWINGER.types).toEqual(["Dragon"]);
    expect(WATER_SWINGER.types).toEqual(["Water"]);
    expect(DRAGON_FOE.types).toEqual(["Dragon"]);
    expect(WATER_FOE.types).toEqual(["Water"]);
    expect(DUAL_FOE.types).toEqual(["Water", "Dragon"]);
    expect(DRAGON_SITTER.types).toEqual(["Dragon"]);
    expect(WATER_SITTER.types).toEqual(["Water"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE READER: WHO OWNS IT, WHO STILL REFUSES IT, AND WHAT THE VOCABULARY IS
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the reader, named rather than counted", () => {
  it("🛑 `deriveAttackEffect` owns it, BY VALUE and not by non-nullity", () => {
    // D469's convention: a census measures whether a sentence is CLAIMED, never
    // whether it is claimed correctly, so the rung has to spell the program.
    expect(deriveAttackEffect(GATED)).toEqual(GATED_PROGRAM);
  });

  it("🛑 …and the other TWELVE readers still refuse it", () => {
    // D438: re-pointing a thirteen-way `resolvedByAnyReader === false` onto a
    // boolean `=== true` discards all thirteen refusals at once, because the new
    // claim is satisfied by a mistaken widening and by the real build alike — the
    // exact move that disarmed D368's tripwire and produced this run's only GAP.
    // Naming the owner AND keeping the twelve is strictly stronger than either.
    for (const [name, read] of READERS) {
      if (read === deriveAttackEffect) continue;
      expect(read(GATED), name).toBeNull();
    }
    expect(resolvedByAnyReader(GATED)).toBe(true);
    // …and no splitter is involved: this is the RAW summand alone.
    expect(splitAttackGateClause(GATED)).toBeNull();
    expect(splitAttackTrailingClause(GATED)).toBeNull();
  });

  it("🛑 `{N}` was a LIVE map entry with NO printing, and this row is its first", () => {
    // D367's block says `{C}` and `{N}` are carried in `CLAUSE_POKEMON_TYPES` though
    // no printing spells them in a clause. That was true when written. Measured here
    // over the whole column rather than asserted: `{N}` appears in exactly two corpus
    // sentences, and only ONE of them is a clause — this one.
    const braceN = legalAttackCorpus().filter(([, s]) => s.includes("{N}"));
    expect(braceN).toHaveLength(2);
    expect(braceN.some(([, s]) => s === GATED)).toBe(true);
    const clauses = legalAttackCorpus().filter(([, s]) =>
      /Active Pokémon is a \{N\} Pokémon/.test(s),
    );
    expect(clauses.map(([, s]) => s)).toEqual([GATED]);
    // BOTH NOTATIONS reach the same member, which is what makes the map and not the
    // regex the vocabulary (D367). A brace code is a card-face glyph and the prose
    // name is what a person reads (D118); they must not disagree about the VALUE.
    expect(deriveAttackEffect(GATED.replace("{N}", "Dragon"))).toEqual(GATED_PROGRAM);
  });

  it("the open slots admit what the family's vocabulary admits, and nothing else", () => {
    // D462's warrant for a template over a literal: `STATUS_WORDS` is this family's
    // own vocabulary at a fifth position and `CLAUSE_POKEMON_TYPES` is the clause
    // family's, so neither slot is a NEW parameter (D121 prices those). Driven on
    // constructed strings, LABELLED as constructed (D440).
    expect(deriveAttackEffect("If your opponent's Active Pokémon is a {P} Pokémon, it is now Burned.")).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveHasType", type: "Psychic" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "applyStatus", target: "defender", status: "burned" }],
      },
    ]);
    // …and the clause slot reaches the LITERAL table too, not only the type
    // patterns, because it is `boardConditionForClause` and not a private lookup.
    expect(deriveAttackEffect("If your opponent's Active Pokémon is a Stage 1 Pokémon, it is now Asleep.")).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveIsStage1" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "applyStatus", target: "defender", status: "asleep" }],
      },
    ]);
  });

  it("🛑 the UNGATED sibling's SHAPE is printed 74 times and its `Paralyzed` slot ZERO", () => {
    // The control that runs through every board in §5 is a CONSTRUCTED string, and
    // this is the measurement that says so rather than a comment claiming it (D440:
    // a rung over unprinted text is a claim about the READER, not about the pool —
    // declaring it is what stops it reading as an accident). It also pins the figure
    // that the first draft of `BARE`'s doc block got wrong from memory.
    const bareShape = legalAttackCorpus().filter(([, s]) =>
      /^Your opponent's Active Pokémon is now (Asleep|Burned|Confused|Paralyzed|Poisoned)\.$/.test(
        s,
      ),
    );
    expect(bareShape.map(([units, s]) => [units, s.replace(/^.*is now /, "")])).toEqual([
      [15, "Asleep."],
      [14, "Burned."],
      [31, "Confused."],
      [14, "Poisoned."],
    ]);
    expect(bareShape.reduce((sum, [units]) => sum + units, 0)).toBe(74);
    expect(bareShape.some(([, s]) => s === BARE)).toBe(false);
    // …and the reader takes it anyway, which is what makes it usable as a control.
    expect(deriveAttackEffect(BARE)).toEqual([
      { op: "applyStatus", target: "defender", status: "paralyzed" },
    ]);
  });

  it("the U+2019 re-ingest derives the SAME program, not merely a non-null one", () => {
    // D137's contract: the two spellings must produce the same VALUE. The anchor
    // carries `['’]` and `boardConditionForClause` folds for its literal table, so
    // there are two mechanisms behind this and both are exercised by one string.
    expect(deriveAttackEffect(GATED.replace("'", "’"))).toEqual(GATED_PROGRAM);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE BANNER STAYS LOUD, ON A BOARD
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — `Tera` is refused AT THE MAP, and the refusal is loud on a real board", () => {
  it("🛑 the derived value is null, and the type slot is what refuses it", () => {
    // The capture is `.+` on purpose: the MAP is the vocabulary, not the regex. A
    // `(Grass|Fire|…)` alternation would refuse this at the anchor — the same answer
    // today, and a hand-kept list that rots the day a type is added to the schema.
    expect(deriveAttackEffect(TERA)).toBeNull();
    // ONE AXIS (D427/D399): the two strings differ in the type token and in nothing
    // else, so the refusal is attributable.
    expect(TERA.replace("Tera", "{N}")).toBe(GATED);
  });

  it("🛑 …and on a board it reaches ATTACK_EFFECT_SKIPPED with the whole sentence", () => {
    // D468's rule with the direction that matters: a data-blocked filter must fail
    // LOUDLY rather than count 0 forever. This drives the whole path — the attack
    // resolves, the damage lands, and the engine announces it did not simulate the
    // sentence.
    const { state, events } = swing(
      table({ swinger: "fix-d472-tideswing", foe: "fix-d472-drakefoe" }),
      BANNER_LOCK,
    );
    expect(pick(events, "ATTACK_EFFECT_SKIPPED")?.effect).toBe(TERA);
    expect(every(events, "STATUS_APPLIED")).toEqual([]);
    expect(conditionsOf(state, "p2").rotation).toBe("none");
    expect(pick(events, "DAMAGE_DEALT")?.dealt).toBe(10);
  });

  it("…and the SAME board under the built clause paralyses, which is the control", () => {
    // Without this the rung above passes on a build that stopped applying statuses
    // altogether (D214's attribution control, at a refusal).
    const { state, events } = swing(
      table({ swinger: "fix-d472-tideswing", foe: "fix-d472-drakefoe" }),
      DRAKE_LOCK,
    );
    expect(pick(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    expect(conditionsOf(state, "p2").rotation).toBe("paralyzed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE ANCHOR'S EDGES, EVERY ONE OF THEM ONE AXIS WIDE
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the anchor's edges, driven synthetically because no near miss prints", () => {
  it("🛑 NO single-axis loosening of this anchor claims anything else in the column", () => {
    // D462/D464's procedure: run the loosening you are about to claim, over the
    // POPULATION, and keep the result as a RUNG rather than as prose. Each pattern
    // below is the shipped anchor with exactly one feature removed.
    const S = "Asleep|Burned|Confused|Paralyzed|Poisoned";
    const LOOSENINGS: readonly (readonly [string, RegExp])[] = [
      ["^ dropped", new RegExp(`If your opponent['’]s Active Pokémon is a (.+) Pokémon, it is now (${S})\\.$`)],
      ["\\.$ dropped", new RegExp(`^If your opponent['’]s Active Pokémon is a (.+) Pokémon, it is now (${S})\\.`)],
      ["status slot widened", /^If your opponent['’]s Active Pokémon is a (.+) Pokémon, it is now (.+)\.$/],
      ["subject widened", new RegExp(`^If (.+), it is now (${S})\\.$`)],
      ["noun tail dropped", new RegExp(`^If your opponent['’]s Active Pokémon is a (.+), it is now (${S})\\.$`)],
      ["apostrophe class narrowed", new RegExp(`^If your opponent's Active Pokémon is a (.+) Pokémon, it is now (${S})\\.$`)],
      ["BOTH ends widened", /^If (.+), it is now (.+)\.$/],
    ];
    for (const [label, pattern] of LOOSENINGS) {
      const hit = legalAttackCorpus().filter(([, s]) => pattern.test(s));
      expect(hit.map(([, s]) => s), label).toEqual([GATED]);
      expect(hit.reduce((sum, [units]) => sum + units, 0), label).toBe(2);
    }
  });

  it("🛑 the SUBJECT is load-bearing for the ANAPHOR, not for the catalog", () => {
    // The measurement above says the narrowing buys zero printings. This says what
    // it buys instead: under the wide anchor, a real `BoardCondition` about the
    // ATTACKER's own Bench would resolve and the pronoun would land on the DEFENDER
    // — a wrong-but-plausible program, strictly worse than an unbuilt one.
    const WIDE_SUBJECT = "If you have any {M} Pokémon on your Bench, it is now Paralyzed.";
    expect(deriveAttackEffect(WIDE_SUBJECT)).toBeNull();
    // …and the clause inside it is genuinely READABLE, which is what makes this a
    // refusal rather than a vacuous assertion about an unknown string (D424's rule:
    // an "X is refused" rung owes a "Y is admitted" on the same axis).
    expect(
      deriveAttackDamageBonus("If you have any {M} Pokémon on your Bench, this attack does 80 more damage."),
    ).toEqual({
      per: 80,
      count: { kind: "boardCondition", cond: { kind: "yourBenchHasType", type: "Metal" } },
    });
  });

  it("🛑 arm 6a's sentence and this one are STRUCTURALLY disjoint — an inequality, not a null", () => {
    // D449: a `toBeNull` on a sentence the catalog PRINTS goes red the day somebody
    // builds it, and what these rungs are really about is DISJOINTNESS. Both derive;
    // they derive to different programs; and neither anchor can claim the other's
    // string, because both are `^…$` and disagree on a mandatory run of bytes at the
    // same position.
    expect(deriveAttackEffect(BASIC_KO)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveIsBasic" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "knockOutDefender" }],
      },
    ]);
    expect(deriveAttackEffect(BASIC_KO)).not.toEqual(deriveAttackEffect(GATED));
    // The byte that does it: `it is ` followed by `now ` here and by `Knocked` there.
    expect(GATED.includes(", it is now ")).toBe(true);
    expect(BASIC_KO.includes(", it is now ")).toBe(false);
    // ⚠️ And `Basic` is NOT a `CONDITIONAL_DAMAGE_CLAUSES` row, so this anchor
    // refuses arm 6a's clause under a STATUS consequent. No card prints that
    // sentence; the refusal is recorded rather than discovered.
    expect(
      deriveAttackEffect("If your opponent's Active Pokémon is a Basic Pokémon, it is now Paralyzed."),
    ).toBeNull();
  });

  it("the `^` end fails LOUD and the `$` end fails through the SPLITTER (D464)", () => {
    // Leading text: nothing claims the head, so the whole string stays unread.
    expect(
      deriveAttackEffect(`This attack does 30 damage. ${GATED}`),
    ).toBeNull();
    // Trailing text: `deriveAttackEffect` still refuses the compound and
    // `resolvedByAnyReader` is still false on it — but D409's trailing splitter now
    // composes this newly-claimable head with a claimed tail. That is a path which
    // is neither this anchor nor this arm, and a `toBeNull` cannot express it.
    const compound = `${GATED} Draw a card.`;
    expect(deriveAttackEffect(compound)).toBeNull();
    expect(splitAttackTrailingClause(compound)).toEqual({ head: GATED, tail: "Draw a card." });
    // …and NO such compound prints, so nothing is authored by that path.
    const carriers = legalAttackCorpus().filter(([, s]) => s.includes(GATED) && s !== GATED);
    expect(carriers).toEqual([]);
  });

  it("the case, the pronoun and the STATUS SLOT are load-bearing, one axis each", () => {
    expect(deriveAttackEffect(GATED.replace("If", "if"))).toBeNull();
    expect(deriveAttackEffect(GATED.replace(", it is now ", ", it is "))).toBeNull();
    // The status slot is `(Asleep|Burned|Confused|Paralyzed|Poisoned)` and not `(.+)`.
    // Widened, this string would match and `statusOf` would hand the op an
    // `undefined` status — a program shaped exactly like a working one. The corpus
    // cannot show it (the loosening claims the same one row), so it is constructed.
    expect(deriveAttackEffect(GATED.replace("Paralyzed", "Knocked Out"))).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE GATE ON A REAL BOARD: IT FIRES, AND THE THREE ROUTES TO SILENCE
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the condition on a real board, and three routes to silence", () => {
  it("🛑 it FIRES — asserted on the FIELDS, with the event row beside it", () => {
    // Asserted on the whole `SpecialConditions` record and not on a status list: a
    // list assertion cannot tell "rotation is paralyzed" from a board that renders
    // the same way (D424's rule, one arity down).
    const { state, events } = swing(
      table({ swinger: "fix-d472-tideswing", foe: "fix-d472-drakefoe" }),
      DRAKE_LOCK,
    );
    expect(conditionsOf(state, "p2")).toEqual({
      rotation: "paralyzed",
      poisonDamage: 0,
      burned: false,
      confusionDamage: 30,
    });
    expect(every(events, "STATUS_APPLIED").map((e) => e.status)).toEqual(["paralyzed"]);
    // …and the ATTACKER is untouched, which is the `target: "self"` control.
    expect(conditionsOf(state, "p1").rotation).toBe("none");
  });

  it("🛑 BOTH SEATS — the same sentence read from p2 lands on p1's Active", () => {
    // D213's rule, re-earned by D412: the server-side twin passing proves nothing
    // about the other seat. `conditionHolds` resolves `otherSeat(seat)` from the
    // ATTACKING seat, so a hard-coded `p2` passes every line above and fails here.
    const { state } = swing(
      table({ swinger: "fix-d472-tideswing", foe: "fix-d472-drakefoe", by: "p2" }),
      DRAKE_LOCK,
      "p2",
    );
    expect(conditionsOf(state, "p1").rotation).toBe("paralyzed");
    expect(conditionsOf(state, "p2").rotation).toBe("none");
  });

  it("🛑 ZERO-MATCH ROUTE 1 — their Active is the wrong type while OUR Active is right", () => {
    // 0-because-the-clause-is-false must be told from 0-because-something-broke, so
    // each route below carries the same three controls: the DAMAGE still lands (the
    // attack ran), `ATTACK_EFFECT_SKIPPED` does NOT fire (the sentence was READ, not
    // refused), and the ungated sibling paralyses on the very same board (the
    // silence is the CLAUSE's, not the op's or the board's).
    const board = table({ swinger: "fix-d472-drakeswing", foe: "fix-d472-tidefoe" });
    const { state, events } = swing(board, DRAKE_LOCK);
    expect(conditionsOf(state, "p2").rotation).toBe("none");
    expect(every(events, "STATUS_APPLIED")).toEqual([]);
    expect(pick(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    expect(pick(events, "DAMAGE_DEALT")?.dealt).toBe(10);
    expect(conditionsOf(swing(board, PLAIN_LOCK).state, "p2").rotation).toBe("paralyzed");
  });

  it("🛑 ZERO-MATCH ROUTE 2 — the Dragon is on THEIR Bench, not in their Active Spot", () => {
    // The printed clause names the ACTIVE SPOT. `opponentInPlayHasType` is a real
    // sibling member one lookup away in the same function, and this is the board
    // that tells the two apart.
    const board = table({
      swinger: "fix-d472-tideswing",
      foe: "fix-d472-tidefoe",
      theirBench: "fix-d472-drakesit",
    });
    const { state, events } = swing(board, DRAKE_LOCK);
    expect(conditionsOf(state, "p2").rotation).toBe("none");
    expect(pick(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    expect(pick(events, "DAMAGE_DEALT")?.dealt).toBe(10);
    expect(conditionsOf(swing(board, PLAIN_LOCK).state, "p2").rotation).toBe("paralyzed");
  });

  it("🛑 ZERO-MATCH ROUTE 3 — the Dragon is on OUR Bench, which is a different member", () => {
    // `yourBenchHasType` is the third live member reading the same map, and it reads
    // the other seat's Bench. Same number, third fact.
    const board = table({
      swinger: "fix-d472-tideswing",
      ourBench: "fix-d472-drakesit",
      foe: "fix-d472-tidefoe",
    });
    const { state, events } = swing(board, DRAKE_LOCK);
    expect(conditionsOf(state, "p2").rotation).toBe("none");
    expect(pick(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    expect(pick(events, "DAMAGE_DEALT")?.dealt).toBe(10);
    expect(conditionsOf(swing(board, PLAIN_LOCK).state, "p2").rotation).toBe("paralyzed");
  });

  it("🛑 the DUAL-TYPED defender is Paralyzed though `Dragon` is its SECOND type", () => {
    // `types` is an array. `types[0] === "Dragon"` agrees with `includes` on every
    // other board in this file and disagrees here.
    const { state } = swing(
      table({ swinger: "fix-d472-tideswing", foe: "fix-d472-dualfoe" }),
      DRAKE_LOCK,
    );
    expect(conditionsOf(state, "p2").rotation).toBe("paralyzed");
  });

  it("the gate emits NO event of its own — the condition is public", () => {
    // `conditionGate` is spliced by `runProgram`'s queue loop and files nothing,
    // deliberately: unlike a coin flip it tells the opponent nothing they cannot
    // already see. Asserted so a successor adding a row has to decide to.
    const { events } = swing(
      table({ swinger: "fix-d472-tideswing", foe: "fix-d472-tidefoe" }),
      DRAKE_LOCK,
    );
    expect(events.map((e) => e.type)).not.toContain("EFFECT_PENDING");
    expect(every(events, "STATUS_APPLIED")).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE SIGNATURE: EIGHT READINGS, EIGHT DIFFERENT NUMBERS
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — one board family, eight readings, eight different numbers", () => {
  it("🛑 the DEFENDER signature is 17 and the ATTACKER signature is 0", () => {
    // See `BOARDS`'s block for the full table. The value 17 is 1,0,0,0,1 over boards
    // A..E, and no other reading in that table produces it; the second figure is what
    // separates `target: "self"` (0, 17) from the wrong type constant (0, 0).
    expect([signature("defender", DRAKE_LOCK), signature("attacker", DRAKE_LOCK)]).toEqual([17, 0]);
  });

  it("the UNGATED sibling answers 31 on the same family, which prices the gate", () => {
    // 31 is what "the gate dropped" would answer, and it is here as a real program
    // rather than as arithmetic in a comment: the difference between 17 and 31 IS the
    // clause, measured on the same five boards with the same op.
    expect(signature("defender", PLAIN_LOCK)).toBe(31);
  });

  it("the DATA-BLOCKED banner answers 0, and the clauseless attack answers 0", () => {
    // Two more real programs on the same family: a sentence the reader refuses (loud,
    // 0) and an attack with no sentence at all (0). Together with 17 and 31 they say
    // the signature is measuring the CLAUSE and not the harness.
    expect(signature("defender", BANNER_LOCK)).toBe(0);
    expect(signature("defender", BARE_SWIPE)).toBe(0);
  });

  it("the same family read from p2 gives the same two numbers", () => {
    expect([
      signature("defender", DRAKE_LOCK, "p2"),
      signature("attacker", DRAKE_LOCK, "p2"),
    ]).toEqual([17, 0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — `MATCH_RECORD_VERSION` STAYS 29, ARGUED AND THEN DRIVEN
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — the persisted bytes, and why 29 does not move", () => {
  it("🛑 SERIALIZED ALPHABET — no new op, op FIELD or op VALUE (D462)", () => {
    // The op kinds and every field value in this program already ship: `conditionGate`
    // since D40, `applyStatus { target: "defender", status: "paralyzed" }` since 0.x
    // (arm 1, 4 sentences / 74 printings, measured in §2). The `cond` is a
    // `BoardCondition` member shipped at D120, and `conditionGate.cond` has accepted
    // ANY `boardConditionForClause` result since D399's arm 6c-bis — so this is a new
    // INHABITANT of an existing union rather than a new member, which is precisely the
    // case the version constant does NOT move for. There is no byte a v29 record can
    // hold after this slice that it could not hold before it.
    const program = deriveAttackEffect(GATED);
    expect(JSON.stringify(program)).toBe(
      JSON.stringify([
        {
          op: "conditionGate",
          cond: { kind: "opponentActiveHasType", type: "Dragon" },
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
          then: [{ op: "applyStatus", target: "defender", status: "paralyzed" }],
        },
      ]),
    );
  });

  it("🛑 REACHABILITY — the program is LENGTH ONE and the gate never becomes a `pendingOp`", () => {
    // D452's rule: state BOTH halves. An `EffectOp` reaches storage only through
    // `phase.cont`'s `pendingOp` and its `rest`, written only on a park (D450). This
    // program has ONE op, so there is no earlier op at all (D465's first-position
    // form); that op is a GATE, spliced by `runProgram`'s queue loop and never
    // stepped; and the branch it splices is one `applyStatus`, which does not park.
    expect(deriveAttackEffect(GATED)).toHaveLength(1);
    // …DRIVEN on both a board where it FIRES and one where it WHIFFS, because a whiff
    // is not a park and the two are easy to confuse in a `stepOp` arm (D465).
    for (const foe of ["fix-d472-drakefoe", "fix-d472-tidefoe"]) {
      const { state } = swing(table({ swinger: "fix-d472-tideswing", foe }), DRAKE_LOCK);
      expect(state.phase.kind).not.toBe("effect:choose");
      expect(JSON.stringify(state)).not.toContain("conditionGate");
      expect(JSON.stringify(state)).not.toContain("opponentActiveHasType");
    }
  });

  it("a record round-trips and the parsed bytes are a LIVE board", () => {
    const first = swing(table({ swinger: "fix-d472-tideswing", foe: "fix-d472-drakefoe" }), DRAKE_LOCK);
    const saved = JSON.parse(JSON.stringify(first.state)) as GameState;
    expect(saved).toEqual(first.state);
    expect(conditionsOf(saved, "p2").rotation).toBe("paralyzed");
  });

  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.400.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — THE TAXES THIS SLICE DOES NOT PAY
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — no new `FIXTURE_POOL` id and no new vocabulary", () => {
  it("the local ids are LOCAL", () => {
    // D452/D465: a `FIXTURE_POOL` id is a census entry with a tax of its own —
    // `opponentResistanceBonus.test.ts`'s pool-size pin and its eleven-deep ladder.
    // A file-local pool takes a 0 term, and that is asserted rather than promised.
    for (const id of Object.keys(LOCAL_CARDS)) expect(FIXTURE_POOL[id], id).toBeUndefined();
    expect(Object.keys(LOCAL_CARDS)).toHaveLength(7);
  });

  it("no POOLED card prints any of this file's four sentences", () => {
    const carriers: string[] = [];
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const [index, attack] of (card.attacks ?? []).entries()) {
        if ([GATED, TERA].includes(attack.effect ?? "")) carriers.push(`${id}[${index}]`);
      }
    }
    expect(carriers).toEqual([]);
  });

  it("🛑 the local fixtures carry NO possessive and NO evolution stage", () => {
    // D440: an owner-prefixed fixture is a census subject even when it is not a
    // Pokémon, and it reddens the D242 prefixed-NAME enumeration in three suites.
    // D461: a synthetic Stage 1 must carry a non-null `evolveFrom` or it turns
    // `stage1Bonus`'s chainless rung into an artefact. Neither hazard is taken here,
    // and that is checked rather than remembered.
    for (const card of Object.values(LOCAL_CARDS)) {
      expect(card.name.includes("'"), card.id).toBe(false);
      expect(card.name.includes("’"), card.id).toBe(false);
      expect(card.stage, card.id).toBe("Basic");
      expect(card.evolveFrom, card.id).toBeNull();
    }
  });
});

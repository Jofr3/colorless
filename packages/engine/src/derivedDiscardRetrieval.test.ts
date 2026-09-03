import { describe, expect, it } from "vitest";
import { matchesFilter } from "./cards";
import { deriveAttackEffect } from "./effects";
import type { CardFilter, EffectOp, GameEvent, GameState } from "./index";
import { logFromEvents } from "./log";
import {
  DERIVED_RETRIEVAL_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  discardFromDeck,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.153.0 → 0.154.0 — D238, THE PRINTED **BRACE CODE**: the last blocker on
// backlog row 13, and the only one on the page that was ONE MECHANISM SERVING
// THREE ANCHORS (this family, `derivedHandSearch` and `derivedBenchSearch`).
// D237 read 10 of this row's 16 legal printings and pinned 4 more on the brace
// code; this slice takes those 4 and leaves 2.
//
// ✅ THE COUNT, RE-DERIVED A SECOND TIME BY A SECOND SLICE and unchanged — the
// FIFTH row running. The brace sweep's own figures (remote D1 `luminous`, 3,786
// rows / 20 sets, 2,021 legal, 2026-08-06, `json_each` + `GLOB`, grouped BY
// SENTENCE, all three text columns):
//
//   WHERE t GLOB '*{[GRWLPFDMYNC]} Pok*'
//   -- attack 32 / 16 · ability 28 / 12 · effect 25 / 15
//
// 🛑 AND **6 OF THOSE 32 ARE CARD PREDICATES** — the rest are BOARD targets and
// damage scalers that `targetType` and three other readers own. The ceiling is
// not the yield, and the resume point that said so is confirmed rather than
// assumed. Full arithmetic on the constants in effects.ts.
//
// 🛑 THE PREDICTION, GRADED — **PART WRONG, FOURTH SLICE RUNNING.** It read:
// *"ONE `CardFilter` member and ONE capture group per anchor (three anchors), NO
// third table column, and all 8 legal printings plus the 1 rotated one."*
//   • ✅ ONE `CardFilter` member — correct, and the Energy half needed NONE
//     (`basicEnergy.energyType` has existed since Chien-Pao; only the anchor was
//     ever in the way, which the prediction did not say).
//   • ✅ NO third table column — correct, and for the reason the prediction named
//     as its own risk: the caption contract genuinely cannot hold for a brace
//     code, so the answer is a SECOND, DISJOINT resolution path.
//   • 🛑 "ONE capture group per anchor" LOSES, and by a factor of three. This
//     anchor gained ZERO groups (its noun ALTERNATION widened); `derivedHandSearch`
//     gained ZERO (its `[^,.]+?` capture already admitted a brace phrase and the
//     TABLE's silence was the whole refusal); only `derivedBenchSearch` gained one.
//   • 🛑 "the 1 rotated one" LOSES: there are **FOUR** rotated printings, three of
//     them on THIS anchor, and two of those sentences were named by no page in
//     this repo. A residue table is a census of what its slice measured.
//
// ✅ THE COUNT. Re-measured against the remote D1 `luminous` on 2026-08-06 —
// `json_each` + `GLOB` (never `LIKE`), grouped BY SENTENCE, over ALL THREE text
// columns, `legal_standard = 1`:
//
//   WHERE t GLOB '*[Pp]ut*from your discard pile*'
//   -- attack 16 printings / 8 sentences · ability 4 / 2 · effect 8 / 5
//
// The row says **16 (8 sentences) · 4 · 3**: the attack half exact on BOTH
// figures, the ability half raw, and the Trainer half the 8 above minus the 5
// already authored. **23 = 23.**
//
// 🛑 AND ITS *PREDICTION* WAS GRADED **PART WRONG**, WHICH IS THE THIRD TIME AND
// THE REASON ONE IS WRITTEN DOWN EVERY SLICE. The resume point predicted, in
// writing, that "printed grammar is a property of the ZONE", so this row's
// residue should look like row 9's: **≥ 12 of the 16 read, and every blocker a
// NOUN the table cannot name**.
//   • 🛑 The ≥ 12 clause LOSES — this arm reads **10**, and no arm could have
//     reached 12: 2 of the 16 are a leading "Flip 3 coins." owned by
//     `deriveAttackCoinFlip`, a different reader, and 4 more are the printed
//     BRACE CODE.
//   • ✅ The "blockers are NOUNS" clause holds for 4 of the 6, and better than it
//     reads: the {W} Pokémon (3) and the Basic {G} Energy (1) are ONE blocker
//     wearing two nouns, and it is the SAME blocker `derivedHandSearch.test.ts`
//     already names in its own residue.
//   • 🛑 The underlying claim is FALSE AS D236 STATED IT. D236 wrote that the
//     leading-clause category is one "the discard side does not print even once".
//     The discard side prints it TWICE, in both verbs — here, and in D234's own
//     residue table one verb over. **The leading clause is a property of neither
//     the zone nor the verb; it is a property of the per-heads FOLD**, which is
//     the unanswered `attack.ts` question D234 named and did not answer.
//
// ⚠️ WHAT THIS FILE IS FOR, AND IT IS NOT "did a card come back". `discardPileRetrieval`
// has run since M5 with six registry rows behind it and `discardRetrieval.test.ts`
// owns the op's own behaviour. What is NEW is (a) a TEXT PARSER that picks the
// FILTER and the DESTINATION out of printed bytes, (b) a `CardFilter` member that
// is a strict SUPERSET of four existing ones, and (c) a third `dest` on the op.
// The risks are therefore: a noun resolving to a filter one notch too wide, a
// Bench destination carrying a noun the Bench cannot hold, and a log row that
// says "shuffled into their deck" about a Pokémon entering play.

/** One printed sentence, its program, and the printings measured for it. Both
    figures per row: `printings` over the whole remote catalog (3,786 rows / 20
    sets), `legalPrintings` over the Standard pool (2,021 rows) — a count without
    a POPULATION and a LEGALITY is not a fact. `note` is the `chooseCards` caption
    the park raises, asserted rather than described. */
interface Clause {
  readonly text: string;
  readonly program: readonly EffectOp[];
  readonly printings: number;
  readonly legalPrintings: number;
  readonly note: string;
}

/** ⚠️ NAMED CONSTANTS RATHER THAN INDICES INTO `CLAUSES`, which is a divergence
    from the nine sibling suites and a deliberate one: `noUncheckedIndexedAccess`
    makes every `CLAUSES[i]` optional unless the array is an `as const` TUPLE, and
    a tuple would make each `program` deeply readonly and therefore no longer an
    `EffectOp`. Naming them keeps both the type and the readability. */
const SUPPORTER: Clause = {
  text: "Put a Supporter card from your discard pile into your hand.",
  program: [{ op: "discardPileRetrieval", filter: { kind: "supporter" }, dest: "hand", max: 1 }],
  printings: 3,
  legalPrintings: 3, // sv06-055, sv06-175, sv09-124
  note: "Put a Supporter card from your discard pile into your hand.",
};
const DUSKULL: Clause = {
  text: "Put up to 3 Duskull from your discard pile onto your Bench.",
  program: [
    {
      op: "discardPileRetrieval",
      filter: { kind: "byName", name: "Duskull" },
      dest: "bench",
      max: 3,
    },
  ],
  printings: 3,
  legalPrintings: 3, // sv06.5-018, sv06.5-068, sv08.5-035
  note: "Put up to 3 Duskull from your discard pile onto your Bench.",
};
const TWO_POKEMON: Clause = {
  text: "Put up to 2 Pokémon from your discard pile into your hand.",
  program: [{ op: "discardPileRetrieval", filter: { kind: "anyPokemon" }, dest: "hand", max: 2 }],
  printings: 2,
  legalPrintings: 2, // sv06-019, sv08-010
  note: "Put up to 2 Pokémon from your discard pile into your hand.",
};
const ONE_POKEMON: Clause = {
  text: "Put a Pokémon from your discard pile into your hand.",
  program: [{ op: "discardPileRetrieval", filter: { kind: "anyPokemon" }, dest: "hand", max: 1 }],
  printings: 1,
  legalPrintings: 1, // sv07-057
  note: "Put a Pokémon from your discard pile into your hand.",
};
const TRAINER: Clause = {
  text: "Put a Trainer card from your discard pile into your hand.",
  program: [{ op: "discardPileRetrieval", filter: { kind: "trainerCard" }, dest: "hand", max: 1 }],
  printings: 1,
  legalPrintings: 1, // sv08-087 Wailord — the new filter's only legal printing
  note: "Put a Trainer card from your discard pile into your hand.",
};

/** ⚠️⚠️ D238 — THE BRACE CODE, and the sentence D237 fielded UNREAD at fixture
    index 53 on purpose. It is the family's largest single sentence (3 legal) and
    the ONLY one whose filter the deriver builds out of a printed CODE rather than
    off a table row. Note the CAPTION: the card prints `{W}` and the dialog says
    "Water", which is the whole reason these phrases are not rows in the shared
    noun table. */
const TIDAL: Clause = {
  text: "Put up to 3 {W} Pokémon from your discard pile onto your Bench.",
  program: [
    {
      op: "discardPileRetrieval",
      filter: { kind: "typedPokemon", pokemonType: "Water" },
      dest: "bench",
      max: 3,
    },
  ],
  printings: 3,
  legalPrintings: 3, // svp-131, sv06.5-012, sv06.5-080
  note: "Put up to 3 Water Pokémon from your discard pile onto your Bench.",
};
/** D238 — the SAME blocker wearing the other noun, and it resolves to a filter
    that has existed since Chien-Pao: only the ANCHOR was ever in the way. The
    pair with `TIDAL` is what makes "one mechanism, two nouns" a driven fact. */
const GRASS_ENERGY: Clause = {
  text: "Put a Basic {G} Energy card from your discard pile into your hand.",
  program: [
    {
      op: "discardPileRetrieval",
      filter: { kind: "basicEnergy", energyType: "Grass" },
      dest: "hand",
      max: 1,
    },
  ],
  printings: 1,
  legalPrintings: 1, // sv06.5-013
  note: "Put a Basic Grass Energy card from your discard pile into your hand.",
};

const CLAUSES: readonly Clause[] = [
  SUPPORTER,
  DUSKULL,
  TWO_POKEMON,
  ONE_POKEMON,
  TRAINER,
  TIDAL,
  GRASS_ENERGY,
];

/** The nine CATALOG sentences this arm also reads, none of them Standard-legal,
    each differing from a row above only in a NOUN or a printed count. They are
    what makes 14 legal into **33 catalog**, and they are listed rather than
    counted because "an arm transfers across sets and a registry row does not"
    (D180/D187) is a claim that has to name its beneficiaries. */
const CATALOG_ONLY: readonly (readonly [string, number, EffectOp])[] = [
  [
    "Put an Item card from your discard pile into your hand.",
    5,
    { op: "discardPileRetrieval", filter: { kind: "item" }, dest: "hand", max: 1 },
  ],
  [
    "Put a Pokémon from your discard pile onto your Bench.",
    3,
    { op: "discardPileRetrieval", filter: { kind: "anyPokemon" }, dest: "bench", max: 1 },
  ],
  [
    "Put up to 2 Item cards from your discard pile into your hand.",
    2,
    { op: "discardPileRetrieval", filter: { kind: "item" }, dest: "hand", max: 2 },
  ],
  [
    "Put up to 2 Basic Energy cards from your discard pile into your hand.",
    2,
    { op: "discardPileRetrieval", filter: { kind: "basicEnergy" }, dest: "hand", max: 2 },
  ],
  [
    "Put a Basic Energy card from your discard pile into your hand.",
    2,
    { op: "discardPileRetrieval", filter: { kind: "basicEnergy" }, dest: "hand", max: 1 },
  ],
  [
    "Put up to 4 Pokémon from your discard pile into your hand.",
    1,
    { op: "discardPileRetrieval", filter: { kind: "anyPokemon" }, dest: "hand", max: 4 },
  ],
  [
    "Put up to 3 Basic Energy cards from your discard pile into your hand.",
    1,
    { op: "discardPileRetrieval", filter: { kind: "basicEnergy" }, dest: "hand", max: 3 },
  ],
  // ⚠️⚠️ D238 — TWO SENTENCES NO PAGE IN THIS REPO HAD NAMED, and they are the
  // slice's sharpest finding about residue tables. Three suites between them
  // listed ONE rotated brace-coded printing; a catalog-wide sweep on the SAME
  // anchors returns FOUR, of which these are three printings on two sentences.
  // A residue table is a census of what its own slice measured, never of what an
  // arm will serve — which is exactly why "an arm transfers" is re-measured here
  // rather than inherited from the row that named the legal half.
  [
    "Put up to 3 Basic {W} Energy cards from your discard pile into your hand.",
    2,
    {
      op: "discardPileRetrieval",
      filter: { kind: "basicEnergy", energyType: "Water" },
      dest: "hand",
      max: 3,
    },
  ],
  [
    "Put up to 2 Basic {M} Energy cards from your discard pile into your hand.",
    1,
    {
      op: "discardPileRetrieval",
      filter: { kind: "basicEnergy", energyType: "Metal" },
      dest: "hand",
      max: 2,
    },
  ],
] as const;

/** 🛑 THE TWO LEGAL PRINTINGS THIS FAMILY STILL DOES **NOT** READ, with the legal
    count and the reason. Pinned derived-to-null so the residue is a fact about
    the code rather than a note in a doc.

    ⚠️ **ONE BLOCKER, ONE SENTENCE — THE SMALLEST RESIDUE ON THE WHOLE BACKLOG
    PAGE**, and it is not a noun at all: D237 left two blockers here and D238's
    brace code took the larger of them, which is the entire reason that slice
    existed. What is left belongs to a DIFFERENT READER (`deriveAttackCoinFlip`)
    and to `attack.ts`'s unanswered per-heads FOLD question, so no amount of work
    on this anchor can reach it. */
const UNREAD: readonly (readonly [string, number, string])[] = [
  [
    "Flip 3 coins. Put a number of cards up to the number of heads from your discard pile into your hand.",
    2,
    "a `programPerHeads` over a PARKING op — owned by `deriveAttackCoinFlip`, a different reader, and the SAME unanswered `attack.ts` fold question D234's residue named one verb over",
  ],
] as const;

/** Constructed near misses, kept apart from `UNREAD` because they have no
    printing at all and would otherwise inflate its arithmetic. Each is a program
    a plausible build would emit and this one must refuse. */
const NEAR_MISSES: readonly (readonly [string, string])[] = [
  [
    "Put a Supporter card from your discard pile onto your Bench.",
    "a NON-POKÉMON noun at the Bench destination — nothing downstream re-checks it, so a derived program here would put a Supporter into play",
  ],
  [
    "Put a Supporter card from your discard pile into your hand. Draw a card.",
    "a TRAILING CLAUSE — the terminal `$`, and the reason the destination class is `[^.]` rather than a greedy `(.+)` that would backtrack past the period",
  ],
  [
    "Put up to 2 in any combination of Item cards and Pokémon Tool cards from your discard pile into your hand.",
    "a DISJUNCTION of two nouns (1 catalog printing) — no `CardFilter` member spells it, and the table refuses the phrase whole",
  ],
  [
    "Put a Fennel card from your discard pile into your hand.",
    "a proper NAME on the SINGULAR branch — `byName` carries no article, so no printing can spell one, and the singular branch offers no name group",
  ],
  [
    "Put up to 0 Pokémon from your discard pile into your hand.",
    "a printed 0 — the ingested-text floor, which would otherwise derive a silent no-op",
  ],
  // ⚠️⚠️ D238 — THE RE-HOMED CONTROL. This slot used to hold "Put up to 2 {D}
  // Pokémon from your discard pile into your hand.", on the grounds that the
  // brace code was unspellable; D238 spells it, so that half of the claim EXPIRED
  // on schedule. RE-HOMED, NEVER DELETED (D237's own rule, paid back one slice
  // later): the claim was that an unresolvable NOUN is a refusal rather than an
  // approximation, and it is now made on a brace code whose LETTER no map spells.
  [
    "Put up to 2 {Q} Pokémon from your discard pile into your hand.",
    "a brace code that is not a printed type — `POKEMON_TYPE_BY_CODE` has no `Q`, so the pattern matches and the MAP refuses, which is the layer that has to say no",
  ],
  [
    "Put up to 3 Basic {N} Energy cards from your discard pile into your hand.",
    "the SAME refusal from the other map, and the sharper one: `{N}` IS a printed Pokémon type (Dragon) and there is no Basic Dragon Energy card, so `ENERGY_TYPE_BY_CODE`'s nine-row vocabulary is what keeps a search for a nonexistent card off the board",
  ],
  [
    "Put up to 3 {W} Energy cards from your discard pile into your hand.",
    "a typed Energy noun WITHOUT the printed 'Basic' — that phrase is `providesEnergy`, a while-attached property `matchesFilter` answers FALSE for in every pile, so a build that dropped the word would search a pile for something nothing in it can be",
  ],
  [
    "Put a Basic {G} Energy card from your discard pile onto your Bench.",
    "the BENCH guard meeting the new noun — an Energy is not benchable however typed it is, and this is the pair that shows the guard is about the FILTER and not about the sentence",
  ],
];

// ── The board. Indices 48-53 on `fix-trainerops`, appended by D237. ──
const VOLT_RECOVERY = 48;
const RESCUE_CALL = 49;
const TRAINER_RECALL = 50;
const GHOSTLY_GATHERING = 51;
const SALVAGE_CALL = 52;
const TIDAL_RECALL = 53;
const SALVAGE_GRASP = 54;

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: DERIVED_RETRIEVAL_DECK, p2: DERIVED_RETRIEVAL_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** p1 attacks with `fix-trainerops`, holding one {C} for the cost, over a Bench
    built to order and a discard pile stocked card by card. p2 is a plain body so
    nothing on the other side of the table can be reached by accident. */
function ready(
  seed: number,
  {
    bench = ["fix-basic-1"],
    discard = {},
  }: { bench?: readonly string[]; discard?: Record<string, number> } = {},
): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-trainerops");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p1");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  for (const [id, count] of Object.entries(discard)) {
    state = discardFromDeck(state, "p1", id, count);
  }
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-basic-1");
  return state;
}

/** One of everything the four Trainer subtypes can be, plus two Pokémon lines —
    the pile that makes `trainerCard`'s width and `byName`'s narrowness both
    observable on the SAME board. */
const FULL_PILE = {
  "fix-gatedsup": 1,
  "fix-item": 1,
  "fix-tool": 1,
  "fix-stadium": 1,
  "fix-duskull": 3,
  "fix-charjabug": 1,
  // ⚠️ D238 — the five lines the brace code needs, and every one of them is a
  // DISCRIMINATOR rather than a candidate. Two {W} bodies (one of them dual-type)
  // sit beside the four COLORLESS Pokémon above, so `typedPokemon` and
  // `anyPokemon` offer different sets on the same pile; a Grass Basic Energy sits
  // beside a Water one and a Colorless one, so `basicEnergy.energyType` is
  // falsifiable at two distances rather than one.
  "fix-water-basic": 2,
  "fix-dual-basic": 1,
  "fix-grass-energy": 1,
  "fix-water-energy": 1,
  "fix-energy": 1,
} as const;

function cardsPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") {
    throw new Error(`expected a park, got ${state.phase.kind}`);
  }
  if (state.phase.prompt.kind !== "chooseCards") {
    throw new Error(`expected chooseCards, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

/** The card ids a prompt is offering, sorted — what the FILTER admitted, named
    rather than counted. */
function offered(state: GameState): string[] {
  return cardsPrompt(state)
    .candidates.map((uid) => state.cardIdByUid[uid] as string)
    .sort();
}

/** The uids in p1's discard pile whose card id is `id`. */
function pileUids(state: GameState, id: string): string[] {
  return state.players.p1.discard.filter((uid) => state.cardIdByUid[uid] === id);
}

/** D238's filter at the type the family's biggest sentence prints. */
const WATER: CardFilter = { kind: "typedPokemon", pokemonType: "Water" };

const attack = (state: GameState, index: number) =>
  mustApply(state, { type: "attack", seat: "p1", index });

const resolve = (state: GameState, uids: string[]) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids } });

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE ANCHOR — five printed sentences, ONE arm
// ─────────────────────────────────────────────────────────────────────────────

describe("the anchor — seven printed sentences, ONE arm", () => {
  it("derives each printed sentence to its program", () => {
    for (const { text, program } of CLAUSES) {
      expect(deriveAttackEffect(text), text).toEqual(program);
    }
  });

  it("adds up: 14 of the row's 16 legal printings, across 7 of its 8 sentences", () => {
    // The arithmetic stated rather than described — a slice that quietly dropped
    // one noun row would still pass every accept case above.
    expect(CLAUSES).toHaveLength(7);
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(14);
    // …and the residue, which is the other half of the same census: 2 more legal
    // printings over 1 sentence, pinned derived-to-null.
    expect(UNREAD).toHaveLength(1);
    expect(UNREAD.reduce((sum, [, legal]) => sum + legal, 0)).toBe(2);
    for (const [text] of UNREAD) expect(deriveAttackEffect(text), text).toBeNull();
    // 14 + 2 = 16, which is still exactly what the backlog row measured. D237
    // read 10 of the 16 and D238 takes the 4 it had pinned on the brace code —
    // the SAME total, re-derived a second time by a second slice.
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0) + 2).toBe(16);
    expect(CLAUSES.length + UNREAD.length).toBe(8);
  });

  it("reads 33 of the family's 39 CATALOG printings too — an arm transfers", () => {
    // The wider population, because a row that counts only the legal pool
    // under-states what an arm buys: the same GLOB over all 3,786 rows returns 39
    // printings on 18 sentences, and this arm now reads 33 on 16 (D237 read 26 on
    // 12; D238's brace code adds 4 legal and 3 ROTATED-ONLY printings, and two of
    // those three sentences were named by no page in this repo).
    const legalSide = CLAUSES.reduce((sum, c) => sum + c.printings, 0);
    const catalogOnly = CATALOG_ONLY.reduce((sum, [, n]) => sum + n, 0);
    expect(legalSide).toBe(14);
    expect(catalogOnly).toBe(19);
    expect(legalSide + catalogOnly).toBe(33);
    expect(CLAUSES.length + CATALOG_ONLY.length).toBe(16);
    // …and each of the nine is DRIVEN rather than tallied, because a count of
    // sentences nobody executed is the defect this whole page was written about.
    for (const [text, , op] of CATALOG_ONLY) {
      expect(deriveAttackEffect(text), text).toEqual([op]);
    }
  });

  it("🛑 the NOUN and the DESTINATION are INDEPENDENT axes, which is why it is one arm", () => {
    // ⚠️ THE ROW'S PREDICTION, DRIVEN. If the five sentences were five arms,
    // changing the noun would be free to change something other than `filter`,
    // and changing the destination free to change something other than `dest`.
    // Both are asserted as "differs in exactly one key".
    const [hand] = deriveAttackEffect(ONE_POKEMON.text) ?? [];
    const [bench] =
      deriveAttackEffect("Put a Pokémon from your discard pile onto your Bench.") ?? [];
    expect(bench).toEqual({ ...hand, dest: "bench" });
    const [supporter] = deriveAttackEffect(SUPPORTER.text) ?? [];
    const [trainer] = deriveAttackEffect(TRAINER.text) ?? [];
    expect(trainer).toEqual({ ...supporter, filter: { kind: "trainerCard" } });
    // …and the count rides the same arm at a value no card prints today, which is
    // the whole reason `max` is a capture rather than an alternation over 2 and 3.
    expect(
      deriveAttackEffect("Put up to 7 Pokémon from your discard pile into your hand."),
    ).toEqual([
      { op: "discardPileRetrieval", filter: { kind: "anyPokemon" }, dest: "hand", max: 7 },
    ]);
  });

  it("🛑 the article and the count are WELDED, and the missing group IS max 1", () => {
    // "a Pokémon" and "up to N Pokémon" are the same row of the table read on two
    // branches, and `max` is REQUIRED on this op — so unlike the attach family's
    // `count` there is no "absent means 1" to leave off: a singular printing emits
    // `max: 1` outright. Both halves are printed and legal, so neither branch is
    // an unreachable arm nobody can kill a mutant on.
    const [one] = deriveAttackEffect(ONE_POKEMON.text) ?? [];
    const [two] = deriveAttackEffect(TWO_POKEMON.text) ?? [];
    expect(one).toEqual({ ...two, max: 1 });
    expect(ONE_POKEMON.legalPrintings).toBeGreaterThan(0);
    expect(TWO_POKEMON.legalPrintings).toBeGreaterThan(0);
    // The CROSSED forms no card prints cannot match, because the article rides
    // the singular branch and the count rides the plural one.
    for (const crossed of [
      "Put up to 2 a Pokémon from your discard pile into your hand.",
      "Put Pokémon from your discard pile into your hand.",
      "Put a Pokémon cards from your discard pile into your hand.",
    ]) {
      expect(deriveAttackEffect(crossed), crossed).toBeNull();
    }
  });

  it("🛑 an unresolvable NOUN or DESTINATION is a REFUSAL, never an approximation", () => {
    // The whole design of the two closed tables. A build that fell back to
    // `anyCard` on an unknown noun, or to `hand` on an unknown destination, would
    // derive a program for every one of these.
    for (const [text, why] of NEAR_MISSES) expect(deriveAttackEffect(text), why).toBeNull();
    for (const text of [
      "Put a Berry card from your discard pile into your hand.",
      "Put a Supporter card from your discard pile into your deck.",
      "Put a Supporter card from your discard pile onto your opponent's Bench.",
      "Put a Supporter card from your deck into your hand.",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("🛑 the printed DECK destination is a MEASURED absence, not an oversight", () => {
    // The op carries `dest: "deck"` (Pal Pad, Super Rod) and no attack sentence in
    // the catalog spells it: those printings say "**Shuffle** … into your deck",
    // a different verb and therefore a different family (D232's rule). The table
    // is authored off the bytes, so the phrase is refused rather than admitted on
    // the strength of the union.
    expect(
      deriveAttackEffect("Put up to 2 Supporter cards from your discard pile into your deck."),
    ).toBeNull();
    expect(
      deriveAttackEffect("Shuffle up to 2 Supporter cards from your discard pile into your deck."),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. `trainerCard` — the new filter, and it is a strict SUPERSET
// ─────────────────────────────────────────────────────────────────────────────

describe("`trainerCard` — the CATEGORY, not a disjunction of four subtypes", () => {
  const SUBTYPES: readonly (readonly [string, CardFilter])[] = [
    ["fix-gatedsup", { kind: "supporter" }],
    ["fix-item", { kind: "item" }],
    ["fix-tool", { kind: "toolCard" }],
    ["fix-stadium", { kind: "stadium" }],
  ];

  it("admits every one of the four printed subtypes, where each subtype admits one", () => {
    // ⚠️ THE FALSIFIABILITY TEST (D231) on a filter whose whole content is a
    // widening: on the SAME four cards, the new member says yes four times and
    // each old member says yes once. A build that spelled it as any three of the
    // four would be green on a pool missing the fourth.
    for (const [id] of SUBTYPES) {
      const card = FIXTURE_POOL[id];
      expect(card, id).toBeDefined();
      expect(matchesFilter(card, { kind: "trainerCard" }), id).toBe(true);
      for (const [other, filter] of SUBTYPES) {
        expect(matchesFilter(card, filter), `${id} vs ${other}`).toBe(id === other);
      }
    }
  });

  it("refuses everything that is NOT a Trainer, including the Energy and the Pokémon", () => {
    for (const id of ["fix-basic-1", "fix-duskull", "fix-energy", "fix-water-energy"]) {
      expect(matchesFilter(FIXTURE_POOL[id], { kind: "trainerCard" }), id).toBe(false);
    }
    // …and an absent card is false at the guard, not at this arm (D231's rule for
    // `anyCard`, which this member sits beside).
    expect(matchesFilter(undefined, { kind: "trainerCard" })).toBe(false);
  });

  it("its printed noun phrase is `retrieveNoun`'s output, driven through the prompt", () => {
    // 🛑 THE ROUND TRIP THE SHARED TABLE EXISTS FOR. `HAND_SEARCH_NOUNS` and
    // `retrieveNoun` live in different files (effects.ts cannot import
    // interpreter.ts), so the contract that its two strings ARE that function's
    // output is a TEST rather than a shared constant — and it goes red from
    // either side. Here it is driven end to end: the printed sentence goes in and
    // the dialog caption comes back out.
    const state = attack(ready(3, { discard: FULL_PILE }), TRAINER_RECALL).state;
    expect(cardsPrompt(state).note).toBe(TRAINER.note);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2b. `typedPokemon` — D238's new filter, and the ARRAY it reads
// ─────────────────────────────────────────────────────────────────────────────

describe("`typedPokemon` — a printed TYPE, read off an ARRAY", () => {
  it("admits the typed body and refuses the untyped ones", () => {
    for (const id of ["fix-water-basic", "fix-dual-basic"]) {
      expect(matchesFilter(FIXTURE_POOL[id], WATER), id).toBe(true);
    }
    // ⚠️ THE REFUSALS ARE THE MEASUREMENT. `fix-duskull`, `fix-charjabug` and
    // `fix-basic-1` are all Pokémon and all Colorless, so a build that emitted
    // `anyPokemon` for a typed sentence passes every accept above and fails here.
    for (const id of ["fix-duskull", "fix-charjabug", "fix-basic-1"]) {
      expect(matchesFilter(FIXTURE_POOL[id], WATER), id).toBe(false);
    }
    // …and a card that is not a Pokémon at all is false at the category conjunct,
    // never at the type one — `fix-water-energy` is literally named "Water Energy".
    for (const id of ["fix-water-energy", "fix-gatedsup", "fix-item"]) {
      expect(matchesFilter(FIXTURE_POOL[id], WATER), id).toBe(false);
    }
    expect(matchesFilter(undefined, WATER)).toBe(false);
  });

  it("🛑 a DUAL-TYPE body matches on EITHER type — `includes`, not `types[0]`", () => {
    // ⚠️ THE ONE ASSERTION NO OTHER CARD IN THE POOL CAN MAKE. `fix-dual-basic` is
    // printed ["Fire", "Water"], so a predicate written `card.types[0] === type`
    // — the obvious wrong read of a column that is an ARRAY, and one the catalog
    // punishes because dual-type Pokémon are really printed — admits it for {R}
    // and REFUSES it for {W}. Both halves are asserted, because the wrong build
    // passes the {R} half.
    const dual = FIXTURE_POOL["fix-dual-basic"];
    expect(dual?.types).toEqual(["Fire", "Water"]);
    expect(matchesFilter(dual, { kind: "typedPokemon", pokemonType: "Fire" })).toBe(true);
    expect(matchesFilter(dual, WATER)).toBe(true);
    expect(matchesFilter(dual, { kind: "typedPokemon", pokemonType: "Grass" })).toBe(false);
  });

  it("🛑 the `stage` rider narrows, and its ABSENCE admits both stages", () => {
    // The falsifiability pair for a field whose only printed witness is a
    // 0-legal sentence one family over ("Search your deck for a Basic {G}
    // Pokémon…"). A build that ignored the rider offers the Stage 1 to both.
    const basic = FIXTURE_POOL["fix-grass-basic"];
    const stage1 = FIXTURE_POOL["fix-grass-stage1"];
    const unmarked: CardFilter = { kind: "typedPokemon", pokemonType: "Grass" };
    const marked: CardFilter = { kind: "typedPokemon", pokemonType: "Grass", stage: "basic" };
    expect(matchesFilter(basic, unmarked)).toBe(true);
    expect(matchesFilter(stage1, unmarked)).toBe(true);
    expect(matchesFilter(basic, marked)).toBe(true);
    expect(matchesFilter(stage1, marked)).toBe(false);
  });

  it("its noun phrase writes the type OUT IN FULL, driven through the prompt", () => {
    // 🛑 THE DECISION THIS SLICE OWED, ASSERTED END TO END. The card prints `{W}`
    // and the dialog caption says "Water Pokémon" — so the printed phrase and the
    // caption phrase DIFFER, which is precisely why these nouns are not rows in
    // `HAND_SEARCH_NOUNS` (whose contract is that its strings ARE `retrieveNoun`'s
    // output). A build that captioned the code back at the player passes every
    // filter assertion above and fails only here.
    const state = attack(ready(3, { discard: FULL_PILE }), TIDAL_RECALL).state;
    expect(cardsPrompt(state).note).toBe(TIDAL.note);
    expect(cardsPrompt(state).note).not.toContain("{W}");
    // …and the Energy noun, the same round trip through the member that already
    // existed: "Basic {G} Energy card" in, "Basic Grass Energy card" out.
    const energy = attack(ready(3, { discard: FULL_PILE }), SALVAGE_GRASP).state;
    expect(cardsPrompt(energy).note).toBe(GRASS_ENERGY.note);
    expect(cardsPrompt(energy).note).not.toContain("{G}");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE BOARD — the filter offers what the sentence names
// ─────────────────────────────────────────────────────────────────────────────

describe("the derived program on a real board", () => {
  it("`a Trainer card` offers all four subtypes; `a Supporter card` offers one", () => {
    // ⚠️ THE PAIR IS THE POINT: the same board, the same pile, two sentences that
    // differ only in the noun. A crossed build passes either assertion alone.
    const wide = attack(ready(3, { discard: FULL_PILE }), TRAINER_RECALL).state;
    expect(offered(wide)).toEqual(["fix-gatedsup", "fix-item", "fix-stadium", "fix-tool"]);
    const narrow = attack(ready(3, { discard: FULL_PILE }), VOLT_RECOVERY).state;
    expect(offered(narrow)).toEqual(["fix-gatedsup"]);
    expect(cardsPrompt(narrow).note).toBe(SUPPORTER.note);
  });

  it("`up to 2 Pokémon` offers the Pokémon and nothing else, at max 2", () => {
    const state = attack(ready(3, { discard: FULL_PILE }), RESCUE_CALL).state;
    expect(offered(state)).toEqual([
      "fix-charjabug",
      "fix-dual-basic",
      "fix-duskull",
      "fix-duskull",
      "fix-duskull",
      "fix-water-basic",
      "fix-water-basic",
    ]);
    const prompt = cardsPrompt(state);
    expect(prompt.max).toBe(2);
    expect(prompt.min).toBe(0); // printed "up to" — a decline is a legal answer
    expect(prompt.dest).toBe("hand");
    expect(prompt.note).toBe(TWO_POKEMON.note);
  });

  it("🛑 `up to 3 Duskull` offers the NAMED body alone — not the other Pokémon", () => {
    // The `byName` arm's falsifiability pair, on one board: `fix-charjabug` is a
    // Pokémon in the same pile and must NOT be offered. A build that emitted
    // `anyPokemon` for a named sentence offers it (and every `fix-basic-1`); a
    // build that matched on stage rather than on name offers the wrong one.
    const state = attack(ready(3, { discard: FULL_PILE }), GHOSTLY_GATHERING).state;
    expect(offered(state)).toEqual(["fix-duskull", "fix-duskull", "fix-duskull"]);
    expect(cardsPrompt(state).dest).toBe("bench");
    expect(cardsPrompt(state).note).toBe(DUSKULL.note);
  });

  it("🆕 D238 — `up to 3 {W} Pokémon` offers the TYPED bodies and benches them", () => {
    // ⚠️ THE PAIR WITH `up to 2 Pokémon` ABOVE IS THE POINT: same board, same
    // pile, and the typed sentence offers THREE of the seven Pokémon the untyped
    // one offers. A build that resolved the brace code to `anyPokemon` — the
    // "wrong-but-plausible program" this page keeps warning about — passes every
    // derive assertion and offers Duskull here.
    const parked = attack(ready(3, { discard: FULL_PILE }), TIDAL_RECALL).state;
    expect(offered(parked)).toEqual(["fix-dual-basic", "fix-water-basic", "fix-water-basic"]);
    const prompt = cardsPrompt(parked);
    expect(prompt.max).toBe(3);
    expect(prompt.min).toBe(0);
    expect(prompt.dest).toBe("bench");
    // 🛑 AND IT REALLY BENCHES, which is `BENCHABLE_RETRIEVAL_KINDS` gaining the
    // new kind: forgetting that one line refuses this sentence at the guard and
    // sends 3 legal printings to the skipped path looking exactly like an unread
    // sentence — green derive tests, silent loss.
    const benchBefore = parked.players.p1.bench.length;
    const uids = prompt.candidates.slice(0, 2);
    const { state, events } = resolve(parked, [...uids]);
    expect(state.players.p1.bench).toHaveLength(benchBefore + 2);
    expect(events.filter((e) => e.type === "DISCARD_RETRIEVED")).toEqual([
      { type: "DISCARD_RETRIEVED", seat: "p1", dest: "bench", uids: [...uids] },
    ]);
  });

  it("🆕 D238 — `a Basic {G} Energy card` offers the GRASS one, not the other two", () => {
    // The other noun, and the pile holds three Basic Energy cards: Grass, Water
    // and the Colorless `fix-energy`. A build that dropped `energyType` offers all
    // three; a build that read the code off the wrong map offers the wrong one.
    const parked = attack(ready(3, { discard: FULL_PILE }), SALVAGE_GRASP).state;
    expect(offered(parked)).toEqual(["fix-grass-energy"]);
    expect(cardsPrompt(parked).max).toBe(1);
    expect(cardsPrompt(parked).dest).toBe("hand");
  });

  it("takes the picked cards into the HAND and files a `DISCARD_RETRIEVED` row", () => {
    const before = ready(3, { discard: FULL_PILE });
    const parked = attack(before, SALVAGE_CALL).state;
    const uid = pileUids(parked, "fix-duskull")[0] as string;
    const { state, events } = resolve(parked, [uid]);
    expect(state.players.p1.hand).toContain(uid);
    expect(state.players.p1.discard).not.toContain(uid);
    const retrieved = events.filter((e) => e.type === "DISCARD_RETRIEVED");
    expect(retrieved).toEqual([
      { type: "DISCARD_RETRIEVED", seat: "p1", dest: "hand", uids: [uid] },
    ]);
  });

  it("🛑 puts the picked cards onto the BENCH, in play and stamped this turn", () => {
    // The whole reason `dest: "bench"` is a new op member rather than a caption:
    // the cards LEAVE the discard pile and BECOME Pokémon in play. A build that
    // routed the Bench destination through the hand arm passes the "left the pile"
    // half and nothing else.
    const before = ready(3, { discard: FULL_PILE });
    const benchBefore = before.players.p1.bench.length;
    const parked = attack(before, GHOSTLY_GATHERING).state;
    const uids = pileUids(parked, "fix-duskull");
    expect(uids).toHaveLength(3);
    const { state, events } = resolve(parked, uids);
    expect(state.players.p1.bench).toHaveLength(benchBefore + 3);
    for (const uid of uids) {
      expect(state.players.p1.discard).not.toContain(uid);
      expect(state.players.p1.hand).not.toContain(uid);
      const spot = state.players.p1.bench.find((p) => p.stack.includes(uid));
      expect(spot, uid).toBeDefined();
      expect(spot?.stack).toEqual([uid]); // a fresh body, not evolved onto anything
      // Stamped with the turn the ATTACK ran on, not the turn the state ends on
      // — resolving the last op ends the turn, so `state.turn` has already moved.
      // The stamp is what §9's "you played this Pokémon this turn" rules read.
      expect(spot?.turnPlayed).toBe(parked.turn);
      expect(spot?.damage).toBe(0);
    }
    expect(events.filter((e) => e.type === "DISCARD_RETRIEVED")).toEqual([
      { type: "DISCARD_RETRIEVED", seat: "p1", dest: "bench", uids },
    ]);
  });

  it("🛑 the MOVE clamps too, on a Bench that filled AFTER the park was raised", () => {
    // ⚠️⚠️ THIS CASE EXISTS BECAUSE A MUTANT SURVIVED. Dropping the clamp inside
    // `retrieveMove` was invisible to every assertion above, because the PARK's
    // clamp had already narrowed `max` — so the two clamps looked like belt and
    // braces and only one of them was under test. **A survivor is a suite gap
    // until proven otherwise, and this one was a gap.**
    //
    // The board that tells them apart is the one the park cannot narrow: a park
    // is serialized into a `MatchRecord` and answered LATER, so the Bench can
    // fill in between. Surgery rather than a printed card, and said so — no
    // sentence in the pool benches a body between an attack's park and its
    // answer, which is exactly why the second clamp is written from the RULE
    // (the set removed from the pile must equal the set that lands) rather than
    // from a fixture.
    const parked = attack(ready(3, { discard: FULL_PILE }), GHOSTLY_GATHERING).state;
    const uids = pileUids(parked, "fix-duskull");
    expect(cardsPrompt(parked).max).toBe(3);
    let filled = parked;
    for (let i = 0; i < 4; i++) filled = benchFromDeck(filled, "p1", "fix-basic-1");
    expect(filled.players.p1.bench).toHaveLength(5); // BENCH_MAX — no space at all
    const { state, events } = resolve(filled, uids);
    // NOTHING moves: not into the Bench, not out of the pile, and no event lies
    // about it. An unclamped move would remove all three from the discard pile
    // and append them past the fifth slot — cards in neither zone.
    expect(state.players.p1.bench).toHaveLength(5);
    for (const uid of uids) expect(state.players.p1.discard).toContain(uid);
    expect(events.filter((e) => e.type === "DISCARD_RETRIEVED")).toEqual([]);
  });

  it("🛑 the BENCH destination clamps to the space left, BEFORE anything moves", () => {
    // `searchDeck`'s own rule, re-read on this op: the prompt is narrowed to the
    // free slots so the set removed from the pile is exactly the set that lands.
    // A build that clamped AFTER the move strands the excess in neither zone —
    // the card-destruction shape the M1 review called out.
    const state = attack(
      ready(3, {
        bench: ["fix-basic-1", "fix-basic-1", "fix-basic-1", "fix-basic-1"],
        discard: FULL_PILE,
      }),
      GHOSTLY_GATHERING,
    ).state;
    expect(state.players.p1.bench).toHaveLength(4);
    expect(cardsPrompt(state).max).toBe(1); // BENCH_MAX 5 − 4 seated
    // …and the caption says the CLAMPED number rather than the printed one, so
    // the dialog cannot promise a pick the validator would reject. At max 1 it
    // reads `retrieveNoun`'s SINGULAR, which for `byName` is the bare name — the
    // one row in that table that carries no article, because a card name is not
    // a noun phrase (D230's reading, re-read here rather than special-cased).
    expect(cardsPrompt(state).note).toBe("Put Duskull from your discard pile onto your Bench.");
  });

  it("🛑 a FULL Bench makes the whole op a silent no-op, not a park", () => {
    const state = attack(
      ready(3, {
        bench: ["fix-basic-1", "fix-basic-1", "fix-basic-1", "fix-basic-1", "fix-basic-1"],
        discard: FULL_PILE,
      }),
      GHOSTLY_GATHERING,
    ).state;
    expect(state.players.p1.bench).toHaveLength(5);
    expect(state.phase.kind).not.toBe("effect:choose");
  });

  it("an EMPTY pile is a no-op, and a decline moves nothing", () => {
    // The pile holds no Supporter at all — `discardPileRetrieval`'s whiff, which
    // is the same silent ending `searchDeck` has always had.
    const whiff = attack(ready(3, { discard: { "fix-item": 2 } }), VOLT_RECOVERY).state;
    expect(whiff.phase.kind).not.toBe("effect:choose");
    // …and a park answered with the empty set is a legal answer that files no row.
    const parked = attack(ready(3, { discard: FULL_PILE }), VOLT_RECOVERY).state;
    const { state, events } = resolve(parked, []);
    expect(events.filter((e) => e.type === "DISCARD_RETRIEVED")).toEqual([]);
    expect(state.players.p1.hand).not.toContain(pileUids(parked, "fix-gatedsup")[0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE FIXTURE — the claim this suite rests on
// ─────────────────────────────────────────────────────────────────────────────

describe("the fixture prints what the catalog prints", () => {
  it("indices 48-54 carry this family's seven sentences, verbatim", () => {
    const attacks = FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];
    const rows: readonly (readonly [number, string, string])[] = [
      [VOLT_RECOVERY, "Volt Recovery", SUPPORTER.text],
      [RESCUE_CALL, "Rescue Call", TWO_POKEMON.text],
      [TRAINER_RECALL, "Trainer Recall", TRAINER.text],
      [GHOSTLY_GATHERING, "Ghostly Gathering", DUSKULL.text],
      [SALVAGE_CALL, "Salvage Call", ONE_POKEMON.text],
      [TIDAL_RECALL, "Tidal Recall", TIDAL.text],
      [SALVAGE_GRASP, "Salvage Grasp", GRASS_ENERGY.text],
    ];
    for (const [index, name, text] of rows) {
      expect(attacks[index]?.name, `${index}`).toBe(name);
      expect(attacks[index]?.effect, name).toBe(text);
    }
    // ⚠️ APPENDED, NEVER INSERTED: ten sibling suites address 0-47 by constant.
    // ⚠️ FIFTY-FIVE AT D240; **58 at D241**, which appended 55-57 (look at the
    // top N — "Summoning Gate" / "Larimar Rain" / "Dig It Up").
    // `derivedLookAtTop.test.ts` owns 55-57. ELEVEN slices, eleven appends, zero
    // inserts.
    // 🆕🆕 **63 AT D426**, which appended **61-62** — the opponent-chooses hand
    // discard (*"Your opponent discards 2 cards from their hand."* / *"…a card…"*).
    // `opponentHandDiscard.test.ts` owns them, and the append-never-insert
    // discipline this whole paragraph exists for holds again: 0-60 are addressed by
    // constant in a dozen sibling suites and every one of them still means what it
    // meant. ⚠️ NO ORDINAL IS CLAIMED (*"the Nth slice"*) — the running count above
    // was last written at D241 and was already one append behind by D246, which is
    // exactly how a count in a comment rots. The LENGTH is the executable half and
    // it is the line below.
    // 🆕🆕 **68 AT D443**, which appended **66-67** — the OPPONENT-BOARD pair
    // (`derivedOpponentEnergyMove.test.ts` owns them). TWELVE sibling suites carry
    // this pin and all twelve were stepped in one pass, as D442 stepped eleven.
    // 🆕🆕 **66 AT D442**, which appended **63-65** — the destination-side SPREAD
    // (`derivedSpreadEnergyMove.test.ts` owns them). ELEVEN sibling suites carry this
    // same length pin and ALL of them were stepped in one pass (D431): a green run
    // after fixing the one that reddened is evidence the runner stopped early.
    expect(attacks).toHaveLength(73); // 🆕🆕 **72 AT D457**, which appended **71** — and NOT to field a new family: index 42 was the demonstrator's LAST unread sentence and D457 built it, leaving `optionalSelfSwitch.test.ts` §7's loud-path attribution control with no subject at all. 71 is corpus line 404 (the Future-banner attach, DATA-BLOCKED rather than merely unbuilt), and `testFixtures.ts` carries the argument. THIRTEEN suites carry this pin and all thirteen were stepped in one pass (D431).
  });

  it("🆕 D238 — `Tidal Recall` was fielded UNREAD by D237 and READS on this commit", () => {
    // 🛑 THIS IS WHAT A DEFERRAL FIXTURE IS FOR, and the assertion is inverted
    // rather than deleted (D181's `Strafe` precedent, collected one slice later).
    // D237 fielded index 53 knowing it would derive to null, so the refusal had a
    // live subject sitting on the attacker beside five readable siblings; the day
    // the brace code was spelled the subject went green without anybody having to
    // remember it existed. **The claim it was pinning — that an unresolvable noun
    // is a refusal — did not expire with it**: it is re-homed onto `{Q}` and
    // `Basic {N}` in `NEAR_MISSES`, where no map spells the code.
    const text = FIXTURE_POOL["fix-trainerops"]?.attacks?.[TIDAL_RECALL]?.effect as string;
    expect(text).toBe(TIDAL.text);
    expect(deriveAttackEffect(text)).toEqual(TIDAL.program);
    const state = attack(ready(3, { discard: FULL_PILE }), TIDAL_RECALL).state;
    expect(state.phase.kind).toBe("effect:choose");
  });

  it("`fix-duskull` is a BASIC named Duskull, and `fix-charjabug` is not", () => {
    // Both halves are load-bearing (D230's rule, one family over): the NAME is
    // what `byName` matches, and the STAGE is what tells the two named bodies
    // apart for a build that matched on the wrong field.
    const duskull = FIXTURE_POOL["fix-duskull"];
    expect(duskull?.name).toBe("Duskull");
    expect(duskull?.stage).toBe("Basic");
    expect(duskull?.attacks ?? []).toHaveLength(0);
    const charjabug = FIXTURE_POOL["fix-charjabug"];
    expect(charjabug?.name).toBe("Charjabug");
    expect(charjabug?.stage).toBe("Stage1");
    expect(matchesFilter(duskull, { kind: "byName", name: "Duskull" })).toBe(true);
    expect(matchesFilter(charjabug, { kind: "byName", name: "Duskull" })).toBe(false);
  });

  it("the costs are the usual divergence, and it is asserted rather than hidden", () => {
    // Every attack in this block costs {C} where the real prints cost more; the
    // EFFECT STRING is the claim this suite makes, and the cost is fixture
    // convenience so one attached Energy can drive six sentences.
    const attacks = FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];
    for (const index of [
      VOLT_RECOVERY,
      RESCUE_CALL,
      TRAINER_RECALL,
      GHOSTLY_GATHERING,
      SALVAGE_CALL,
      TIDAL_RECALL,
      SALVAGE_GRASP,
    ]) {
      expect(attacks[index]?.cost, `${index}`).toEqual(["Colorless"]);
      expect(attacks[index]?.damage, `${index}`).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE READ SITES — priced by grep, then DRIVEN
// ─────────────────────────────────────────────────────────────────────────────

describe("the read sites this slice actually pays", () => {
  const NAMES = { p1: "P1", p2: "P2" } as const;
  const rows = (events: readonly GameEvent[], state: GameState): string[] =>
    logFromEvents(events, { names: NAMES, state, elapsed: "+00:09" }).map((entry) =>
      entry.kind === "turn" ? `— turn ${entry.turn} —` : entry.segments.map((s) => s.text).join(""),
    );

  it("🛑 `log.ts` gained a THIRD arm, and the BENCH row would otherwise have LIED", () => {
    // ⚠️ THIS IS THE ONE READ SITE THIS SLICE PAID THAT WAS NOT ZERO, and the
    // failure it would have shipped is not a gap but a CONTRADICTION: the row was
    // a binary ternary on `dest === "hand"`, so three Duskull entering play would
    // have been announced as "shuffled 3 cards from their discard pile into their
    // deck" while the board showed them on the Bench.
    const parked = attack(ready(3, { discard: FULL_PILE }), GHOSTLY_GATHERING).state;
    const uids = pileUids(parked, "fix-duskull");
    const { state, events } = resolve(parked, uids);
    expect(rows(events, state)).toContain("put 3 cards from their discard pile onto their Bench");
  });

  it("the HAND and DECK rows are unmoved by the widening", () => {
    // The other two arms, driven on the same commit — a refactor that reworded an
    // existing row while adding one is the shape this assertion exists to catch.
    const parked = attack(ready(3, { discard: FULL_PILE }), SALVAGE_CALL).state;
    const uid = pileUids(parked, "fix-duskull")[0] as string;
    const { state, events } = resolve(parked, [uid]);
    expect(rows(events, state)).toContain("took 1 card from their discard pile");
    // …and the `dest: "deck"` wording, driven straight off the renderer, because
    // no attack in this family can produce it (Pal Pad and Super Rod are Trainers).
    expect(
      rows([{ type: "DISCARD_RETRIEVED", seat: "p1", dest: "deck", uids: [uid] }], state),
    ).toEqual(["shuffled 1 card from their discard pile into their deck"]);
  });

  it("🛑 the shared noun table carries no REGEX METACHARACTER — the anchor is built from it", () => {
    // The anchor interpolates every phrase in `HAND_SEARCH_NOUNS` into an
    // alternation, so a row containing `(`, `|`, `.` or `?` would silently change
    // what this reader matches rather than fail to compile. Asserted from the
    // OUTSIDE, because effects.ts does not export the table.
    //
    // ⚠️⚠️ D238 SPLITS THIS ASSERTION IN TWO, AND THE SPLIT **IS** THE SLICE'S
    // DESIGN DECISION MADE OBSERVABLE. Every phrase resolved through the TABLE is
    // still letters, spaces and "é"; every phrase resolved through the BRACE
    // PATTERN contains `{` and `}`, which are metacharacters — so the two could
    // never have shared a table, whatever the caption contract said. That is why
    // the answer to "third column or capture group?" was NEITHER.
    const nounOf = (text: string) =>
      text.replace(/^Put (?:up to \d+ )?/, "").replace(/ from your discard pile.*$/, "");
    const braced: string[] = [];
    const plain: string[] = [];
    for (const text of [...CLAUSES.map((c) => c.text), ...CATALOG_ONLY.map(([t]) => t)]) {
      (nounOf(text).includes("{") ? braced : plain).push(nounOf(text));
    }
    for (const phrase of plain) expect(phrase, phrase).toMatch(/^[A-Za-zé ]+$/);
    // Four brace-coded sentences on this anchor alone — not one, which is what
    // makes the pattern cheaper than the rows it replaces.
    expect(braced).toHaveLength(4);
    for (const phrase of braced) expect(phrase, phrase).toMatch(/\{[A-Z]\}/);
  });
});

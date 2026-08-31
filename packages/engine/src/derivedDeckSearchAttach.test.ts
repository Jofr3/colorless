import { describe, expect, it } from "vitest";
import { programPlayable } from "./cardplay";
import { POKEMON_TYPE_BY_CODE, POKEMON_TYPES, deriveAttackEffect } from "./effects";
import type { EffectOp, GameEvent, GameState, PokemonRef } from "./index";
import type { EffectPrompt } from "./interpreter";
import {
  DECK_SEARCH_ATTACH_DECK,
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.150.0 → 0.151.0 — D235, THE DECK SEARCH THAT **ATTACHES**: backlog row 10,
// the biggest attack-column count left on the D233 page, and the FIRST prediction
// on that page to be graded PART WRONG.
//
// ✅ THE COUNT RE-DERIVES TO THE DIGIT — and unlike D234 the WHOLE row does, not
// just the half an anchor can take. Remote D1 `luminous`, `legal_standard = 1`,
// `json_each` over `attacks_json`/`abilities_json` plus the bare `effect` column,
// GLOB (never LIKE), GROUPED BY SENTENCE, 2026-08-06:
//
//   WHERE t GLOB '*[Ss]earch your deck for*Energy card*attach*' GROUP BY col;
//   -- attack 28 / 17 · ability 5 / 3 · effect 5 / 2
//
// The row says **28 (17 sentences) · 4 · 1**. The ability and Trainer halves are
// the 5 and 5 above minus what is already authored — `sv10-136` (Marnie's
// Grimmsnarl ex) and the four-printing Janine's Secret Art sentence. **33 = 33**,
// two rows running.
//
// 🛑 THE PREDICTION AND ITS GRADE, WHICH IS THE PART WORTH TRANSFERRING. Written
// down before the first regex, so it could be falsified rather than adjusted:
//   • *"ONE anchor plus one optional trailing group, not seventeen arms"* —
//     ✅ CORRECT. D232's rule holds a third time.
//   • *"23 of the 28 legal printings"* — 🛑 **WRONG, it is 20.** The miss has a
//     name: **A DESTINATION TABLE IS NOT PORTABLE BETWEEN TWO OPS JUST BECAUSE
//     ITS KEYS ARE.** D234's table spells every phrase this family prints, so it
//     was priced as free — but `attachEnergyFrom` has `count` (a batch pinned to
//     ONE chosen body, D205) and `attachFromDeck` has no such field, because its
//     park answers with a MAP from card to target. "attach **them** to **1 of**
//     your Pokémon" is expressible one op over and NOT here.
//
// 🛑 20 OF THE 28 ON 12 OF THE 14 READABLE SENTENCES; the 8 left are FOUR
// SEPARATE BLOCKERS (`UNREAD` below), two of which the backlog row priced up
// front and two of which it did not. A residue is a measurement, not a remainder.
//
// ⚠️ WHAT THIS FILE IS FOR, AND IT IS NOT "did an Energy attach".
// `attachFromDeck` has run since M5 with Charizard ex and Janine's Secret Art
// behind it, and `attachFromDeck.test.ts` owns the op's own behaviour. What is
// NEW is a TEXT PARSER, and its two real risks are both one printed word wide:
// the `batch` rule (a sentence that says "1 of" must not derive to a program that
// permits a split), and the §9.2 tail (a sentence that prints no poison clause
// must not derive to a program that poisons). Every case that could survive a
// crossed build is paired with one that could not.

/** The twelve sentences this one anchor reads, with the program each derives to
    and the printings measured for it. Both figures per row: `printings` over the
    whole remote catalog (3,786 rows / 20 sets), `legalPrintings` over the
    Standard pool (2,021 rows) — a count without a POPULATION and a LEGALITY is
    not a fact. */
const CLAUSES = [
  {
    text: "Search your deck for a Basic Energy card and attach it to this Pokémon. Then, shuffle your deck.",
    program: [
      { op: "attachFromDeck", filter: { kind: "basicEnergy" }, max: 1, toSelf: true },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    printings: 3,
    legalPrintings: 2,
  },
  {
    text: "Search your deck for a Basic {L} Energy card and attach it to this Pokémon. Then, shuffle your deck.",
    program: [
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Lightning" },
        max: 1,
        toSelf: true,
      },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    printings: 4,
    legalPrintings: 2,
  },
  {
    text: "Search your deck for a Basic {M} Energy card and attach it to this Pokémon. Then, shuffle your deck.",
    program: [
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Metal" },
        max: 1,
        toSelf: true,
      },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    printings: 1,
    legalPrintings: 1,
  },
  {
    text: "Search your deck for up to 2 Basic {W} Energy cards and attach them to this Pokémon. Then, shuffle your deck.",
    program: [
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Water" },
        max: 2,
        toSelf: true,
      },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    printings: 2,
    legalPrintings: 2,
  },
  {
    text: "Search your deck for up to 3 Basic Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.",
    program: [
      { op: "attachFromDeck", filter: { kind: "basicEnergy" }, max: 3 },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    printings: 3,
    legalPrintings: 3,
  },
  {
    text: "Search your deck for up to 2 Basic Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.",
    program: [
      { op: "attachFromDeck", filter: { kind: "basicEnergy" }, max: 2 },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    printings: 2,
    legalPrintings: 2,
  },
  {
    text: "Search your deck for up to 2 Basic {L} Energy cards and attach them to your Benched Pokémon in any way you like. Then, shuffle your deck.",
    program: [
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Lightning" },
        max: 2,
        benchOnly: true,
      },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    printings: 1,
    legalPrintings: 1,
  },
  {
    text: "Search your deck for a Basic {W} Energy card and attach it to 1 of your Pokémon. Then, shuffle your deck.",
    program: [
      { op: "attachFromDeck", filter: { kind: "basicEnergy", energyType: "Water" }, max: 1 },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    printings: 1,
    legalPrintings: 1,
  },
  {
    text: "Search your deck for a Basic {R} Energy card and attach it to 1 of your Pokémon. Then, shuffle your deck.",
    program: [
      { op: "attachFromDeck", filter: { kind: "basicEnergy", energyType: "Fire" }, max: 1 },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    printings: 1,
    legalPrintings: 1,
  },
  {
    text: "Search your deck for a Basic {G} Energy card and attach it to 1 of your Pokémon. Then, shuffle your deck.",
    program: [
      { op: "attachFromDeck", filter: { kind: "basicEnergy", energyType: "Grass" }, max: 1 },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    printings: 1,
    legalPrintings: 1,
  },
  {
    text: "Search your deck for a Basic {F} Energy card and attach it to 1 of your Pokémon. Then, shuffle your deck.",
    program: [
      { op: "attachFromDeck", filter: { kind: "basicEnergy", energyType: "Fighting" }, max: 1 },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    printings: 1,
    legalPrintings: 1,
  },
  /** ⚠️ THE ONE SENTENCE WITH A §9.2 TAIL, and the only three-op program in the
      family. `recordAs` is set ONLY here, because the gate that reads it exists
      only here — an unread filing would be a field with no observable meaning
      (D135), and these rows are compared BY VALUE against Janine's hand-authored
      registry ones. */
  {
    text: "Search your deck for up to 2 Basic {D} Energy cards and attach them to this Pokémon. Then, shuffle your deck. If you attached Energy to a Pokémon in this way, this Pokémon is now Poisoned.",
    program: [
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Darkness" },
        max: 2,
        toSelf: true,
        recordAs: "moved",
      },
      { op: "shuffleDeck" },
      {
        op: "recordGate",
        slot: "moved",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "applyStatus", target: "self", status: "poisoned" }],
      },
    ] as EffectOp[],
    printings: 3,
    legalPrintings: 3,
  },
] as const;

const SELF_BARE = 0;
const SELF_LIGHTNING = 1;
const SELF_METAL = 2;
const SELF_WATER_TWO = 3;
const ANY_WAY_THREE = 4;
const BENCH_ANY_WAY = 6;
const ONE_OF_WATER = 7;
const POISON_TAIL = 11;

/** 🛑 THE RESIDUE, MEASURED. Eight legal printings over five sentences, each
    refused for a DIFFERENT reason, each pinned derived-to-null. `[text, legal,
    why]` — and the `why` is what the backlog sub-row carries, because "the rest
    of row 10" is how a row acquires a count nobody can reproduce.

    ⚠️ TWO OF THE FIVE WERE PRICED BY THE ROW UP FRONT AND TWO WERE NOT, which is
    itself the measurement: a row that prices its blockers is still only as good
    as the op vocabulary the pricer had in mind. */
const UNREAD = [
  [
    "Search your deck for up to 2 Basic Energy cards and attach them to 1 of your Pokémon. Then, shuffle your deck.",
    2,
    "batch onto ONE body — `attachFromDeck` has no `attachEnergyFrom.count`; NOT priced by the row",
  ],
  [
    "Search your deck for up to 2 Basic {P} Energy cards and attach them to 1 of your Benched Pokémon. Then, shuffle your deck.",
    1,
    "the same gap wearing a `benchOnly`; NOT priced by the row",
  ],
  [
    "Search your deck for up to 2 Basic Energy cards and attach them to your Future Pokémon in any way you like. Then, shuffle your deck.",
    2,
    "a SUBGROUP target — `targetType` reads `card.types`, and Future is not a type; priced by the row",
  ],
  [
    "Search your deck for up to 3 Basic Energy cards of different types and attach them to your Tera Pokémon in any way you like. Then, shuffle your deck.",
    1,
    "BOTH blockers on one printing (sv08-161): the Tera subgroup AND a distinctness `CardFilter`; priced by the row",
  ],
  [
    "Search your deck for up to 2 Basic {G} Energy cards and up to 2 Basic {L} Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.",
    2,
    "a SECOND printed noun — a different sentence SHAPE, so its own arm by D232's rule; NOT priced by the row",
  ],
] as const;

/** 🛑 THE FAMILY'S REAL NEAR MISSES, catalog rows rather than constructions. The
    first is row 9 — the anchor D234 wrote, one ZONE over — and the second is the
    ability-column printing of this very family, which begins with a §9 trigger
    clause the `^` must refuse. A build that dropped either boundary would read
    text belonging to a different op or a different entry point.

    🆕🆕 **D347 — `ABILITY_SIDE_NEAR_MISS` IS NOW A BUILT CARD, AND THE ASSERTION
    BELOW IS UNCHANGED AND STILL CORRECT.** Yanmega ex `sv10-003`/`sv10-206`/
    `sv10-228` "Buzzing Boost" is a registry program as of this slice
    (`buzzingBoost.test.ts`). The deriver must STILL refuse this string, because an
    Ability has no text deriver in this engine at all — `programFor` is its only
    reader — so "the `^` refuses it" and "the card is built" are claims about two
    different entry points and were never in tension. **Recorded because a future
    slice grepping this constant will find a shipped card and must not conclude the
    negative fixture has rotted: what would rot it is a DERIVER learning the
    sentence, and nothing here does.**

    ⚠️ **AND THE ROW-10 RESIDUE IT SITS BESIDE HAS MOVED, WHICH THIS FILE DOES NOT
    OWN.** `UNREAD[0]`'s blocker — *"batch onto ONE body; `attachFromDeck` has no
    `attachEnergyFrom.count`"* — is UNSPENT and unaffected. Yanmega's batch lands on
    the SOURCE, not on a chosen body, so `toSelf` returns a one-element target list
    and the `attachCards` prompt does the whole job. **The printed pronoun is the
    difference between the two, and a slice that priced by count alone would have
    read them as one gap.** */
const DISCARD_SIDE_NEAR_MISS =
  "Attach a Basic Energy card from your discard pile to 1 of your Pokémon.";
const ABILITY_SIDE_NEAR_MISS =
  "Once during your turn, when this Pokémon moves from your Bench to the Active Spot, you may search your deck for up to 3 Basic {G} Energy cards and attach them to this Pokémon. Then, shuffle your deck.";

// ── The board. Indices 35-42 on `fix-trainerops`, appended by D235. ──
const ENERGY_ASSIST = 35;
const ZAP_CHARGE = 36;
const AQUA_SUPPLY = 37;
const ENERGY_BOUNTY = 38;
const BENCH_CHARGE = 39;
const TOXIC_RESERVE = 40;
const WATER_DRAW = 41;
const SPLIT_SUPPLY = 42;

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: DECK_SEARCH_ATTACH_DECK, p2: DECK_SEARCH_ATTACH_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** p1 attacks with `fix-trainerops`, holding one {C} for the cost, over a Bench
    built to order. Unlike row 9's board nothing has to be moved into a pile
    first — the DECK is where the cards already are, which is the whole difference
    between the two families' setups. */
function ready(seed: number, bench: readonly string[] = ["fix-basic-1", "fix-basic-1"]): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-trainerops");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p1");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-basic-1");
  return state;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** The parked `attachCards` prompt an attack produced — the COMPOUND one (which
    cards, and where each goes), which is what separates this op from row 9's. */
function promptOf(state: GameState): Extract<EffectPrompt, { kind: "attachCards" }> {
  if (state.phase.kind !== "effect:choose") {
    throw new Error(`expected a park, got ${state.phase.kind}`);
  }
  if (state.phase.prompt.kind !== "attachCards") {
    throw new Error(`expected attachCards, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

const benchRef = (index: number): PokemonRef => ({ seat: "p1", spot: { spot: "bench", index } });
const ACTIVE_REF: PokemonRef = { seat: "p1", spot: { spot: "active" } };

function attach(state: GameState, assignments: { uid: string; to: PokemonRef }[]) {
  return mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "attachCards", assignments },
  });
}

const idsOf = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE ANCHOR
// ─────────────────────────────────────────────────────────────────────────────

describe("the anchor — twelve printed sentences, ONE arm and one optional group", () => {
  it("derives each printed sentence to its program", () => {
    for (const { text, program } of CLAUSES) {
      expect(deriveAttackEffect(text), text).toEqual(program);
    }
  });

  it("adds up: 20 of the row's 28 legal printings, and the residue is 8", () => {
    // The arithmetic stated rather than described — a slice that quietly dropped
    // one destination row would still pass every accept case above.
    expect(CLAUSES).toHaveLength(12);
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(20);
    expect(UNREAD).toHaveLength(5);
    expect(UNREAD.reduce((sum, [, legal]) => sum + legal, 0)).toBe(8);
    for (const [text] of UNREAD) expect(deriveAttackEffect(text), text).toBeNull();
    // 20 + 8 = 28 and 12 + 5 = 17: exactly the census this row was measured with.
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0) + 8).toBe(28);
    expect(CLAUSES.length + UNREAD.length).toBe(17);
  });

  it("🛑 the PREDICTION was 23 and the answer is 20 — the gap has ONE cause", () => {
    // ⚠️ THE GRADE, DRIVEN RATHER THAN NARRATED. The three printings the
    // prediction over-counted are exactly the two "attach THEM to 1 OF your …"
    // sentences, and the reason is that the same printed phrase means something
    // `attachEnergyFrom` can say and `attachFromDeck` cannot.
    const missed = UNREAD.slice(0, 2);
    expect(missed.reduce((sum, [, legal]) => sum + legal, 0)).toBe(3);
    for (const [text] of missed) {
      expect(text).toContain("attach them to 1 of your");
      expect(deriveAttackEffect(text), text).toBeNull();
    }
    // …and the SIBLING op reads the same destination phrase at the same count,
    // which is what makes this a fact about the op rather than about the anchor.
    expect(
      deriveAttackEffect(
        "Attach up to 2 Basic Energy cards from your discard pile to 1 of your Pokémon.",
      ),
    ).toEqual([{ op: "attachEnergyFrom", source: "discard", count: 2 }]);
  });

  it("🛑 the BATCH rule: the SAME destination phrase is read at 1 and refused at 2", () => {
    // ⚠️ THE FALSIFIABILITY PAIR (D231). Both sentences are printed AND legal, and
    // they differ by the number alone. A build that dropped the rule derives the
    // second to `max: 2` with no target coupling — two Energy free to land on two
    // different Pokémon off a card that prints "1 of". It passes every generic
    // attach assertion in this repo.
    expect(deriveAttackEffect(CLAUSES[ONE_OF_WATER].text)).toEqual(CLAUSES[ONE_OF_WATER].program);
    expect(deriveAttackEffect(UNREAD[0][0])).toBeNull();
    expect(CLAUSES[ONE_OF_WATER].legalPrintings).toBeGreaterThan(0);
    expect(UNREAD[0][1]).toBeGreaterThan(0);
    // …and it is the DESTINATION that decides, not the count: the same "up to 2"
    // is read when the phrase admits a batch.
    expect(deriveAttackEffect(CLAUSES[SELF_WATER_TWO].text)).not.toBeNull();
    expect(deriveAttackEffect(CLAUSES[BENCH_ANY_WAY].text)).not.toBeNull();
    // The benched twin of the refusal, so the rule is not read as "un-narrowed
    // destinations only".
    expect(deriveAttackEffect(UNREAD[1][0])).toBeNull();
    expect(
      deriveAttackEffect(
        "Search your deck for a Basic {P} Energy card and attach it to 1 of your Benched Pokémon. Then, shuffle your deck.",
      ),
    ).toEqual([
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Psychic" },
        max: 1,
        benchOnly: true,
      },
      { op: "shuffleDeck" },
    ]);
  });

  it("🛑 the §9.2 TAIL is an OPTIONAL GROUP, and its absence changes the PROGRAM", () => {
    // The tail sentence and the tail-less sentence differ by one printed clause
    // and by a whole op. A build that hard-wired the gate poisons a Wiglett; a
    // build that ignored the clause silently drops the card's second sentence.
    const gated = deriveAttackEffect(CLAUSES[POISON_TAIL].text) ?? [];
    const bare = deriveAttackEffect(CLAUSES[SELF_WATER_TWO].text) ?? [];
    expect(gated).toHaveLength(3);
    expect(bare).toHaveLength(2);
    expect(gated[2]).toEqual({
      op: "recordGate",
      slot: "moved",
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      then: [{ op: "applyStatus", target: "self", status: "poisoned" }],
    });
    // `recordAs` rides the gate and NOTHING else — an unread filing is a field
    // with no observable meaning.
    expect(gated[0]).toHaveProperty("recordAs", "moved");
    for (const { program, text } of CLAUSES) {
      if (text === CLAUSES[POISON_TAIL].text) continue;
      for (const op of program) expect(op, text).not.toHaveProperty("recordAs");
    }
    // …and the tail is matched as a LITERAL, so a paraphrase is refused whole
    // rather than read as the bare sentence with a clause thrown away.
    expect(
      deriveAttackEffect(
        `${CLAUSES[SELF_WATER_TWO].text} If you attached Energy to a Pokémon in this way, this Pokémon is now Asleep.`,
      ),
    ).toBeNull();
  });

  it("the NOUN and the DESTINATION are independent axes, which is why it is one arm", () => {
    // ⚠️ THE PREDICTION'S CORRECT HALF, DRIVEN. If the twelve sentences were
    // twelve arms, changing the noun would be free to change something other than
    // `filter.energyType`, and changing the destination free to change something
    // other than the riders. Both are asserted as "differs in exactly one key".
    const [bare] = deriveAttackEffect(CLAUSES[SELF_BARE].text) ?? [];
    const [typed] = deriveAttackEffect(CLAUSES[SELF_LIGHTNING].text) ?? [];
    const [metal] = deriveAttackEffect(CLAUSES[SELF_METAL].text) ?? [];
    expect(typed).toEqual({ ...bare, filter: { kind: "basicEnergy", energyType: "Lightning" } });
    expect(metal).toEqual({ ...bare, filter: { kind: "basicEnergy", energyType: "Metal" } });
    // …and the count rides the same arm at a value no card prints today, which is
    // the whole reason it is a capture rather than an alternation over 2 and 3.
    expect(
      deriveAttackEffect(
        "Search your deck for up to 7 Basic Energy cards and attach them to your Benched Pokémon in any way you like. Then, shuffle your deck.",
      ),
    ).toEqual([
      { op: "attachFromDeck", filter: { kind: "basicEnergy" }, max: 7, benchOnly: true },
      { op: "shuffleDeck" },
    ]);
  });

  it("a SINGULAR printing emits `max: 1`, never a missing max", () => {
    // The absent count IS the article. Unlike `attachEnergyFrom.count` this field
    // is REQUIRED on the op, so "absent means 1" resolves at the anchor rather
    // than at the interpreter — stated because the sibling family's identical
    // sentence resolves the other way, and a reader who learned that rule there
    // would carry the wrong one here.
    for (const index of [SELF_BARE, SELF_LIGHTNING, SELF_METAL, ONE_OF_WATER]) {
      expect(CLAUSES[index]?.program[0]).toHaveProperty("max", 1);
    }
  });

  it("🛑 the ZONE is one word from row 9, and the ENTRY POINT one clause from the ability half", () => {
    // Both are CATALOG rows. The discard-pile spelling is a different op entirely
    // (D234's anchor, 5 legal printings still owed); the ability spelling is 4
    // legal printings of THIS family that no reader may ever reach, because an
    // Ability is a hand-authored registry row forever.
    expect(deriveAttackEffect(DISCARD_SIDE_NEAR_MISS)).toEqual([
      { op: "attachEnergyFrom", source: "discard" },
    ]);
    expect(deriveAttackEffect(ABILITY_SIDE_NEAR_MISS)).toBeNull();
    expect(ABILITY_SIDE_NEAR_MISS).toContain("you may search your deck for");
  });

  it("refuses the anchor, grammar, punctuation and case rewrites", () => {
    const bare = CLAUSES[SELF_BARE].text;
    const rewrites = [
      // A leading clause — the shape a `$`-only build eats. ⚠️ THE POOL HAS A REAL
      // ONE: `ABILITY_SIDE_NEAR_MISS` above.
      `Draw a card. ${bare}`,
      // 🛑 A TRAILING CLAUSE — the shape a `$`-only build eats, and here it is the
      // mutant that matters: with an OPTIONAL tail group on the anchor, dropping
      // `$` makes this derive with the clause silently thrown away. Constructed,
      // and said so — no printing in this family carries an unrecognised tail.
      `${bare} Draw a card.`,
      // Case, both ends.
      bare.replace("Search", "search"),
      bare.replace("Basic", "basic"),
      // The trailing period.
      bare.slice(0, -1),
      // The printed shuffle, which every card in the family prints and which the
      // trailing `shuffleDeck` op is.
      bare.replace(" Then, shuffle your deck.", ""),
      // 🛑 THE GRAMMATICAL CROSSES, which the pronoun weld exists to refuse: no
      // card prints either, and an `it|them` build would read both.
      "Search your deck for a Basic Energy card and attach them to this Pokémon. Then, shuffle your deck.",
      "Search your deck for up to 2 Basic Energy cards and attach it to this Pokémon. Then, shuffle your deck.",
      // A printed 0 would derive to a search that moves nothing and shuffles anyway.
      "Search your deck for up to 0 Basic Energy cards and attach them to this Pokémon. Then, shuffle your deck.",
      // …and past the shared ingested-text ceiling.
      "Search your deck for up to 11 Basic Energy cards and attach them to this Pokémon. Then, shuffle your deck.",
      // The DISCARD PILE, which is row 9's op (`attachEnergyFrom`).
      "Search your discard pile for a Basic Energy card and attach it to this Pokémon. Then, shuffle your deck.",
      // A destination the table does not name — the residue's own shape, and the
      // reason the phrase is a Map lookup rather than a `.+` the arm trusts.
      "Search your deck for a Basic Energy card and attach it to your opponent's Active Pokémon. Then, shuffle your deck.",
      // A brace code the ENERGY map refuses ({C} is the provision fallback).
      "Search your deck for a Basic {C} Energy card and attach it to this Pokémon. Then, shuffle your deck.",
      // A SPECIAL Energy — the noun is welded to "Basic", and `attachableEnergies`
      // could not honour the wider one anyway.
      "Search your deck for an Energy card and attach it to this Pokémon. Then, shuffle your deck.",
    ];
    for (const text of rewrites) expect(deriveAttackEffect(text), text).toBeNull();
  });

  it("carries NO new op and NO new op FIELD — the honest price of the arm", () => {
    // `attachFromDeck` has run since M5-D50 with every key any arm here sets;
    // `shuffleDeck`, `recordGate` and `applyStatus` are all older still.
    const known: Record<string, readonly string[]> = {
      attachFromDeck: ["op", "filter", "max", "toSelf", "benchOnly", "targetType", "recordAs"],
      shuffleDeck: ["op"],
      recordGate: ["op", "slot", "then"],
    };
    for (const { program, text } of CLAUSES) {
      for (const op of program) {
        expect(Object.keys(known), text).toContain(op.op);
        for (const key of Object.keys(op)) expect(known[op.op], `${op.op}.${key}`).toContain(key);
      }
    }
  });

  it("the brace-coded destination is generated from POKEMON_TYPE_BY_CODE, not listed", () => {
    // ⚠️ THE MAP IS TOTAL OVER `POKEMON_TYPES` BY CONSTRUCTION — a type added to
    // the schema is admitted here without an edit. BOTH generated forms, because
    // this table carries the "in any way you like" spelling as well as the "1 of"
    // one, and the two land on opposite sides of the `batch` rule.
    expect(new Set(Object.values(POKEMON_TYPE_BY_CODE))).toEqual(new Set(POKEMON_TYPES));
    for (const [code, type] of Object.entries(POKEMON_TYPE_BY_CODE)) {
      expect(
        deriveAttackEffect(
          `Search your deck for a Basic Energy card and attach it to 1 of your {${code}} Pokémon. Then, shuffle your deck.`,
        ),
        code,
      ).toEqual([
        { op: "attachFromDeck", filter: { kind: "basicEnergy" }, max: 1, targetType: type },
        { op: "shuffleDeck" },
      ]);
      expect(
        deriveAttackEffect(
          `Search your deck for up to 2 Basic Energy cards and attach them to your {${code}} Pokémon in any way you like. Then, shuffle your deck.`,
        ),
        code,
      ).toEqual([
        { op: "attachFromDeck", filter: { kind: "basicEnergy" }, max: 2, targetType: type },
        { op: "shuffleDeck" },
      ]);
      // …and the "1 of" form is still refused at the plural, generated rows
      // included: the `batch` rule is a property of the TABLE, not of five
      // hand-written rows.
      expect(
        deriveAttackEffect(
          `Search your deck for up to 2 Basic Energy cards and attach them to 1 of your {${code}} Pokémon. Then, shuffle your deck.`,
        ),
        code,
      ).toBeNull();
    }
    // …and a code in NEITHER map is refused rather than silently dropped.
    expect(
      deriveAttackEffect(
        "Search your deck for a Basic Energy card and attach it to 1 of your {Z} Pokémon. Then, shuffle your deck.",
      ),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE FIXTURE — the printings, present and pinned
// ─────────────────────────────────────────────────────────────────────────────

describe("PROVENANCE — the demonstrator carries eight of the sentences at 35-42", () => {
  const attacks = () => FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];

  it("fields the family at indices 35-42, appended and not inserted", () => {
    // 48 at D236, which appended 43-47 (attach from the HAND — this family's own
    // op one SOURCE ZONE and one op over); 43 at D235, which appended 35-42; 35 at
    // D234, 29 at D232, 25 at D231, 20 at
    // D230, 17 at D229, 14 at D228, 13 at D227, 9 at D189, 8 at D181. TEN slices,
    // ten appends, zero inserts — which is what every index constant in ten
    // suites depends on.
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
    // 🆕🆕 **66 AT D442**, which appended **63-65** — the destination-side SPREAD
    // (`derivedSpreadEnergyMove.test.ts` owns them). ELEVEN sibling suites carry this
    // same length pin and ALL of them were stepped in one pass (D431): a green run
    // after fixing the one that reddened is evidence the runner stopped early.
    expect(attacks()).toHaveLength(66);
    expect(attacks()[ENERGY_ASSIST]?.effect).toBe(CLAUSES[SELF_BARE].text);
    expect(attacks()[ZAP_CHARGE]?.effect).toBe(CLAUSES[SELF_LIGHTNING].text);
    expect(attacks()[AQUA_SUPPLY]?.effect).toBe(CLAUSES[SELF_WATER_TWO].text);
    expect(attacks()[ENERGY_BOUNTY]?.effect).toBe(CLAUSES[ANY_WAY_THREE].text);
    expect(attacks()[BENCH_CHARGE]?.effect).toBe(CLAUSES[BENCH_ANY_WAY].text);
    expect(attacks()[TOXIC_RESERVE]?.effect).toBe(CLAUSES[POISON_TAIL].text);
    expect(attacks()[WATER_DRAW]?.effect).toBe(CLAUSES[ONE_OF_WATER].text);
    // …and the one that is DELIBERATELY UNREAD, fielded so the refusal has a live
    // subject on a real board rather than a comment (D181's `Strafe` precedent).
    expect(attacks()[SPLIT_SUPPLY]?.effect).toBe(UNREAD[0][0]);
    // The indices the sibling suites address by constant did not move.
    expect(attacks()[2]?.effect).toBe(
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
    );
    expect(attacks()[34]?.effect).toBe(
      "Attach a Basic {F} Energy card from your discard pile to each of your Benched Pokémon.",
    );
  });

  it("NO printed base damage on any of the eight — stated, because it is MEASURED", () => {
    // All 28 legal printings in this family print a bare effect. Said out loud
    // because D229's identical omission is a deliberate DIVERGENCE from the
    // catalog, and a reader who learned the reason there would carry the wrong one
    // here.
    for (const index of [
      ENERGY_ASSIST,
      ZAP_CHARGE,
      AQUA_SUPPLY,
      ENERGY_BOUNTY,
      BENCH_CHARGE,
      TOXIC_RESERVE,
      WATER_DRAW,
      SPLIT_SUPPLY,
    ]) {
      expect(attacks()[index]?.damage, `index ${index}`).toBeUndefined();
    }
    // …and the neighbouring index that DOES print a number still does.
    expect(attacks()[3]?.damage).toBe(60);
  });

  it("the demonstrator's own attack rows still DERIVE to this slice's programs", () => {
    // The round trip: the fixture strings are the CLAIM, so they are read back
    // through the deriver rather than compared to the constants alone. An arm
    // authored against a paraphrase passes a test written against the same
    // paraphrase and matches no real card (D183).
    expect(deriveAttackEffect(attacks()[TOXIC_RESERVE]?.effect ?? "")).toEqual(
      CLAUSES[POISON_TAIL].program,
    );
    expect(deriveAttackEffect(attacks()[SPLIT_SUPPLY]?.effect ?? "")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE POINT OF THE SLICE — where the Energy lands
// ─────────────────────────────────────────────────────────────────────────────

describe("end to end — an ATTACK searching its own deck for Energy", () => {
  it("the SELF target forces the DESTINATION and still asks WHICH card", () => {
    // ⚠️ THE PARK IS COMPOUND HERE, which is the structural difference from row
    // 9's `choosePokemon`: `toSelf` collapses the TARGET list to one ref, and the
    // question that remains is which cards leave the deck.
    const state = ready(3);
    const attacker = activeUid(state, "p1");
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: AQUA_SUPPLY,
    });

    const prompt = promptOf(parked);
    // 🛑 ONE TARGET, and it is the ATTACKER — the discriminator against a build
    // that dropped `toSelf`: with two Benched bodies on this board, THAT build
    // offers three.
    expect(prompt.targets).toEqual([ACTIVE_REF]);
    expect(prompt.max).toBe(2);
    // 🛑 AND THE TYPE FILTER BIT: the deck holds {C}, {L} and {D} too, and only
    // {W} was offered. A build that dropped `filter.energyType` offers the lot.
    expect(new Set(idsOf(parked, prompt.candidates))).toEqual(new Set(["fix-water-energy"]));

    const { state: done, events } = attach(parked, [
      { uid: prompt.candidates[0] as string, to: ACTIVE_REF },
      { uid: prompt.candidates[1] as string, to: ACTIVE_REF },
    ]);
    const attached = all(events, "ENERGY_ATTACHED");
    expect(attached).toHaveLength(2);
    for (const e of attached) expect(e.target).toEqual({ spot: "active" });
    expect(done.players.p1.active?.energy).toHaveLength(3); // the {C} cost + two {W}
    expect(activeUid(done, "p1")).toBe(attacker);
    // …and the printed shuffle ran: the deck is the same size minus what moved.
    expect(done.phase.kind).not.toBe("effect:choose");
  });

  it("the BENCH-ONLY spread offers the Bench alone — the attacker is not a target", () => {
    const state = ready(5);
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: BENCH_CHARGE,
    });

    const prompt = promptOf(parked);
    // 🛑 THE ASSERTION THE `benchOnly` RIDER IS ABOUT: two Benched bodies, and the
    // ATTACKER — in play, the controller's, eligible under an un-narrowed set —
    // is absent.
    expect(prompt.targets).toHaveLength(2);
    for (const ref of prompt.targets) expect(ref.spot.spot).toBe("bench");
    expect(prompt.targets).not.toContainEqual(ACTIVE_REF);

    // …and "in any way you like" means the two cards may land APART, which is the
    // half of the printed phrase a per-target cap would forbid.
    const { state: done, events } = attach(parked, [
      { uid: prompt.candidates[0] as string, to: benchRef(0) },
      { uid: prompt.candidates[1] as string, to: benchRef(1) },
    ]);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(2);
    expect(done.players.p1.bench[0]?.energy).toHaveLength(1);
    expect(done.players.p1.bench[1]?.energy).toHaveLength(1);
    expect(done.players.p1.active?.energy).toHaveLength(1); // the {C} cost, untouched
  });

  it("the un-narrowed spread offers the ATTACKER too, and all three may land on ONE body", () => {
    const state = ready(7);
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: ENERGY_BOUNTY,
    });

    const prompt = promptOf(parked);
    expect(prompt.targets).toHaveLength(3);
    expect(prompt.targets).toContainEqual(ACTIVE_REF);
    expect(prompt.max).toBe(3);
    // 🛑 NO `maxPerTarget`: the printed "in any way you like" permits every card
    // on one Pokémon, and this is the board that says so.
    expect(prompt).not.toHaveProperty("maxPerTarget");
    const { state: done, events } = attach(
      parked,
      prompt.candidates.slice(0, 3).map((uid) => ({ uid, to: benchRef(0) })),
    );
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(3);
    expect(done.players.p1.bench[0]?.energy).toHaveLength(3);
  });

  it("🛑 the §9.2 TAIL poisons the attacker — and only when something attached", () => {
    const state = ready(9);
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: TOXIC_RESERVE,
    });
    const prompt = promptOf(parked);
    expect(new Set(idsOf(parked, prompt.candidates))).toEqual(new Set(["fix-darkness-energy"]));
    // ⚠️ THE PARK ANNOUNCES WHAT ITS ANSWER BUYS — `withConsequence` reads the
    // gate out of the queue and appends the clause. This is the FIRST attack
    // program in the pool to reach that describer, and it prices at zero because
    // the `self` arm of `applyStatus` was already written for Janine.
    expect(prompt.note).toContain("If you do, it is now Poisoned");

    const { state: done } = attach(parked, [
      { uid: prompt.candidates[0] as string, to: ACTIVE_REF },
    ]);
    expect(done.players.p1.active?.conditions.poisonDamage).toBeGreaterThan(0);
  });

  it("🛑 …and an EMPTY answer files nothing, so the gate does NOT poison", () => {
    // ⚠️ THE PAIR THAT MAKES THE GATE LOAD-BEARING. Same board, same attack, same
    // prompt — the player declines, `attachFromDeck` files an empty record, and
    // `recordGateHolds` reads false. A build that put the poison beside the attach
    // instead of behind the gate poisons here too, and passes the case above.
    const state = ready(9);
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: TOXIC_RESERVE,
    });
    const { state: done, events } = attach(parked, []);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(done.players.p1.active?.conditions.poisonDamage).toBe(0);
    expect(done.phase.kind).not.toBe("effect:choose");
  });

  it("the TAIL-LESS sibling never poisons, on the same board", () => {
    // The other direction of the same pair: Aqua Supply prints no §9.2 clause, so
    // a build that hard-wired the poison onto every `toSelf` batch fails here.
    const state = ready(9);
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: AQUA_SUPPLY,
    });
    const { state: done } = attach(parked, [
      { uid: promptOf(parked).candidates[0] as string, to: ACTIVE_REF },
    ]);
    expect(done.players.p1.active?.energy).toHaveLength(2);
    expect(done.players.p1.active?.conditions.poisonDamage).toBe(0);
  });

  it("a deck with NO matching Energy is a silent whiff, not a refusal", () => {
    // 🛑 THE HALF THAT SEPARATES AN ATTACK FROM A CARD PLAY, and the reason
    // `programPlayable` prices at ZERO for this slice — twice over. §8: the attack
    // was declared and paid for, so a program that can do nothing still RESOLVES.
    // And `attachFromDeck` is deliberately UNGATED even on the card-play path
    // (cardplay.ts), because every carrier prints a shuffle, which always
    // resolves (ruling/284) — so unlike row 9's op the contrast is NOT a refusal.
    const state = ready(11);
    const emptied: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          deck: state.players.p1.deck.filter(
            (uid) => state.cardIdByUid[uid] !== "fix-water-energy",
          ),
        },
      },
    };
    deepFreeze(emptied);
    const { state: done, events } = mustApply(emptied, {
      type: "attack",
      seat: "p1",
      index: AQUA_SUPPLY,
    });
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(all(events, "ATTACK_DECLARED")).toHaveLength(1);
    // 🛑 AND THE CARD-PLAY GATE AGREES ON BOTH BOARDS, which is the measurement
    // rather than the assumption: this op is not in `programPlayable`'s list at
    // all, so an empty deck is still "playable".
    expect(programPlayable(emptied, CLAUSES[SELF_WATER_TWO].program, "p1")).toBe(true);
    expect(programPlayable(state, CLAUSES[SELF_WATER_TWO].program, "p1")).toBe(true);
  });

  it("🛑 the UNREAD sentence is on the board and resolves to NOTHING", () => {
    // The refusal with a live subject. `Split Supply` is a real printed attack on
    // the demonstrator, over a deck full of Basic Energy and two Benched bodies —
    // and the effect is SKIPPED, because no reader resolves it. A slice that
    // dropped the `batch` rule turns this green while letting the two cards land
    // apart, which is precisely the bug it cannot otherwise be caught doing.
    const state = ready(13);
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SPLIT_SUPPLY,
    });
    expect(all(events, "ATTACK_DECLARED")).toHaveLength(1);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(done.players.p1.bench.every((p) => p.energy.length === 0)).toBe(true);
  });

  it("the search is the ATTACKER's own deck and own board, on both ends", () => {
    // The one-`otherSeat`-apart pairing every op in this family owes: a build that
    // read the opponent's deck, or attached on their side, would pass every count
    // assertion above. Both zones are named.
    const state = ready(15);
    const opponentDeck = state.players.p2.deck.length;
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: ENERGY_BOUNTY,
    });
    for (const ref of promptOf(parked).targets) expect(ref.seat).toBe("p1");
    for (const uid of promptOf(parked).candidates) {
      expect(state.players.p1.deck).toContain(uid);
    }
    const { state: done } = attach(parked, [
      { uid: promptOf(parked).candidates[0] as string, to: ACTIVE_REF },
    ]);
    // ⚠️ EXACTLY ONE card left p2's deck and it is the TURN-START DRAW: resolving
    // the last park finishes the attack, which ends the turn. Asserted as the
    // number rather than skipped, because "the opponent's deck did not move" is
    // the claim and 1 is the only movement §3 permits here.
    expect(opponentDeck - done.players.p2.deck.length).toBe(1);
    expect(done.players.p2.bench.every((p) => p.energy.length === 0)).toBe(true);
    expect(done.players.p2.active?.energy).toHaveLength(0);
  });
});

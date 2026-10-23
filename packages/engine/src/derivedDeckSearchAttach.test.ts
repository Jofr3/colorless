import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { engineVersion } from "./index";
import { programPlayable } from "./cardplay";
import { programFor, registryCardIds } from "./registry";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { POKEMON_TYPE_BY_CODE, POKEMON_TYPES, deriveAttackEffect } from "./effects";
import type { EffectOp, GameEvent, GameState, PokemonRef } from "./index";
import type { EffectPrompt } from "./interpreter";
import {
  DECK_SEARCH_ATTACH_DECK,
  FIXTURE_POOL,
  TWO_NOUN_SEARCH_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  expectErr,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

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
        then: [{ op: "applyStatus", target: "self", status: "poisoned" }],
      },
    ] as EffectOp[],
    printings: 3,
    legalPrintings: 3,
  },
  {
    text: "Search your deck for up to 2 Basic Energy cards and attach them to 1 of your Pokémon. Then, shuffle your deck.",
    program: [
      { op: "attachFromDeck", filter: { kind: "basicEnergy" }, max: 2, oneTarget: true },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    printings: 2,
    legalPrintings: 2,
  },
  {
    text: "Search your deck for up to 2 Basic {P} Energy cards and attach them to 1 of your Benched Pokémon. Then, shuffle your deck.",
    program: [
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Psychic" },
        max: 2,
        benchOnly: true,
        oneTarget: true,
      },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    printings: 1,
    legalPrintings: 1,
  },
  {
    text: "Search your deck for up to 2 Basic {G} Energy cards and up to 2 Basic {L} Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.",
    program: [
      { op: "attachFromDeck", filter: { kind: "basicEnergy", energyType: "Grass" }, max: 2 },
      { op: "attachFromDeck", filter: { kind: "basicEnergy", energyType: "Lightning" }, max: 2 },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    printings: 2,
    legalPrintings: 2,
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
const ONE_OF_TWO = 12;
const ONE_OF_BENCH_TWO = 13;
const TWO_NOUNS = 14;

const UNREAD = [
  [
    "Search your deck for up to 2 Basic Energy cards and attach them to your Future Pokémon in any way you like. Then, shuffle your deck.",
    2,
    "a SUBGROUP target — `targetType` reads `card.types`, and Future is not a type; priced by the row",
  ],
  [
    "Search your deck for up to 3 Basic Energy cards of different types and attach them to your Tera Pokémon in any way you like. Then, shuffle your deck.",
    1,
    "BOTH blockers on one printing (sv08-161): the Tera subgroup AND a distinctness constraint the anchor's welded `Energy cards and attach them` does not even admit — \ud83c\udd95 D513 corrected the CARRIER, which read `CardFilter`; no filter can express a pairwise relation among the picks, and the hand-side twin (corpus FILE LINE 473) was built instead through `searchDeck.distinctEnergyTypes` + `chooseCards.caps`",
  ],
] as const;

const DISCARD_SIDE_NEAR_MISS =
  "Attach a Basic Energy card from your discard pile to 1 of your Pokémon.";
const ABILITY_SIDE_NEAR_MISS =
  "Once during your turn, when this Pokémon moves from your Bench to the Active Spot, you may search your deck for up to 3 Basic {G} Energy cards and attach them to this Pokémon. Then, shuffle your deck.";

const ENERGY_ASSIST = 35;
const ZAP_CHARGE = 36;
const AQUA_SUPPLY = 37;
const ENERGY_BOUNTY = 38;
const BENCH_CHARGE = 39;
const TOXIC_RESERVE = 40;
const WATER_DRAW = 41;
const SPLIT_SUPPLY = 42;
const SPLIT_HARVEST = 72;

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: DECK_SEARCH_ATTACH_DECK, p2: DECK_SEARCH_ATTACH_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

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

function readyTwoNoun(
  seed: number,
  bench: readonly string[] = ["fix-basic-1", "fix-basic-1"],
): GameState {
  const start = mustApply(
    driveSetup(seed, { p1: TWO_NOUN_SEARCH_DECK, p2: TWO_NOUN_SEARCH_DECK }, { first: "p2" }),
    { type: "endTurn", seat: "p2" },
  ).state;
  let state = setActiveFromDeck(start, "p1", "fix-trainerops");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p1");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-basic-1");
  return state;
}

function withoutCard(state: GameState, id: string): GameState {
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...state.players.p1,
        deck: state.players.p1.deck.filter((uid) => state.cardIdByUid[uid] !== id),
      },
    },
  };
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

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

describe("the anchor — fifteen printed sentences, ONE arm and TWO optional groups", () => {
  it("derives each printed sentence to its program", () => {
    for (const { text, program } of CLAUSES) {
      expect(deriveAttackEffect(text), text).toEqual(program);
    }
  });

  it("adds up: 25 of the row's 28 legal printings, and the residue is 3", () => {
    expect(CLAUSES).toHaveLength(15);
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(25);
    expect(UNREAD).toHaveLength(2);
    expect(UNREAD.reduce((sum, [, legal]) => sum + legal, 0)).toBe(3);
    for (const [text] of UNREAD) expect(deriveAttackEffect(text), text).toBeNull();
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0) + 3).toBe(28);
    expect(CLAUSES.length + UNREAD.length).toBe(17);
  });

  it("D458 — the SECOND printed noun is ONE optional group, and the axis is the NOUN COUNT", () => {
    const both = CLAUSES[TWO_NOUNS].text;
    const grassOnly =
      "Search your deck for up to 2 Basic {G} Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.";
    const lightningOnly =
      "Search your deck for up to 2 Basic {L} Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.";
    expect(both.replace(" and up to 2 Basic {L} Energy cards", "")).toBe(grassOnly);
    expect(both.replace("up to 2 Basic {G} Energy cards and ", "")).toBe(lightningOnly);
    // …and each half derives to exactly the op the two-noun program's own half is.
    expect(deriveAttackEffect(grassOnly)).toEqual([
      CLAUSES[TWO_NOUNS].program[0],
      { op: "shuffleDeck" },
    ]);
    expect(deriveAttackEffect(lightningOnly)).toEqual([
      CLAUSES[TWO_NOUNS].program[1],
      { op: "shuffleDeck" },
    ]);
    expect(deriveAttackEffect(both)).toHaveLength(3);
    expect(
      deriveAttackEffect(
        "Search your deck for up to 4 Basic Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.",
      ),
    ).toEqual([
      { op: "attachFromDeck", filter: { kind: "basicEnergy" }, max: 4 },
      { op: "shuffleDeck" },
    ]);
    expect(deriveAttackEffect(both)?.filter((op) => op.op === "shuffleDeck")).toHaveLength(1);
    expect(deriveAttackEffect(both)?.at(-1)).toEqual({ op: "shuffleDeck" });
  });

  it("D458 — the second noun is REFUSED beside a coupling it cannot honour, and ADMITTED without one", () => {
    const twoNounRefusals = [
      "Search your deck for up to 2 Basic {G} Energy cards and up to 2 Basic {L} Energy cards and attach them to 1 of your Pokémon. Then, shuffle your deck.",
      "Search your deck for up to 2 Basic {G} Energy cards and up to 2 Basic {L} Energy cards and attach them to 1 of your Benched Pokémon. Then, shuffle your deck.",
      "Search your deck for up to 2 Basic {G} Energy cards and up to 2 Basic {L} Energy cards and attach them to this Pokémon. Then, shuffle your deck. If you attached Energy to a Pokémon in this way, this Pokémon is now Poisoned.",
    ];
    for (const text of twoNounRefusals) expect(deriveAttackEffect(text), text).toBeNull();
    for (const text of twoNounRefusals) {
      expect(
        deriveAttackEffect(text.replace(" and up to 2 Basic {L} Energy cards", "")),
        text,
      ).not.toBeNull();
    }
    expect(
      deriveAttackEffect(
        "Search your deck for up to 2 Basic {G} Energy cards and up to 2 Basic {L} Energy cards and attach them to this Pokémon. Then, shuffle your deck.",
      ),
    ).toEqual([
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Grass" },
        max: 2,
        toSelf: true,
      },
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Lightning" },
        max: 2,
        toSelf: true,
      },
      { op: "shuffleDeck" },
    ]);
    expect(
      deriveAttackEffect(
        "Search your deck for up to 2 Basic {G} Energy cards and up to 2 Basic {L} Energy cards and attach them to 1 of your {R} Pokémon. Then, shuffle your deck.",
      ),
    ).toBeNull();
    expect(
      deriveAttackEffect(
        "Search your deck for up to 2 Basic {G} Energy cards and up to 2 Basic {L} Energy cards and attach them to your {R} Pokémon in any way you like. Then, shuffle your deck.",
      ),
    ).toEqual([
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Grass" },
        max: 2,
        targetType: "Fire",
      },
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Lightning" },
        max: 2,
        targetType: "Fire",
      },
      { op: "shuffleDeck" },
    ]);
  });

  it("D458 — the second noun's own grammar rewrites are refused", () => {
    // The optional group is welded as a UNIT, which is what stops it loosening the
    // anchor for every OTHER sentence in the family. Each rewrite is one token off
    // the printed line.
    const rewrites = [
      // The SINGULAR branch cannot take the group — the pronoun stays welded.
      "Search your deck for a Basic {G} Energy card and up to 2 Basic {L} Energy cards and attach it to your Pokémon in any way you like. Then, shuffle your deck.",
      // "Basic" is not optional on the second noun either.
      "Search your deck for up to 2 Basic {G} Energy cards and up to 2 Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.",
      // A brace code the ENERGY map refuses, on the SECOND noun this time.
      "Search your deck for up to 2 Basic {G} Energy cards and up to 2 Basic {C} Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.",
      // A printed 0 and the shared ingested-text ceiling, both on the SECOND cap —
      // the guards are duplicated deliberately, because a build that checked only
      // the first count passes every accept case in this file.
      "Search your deck for up to 2 Basic {G} Energy cards and up to 0 Basic {L} Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.",
      "Search your deck for up to 2 Basic {G} Energy cards and up to 11 Basic {L} Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.",
      "Search your deck for up to 2 Basic {G} Energy cards and up to 2 Basic {L} Energy cards and up to 2 Basic {W} Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.",
      "Search your deck for up to 2 in any combination of Basic {G} Energy cards and Basic {L} Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.",
    ];
    for (const text of rewrites) expect(deriveAttackEffect(text), text).toBeNull();
  });

  it("D235's PREDICTION WAS 23, ITS ANSWER WAS 20, AND D457 MAKES THE ANSWER 23 — for the reason the grade named", () => {
    const repaired = [CLAUSES[ONE_OF_TWO], CLAUSES[ONE_OF_BENCH_TWO]] as const;
    expect(repaired.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(3);
    for (const { text, program } of repaired) {
      expect(text).toContain("attach them to 1 of your");
      expect(deriveAttackEffect(text), text).toEqual(program);
      expect(deriveAttackEffect(text)?.[0]).toHaveProperty("oneTarget", true);
    }
    // …and the SIBLING op still reads the same destination phrase at the same
    // count through its OWN field, which is what makes the two readings a pair
    // rather than one mechanism spelled twice.
    expect(
      deriveAttackEffect(
        "Attach up to 2 Basic Energy cards from your discard pile to 1 of your Pokémon.",
      ),
    ).toEqual([{ op: "attachEnergyFrom", source: "discard", count: 2 }]);
  });

  it("the BATCH rule: the SAME destination phrase is read BARE at 1 and COUPLED at 2", () => {
    expect(deriveAttackEffect(CLAUSES[ONE_OF_WATER].text)).toEqual(CLAUSES[ONE_OF_WATER].program);
    expect(CLAUSES[ONE_OF_WATER].program[0]).not.toHaveProperty("oneTarget");
    expect(deriveAttackEffect(CLAUSES[ONE_OF_TWO].text)).toEqual(CLAUSES[ONE_OF_TWO].program);
    expect(CLAUSES[ONE_OF_TWO].program[0]).toHaveProperty("oneTarget", true);
    expect(CLAUSES[ONE_OF_WATER].legalPrintings).toBeGreaterThan(0);
    expect(CLAUSES[ONE_OF_TWO].legalPrintings).toBeGreaterThan(0);
    // …and it is the DESTINATION that decides whether the rider is owed, not the
    // count: the same "up to 2" carries NO coupling when the phrase admits a
    // batch, which is the half of the rule a `count > 1` build alone would lose.
    expect(deriveAttackEffect(CLAUSES[SELF_WATER_TWO].text)).toEqual(
      CLAUSES[SELF_WATER_TWO].program,
    );
    expect(CLAUSES[SELF_WATER_TWO].program[0]).not.toHaveProperty("oneTarget");
    expect(deriveAttackEffect(CLAUSES[ANY_WAY_THREE].text)?.[0]).not.toHaveProperty("oneTarget");
    expect(deriveAttackEffect(CLAUSES[BENCH_ANY_WAY].text)?.[0]).not.toHaveProperty("oneTarget");
    // The benched twin on both sides, so the rule is not read as "un-narrowed
    // destinations only": the rider rides beside `benchOnly` at 2 and is absent
    // at 1.
    expect(deriveAttackEffect(CLAUSES[ONE_OF_BENCH_TWO].text)).toEqual(
      CLAUSES[ONE_OF_BENCH_TWO].program,
    );
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

  it("the §9.2 TAIL is an OPTIONAL GROUP, and its absence changes the PROGRAM", () => {
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
    for (const index of [SELF_BARE, SELF_LIGHTNING, SELF_METAL, ONE_OF_WATER]) {
      expect(CLAUSES[index]?.program[0]).toHaveProperty("max", 1);
    }
  });

  it("the ZONE is one word from row 9, and the ENTRY POINT one clause from the ability half", () => {
    expect(deriveAttackEffect(DISCARD_SIDE_NEAR_MISS)).toEqual([
      { op: "attachEnergyFrom", source: "discard" },
    ]);
    expect(deriveAttackEffect(ABILITY_SIDE_NEAR_MISS)).toBeNull();
    expect(ABILITY_SIDE_NEAR_MISS).toContain("you may search your deck for");
  });

  it("refuses the anchor, grammar, punctuation and case rewrites", () => {
    const bare = CLAUSES[SELF_BARE].text;
    const rewrites = [
      `Draw a card. ${bare}`,
      `${bare} Draw a card.`,
      // Case, both ends.
      bare.replace("Search", "search"),
      bare.replace("Basic", "basic"),
      // The trailing period.
      bare.slice(0, -1),
      // The printed shuffle, which every card in the family prints and which the
      // trailing `shuffleDeck` op is.
      bare.replace(" Then, shuffle your deck.", ""),
      "Search your deck for a Basic Energy card and attach them to this Pokémon. Then, shuffle your deck.",
      "Search your deck for up to 2 Basic Energy cards and attach it to this Pokémon. Then, shuffle your deck.",
      // A printed 0 would derive to a search that moves nothing and shuffles anyway.
      "Search your deck for up to 0 Basic Energy cards and attach them to this Pokémon. Then, shuffle your deck.",
      // …and past the shared ingested-text ceiling.
      "Search your deck for up to 11 Basic Energy cards and attach them to this Pokémon. Then, shuffle your deck.",
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

  it("carries NO new op, and ONE new op FIELD — the honest price, D457's and D458's halves included", () => {
    const known: Record<string, readonly string[]> = {
      attachFromDeck: [
        "op",
        "filter",
        "max",
        "toSelf",
        "benchOnly",
        "targetType",
        "recordAs",
        "oneTarget",
      ],
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
      expect(
        deriveAttackEffect(
          `Search your deck for up to 2 Basic Energy cards and attach them to 1 of your {${code}} Pokémon. Then, shuffle your deck.`,
        ),
        code,
      ).toEqual([
        {
          op: "attachFromDeck",
          filter: { kind: "basicEnergy" },
          max: 2,
          targetType: type,
          oneTarget: true,
        },
        { op: "shuffleDeck" },
      ]);
    }
    // …and a code in NEITHER map is refused rather than silently dropped.
    expect(
      deriveAttackEffect(
        "Search your deck for a Basic Energy card and attach it to 1 of your {Z} Pokémon. Then, shuffle your deck.",
      ),
    ).toBeNull();
  });
});

describe("PROVENANCE — the demonstrator carries eight of the sentences at 35-42, and D458's at 72", () => {
  const attacks = () => FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];

  it("fields the family at indices 35-42, appended and not inserted", () => {
    expect(attacks()).toHaveLength(73);
    expect(attacks()[ENERGY_ASSIST]?.effect).toBe(CLAUSES[SELF_BARE].text);
    expect(attacks()[ZAP_CHARGE]?.effect).toBe(CLAUSES[SELF_LIGHTNING].text);
    expect(attacks()[AQUA_SUPPLY]?.effect).toBe(CLAUSES[SELF_WATER_TWO].text);
    expect(attacks()[ENERGY_BOUNTY]?.effect).toBe(CLAUSES[ANY_WAY_THREE].text);
    expect(attacks()[BENCH_CHARGE]?.effect).toBe(CLAUSES[BENCH_ANY_WAY].text);
    expect(attacks()[TOXIC_RESERVE]?.effect).toBe(CLAUSES[POISON_TAIL].text);
    expect(attacks()[WATER_DRAW]?.effect).toBe(CLAUSES[ONE_OF_WATER].text);
    expect(attacks()[SPLIT_SUPPLY]?.effect).toBe(CLAUSES[ONE_OF_TWO].text);
    expect(attacks()[SPLIT_HARVEST]?.effect).toBe(CLAUSES[TWO_NOUNS].text);
    expect(deriveAttackEffect(attacks()[71]?.effect ?? "")).toBeNull();
    // The indices the sibling suites address by constant did not move.
    expect(attacks()[2]?.effect).toBe(
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
    );
    expect(attacks()[34]?.effect).toBe(
      "Attach a Basic {F} Energy card from your discard pile to each of your Benched Pokémon.",
    );
  });

  it("NO printed base damage on any of the eight — stated, because it is MEASURED", () => {
    for (const index of [
      ENERGY_ASSIST,
      ZAP_CHARGE,
      AQUA_SUPPLY,
      ENERGY_BOUNTY,
      BENCH_CHARGE,
      TOXIC_RESERVE,
      WATER_DRAW,
      SPLIT_SUPPLY,
      SPLIT_HARVEST,
    ]) {
      expect(attacks()[index]?.damage, `index ${index}`).toBeUndefined();
    }
    // …and the neighbouring index that DOES print a number still does.
    expect(attacks()[3]?.damage).toBe(60);
  });

  it("the demonstrator's own attack rows still DERIVE to this slice's programs", () => {
    expect(deriveAttackEffect(attacks()[TOXIC_RESERVE]?.effect ?? "")).toEqual(
      CLAUSES[POISON_TAIL].program,
    );
    expect(deriveAttackEffect(attacks()[SPLIT_SUPPLY]?.effect ?? "")).toEqual(
      CLAUSES[ONE_OF_TWO].program,
    );
    expect(deriveAttackEffect(attacks()[SPLIT_HARVEST]?.effect ?? "")).toEqual(
      CLAUSES[TWO_NOUNS].program,
    );
  });
});

describe("end to end — an ATTACK searching its own deck for Energy", () => {
  it("the SELF target forces the DESTINATION and still asks WHICH card", () => {
    const state = ready(3);
    const attacker = activeUid(state, "p1");
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: AQUA_SUPPLY,
    });

    const prompt = promptOf(parked);
    expect(prompt.targets).toEqual([ACTIVE_REF]);
    expect(prompt.max).toBe(2);
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
    expect(prompt).not.toHaveProperty("maxPerTarget");
    const { state: done, events } = attach(
      parked,
      prompt.candidates.slice(0, 3).map((uid) => ({ uid, to: benchRef(0) })),
    );
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(3);
    expect(done.players.p1.bench[0]?.energy).toHaveLength(3);
  });

  it("the §9.2 TAIL poisons the attacker — and only when something attached", () => {
    const state = ready(9);
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: TOXIC_RESERVE,
    });
    const prompt = promptOf(parked);
    expect(new Set(idsOf(parked, prompt.candidates))).toEqual(new Set(["fix-darkness-energy"]));
    expect(prompt.note).toContain("If you do, it is now Poisoned");

    const { state: done } = attach(parked, [
      { uid: prompt.candidates[0] as string, to: ACTIVE_REF },
    ]);
    expect(done.players.p1.active?.conditions.poisonDamage).toBeGreaterThan(0);
  });

  it("…and an EMPTY answer files nothing, so the gate does NOT poison", () => {
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
    expect(programPlayable(emptied, CLAUSES[SELF_WATER_TWO].program, "p1")).toBe(true);
    expect(programPlayable(state, CLAUSES[SELF_WATER_TWO].program, "p1")).toBe(true);
  });

  it("D457 — the ONE-OF sentence parks, and BOTH cards may land on one body", () => {
    const state = ready(13);
    deepFreeze(state);
    const { state: parked, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SPLIT_SUPPLY,
    });
    expect(all(events, "ATTACK_DECLARED")).toHaveLength(1);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    const prompt = promptOf(parked);
    expect(prompt.oneTarget).toBe(true);
    expect(prompt.max).toBe(2);
    expect(prompt.targets.length).toBeGreaterThan(1);
    // …and the printed phrase is what the dialog says, not "in any way you like".
    expect(prompt.note).toContain("attach them to 1 of your Pokémon");
    expect(prompt.note).not.toContain("in any way you like");
    const [first, second] = prompt.candidates as [string, string];
    const { state: done, events: attached } = attach(parked, [
      { uid: first, to: benchRef(0) },
      { uid: second, to: benchRef(0) },
    ]);
    expect(all(attached, "ENERGY_ATTACHED")).toHaveLength(2);
    expect(done.players.p1.bench[0]?.energy).toHaveLength(2);
    expect(done.players.p1.bench[1]?.energy ?? []).toHaveLength(0);
  });

  it("D457 — the SPLIT the card does not print is refused on the wire", () => {
    const state = ready(13);
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SPLIT_SUPPLY,
    });
    const [first, second] = promptOf(parked).candidates as [string, string];
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "attachCards",
          assignments: [
            { uid: first, to: benchRef(0) },
            { uid: second, to: benchRef(1) },
          ],
        },
      },
      "BAD_EFFECT_CHOICE",
    );
    const { state: declined, events } = attach(parked, []);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(declined.phase.kind).not.toBe("effect:choose");
    const { state: one, events: oneEvents } = attach(parked, [{ uid: first, to: benchRef(1) }]);
    expect(all(oneEvents, "ENERGY_ATTACHED")).toHaveLength(1);
    expect(one.players.p1.bench[1]?.energy).toHaveLength(1);
  });

  it("D458 — the second printed noun asks TWICE, and the two searches are FILTERED apart", () => {
    const state = readyTwoNoun(3);
    deepFreeze(state);
    const { state: parked, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SPLIT_HARVEST,
    });
    expect(all(events, "ATTACK_DECLARED")).toHaveLength(1);
    // PARK ONE is the FIRST printed noun, and only it: the deck holds {L} and {W}
    // too, so a build that dropped either `filter` offers them here.
    const grass = promptOf(parked);
    expect(new Set(idsOf(parked, grass.candidates))).toEqual(new Set(["fix-grass-energy"]));
    expect(grass.max).toBe(2);
    expect(grass.note).toContain("in any way you like");
    const { state: mid, events: firstEvents } = attach(parked, [
      { uid: grass.candidates[0] as string, to: benchRef(0) },
      { uid: grass.candidates[1] as string, to: benchRef(0) },
    ]);
    expect(all(firstEvents, "ENERGY_ATTACHED")).toHaveLength(2);
    expect(mid.phase.kind).toBe("effect:choose");
    const lightning = promptOf(mid);
    expect(new Set(idsOf(mid, lightning.candidates))).toEqual(new Set(["fix-lightning-energy"]));
    expect(lightning.max).toBe(2);
    const { state: done, events: secondEvents } = attach(mid, [
      { uid: lightning.candidates[0] as string, to: benchRef(1) },
      { uid: lightning.candidates[1] as string, to: benchRef(1) },
    ]);
    expect(all(secondEvents, "ENERGY_ATTACHED")).toHaveLength(2);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(idsOf(done, done.players.p1.bench[0]?.energy ?? [])).toEqual([
      "fix-grass-energy",
      "fix-grass-energy",
    ]);
    expect(idsOf(done, done.players.p1.bench[1]?.energy ?? [])).toEqual([
      "fix-lightning-energy",
      "fix-lightning-energy",
    ]);
    expect(state.players.p1.deck.length - done.players.p1.deck.length).toBe(4);
  });

  it("D458 — …and ALL FOUR may land on ONE body, which is the other end of the shared destination", () => {
    // The pair that makes the split load-bearing. Nothing about the sequential
    // model narrows the second park's targets, so the printed *"in any way you
    // like"* still reaches the all-on-one distribution across BOTH searches.
    const state = readyTwoNoun(3);
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SPLIT_HARVEST,
    });
    const grass = promptOf(parked);
    expect(grass.targets).toContainEqual(ACTIVE_REF);
    const { state: mid } = attach(
      parked,
      grass.candidates.slice(0, 2).map((uid) => ({ uid, to: ACTIVE_REF })),
    );
    const lightning = promptOf(mid);
    expect(lightning.targets).toContainEqual(ACTIVE_REF);
    const { state: done } = attach(
      mid,
      lightning.candidates.slice(0, 2).map((uid) => ({ uid, to: ACTIVE_REF })),
    );
    expect(idsOf(done, done.players.p1.active?.energy ?? [])).toEqual([
      "fix-energy",
      "fix-grass-energy",
      "fix-grass-energy",
      "fix-lightning-energy",
      "fix-lightning-energy",
    ]);
    expect(done.players.p1.bench.every((b) => b.energy.length === 0)).toBe(true);
  });

  it("D458 — a deck with ZERO of the SECOND type still resolves the FIRST", () => {
    const state = withoutCard(readyTwoNoun(5), "fix-lightning-energy");
    expect(
      state.players.p1.deck.filter((u) => state.cardIdByUid[u] === "fix-grass-energy").length,
    ).toBeGreaterThan(1);
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SPLIT_HARVEST,
    });
    const grass = promptOf(parked);
    expect(new Set(idsOf(parked, grass.candidates))).toEqual(new Set(["fix-grass-energy"]));
    const { state: done, events } = attach(
      parked,
      grass.candidates.slice(0, 2).map((uid) => ({ uid, to: benchRef(0) })),
    );
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(2);
    expect(done.players.p1.bench[0]?.energy).toHaveLength(2);
  });

  it("D458 — …and ZERO of the FIRST type does not stop the SECOND", () => {
    // The mirror, and the one a build that ran the searches in the wrong order — or
    // that abandoned the program on the first whiff — cannot pass. The FIRST search
    // has nothing to offer, so the FIRST park is the {L} one.
    const state = withoutCard(readyTwoNoun(5), "fix-grass-energy");
    deepFreeze(state);
    const { state: parked, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SPLIT_HARVEST,
    });
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    const lightning = promptOf(parked);
    expect(new Set(idsOf(parked, lightning.candidates))).toEqual(new Set(["fix-lightning-energy"]));
    const { state: done } = attach(parked, [
      { uid: lightning.candidates[0] as string, to: benchRef(1) },
    ]);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(idsOf(done, done.players.p1.bench[1]?.energy ?? [])).toEqual(["fix-lightning-energy"]);
  });

  it("D458 — a deck with NEITHER type is a silent whiff on BOTH searches", () => {
    const state = withoutCard(
      withoutCard(readyTwoNoun(7), "fix-grass-energy"),
      "fix-lightning-energy",
    );
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SPLIT_HARVEST,
    });
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    expect(all(events, "ATTACK_DECLARED")).toHaveLength(1);
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
    expect(opponentDeck - done.players.p2.deck.length).toBe(1);
    expect(done.players.p2.bench.every((p) => p.energy.length === 0)).toBe(true);
    expect(done.players.p2.active?.energy).toHaveLength(0);
  });
});

describe("D457 §4 — `MATCH_RECORD_VERSION` STAYS 29, driven over the SERIALIZED BYTES", () => {
  it("the version PREDICTION in THREE directions, LOSS included", () => {
    const state = ready(13);
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SPLIT_SUPPLY,
    });
    if (parked.phase.kind !== "effect:choose" || parked.phase.prompt.kind !== "attachCards") {
      throw new Error("expected an attachCards park");
    }
    const prompt = parked.phase.prompt;
    const [first, second] = prompt.candidates as [string, string];
    const split = [
      { uid: first, to: benchRef(0) },
      { uid: second, to: benchRef(1) },
    ];

    const v29 = JSON.parse(
      JSON.stringify(prompt, (k, v) => (k === "oneTarget" ? undefined : v)),
    ) as Extract<EffectPrompt, { kind: "attachCards" }>;
    expect(Object.keys(v29)).toEqual(["kind", "candidates", "targets", "max", "note"]);
    const legacy: GameState = { ...parked, phase: { ...parked.phase, prompt: v29 } };
    const { state: spread } = mustApply(legacy, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "attachCards", assignments: split },
    });
    expect(spread.players.p1.bench[0]?.energy).toHaveLength(1);
    expect(spread.players.p1.bench[1]?.energy).toHaveLength(1);

    const wire = JSON.stringify(prompt);
    expect(wire).toContain('"oneTarget":true');
    expect(wire).not.toContain('"oneTarget":false');
    expect(Object.keys(prompt)).toEqual([
      "kind",
      "candidates",
      "targets",
      "max",
      "oneTarget",
      "note",
    ]);
    const round = JSON.parse(wire) as Extract<EffectPrompt, { kind: "attachCards" }>;
    const revived: GameState = { ...parked, phase: { ...parked.phase, prompt: round } };
    expectErr(
      revived,
      { type: "resolveEffect", seat: "p1", choice: { kind: "attachCards", assignments: split } },
      "BAD_EFFECT_CHOICE",
    );

    expect(v29.note).toContain("attach them to 1 of your Pokémon");
    expect(v29).not.toHaveProperty("oneTarget");
    expect(round.note).toBe(v29.note);

    let coupled = 0;
    for (const [, text] of legalAttackCorpus()) {
      for (const op of deriveAttackEffect(text) ?? []) {
        if (op.op !== "attachFromDeck") continue;
        const printed = text.includes("attach them to 1 of your");
        expect(op.oneTarget === true, text).toBe(printed);
        if (printed) coupled++;
      }
    }
    expect(coupled).toBe(2);
    for (const id of registryCardIds()) {
      for (const program of Object.values(programFor(id)?.attack ?? {})) {
        for (const op of program) {
          if (op.op === "attachFromDeck") expect(op.oneTarget, id).toBeUndefined();
        }
      }
    }
  });

  it("D458 — `MATCH_RECORD_VERSION` STAYS 29 for the TWO-PARK continuation, driven over the bytes", () => {
    const state = readyTwoNoun(3);
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SPLIT_HARVEST,
    });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
    const cont = parked.phase.cont;

    expect(Object.keys(cont).sort()).toEqual(["ctx", "pendingOp", "rest"]);
    expect(cont.pendingOp).toEqual({
      op: "attachFromDeck",
      filter: { kind: "basicEnergy", energyType: "Grass" },
      max: 2,
    });
    expect(cont.rest).toEqual([
      { op: "attachFromDeck", filter: { kind: "basicEnergy", energyType: "Lightning" }, max: 2 },
      { op: "shuffleDeck" },
    ]);
    const wire = JSON.stringify(cont);
    expect(wire).not.toContain("oneTarget");
    expect(wire).not.toContain("recordAs");

    const revived: GameState = {
      ...parked,
      phase: { ...parked.phase, cont: JSON.parse(wire) as typeof cont },
    };
    const grass = promptOf(revived);
    const { state: mid } = attach(revived, [
      { uid: grass.candidates[0] as string, to: ACTIVE_REF },
    ]);
    expect(mid.phase.kind).toBe("effect:choose");
    const { state: done } = attach(mid, [
      { uid: promptOf(mid).candidates[0] as string, to: ACTIVE_REF },
    ]);
    expect(idsOf(done, done.players.p1.active?.energy ?? [])).toEqual([
      "fix-energy",
      "fix-grass-energy",
      "fix-lightning-energy",
    ]);

    const truncated: GameState = {
      ...parked,
      phase: { ...parked.phase, cont: { ...cont, rest: [{ op: "shuffleDeck" as const }] } },
    };
    const { state: short } = attach(truncated, [
      { uid: promptOf(truncated).candidates[0] as string, to: ACTIVE_REF },
    ]);
    expect(short.phase.kind).not.toBe("effect:choose");
    expect(idsOf(short, short.players.p1.active?.energy ?? [])).toEqual([
      "fix-energy",
      "fix-grass-energy",
    ]);
    expect(JSON.stringify(truncated.phase)).not.toBe(JSON.stringify(parked.phase));
    if (truncated.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(JSON.stringify(truncated.phase.prompt)).toBe(JSON.stringify(parked.phase.prompt));
  });
});

describe("D458 §5 — the engine version moved and the record version did not", () => {
  it("engineVersion is 0.555.0 and `manifest.version` agrees", () => {
    expect(manifest.version).toBe(engineVersion);
  });
});

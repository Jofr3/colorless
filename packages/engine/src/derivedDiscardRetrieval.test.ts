import { describe, expect, it } from "vitest";
import { matchesFilter } from "./cards";
import { deriveAttackCoinFlip, deriveAttackEffect } from "./effects";
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

interface Clause {
  readonly text: string;
  readonly program: readonly EffectOp[];
  readonly printings: number;
  readonly legalPrintings: number;
  readonly note: string;
}

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
  legalPrintings: 1,
  note: "Put a Trainer card from your discard pile into your hand.",
};

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

const UNREAD: readonly (readonly [string, number, string])[] = [
  [
    "Flip 3 coins. Put a number of cards up to the number of heads from your discard pile into your hand.",
    2,
    "BUILT at D525 on `deriveAttackCoinFlip` (a different reader) as `retrievalUpToHeads` — ONE `discardPileRetrieval` with `max: heads` written at `attack.ts`'s fold, NOT a `programPerHeads` repeat; this family still does not read it, by design",
  ],
] as const;

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
    expect(CLAUSES).toHaveLength(7);
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(14);
    expect(UNREAD).toHaveLength(1);
    expect(UNREAD.reduce((sum, [, legal]) => sum + legal, 0)).toBe(2);
    for (const [text] of UNREAD) expect(deriveAttackEffect(text), text).toBeNull();
    for (const [text] of UNREAD)
      expect(deriveAttackCoinFlip(text)?.kind, text).toBe("retrievalUpToHeads");
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0) + 2).toBe(16);
    expect(CLAUSES.length + UNREAD.length).toBe(8);
  });

  it("reads 33 of the family's 39 CATALOG printings too — an arm transfers", () => {
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

  it("the NOUN and the DESTINATION are INDEPENDENT axes, which is why it is one arm", () => {
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

  it("the article and the count are WELDED, and the missing group IS max 1", () => {
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

  it("an unresolvable NOUN or DESTINATION is a REFUSAL, never an approximation", () => {
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

  it("the printed DECK destination is OFF the `Put` table (the control), and the `Shuffle` verb reads it — D523 INVERTED the second half (D418/D436)", () => {
    expect(
      deriveAttackEffect("Put up to 2 Supporter cards from your discard pile into your deck."),
    ).toBeNull();
    expect(
      deriveAttackEffect("Shuffle up to 2 Supporter cards from your discard pile into your deck."),
    ).toEqual([
      { op: "discardPileRetrieval", filter: { kind: "supporter" }, dest: "deck", max: 2 },
      { op: "shuffleDeck" },
    ]);
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
    expect(matchesFilter(undefined, { kind: "trainerCard" })).toBe(false);
  });

  it("its printed noun phrase is `retrieveNoun`'s output, driven through the prompt", () => {
    const state = attack(ready(3, { discard: FULL_PILE }), TRAINER_RECALL).state;
    expect(cardsPrompt(state).note).toBe(TRAINER.note);
  });
});

describe("`typedPokemon` — a printed TYPE, read off an ARRAY", () => {
  it("admits the typed body and refuses the untyped ones", () => {
    for (const id of ["fix-water-basic", "fix-dual-basic"]) {
      expect(matchesFilter(FIXTURE_POOL[id], WATER), id).toBe(true);
    }
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

  it("a DUAL-TYPE body matches on EITHER type — `includes`, not `types[0]`", () => {
    const dual = FIXTURE_POOL["fix-dual-basic"];
    expect(dual?.types).toEqual(["Fire", "Water"]);
    expect(matchesFilter(dual, { kind: "typedPokemon", pokemonType: "Fire" })).toBe(true);
    expect(matchesFilter(dual, WATER)).toBe(true);
    expect(matchesFilter(dual, { kind: "typedPokemon", pokemonType: "Grass" })).toBe(false);
  });

  it("the `stage` rider narrows, and its ABSENCE admits both stages", () => {
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

  it("`up to 3 Duskull` offers the NAMED body alone — not the other Pokémon", () => {
    const state = attack(ready(3, { discard: FULL_PILE }), GHOSTLY_GATHERING).state;
    expect(offered(state)).toEqual(["fix-duskull", "fix-duskull", "fix-duskull"]);
    expect(cardsPrompt(state).dest).toBe("bench");
    expect(cardsPrompt(state).note).toBe(DUSKULL.note);
  });

  it("D238 — `up to 3 {W} Pokémon` offers the TYPED bodies and benches them", () => {
    const parked = attack(ready(3, { discard: FULL_PILE }), TIDAL_RECALL).state;
    expect(offered(parked)).toEqual(["fix-dual-basic", "fix-water-basic", "fix-water-basic"]);
    const prompt = cardsPrompt(parked);
    expect(prompt.max).toBe(3);
    expect(prompt.min).toBe(0);
    expect(prompt.dest).toBe("bench");
    const benchBefore = parked.players.p1.bench.length;
    const uids = prompt.candidates.slice(0, 2);
    const { state, events } = resolve(parked, [...uids]);
    expect(state.players.p1.bench).toHaveLength(benchBefore + 2);
    expect(events.filter((e) => e.type === "DISCARD_RETRIEVED")).toEqual([
      { type: "DISCARD_RETRIEVED", seat: "p1", dest: "bench", uids: [...uids] },
    ]);
  });

  it("D238 — `a Basic {G} Energy card` offers the GRASS one, not the other two", () => {
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

  it("puts the picked cards onto the BENCH, in play and stamped this turn", () => {
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
      expect(spot?.stack).toEqual([uid]);
      expect(spot?.turnPlayed).toBe(parked.turn);
      expect(spot?.damage).toBe(0);
    }
    expect(events.filter((e) => e.type === "DISCARD_RETRIEVED")).toEqual([
      { type: "DISCARD_RETRIEVED", seat: "p1", dest: "bench", uids },
    ]);
  });

  it("the MOVE clamps too, on a Bench that filled AFTER the park was raised", () => {
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

  it("the BENCH destination clamps to the space left, BEFORE anything moves", () => {
    const state = attack(
      ready(3, {
        bench: ["fix-basic-1", "fix-basic-1", "fix-basic-1", "fix-basic-1"],
        discard: FULL_PILE,
      }),
      GHOSTLY_GATHERING,
    ).state;
    expect(state.players.p1.bench).toHaveLength(4);
    expect(cardsPrompt(state).max).toBe(1);
    expect(cardsPrompt(state).note).toBe("Put Duskull from your discard pile onto your Bench.");
  });

  it("a FULL Bench makes the whole op a silent no-op, not a park", () => {
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
    expect(attacks).toHaveLength(73);
  });

  it("D238 — `Tidal Recall` was fielded UNREAD by D237 and READS on this commit", () => {
    const text = FIXTURE_POOL["fix-trainerops"]?.attacks?.[TIDAL_RECALL]?.effect as string;
    expect(text).toBe(TIDAL.text);
    expect(deriveAttackEffect(text)).toEqual(TIDAL.program);
    const state = attack(ready(3, { discard: FULL_PILE }), TIDAL_RECALL).state;
    expect(state.phase.kind).toBe("effect:choose");
  });

  it("`fix-duskull` is a BASIC named Duskull, and `fix-charjabug` is not", () => {
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

  it("`log.ts` gained a THIRD arm, and the BENCH row would otherwise have LIED", () => {
    const parked = attack(ready(3, { discard: FULL_PILE }), GHOSTLY_GATHERING).state;
    const uids = pileUids(parked, "fix-duskull");
    const { state, events } = resolve(parked, uids);
    expect(rows(events, state)).toContain("put 3 cards from their discard pile onto their Bench");
  });

  it("the HAND and DECK rows are unmoved by the widening", () => {
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

  it("the shared noun table carries no REGEX METACHARACTER — the anchor is built from it", () => {
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

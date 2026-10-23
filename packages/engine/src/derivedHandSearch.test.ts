import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { programPlayable } from "./cardplay";
import { matchesFilter } from "./cards";
import { deriveAttackCoinFlip, deriveAttackEffect } from "./effects";
import type { CardFilter, EffectOp } from "./effects";
import type { GameEvent } from "./events";
import type { GameState, Seat } from "./index";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { redactGame } from "./redact";
import {
  FIXTURE_POOL,
  HAND_SEARCH_DECK,
  attachFromDeck,
  clearBench,
  deepFreeze,
  discardFromDeck,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

const CLAUSES = [
  {
    text: "You may search your deck for a card and put it into your hand. Then, shuffle your deck.",
    filter: { kind: "anyCard" },
    max: 1,
    reveal: false,
    legalPrintings: 3, // sv06-106, sv06-198, sv06-214
  },
  {
    text: "You may search your deck for up to 3 cards and put them into your hand. Then, shuffle your deck.",
    filter: { kind: "anyCard" },
    max: 3,
    reveal: false,
    legalPrintings: 3, // sv10.5b-003, sv10.5b-156, sv10.5b-164
  },
  {
    text: "You may search your deck for up to 2 cards and put them into your hand. Then, shuffle your deck.",
    filter: { kind: "anyCard" },
    max: 2,
    reveal: false,
    legalPrintings: 1, // sv05-127
  },
  {
    text: "Search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.",
    filter: { kind: "anyPokemon" },
    max: 1,
    reveal: true,
    legalPrintings: 3, // sv06-126, sv06-185, sv08-047
  },
  {
    text: "Search your deck for up to 3 Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
    filter: { kind: "anyPokemon" },
    max: 3,
    reveal: true,
    legalPrintings: 1, // sv06.5-011
  },
  {
    text: "Search your deck for an Item card, reveal it, and put it into your hand. Then, shuffle your deck.",
    filter: { kind: "item" },
    max: 1,
    reveal: true,
    legalPrintings: 4, // sv05-047, sv10-072, sv10.5w-072, sv10.5w-152
  },
  {
    text: "Search your deck for a Supporter card, reveal it, and put it into your hand. Then, shuffle your deck.",
    filter: { kind: "supporter" },
    max: 1,
    reveal: true,
    legalPrintings: 3, // sv06.5-027, sv10-127, sv10-200
  },
  {
    text: "Search your deck for a Stadium card, reveal it, and put it into your hand. Then, shuffle your deck.",
    filter: { kind: "stadium" },
    max: 1,
    reveal: true,
    legalPrintings: 1, // sv09-086
  },
  {
    text: "Search your deck for a Pokémon Tool card, reveal it, and put it into your hand. Then, shuffle your deck.",
    filter: { kind: "toolCard" },
    max: 1,
    reveal: true,
    legalPrintings: 1, // sv07-103
  },
  {
    text: "Search your deck for up to 2 Basic Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
    filter: { kind: "basicEnergy" },
    max: 2,
    reveal: true,
    legalPrintings: 5, // svp-123, sv06-024, sv08-097, sv10.5b-068, sv10.5b-145
  },
  {
    text: "Search your deck for up to 3 Basic Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
    filter: { kind: "basicEnergy" },
    max: 3,
    reveal: true,
    legalPrintings: 1, // sv06-087
  },
  {
    text: "Search your deck for a Basic Energy card, reveal it, and put it into your hand. Then, shuffle your deck.",
    filter: { kind: "basicEnergy" },
    max: 1,
    reveal: true,
    legalPrintings: 1, // sv05-026
  },
  {
    text: "Search your deck for up to 4 Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
    filter: { kind: "anyEnergy" },
    max: 4,
    reveal: true,
    legalPrintings: 1, // sv08-155
  },
  {
    text: "Search your deck for up to 3 {D} Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
    filter: { kind: "typedPokemon", pokemonType: "Darkness" },
    max: 3,
    reveal: true,
    legalPrintings: 2, // sv10.5w-055, sv10.5w-136
  },
  {
    text: "Search your deck for up to 2 {L} Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
    filter: { kind: "typedPokemon", pokemonType: "Lightning" },
    max: 2,
    reveal: true,
    legalPrintings: 1, // sv08-065
  },
  {
    text: "Search your deck for up to 3 Basic {G} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
    filter: { kind: "basicEnergy", energyType: "Grass" },
    max: 3,
    reveal: true,
    legalPrintings: 1, // svp-199
  },
  {
    text: "Search your deck for up to 3 Basic Energy cards of different types, reveal them, and put them into your hand. Then, shuffle your deck.",
    filter: { kind: "basicEnergy" },
    max: 3,
    reveal: true,
    distinctEnergyTypes: true,
    legalPrintings: 1, // sv06.5-050
  },
  {
    text: "You may search your deck for any number of Fennel cards, reveal them, and put them into your hand. Then, shuffle your deck.",
    filter: { kind: "byName", name: "Fennel", cardNoun: true },
    max: "any",
    reveal: true,
    legalPrintings: 2, // sv10.5b-036, sv10.5b-117
  },
] as const satisfies readonly {
  text: string;
  filter: CardFilter;
  max: number | "any";
  reveal: boolean;
  distinctEnergyTypes?: true;
  legalPrintings: number;
}[];

const ROTATED: readonly (readonly [string, CardFilter, number, boolean])[] = [
  [
    "Search your deck for up to 2 Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
    { kind: "anyPokemon" },
    2,
    true,
  ],
  [
    "Search your deck for up to 2 cards and put them into your hand. Then, shuffle your deck.",
    { kind: "anyCard" },
    2,
    false,
  ],
  [
    "Search your deck for up to 3 cards and put them into your hand. Then, shuffle your deck.",
    { kind: "anyCard" },
    3,
    false,
  ],
  [
    "Search your deck for a card and put it into your hand. Then, shuffle your deck.",
    { kind: "anyCard" },
    1,
    false,
  ],
  [
    "Search your deck for up to 3 Pokémon Tool cards, reveal them, and put them into your hand. Then, shuffle your deck.",
    { kind: "toolCard" },
    3,
    true,
  ],
  [
    "Search your deck for up to 2 Supporter cards, reveal them, and put them into your hand. Then, shuffle your deck.",
    { kind: "supporter" },
    2,
    true,
  ],
  [
    "Search your deck for an Energy card, reveal it, and put it into your hand. Then, shuffle your deck.",
    { kind: "anyEnergy" },
    1,
    true,
  ],
];

const DEFERRED: readonly (readonly [string, string, number])[] = [
  [
    "Search your deck for up to 3 Misty's Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
    "`ownerPokemon` behind a possessive capture (sv10-050/-194)",
    2,
  ],
  [
    "Search your deck for up to 3 in any combination of {R} Pokémon and Basic {R} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
    "a typed DISJUNCTION (sv10.5w-019/-104) — D230's Maushold case, typed",
    2,
  ],
  [
    "Put this Pokémon and all attached cards into your deck. If you do, search your deck for up to 3 cards and put them into your hand. Then, shuffle your deck.",
    "a §9.2 LEADING clause (sv07-011) — refused by the VERB'S CASE, not by `^`",
    1,
  ],
];

const MEAL_TIME = 20; // anyCard, max 1, NO reveal
const BIG_MEAL = 21; // anyCard, max 3, NO reveal
const ENERGY_SEARCH = 22; // basicEnergy, max 2, reveal
const ITEM_HUNT = 23; // item, max 1, reveal
const STADIUM_SEARCH = 24; // stadium, max 1, reveal

function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: HAND_SEARCH_DECK, p2: HAND_SEARCH_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** p1 attacks with `fix-trainerops`; p2 holds a Bench of its own, set explicitly,
    because the crossed build this file guards against reaches for the other
    seat's deck. */
function ready(seed: number): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-trainerops");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p1");
  state = setActiveFromDeck(state, "p2", "fix-basic-1");
  return state;
}

function cardsPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") {
    throw new Error(`expected a park, got ${state.phase.kind}`);
  }
  if (state.phase.prompt.kind !== "chooseCards") {
    throw new Error(`expected chooseCards, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

/** The distinct card ids a prompt is offering — what the FILTER admitted, named
    rather than counted. */
function offered(state: GameState): Set<string> {
  return new Set(cardsPrompt(state).candidates.map((uid) => state.cardIdByUid[uid] as string));
}

const attack = (state: GameState, index: number) =>
  mustApply(state, { type: "attack", seat: "p1", index });

const resolve = (state: GameState, uids: string[]) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids } });

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };

function searchRow(state: GameState, events: GameEvent[]): string {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  const row = logFromEvents(events, ctx).find(
    (r) => r.kind === "action" && r.segments.some((s) => s.text.includes("searched their deck")),
  );
  return row?.kind === "action" ? row.segments.map((s) => s.text).join("") : "";
}

function noteFromPrint(text: string): string {
  return text
    .replace(/^You may search/, "Search")
    .replace(/, reveal (?:it|them),/, "")
    .replace(
      / and put (?:it|them) into your hand\. Then, shuffle your deck\.$/,
      " into your hand.",
    );
}

function programOf(clause: (typeof CLAUSES)[number]): EffectOp[] {
  return [
    {
      op: "searchDeck",
      filter: clause.filter,
      dest: "hand",
      max: clause.max,
      ...(clause.reveal ? { reveal: true } : {}),
      ...("distinctEnergyTypes" in clause ? { distinctEnergyTypes: true } : {}),
    },
    { op: "shuffleDeck" },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE ANCHOR — one regex, one closed noun table, one optional rider
// ─────────────────────────────────────────────────────────────────────────────

describe("the anchor — eighteen printed sentences, ONE regex", () => {
  it("derives each printed sentence to its program", () => {
    for (const clause of CLAUSES) {
      expect(deriveAttackEffect(clause.text), clause.text).toEqual(programOf(clause));
    }
  });

  it("reads the ROTATED printings too — an arm transfers across sets", () => {
    for (const [text, filter, max, reveal] of ROTATED) {
      expect(deriveAttackEffect(text), text).toEqual([
        { op: "searchDeck", filter, dest: "hand", max, ...(reveal ? { reveal: true } : {}) },
        { op: "shuffleDeck" },
      ]);
    }
  });

  it("adds up: 35 of the family's 42 legal printings, on ONE anchor", () => {
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(35);
    expect(DEFERRED.reduce((sum, [, , n]) => sum + n, 0)).toBe(5);
    expect(35 + 5 + 2).toBe(42);
    for (const [text, why] of DEFERRED) expect(deriveAttackEffect(text), why).toBeNull();
  });

  it('D527 — the retired deferral: "a DYNAMIC max (svp-188) — `max` is a number, not an expression" was TRUE at D231 and FALSE since D514, and the row now derives on its OWN anchor to the exact two-op program with `max: "yourBenchCount"`', () => {
    const dynamic =
      "Search your deck for a number of cards up to the number of your Benched Pokémon and put them into your hand. Then, shuffle your deck.";
    expect(DEFERRED.some(([text]) => text === dynamic)).toBe(false);
    expect(CLAUSES.some((c) => (c.text as string) === dynamic)).toBe(false);
    expect(deriveAttackEffect(dynamic)).toEqual([
      { op: "searchDeck", filter: { kind: "anyCard" }, dest: "hand", max: "yourBenchCount" },
      { op: "shuffleDeck" },
    ]);
    expect(legalAttackCorpus().filter(([, s]) => s === dynamic)).toEqual([[1, dynamic]]);
    expect(DEFERRED).toHaveLength(3);
  });

  it('D531 — the retired deferral: "a BOARD-DEPENDENT noun (sv07-065) — the filter would read the attacker" was TRUE about the FILTER and named the wrong LAYER; the row now derives on its OWN anchor to the flat sibling\'s program plus the park-time rider `typedAsAttachedBasicEnergy`', () => {
    const typed =
      "Search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached to this Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.";
    expect(DEFERRED.some(([text]) => text === typed)).toBe(false);
    expect(CLAUSES.some((c) => (c.text as string) === typed)).toBe(false);
    expect(deriveAttackEffect(typed)).toEqual([
      {
        op: "searchDeck",
        filter: { kind: "anyPokemon" },
        dest: "hand",
        max: 5,
        reveal: true,
        typedAsAttachedBasicEnergy: true,
      },
      { op: "shuffleDeck" },
    ]);
    expect(legalAttackCorpus().filter(([, s]) => s === typed)).toEqual([[1, typed]]);
    // …and the flat twin still derives WITHOUT the rider on the sibling anchor — the rider is the
    // one key between the two programs, not a change to this table's reading.
    expect(
      deriveAttackEffect(
        "Search your deck for up to 5 Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
      ),
    ).toEqual([
      { op: "searchDeck", filter: { kind: "anyPokemon" }, dest: "hand", max: 5, reveal: true },
      { op: "shuffleDeck" },
    ]);
  });

  it("the NOUN is a closed TABLE, and an unknown phrase is a REFUSAL", () => {
    const unknown = [
      "Search your deck for up to 3 Misty's Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
      "Search your deck for a Fennel card, reveal it, and put it into your hand. Then, shuffle your deck.",
      "Search your deck for up to 3 in any combination of {R} Pokémon and Basic {R} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
      "Search your deck for a Basic Pokémon and put it into your hand. Then, shuffle your deck.",
      "Search your deck for up to 3 Basic {G} Energy card, reveal them, and put them into your hand. Then, shuffle your deck.",
      //   · so is the article, the other way round;
      "Search your deck for a Basic {G} Energy cards, reveal it, and put it into your hand. Then, shuffle your deck.",
      //   · a typed Energy noun WITHOUT "Basic" is `providesEnergy`, a different
      //     filter for a different question — and `matchesFilter` answers FALSE
      //     for it in every pile, so the search would find nothing;
      "Search your deck for up to 3 {G} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
      //   · and `{N}` IS a printed Pokémon type (Dragon) with NO Basic Energy
      //     card behind it, which is why the two code maps are separate.
      "Search your deck for up to 3 Basic {N} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
      //   · `{Q}` is not a printed type at all — the pattern matches, the MAP
      //     refuses, and that is the layer that has to say no.
      "Search your deck for up to 3 {Q} Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
    ];
    for (const text of unknown) expect(deriveAttackEffect(text), text).toBeNull();
    // …and the POSITIVE control on the same pattern, so "everything is refused"
    // cannot pass on a resolver that returns `undefined` for everything.
    expect(
      deriveAttackEffect(
        "Search your deck for up to 3 Basic {N} Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
      ),
    ).toEqual([
      {
        op: "searchDeck",
        filter: { kind: "typedPokemon", pokemonType: "Dragon", stage: "basic" },
        dest: "hand",
        max: 3,
        reveal: true,
      },
      { op: "shuffleDeck" },
    ]);
  });

  it("D237 — the table gained a row one family over, and THIS anchor gained it too", () => {
    expect(
      deriveAttackEffect(
        "Search your deck for a Trainer card, reveal it, and put it into your hand. Then, shuffle your deck.",
      ),
    ).toEqual([
      { op: "searchDeck", filter: { kind: "trainerCard" }, dest: "hand", max: 1, reveal: true },
      { op: "shuffleDeck" },
    ]);
    expect(
      deriveAttackEffect(
        "Search your deck for a Supporter card, reveal it, and put it into your hand. Then, shuffle your deck.",
      )?.[0],
    ).toHaveProperty("filter", { kind: "supporter" });
  });

  it("the `reveal` RIDER is the printed clause and NOTHING else", () => {
    const bare =
      "You may search your deck for up to 3 cards and put them into your hand. Then, shuffle your deck.";
    const revealing =
      "You may search your deck for up to 3 cards, reveal them, and put them into your hand. Then, shuffle your deck.";
    const [withoutIt] = deriveAttackEffect(bare) ?? [];
    const [withIt] = deriveAttackEffect(revealing) ?? [];
    expect(withIt).toEqual({ ...withoutIt, reveal: true });
    expect(Object.keys(withoutIt as object)).not.toContain("reveal");
    const noReveal = CLAUSES.filter((c) => !c.reveal);
    expect(noReveal.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(7);
    for (const clause of noReveal) expect(clause.filter.kind).toBe("anyCard");
  });

  it("the article and the numeric forms are ONE anchor, and the missing group IS max 1", () => {
    // "a card … put it" and "up to 3 cards … put them" derive to programs that
    // differ in `max` and in nothing else. A build that split them into two
    // anchors would pass every accept case above.
    const [one] = deriveAttackEffect(CLAUSES[0].text) ?? [];
    const [three] = deriveAttackEffect(CLAUSES[1].text) ?? [];
    expect(one).toEqual({ ...three, max: 1 });
    // …and a number the catalog does not print today rides the same arm.
    expect(
      deriveAttackEffect(
        "Search your deck for up to 7 Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
      ),
    ).toEqual([
      { op: "searchDeck", filter: { kind: "anyEnergy" }, dest: "hand", max: 7, reveal: true },
      { op: "shuffleDeck" },
    ]);
  });

  it('"You may search" and "Search" derive to the SAME program', () => {
    expect(deriveAttackEffect(CLAUSES[2].text)).toEqual(
      deriveAttackEffect(CLAUSES[2].text.replace("You may search", "Search")),
    );
  });

  it("refuses the anchor, punctuation, pronoun and case rewrites", () => {
    const bare = CLAUSES[5].text; // "…an Item card, reveal it, …"
    const rewrites = [
      "Put this Pokémon and all attached cards into your deck. If you do, search your deck for up to 3 cards and put them into your hand. Then, shuffle your deck.",
      "Draw a card. Search your deck for up to 3 cards and put them into your hand. Then, shuffle your deck.",
      "Search your deck for up to 2 cards and put them into your hand. Then, shuffle your deck. You may switch this Pokémon with 1 of your Benched Pokémon.",
      // A real printed leading clause of a THIRD shape — the coin gate.
      "Flip a coin. If heads, search your deck for a card and put it into your hand. Then, shuffle your deck. If tails, discard a card from your hand.",
      // Case, both ends.
      bare.replace("Search", "search"),
      bare.replace("Item", "item"),
      // The trailing period, and the trailing SENTENCE — the shuffle is printed,
      // so a build that made it optional would read a card that never says it.
      bare.slice(0, -1),
      "Search your deck for an Item card, reveal it, and put it into your hand.",
      "Search your deck for an Item card, reveal it, and put them into your hand. Then, shuffle your deck.",
      "Search your deck for up to 2 Item cards, reveal them, and put it into your hand. Then, shuffle your deck.",
      // The reveal's own NUMBER crossed — "reveal them" on a singular find.
      "Search your deck for an Item card, reveal them, and put it into your hand. Then, shuffle your deck.",
      "Search your deck for an Item card, reveal it, and put it onto your Bench. Then, shuffle your deck.",
      // The ZONE changed — `discardPileRetrieval`'s, a different op.
      "Search your discard pile for an Item card, reveal it, and put it into your hand. Then, shuffle your deck.",
      // The OWNER changed — no member of this family reaches the other deck.
      "Search your opponent's deck for an Item card, reveal it, and put it into your hand. Then, shuffle your deck.",
      "Search your deck for up to 0 cards and put them into your hand. Then, shuffle your deck.",
    ];
    for (const text of rewrites) expect(deriveAttackEffect(text), text).toBeNull();
  });

  it("hands no clause to the coin reader, and carries no apostrophe to curl", () => {
    for (const clause of CLAUSES) expect(deriveAttackCoinFlip(clause.text), clause.text).toBeNull();
    for (const { text } of CLAUSES) {
      expect(text.includes("'"), text).toBe(false);
      expect(text.includes("’"), text).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE THREE NEW FILTER MEMBERS — the only engine code outside the deriver
// ─────────────────────────────────────────────────────────────────────────────

describe("the CardFilter members this slice adds, at their read site", () => {
  const card = (id: string) => FIXTURE_POOL[id];

  it("`item` is DISJOINT from `toolCard` — the pre-SM reading is the mutant", () => {
    expect(matchesFilter(card("fix-item"), { kind: "item" })).toBe(true);
    for (const id of ["fix-tool", "fix-gatedsup", "fix-stadium", "fix-basic-1", "fix-energy"]) {
      expect(matchesFilter(card(id), { kind: "item" }), id).toBe(false);
    }
  });

  it("`stadium` completes the four printed Trainer subtypes", () => {
    expect(matchesFilter(card("fix-stadium"), { kind: "stadium" })).toBe(true);
    for (const id of ["fix-item", "fix-tool", "fix-gatedsup", "fix-basic-1"]) {
      expect(matchesFilter(card(id), { kind: "stadium" }), id).toBe(false);
    }
    // …and the four members now partition the Trainer category exactly, which is
    // what "closed enum" means here: every Trainer in the pool matches exactly one.
    const kinds: CardFilter[] = [
      { kind: "item" },
      { kind: "supporter" },
      { kind: "stadium" },
      { kind: "toolCard" },
    ];
    for (const pooled of Object.values(FIXTURE_POOL)) {
      if (pooled.category !== "Trainer") continue;
      const hits = kinds.filter((k) => matchesFilter(pooled, k)).length;
      expect(hits, pooled.id).toBe(1);
    }
  });

  it("`anyCard` is true for every real card — and FALSE for a missing one", () => {
    for (const pooled of Object.values(FIXTURE_POOL)) {
      expect(matchesFilter(pooled, { kind: "anyCard" }), pooled.id).toBe(true);
    }
    // The guard that makes it "any CARD" rather than "any uid" — decided one level
    // up, and the line a `return true` written above the undefined check would
    // break.
    expect(matchesFilter(undefined, { kind: "anyCard" })).toBe(false);
  });
});

describe("PROVENANCE — the demonstrator carries five of the forms at 20-24", () => {
  const attacks = () => FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];

  it("fields the family at indices 20-24, appended and not inserted", () => {
    expect(attacks()).toHaveLength(73);
    expect(attacks()[MEAL_TIME]?.effect).toBe(CLAUSES[0].text);
    expect(attacks()[BIG_MEAL]?.effect).toBe(CLAUSES[1].text);
    expect(attacks()[ENERGY_SEARCH]?.effect).toBe(CLAUSES[9].text);
    expect(attacks()[ITEM_HUNT]?.effect).toBe(CLAUSES[5].text);
    expect(attacks()[STADIUM_SEARCH]?.effect).toBe(CLAUSES[7].text);
    // The indices the sibling suites address by constant did not move.
    expect(attacks()[17]?.effect).toBe(
      "Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck.",
    );
    expect(attacks()[2]?.effect).toBe(
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
    );
  });

  it("NO printed base damage on any of the five — and here that IS the catalog", () => {
    for (const index of [MEAL_TIME, BIG_MEAL, ENERGY_SEARCH, ITEM_HUNT, STADIUM_SEARCH]) {
      expect(attacks()[index]?.damage, `index ${index}`).toBeUndefined();
    }
    // …and the neighbouring index that DOES print a number still does.
    expect(attacks()[3]?.damage).toBe(60);
  });

  it("the COSTS diverge from their printings, and say so here", () => {
    for (const index of [MEAL_TIME, BIG_MEAL, ENERGY_SEARCH, ITEM_HUNT, STADIUM_SEARCH]) {
      expect(attacks()[index]?.cost, `index ${index}`).toEqual(["Colorless"]);
    }
  });

  it("the deck holds all four Trainer subtypes AND both Energy classes", () => {
    // The deck is the discriminator (see its doc): six of its seven lines exist to
    // be REFUSED by some filter this anchor emits. If any of them left, the
    // "disjoint candidate sets" assertions below would still pass — vacuously.
    const ids = new Set(HAND_SEARCH_DECK);
    for (const id of ["fix-item", "fix-tool", "fix-gatedsup", "fix-stadium"]) {
      expect(ids.has(id), id).toBe(true);
    }
    expect(ids.has("fix-energy")).toBe(true); // Basic
    expect(ids.has("fix-special")).toBe(true); // Special — NOT a `basicEnergy`
    expect(HAND_SEARCH_DECK).toHaveLength(60);
  });
});

describe("end to end — out of the ATTACKER's deck, into the ATTACKER's hand", () => {
  it("parks offering the actor's own cards, bound for the actor's hand", () => {
    const state = ready(11);
    deepFreeze(state);
    const { state: parked } = attack(state, ITEM_HUNT);

    const prompt = cardsPrompt(parked);
    expect(parked.phase.kind === "effect:choose" ? parked.phase.seat : undefined).toBe("p1");
    expect(prompt.dest).toBe("hand");
    expect(prompt.max).toBe(1);
    expect(prompt.min).toBe(0);
    for (const uid of prompt.candidates) expect(parked.players.p1.deck).toContain(uid);
    // …and every one of them is an ITEM: three other Trainer subtypes sit in this
    // deck, so the filter has something to refuse rather than admitting them all.
    expect(offered(parked)).toEqual(new Set(["fix-item"]));
  });

  it("the eight nouns are told apart ON ONE BOARD — disjoint candidate sets", () => {
    const state = ready(12);
    const items = offered(attack(state, ITEM_HUNT).state);
    const stadiums = offered(attack(state, STADIUM_SEARCH).state);
    const energies = offered(attack(state, ENERGY_SEARCH).state);
    const anything = offered(attack(state, MEAL_TIME).state);

    expect(items).toEqual(new Set(["fix-item"]));
    expect(stadiums).toEqual(new Set(["fix-stadium"]));
    expect(energies).toEqual(new Set(["fix-energy"]));
    expect(energies.has("fix-special")).toBe(false);
    // …while `anyCard` is the UNION and then some: every id in the deck.
    for (const set of [items, stadiums, energies]) {
      for (const id of set) expect(anything.has(id), id).toBe(true);
    }
    expect(anything.size).toBeGreaterThan(4);
    expect(anything.has("fix-special")).toBe(true);
  });

  it("resolving puts the pick in the ACTOR's hand, and shuffles after", () => {
    const state = ready(13);
    const { state: parked } = attack(state, ITEM_HUNT);
    const pick = cardsPrompt(parked).candidates[0] as string;
    const { state: done, events } = resolve(parked, [pick]);

    expect(done.players.p1.hand).toContain(pick);
    expect(done.players.p1.deck).not.toContain(pick);
    expect(done.players.p2.hand).not.toContain(pick);
    expect(done.players.p2.deck).not.toContain(pick);
    // …and the TRAILING op fired, in printed order.
    expect(types(events).filter((t) => t === "DECK_SEARCHED" || t === "SHUFFLE")).toEqual([
      "DECK_SEARCHED",
      "SHUFFLE",
    ]);
  });

  it("the plural form takes THREE, and every one of them lands", () => {
    const state = ready(14);
    const { state: parked } = attack(state, BIG_MEAL);
    expect(cardsPrompt(parked).max).toBe(3);
    const picks = cardsPrompt(parked).candidates.slice(0, 3);
    expect(picks).toHaveLength(3);
    const before = parked.players.p1.hand.length;
    const { state: done } = resolve(parked, picks);
    expect(done.players.p1.hand).toHaveLength(before + 3);
    for (const uid of picks) expect(done.players.p1.deck).not.toContain(uid);
  });

  it("a WHIFF still shuffles — the candidate set is empty and the sentence completes", () => {
    // Every Stadium out of the deck, so the search can find nothing. The trailing
    // op is an OP, not a rider: the printed "Then, shuffle your deck." happens on
    // the boards where nothing was found too.
    let state = ready(15);
    const copies = state.players.p1.deck.filter(
      (uid) => state.cardIdByUid[uid] === "fix-stadium",
    ).length;
    expect(copies).toBeGreaterThan(0);
    state = discardFromDeck(state, "p1", "fix-stadium", copies);
    const { state: done, events } = attack(state, STADIUM_SEARCH);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(types(events)).not.toContain("DECK_SEARCHED");
    expect(types(events)).toContain("SHUFFLE");
  });

  it("DECLINING is legal, takes nothing, and still shuffles", () => {
    const state = ready(16);
    const { state: parked } = attack(state, MEAL_TIME);
    const before = parked.players.p1.hand.length;
    const { state: done, events } = resolve(parked, []);
    expect(done.players.p1.hand).toHaveLength(before);
    expect(types(events)).not.toContain("DECK_SEARCHED");
    expect(types(events)).toContain("SHUFFLE");
  });

  it("the prompt NOTE is the printed sentence, round-tripped through retrieveNoun", () => {
    const state = ready(17);
    const pairs: readonly (readonly [number, string])[] = [
      [MEAL_TIME, CLAUSES[0].text],
      [BIG_MEAL, CLAUSES[1].text],
      [ENERGY_SEARCH, CLAUSES[9].text],
      [ITEM_HUNT, CLAUSES[5].text],
      [STADIUM_SEARCH, CLAUSES[7].text],
    ];
    for (const [index, text] of pairs) {
      expect(cardsPrompt(attack(state, index).state).note, text).toBe(noteFromPrint(text));
    }
    // …and the reconstruction is not a tautology — it really does delete two
    // clauses and keep everything else.
    expect(noteFromPrint(CLAUSES[9].text)).toBe(
      "Search your deck for up to 2 Basic Energy cards into your hand.",
    );
    expect(noteFromPrint(CLAUSES[0].text)).toBe("Search your deck for a card into your hand.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE READ SITES THE RESUME POINT NAMED — log.ts and redact.ts
// ─────────────────────────────────────────────────────────────────────────────

describe("the read sites, priced by driving them from an ATTACK", () => {
  it("a REVEALING search NAMES the cards in the log the opponent reads", () => {
    const state = ready(18);
    const { state: parked } = attack(state, ITEM_HUNT);
    const pick = cardsPrompt(parked).candidates[0] as string;
    const { state: done, events } = resolve(parked, [pick]);
    expect(searchRow(done, events)).toBe(
      "searched their deck — revealed fix-item and put it in hand",
    );
  });

  it("a NON-revealing search stays a COUNT — the seven printings that would leak", () => {
    const state = ready(19);
    const { state: parked } = attack(state, BIG_MEAL);
    const picks = cardsPrompt(parked).candidates.slice(0, 2);
    const { state: done, events } = resolve(parked, [...picks]);
    expect(searchRow(done, events)).toBe("searched their deck — put 2 cards in hand");
    // …and the singular reads as one card, not "1 cards".
    const solo = ready(20);
    const { state: soloParked } = attack(solo, MEAL_TIME);
    const one = cardsPrompt(soloParked).candidates.slice(0, 1);
    const resolved = resolve(soloParked, [...one]);
    expect(searchRow(resolved.state, resolved.events)).toBe(
      "searched their deck — put 1 card in hand",
    );
  });

  it("`redact.ts` resolves the candidates to the ACTOR ALONE — the first ATTACK to", () => {
    const state = ready(21);
    const { state: parked } = attack(state, ENERGY_SEARCH);
    const mine = redactGame(parked, "p1");
    if (mine.phase.kind !== "effect:choose" || mine.phase.prompt?.kind !== "chooseCards") {
      throw new Error("expected the actor to receive a chooseCards prompt");
    }
    expect(mine.phase.prompt.candidates.length).toBeGreaterThan(0);
    for (const candidate of mine.phase.prompt.candidates) {
      expect(candidate.cardId).toBe("fix-energy");
    }
    expect(mine.phase.prompt.dest).toBe("hand");
    const theirs = redactGame(parked, "p2");
    expect(theirs.phase.kind === "effect:choose" ? theirs.phase.prompt : "not-a-park").toBeNull();
    // …and a SPECTATOR is refused too, on the same gate.
    const watcher = redactGame(parked, "p1", true);
    expect(watcher.phase.kind === "effect:choose" ? watcher.phase.prompt : "not-a-park").toBeNull();
  });

  it("`programPlayable` owes NO arm — and the positive control proves it is asking", () => {
    const state = ready(22);
    for (const clause of CLAUSES) {
      expect(programPlayable(state, programOf(clause), "p1"), clause.text).toBe(true);
    }
    // …and the predicate is not simply saying yes to everything: the same board
    // refuses a gust with an empty opponent Bench.
    const empty = clearBench(state, "p2");
    expect(programPlayable(empty, [{ op: "gust" }], "p1")).toBe(false);
    expect(programPlayable(empty, programOf(CLAUSES[0]), "p1")).toBe(true);
  });

  it("no printing of this family is a played ABILITY in this pool", () => {
    for (const card of Object.values(FIXTURE_POOL)) {
      for (const ability of card.abilities ?? []) {
        expect(deriveAttackEffect(ability.effect ?? ""), `${card.id} — ${ability.name}`).toBeNull();
      }
    }
    // …and the sweep is NOT vacuous: the pool prints a whole §9 deck-search
    // ability verbatim (`sv01-076`/`sv01-209` Pachirisu), so the line above is
    // "this arm refuses that shape", not "the pool happens to print none".
    expect(FIXTURE_POOL["sv01-076"]?.abilities?.[0]?.effect).toBe(
      "Once during your turn, you may search your deck for a Basic {L} Energy card and attach it to this Pokémon. Then, shuffle your deck.",
    );
  });
});

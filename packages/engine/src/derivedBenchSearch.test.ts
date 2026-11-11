import { describe, expect, it } from "vitest";
import { programPlayable } from "./cardplay";
import { matchesFilter } from "./cards";
import { deriveAttackCoinFlip, deriveAttackEffect } from "./effects";
import type { CardFilter, EffectOp, GameState } from "./index";
import { programFor } from "./index";
import {
  BENCH_SEARCH_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  benchFromDeck,
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
    text: "Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck.",
    program: [
      { op: "searchDeck", filter: { kind: "basicPokemon" }, dest: "bench", max: 1 },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    note: "Search your deck for a Basic Pokémon onto your Bench.",
    printings: 16,
    legalPrintings: 7,
  },
  {
    text: "Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.",
    program: [
      { op: "searchDeck", filter: { kind: "basicPokemon" }, dest: "bench", max: 2 },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    note: "Search your deck for up to 2 Basic Pokémon onto your Bench.",
    printings: 11,
    legalPrintings: 7,
  },
  {
    text: "Search your deck for up to 3 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.",
    program: [
      { op: "searchDeck", filter: { kind: "basicPokemon" }, dest: "bench", max: 3 },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    note: "Search your deck for up to 3 Basic Pokémon onto your Bench.",
    printings: 2,
    legalPrintings: 2,
  },
  {
    text: "Search your deck for up to 3 Charjabug and put them onto your Bench. Then, shuffle your deck.",
    program: [
      { op: "searchDeck", filter: { kind: "byName", name: "Charjabug" }, dest: "bench", max: 3 },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    note: "Search your deck for up to 3 Charjabug onto your Bench.",
    printings: 4,
    legalPrintings: 4,
  },
] as const;

const ONE = 0;
const TWO = 1;
const THREE = 2;
const NAMED = 3;

const OTHER_NAMED: readonly (readonly [string, string, number])[] = [
  [
    "Search your deck for up to 2 Grubbin and put them onto your Bench. Then, shuffle your deck.",
    "Grubbin",
    2,
  ],
  [
    "Search your deck for up to 2 Froakie and put them onto your Bench. Then, shuffle your deck.",
    "Froakie",
    2,
  ],
  [
    "Search your deck for a Pikachu and put it onto your Bench. Then, shuffle your deck.",
    "Pikachu",
    1,
  ],
];

const TYPED: readonly (readonly [string, EffectOp[]])[] = [
  [
    "Search your deck for a Basic {G} Pokémon and put it onto your Bench. Then, shuffle your deck.",
    [
      {
        op: "searchDeck",
        filter: { kind: "typedPokemon", pokemonType: "Grass", stage: "basic" },
        dest: "bench",
        max: 1,
      },
      { op: "shuffleDeck" },
    ],
  ],
];

const NEAR_MISSES: readonly (readonly [string, string])[] = [
  [
    "Search your deck for up to 2 Basic Steven's Pokémon and put them onto your Bench. Then, shuffle your deck.",
    "an owner-narrowed noun (sv10-083, 1 legal, registry-authored)",
  ],
  [
    "You may search your deck for any number of Basic Lillie's Pokémon and put them onto your Bench. Then, shuffle your deck.",
    "an owner-narrowed noun behind a 'You may' (sv09-068, 1 legal, registry-authored)",
  ],
  [
    "Search your deck for up to 2 in any combination of Maushold and Maushold ex and put them onto your Bench. Then, shuffle your deck.",
    "a DISJUNCTION of two names (sv08-158, 1 legal, registry-authored at D339)",
  ],
  [
    "Search your deck for a Basic {Q} Pokémon and put it onto your Bench. Then, shuffle your deck.",
    "a brace code that is not a printed type — `POKEMON_TYPE_BY_CODE` has no `Q`",
  ],
  [
    "Search your deck for a {G} Pokémon and put it onto your Bench. Then, shuffle your deck.",
    "the typed noun WITHOUT the printed `Basic` — no catalog sentence benches an unmarked type, so this anchor's group spells `Basic` and refuses the rest",
  ],
  [
    "Search your deck for up to 2 Basic Pokémon with 70 HP or less and put them onto your Bench. Then, shuffle your deck.",
    "an HP predicate (3 legal, all TRAINERS) — out of this reader's column entirely",
  ],
];

const DEFERRED: readonly (readonly [string, string])[] = [
  [
    "If you go first, you can use this attack during your first turn. Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.",
    "sv06-009 Volbeat — the §4 licence, `trainerFirstTurnExempt`'s ATTACK twin",
  ],
];

const DEFERRED_BUILT =
  "Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck. If you put any Pokémon onto your Bench in this way, move an Energy from this Pokémon to the new Benched Pokémon.";

const CALL_FOR_FAMILY = 17;
const FORM_RANKS = 18;
const PARALLEL_PLACEMENT = 19;

function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: BENCH_SEARCH_DECK, p2: BENCH_SEARCH_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

function ready(seed: number, { ownBench = 0 }: { ownBench?: number } = {}): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-trainerops");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p1");
  for (let i = 0; i < ownBench; i++) state = benchFromDeck(state, "p1", "fix-basic-1");
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-basic-1");
  return state;
}

/** The parked `chooseCards` prompt an attack produced. */
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

const attack = (state: GameState, index: number) =>
  mustApply(state, { type: "attack", seat: "p1", index });

const resolve = (state: GameState, uids: string[]) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids } });

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE ANCHOR — one regex, four printed forms, two filters
// ─────────────────────────────────────────────────────────────────────────────

describe("the anchor — nine printed nouns, ONE sentence", () => {
  it("derives each printed form to its program", () => {
    for (const { text, program } of CLAUSES) {
      expect(deriveAttackEffect(text), text).toEqual(program);
    }
    for (const [text, name, max] of OTHER_NAMED) {
      expect(deriveAttackEffect(text), text).toEqual([
        { op: "searchDeck", filter: { kind: "byName", name }, dest: "bench", max },
        { op: "shuffleDeck" },
      ]);
    }
  });

  it("adds up: 20 of the family's 25 legal printings, on ONE anchor", () => {
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(20);
    expect(CLAUSES[ONE].legalPrintings).toBe(7);
    expect(CLAUSES[TWO].legalPrintings).toBe(7);
    expect(CLAUSES[THREE].legalPrintings).toBe(2);
    expect(CLAUSES[NAMED].legalPrintings).toBe(4);
    expect(20 + 2 + 1 + 1 + 1).toBe(25);
    for (const [text] of DEFERRED) expect(deriveAttackEffect(text), text).toBeNull();
    expect(deriveAttackEffect(DEFERRED_BUILT)).not.toBeNull();
    expect(deriveAttackEffect(DEFERRED_BUILT)).not.toEqual(CLAUSES[ONE].program);
    expect((deriveAttackEffect(DEFERRED_BUILT) ?? []).map((o) => o.op)).toEqual([
      "searchDeck",
      "shuffleDeck",
      "recordGate",
    ]);
  });

  it("D238 — the TYPED noun derives, and the `stage` rider is in the program", () => {
    for (const [text, program] of TYPED) {
      expect(deriveAttackEffect(text), text).toEqual(program);
    }
    // …and the unmarked form, which no catalog sentence benches, is refused by
    // this anchor's group rather than admitted and then narrowed — the reason the
    // group spells "Basic" instead of making it optional.
    expect(
      deriveAttackEffect(
        "Search your deck for a {G} Pokémon and put it onto your Bench. Then, shuffle your deck.",
      ),
    ).toBeNull();
    const marked: CardFilter = { kind: "typedPokemon", pokemonType: "Grass", stage: "basic" };
    expect(matchesFilter(FIXTURE_POOL["fix-grass-basic"], marked)).toBe(true);
    expect(matchesFilter(FIXTURE_POOL["fix-grass-stage1"], marked)).toBe(false);
  });

  it("REFUSES all six near misses — three of them LEGAL, one of them BUILT", () => {
    // A `(.+)` noun would have taken every one of these and derived a search for
    // "any Basic Pokémon" (or, worse, for a card named "Basic {G} Pokémon"). This
    // is the assertion the whole capture design exists for.
    for (const [text, why] of NEAR_MISSES) {
      expect(deriveAttackEffect(text), why).toBeNull();
    }
    // …and the owner-narrowed pair is BUILT, so the refusal above is not the
    // engine failing to simulate them — the registry answers for both, which is
    // also why a wrong anchor would have been invisible on exactly these two.
    expect(programFor("sv10-083")?.attack?.[0]).toEqual([
      {
        op: "searchDeck",
        filter: { kind: "ownerPokemon", owner: "Steven", stage: "basic" },
        dest: "bench",
        max: 2,
      },
      { op: "shuffleDeck" },
    ]);
    expect(programFor("sv09-068")?.attack?.[0]?.[0]).toMatchObject({
      op: "searchDeck",
      filter: { kind: "ownerPokemon", owner: "Lillie", stage: "basic" },
    });
  });

  it("the article and numeric forms are ONE anchor, and the missing group IS max 1", () => {
    const [one] = deriveAttackEffect(CLAUSES[ONE].text) ?? [];
    const [two] = deriveAttackEffect(CLAUSES[TWO].text) ?? [];
    expect(one).toEqual({ ...two, max: 1 });
    // …and a number the catalog does not print today rides the same arm, which is
    // why the count is captured rather than alternated over 1, 2 and 3.
    expect(
      deriveAttackEffect(
        "Search your deck for up to 9 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.",
      ),
    ).toEqual([
      { op: "searchDeck", filter: { kind: "basicPokemon" }, dest: "bench", max: 9 },
      { op: "shuffleDeck" },
    ]);
  });

  it("the NAMED form differs by its FILTER and by nothing else", () => {
    const [basic] = deriveAttackEffect(CLAUSES[THREE].text) ?? [];
    const [named] = deriveAttackEffect(CLAUSES[NAMED].text) ?? [];
    expect(named).toEqual({ ...basic, filter: { kind: "byName", name: "Charjabug" } });
    // …which is the one noun phrase that differs in print, too.
    expect(CLAUSES[NAMED].text).toBe(CLAUSES[THREE].text.replace("Basic Pokémon", "Charjabug"));
  });

  it("the NAME group is ONE capitalised word, and that is the guard", () => {
    const shape = (noun: string) =>
      `Search your deck for a ${noun} and put it onto your Bench. Then, shuffle your deck.`;
    expect(deriveAttackEffect(shape("Charjabug"))).not.toBeNull();
    for (const noun of ["Mr. Mime", "Iron Thorns", "Ho-Oh", "Farfetch'd", "charjabug"]) {
      expect(deriveAttackEffect(shape(noun)), noun).toBeNull();
    }
  });

  it("carries NO new op, NO new op field and NO new filter member", () => {
    for (const { program } of CLAUSES) {
      expect(program.map((o) => o.op)).toEqual(["searchDeck", "shuffleDeck"]);
      const [search, shuffle] = program;
      expect(Object.keys(search as object).sort()).toEqual(["dest", "filter", "max", "op"]);
      expect(Object.keys(shuffle as object)).toEqual(["op"]);
    }
    // …and the same two ops, in the same order, are what Nest Ball authors — the
    // sentence read off a Trainer instead of an attack.
    expect(programFor("sv01-181")?.trainer).toEqual(CLAUSES[ONE].program);
  });

  it("refuses the anchor, punctuation and case rewrites", () => {
    const bare = CLAUSES[ONE].text;
    const rewrites = [
      `Draw a card. ${bare}`,
      `${bare} Your opponent draws a card.`,
      // Case, both ends.
      bare.replace("Search", "search"),
      bare.replace("Bench", "bench"),
      // The trailing period, and the trailing SENTENCE — the shuffle is printed,
      // so a build that made it optional would read a card that never says it.
      bare.slice(0, -1),
      "Search your deck for a Basic Pokémon and put it onto your Bench.",
      "Search your deck for a Basic Pokémon and put them onto your Bench. Then, shuffle your deck.",
      "Search your deck for up to 2 Basic Pokémon and put it onto your Bench. Then, shuffle your deck.",
      "Search your deck for a Basic Pokémon and put it into your hand. Then, shuffle your deck.",
      // The opponent's board, which no member of this family reaches.
      "Search your deck for a Basic Pokémon and put it onto your opponent's Bench. Then, shuffle your deck.",
      // The DISCARD PILE — `discardPileRetrieval`'s zone, a different op.
      "Search your discard pile for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck.",
      "Search your deck for up to 0 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.",
    ];
    for (const text of rewrites) expect(deriveAttackEffect(text), text).toBeNull();
  });

  it("hands no clause to the coin reader, and carries no apostrophe to curl", () => {
    for (const { text } of CLAUSES) expect(deriveAttackCoinFlip(text), text).toBeNull();
    for (const { text } of CLAUSES) {
      expect(text.includes("'"), text).toBe(false);
      expect(text.includes("’"), text).toBe(false);
    }
  });
});

describe("PROVENANCE — the demonstrator carries the three forms at 17-19", () => {
  it("fields the family at indices 17-19, appended and not inserted", () => {
    const attacks = FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];
    expect(attacks).toHaveLength(73);
    expect(attacks[CALL_FOR_FAMILY]?.effect).toBe(CLAUSES[ONE].text);
    expect(attacks[FORM_RANKS]?.effect).toBe(CLAUSES[TWO].text);
    expect(attacks[PARALLEL_PLACEMENT]?.effect).toBe(CLAUSES[NAMED].text);
    // The indices the sibling suites address by constant did not move.
    expect(attacks[14]?.effect).toBe(
      "Move an Energy from this Pokémon to 1 of your Benched Pokémon.",
    );
    expect(attacks[2]?.effect).toBe(
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
    );
  });

  it("NO printed base damage on any of the three — and here that IS the catalog", () => {
    const attacks = FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];
    for (const index of [CALL_FOR_FAMILY, FORM_RANKS, PARALLEL_PLACEMENT]) {
      expect(attacks[index]?.damage, `index ${index}`).toBeUndefined();
    }
    // …and the neighbouring index that DOES print a number still does, so this is
    // an assertion about these three rows and not about the fixture at large.
    expect(attacks[3]?.damage).toBe(60);
  });

  it("index 19's COST diverges from its printing, and says so here", () => {
    const attacks = FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];
    expect(attacks[PARALLEL_PLACEMENT]?.cost).toEqual(["Colorless"]);
    for (const attack of attacks) expect(attack.cost).not.toContain("Lightning");
  });

  it("`fix-charjabug` is a STAGE 1 named Charjabug — both halves load-bearing", () => {
    const card = FIXTURE_POOL["fix-charjabug"];
    // The NAME is what `byName` matches, and it is the only body in this pool
    // whose name is not its own id.
    expect(card?.name).toBe("Charjabug");
    expect(card?.id).toBe("fix-charjabug");
    // The STAGE is what makes it a discriminator: `basicPokemon` cannot admit it,
    // so the two filters this anchor emits have DISJOINT candidate sets on the
    // one board below.
    expect(card?.stage).toBe("Stage1");
    expect(card?.evolveFrom).toBe("Grubbin");
  });
});

describe("end to end — out of the ATTACKER's deck, onto the ATTACKER's Bench", () => {
  it("parks offering the actor's own Basic Pokémon, bound for the actor's Bench", () => {
    const state = ready(11);
    deepFreeze(state);
    const { state: parked } = attack(state, CALL_FOR_FAMILY);

    const prompt = cardsPrompt(parked);
    expect(parked.phase.kind === "effect:choose" ? parked.phase.seat : undefined).toBe("p1");
    expect(prompt.dest).toBe("bench");
    expect(prompt.max).toBe(1);
    expect(prompt.min).toBe(0);
    expect(prompt.note).toBe(CLAUSES[ONE].note);
    for (const uid of prompt.candidates) expect(parked.players.p1.deck).toContain(uid);
    // …and every one of them is a BASIC: `fix-charjabug` is in this deck and is a
    // Stage 1, so the filter has something to refuse rather than admitting the
    // whole deck by accident.
    expect(new Set(offered(parked))).toEqual(
      new Set(["fix-basic-1", "fix-bigbody", "fix-trainerops"]),
    );
    expect(offered(parked)).not.toContain("fix-charjabug");
    // Nothing has moved yet.
    expect(parked.players.p1.bench).toHaveLength(0);
  });

  it("resolving benches the pick on the ACTOR's side, and shuffles after", () => {
    const state = ready(12);
    const { state: parked } = attack(state, CALL_FOR_FAMILY);
    const pick = cardsPrompt(parked).candidates[0] as string;
    const opponentBench = parked.players.p2.bench.length;
    const { state: done, events } = resolve(parked, [pick]);

    expect(done.players.p1.bench.map((p) => p.stack[0])).toEqual([pick]);
    expect(done.players.p1.deck).not.toContain(pick);
    expect(done.players.p2.bench).toHaveLength(opponentBench);
    expect(done.players.p2.deck).not.toContain(pick);
    // …and the TRAILING op fired, in printed order. `DECK_SEARCHED` then `SHUFFLE`
    // is the whole printed sentence, and a build that dropped the second op would
    // leave the deck's order readable to a player who just looked through it.
    expect(types(events).filter((t) => t === "DECK_SEARCHED" || t === "SHUFFLE")).toEqual([
      "DECK_SEARCHED",
      "SHUFFLE",
    ]);
  });

  it("the NAMED noun and the BASIC noun have DISJOINT candidate sets", () => {
    const state = ready(13);
    const basics = new Set(offered(attack(state, CALL_FOR_FAMILY).state));
    const named = new Set(offered(attack(state, PARALLEL_PLACEMENT).state));
    expect(named).toEqual(new Set(["fix-charjabug"]));
    for (const id of named) expect(basics.has(id)).toBe(false);
    expect(basics.size).toBeGreaterThan(0);
  });

  it("the NAMED search takes up to three, and a Stage 1 really does reach the Bench", () => {
    const state = ready(14);
    const { state: parked } = attack(state, PARALLEL_PLACEMENT);
    expect(cardsPrompt(parked).max).toBe(3);
    const picks = cardsPrompt(parked).candidates.slice(0, 3);
    expect(picks).toHaveLength(3);
    const { state: done } = resolve(parked, picks);
    expect(done.players.p1.bench.map((p) => done.cardIdByUid[p.stack[0] as string])).toEqual([
      "fix-charjabug",
      "fix-charjabug",
      "fix-charjabug",
    ]);
    for (const uid of picks) expect(done.players.p1.deck).not.toContain(uid);
  });

  it("the printed max is CLAMPED to the remaining bench space, never to the number", () => {
    const state = ready(15, { ownBench: 3 });
    const { state: parked } = attack(state, PARALLEL_PLACEMENT);
    expect(cardsPrompt(parked).max).toBe(2);
    expect(cardsPrompt(parked).note).toBe(
      "Search your deck for up to 2 Charjabug onto your Bench.",
    );
  });

  it("a FULL Bench takes no park at all — and the deck is still shuffled", () => {
    const state = ready(16, { ownBench: 5 });
    const { state: done, events } = attack(state, CALL_FOR_FAMILY);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(types(events)).not.toContain("DECK_SEARCHED");
    expect(types(events)).toContain("SHUFFLE");
    expect(done.players.p1.bench).toHaveLength(5);
  });

  it("a WHIFF still shuffles — the candidate set is empty and the sentence completes", () => {
    // Every Charjabug out of the deck, so the named search can find nothing. Same
    // ending as the full Bench, arrived at from the other side.
    let state = ready(17);
    const copies = state.players.p1.deck.filter(
      (uid) => state.cardIdByUid[uid] === "fix-charjabug",
    ).length;
    expect(copies).toBeGreaterThan(0);
    state = discardFromDeck(state, "p1", "fix-charjabug", copies);
    const { state: done, events } = attack(state, PARALLEL_PLACEMENT);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(types(events)).not.toContain("DECK_SEARCHED");
    expect(types(events)).toContain("SHUFFLE");
    expect(done.players.p1.bench).toHaveLength(0);
  });

  it("DECLINING is legal, benches nothing, and still shuffles", () => {
    const state = ready(18);
    const { state: parked } = attack(state, CALL_FOR_FAMILY);
    const { state: done, events } = resolve(parked, []);
    expect(done.players.p1.bench).toHaveLength(0);
    expect(types(events)).not.toContain("DECK_SEARCHED");
    expect(types(events)).toContain("SHUFFLE");
  });

  it("the numeric form takes TWO, and the note names the number", () => {
    const state = ready(19);
    const { state: parked } = attack(state, FORM_RANKS);
    expect(cardsPrompt(parked).max).toBe(2);
    expect(cardsPrompt(parked).note).toBe(CLAUSES[TWO].note);
    const picks = cardsPrompt(parked).candidates.slice(0, 2);
    const { state: done } = resolve(parked, picks);
    expect(done.players.p1.bench).toHaveLength(2);
  });
});

describe("the read sites, priced by driving them rather than by arguing", () => {
  it("`programPlayable` owes NO bench-space arm, and the positive case proves it", () => {
    const full = ready(20, { ownBench: 5 });
    for (const { program } of CLAUSES) {
      expect(programPlayable(full, program, "p1")).toBe(true);
    }
    // …and the predicate is not simply saying yes to everything: the same board
    // refuses a gust with an empty opponent Bench, which is the shape a bench-space
    // arm would have copied.
    const empty = clearBench(full, "p2");
    expect(programPlayable(empty, [{ op: "gust" }], "p1")).toBe(false);
    expect(programPlayable(empty, CLAUSES[ONE].program, "p1")).toBe(true);
  });

  it("no printing of this family is a played ABILITY — the sweep's negative result", () => {
    for (const card of Object.values(FIXTURE_POOL)) {
      for (const ability of card.abilities ?? []) {
        const text = ability.effect ?? "";
        expect(
          text.includes("earch your deck") && text.includes("onto your Bench"),
          `${card.id} — ${ability.name}`,
        ).toBe(false);
      }
    }
    expect(
      Object.values(FIXTURE_POOL).some((card) =>
        (card.abilities ?? []).some((a) => (a.effect ?? "").includes("onto your Bench")),
      ),
    ).toBe(true);
  });
});

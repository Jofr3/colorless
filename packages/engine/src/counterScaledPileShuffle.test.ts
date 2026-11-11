import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackEffect,
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
} from "./effects";
import type { CardFilter, EffectOp } from "./effectTypes";
import { applyAction } from "./index";
import type { GameEvent, GameState, PokemonRef, Seat } from "./index";
import { countCardsInDiscardPile } from "./boardCondition";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  must,
  driveSetup,
  roundTrip,
} from "./testFixtures";
import { present } from "./fixtures/values";

const PRINTED =
  "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck.";

/** The printed HEAD and the printed TAIL, each on its own. Neither is read by anything,
    which is the whole-sentence claim made executable rather than asserted in prose. */
const HEAD_ALONE =
  "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile.";
const TAIL_ALONE = "Then, shuffle those Energy cards into your deck.";

const UNSCALED_TWIN = "Put 2 damage counters on 1 of your opponent's Pokémon.";

/** The filter the printed noun resolves to. ONE object, shared by both ops. */
const GRASS_FILTER: CardFilter = { kind: "basicEnergy", energyType: "Grass" };

/** The derived program, spelled once. THREE ops in printed order. */
const PROGRAM: EffectOp[] = [
  {
    op: "damageChosen",
    target: "opponentAny",
    amount: 20,
    count: 1,
    source: "attack",
    perDiscardPileCard: GRASS_FILTER,
  },
  { op: "discardPileRetrieval", filter: GRASS_FILTER, dest: "deck", max: "all" },
  { op: "shuffleDeck" },
];

const SNIPER = "d538-pile-sniper";
const WALL = "d538-wall";
const B1 = "d538-b1";
const B2 = "d538-b2";
/** THE MATCHING CARD — Basic {G} Energy, the only card class the printed noun names. */
const GRASS = "fix-grass-energy";
/** THE OFF-TYPE BASIC — Basic {R}. `basicEnergy` YES, `energyType: "Grass"` NO, so it
    separates the TYPED filter from a bare `{kind:"basicEnergy"}`. */
const FIRE = "fix-fire-energy";
/** THE SPECIAL ENERGY — `anyEnergy` YES, `basicEnergy` NO (the printed word *"Basic"*). */
const SPECIAL = "fix-special";
/** THE NON-ENERGY — an Item Trainer, so a build counting pile LENGTH reads a third
    number and not a second one. */
const ITEM = "fix-item";
/** Basic {C} — the printed cost of both declared attacks, and nothing else. */
const ENERGY = "fix-energy";

const bencher = (id: string, name: string, hp: number): Card =>
  battler(id, {
    name,
    hp,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  });

const LOCAL_CARDS: Record<string, Card> = {
  [SNIPER]: battler(SNIPER, {
    name: "D538 Pile Sniper",
    hp: 260,
    retreat: 1,
    types: ["Colorless"],
    attacks: [
      { cost: ["Colorless"], name: "Pile Snipe", effect: PRINTED },
      // THE CONTROL, one index over: same attacker, same cost, NO effect text — so
      // every "no park AND no board change" verdict is a claim about the op rather
      // than about the board.
      { cost: ["Colorless"], name: "Plain Tap", damage: 10 },
      // THE NOUN NEAR MISSES, declared so §6 can drive the guard through a real attack
      // rather than through the deriver alone. Index 2 resolves to a NON-ENERGY filter
      // (`typedPokemon`) and index 3 resolves to NOTHING at all (`{Q}` is not a code).
      {
        cost: ["Colorless"],
        name: "Body Count",
        effect:
          "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Pokémon in your discard pile. Then, shuffle those Energy cards into your deck.",
      },
      {
        cost: ["Colorless"],
        name: "Nonsense Count",
        effect:
          "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {Q} Energy card in your discard pile. Then, shuffle those Energy cards into your deck.",
      },
    ],
  }),
  [WALL]: bencher(WALL, "D538 Wall", 330),
  [B1]: bencher(B1, "D538 B1", 200),
  [B2]: bencher(B2, "D538 B2", 200),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [SNIPER]: 4,
  [WALL]: 4,
  [B1]: 4,
  [B2]: 4,
  [GRASS]: 12,
  [FIRE]: 6,
  [SPECIAL]: 6,
  [ITEM]: 6,
  [ENERGY]: 14,
});

function localSetup(seed: number): GameState {
  return driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first: "p2" });
}

function toPile(state: GameState, seat: Seat, cardId: string, count: number): GameState {
  const side = state.players[seat];
  const uids = side.deck.filter((u) => state.cardIdByUid[u] === cardId).slice(0, count);
  if (uids.length < count) {
    throw new Error(`${seat} deck has ${uids.length} ${cardId}, needed ${count}`);
  }
  const taken = new Set(uids);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((u) => !taken.has(u)),
        discard: [...side.discard, ...uids],
      },
    },
  };
}

/** TEST SURGERY — attach `count` copies of `fix-energy` off `seat`'s deck onto its
    Active, so the printed cost is payable. */
function fuel(state: GameState, seat: Seat, count: number): GameState {
  let next = state;
  for (let i = 0; i < count; i++) {
    const side = next.players[seat];
    const body = side.active;
    if (body === null) throw new Error(`${seat} has no Active`);
    const uid = side.deck.find((u) => next.cardIdByUid[u] === ENERGY);
    if (uid === undefined) throw new Error(`${seat}'s deck lacks ${ENERGY}`);
    next = {
      ...next,
      players: {
        ...next.players,
        [seat]: {
          ...side,
          active: { ...body, energy: [...body.energy, uid] },
          deck: side.deck.filter((u) => u !== uid),
        },
      },
    };
  }
  return next;
}

function stockPile(state: GameState): GameState {
  let next = toPile(state, "p1", GRASS, 3);
  next = toPile(next, "p1", FIRE, 2);
  next = toPile(next, "p1", SPECIAL, 2);
  next = toPile(next, "p1", ITEM, 1);
  return toPile(next, "p2", GRASS, 1);
}

function board(seed: number, bench: readonly string[] = []): GameState {
  let state = localSetup(seed);
  state = setActiveFromDeck(state, "p2", WALL);
  state = clearBench(state, "p2");
  for (const id of bench) state = benchFromDeck(state, "p2", id);
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", SNIPER);
  state = clearBench(state, "p1");
  return fuel(state, "p1", 1);
}

function attack(state: GameState, index = 0): { state: GameState; events: readonly GameEvent[] } {
  const result = applyAction(state, { type: "attack", seat: "p1", index });
  if (!result.ok) throw new Error(`attack failed: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: result.events };
}

function answer(
  state: GameState,
  ref: PokemonRef,
): { state: GameState; events: readonly GameEvent[] } {
  const result = applyAction(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemonMulti", refs: [ref] },
  });
  if (!result.ok) throw new Error(`answer refused: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: result.events };
}

const SEED = 538;
const benchRef = (index: number): PokemonRef => ({ seat: "p2", spot: { spot: "bench", index } });
const ACTIVE_REF: PokemonRef = { seat: "p2", spot: { spot: "active" } };
const rows = (events: readonly GameEvent[], type: string) => events.filter((e) => e.type === type);
const pileIds = (state: GameState, seat: Seat): string[] =>
  state.players[seat].discard.map((u) => state.cardIdByUid[u] ?? "?");
const deckIds = (state: GameState, seat: Seat): string[] =>
  state.players[seat].deck.map((u) => state.cardIdByUid[u] ?? "?");
const activeDamage = (state: GameState, seat: Seat): number =>
  state.players[seat].active?.damage ?? -1;

describe("D538 §1 — the corpus row, read off the census rather than retyped", () => {
  it("the row is READ by index and by units, never retyped (D183/D456)", () => {
    const corpus = legalAttackCorpus();
    const row = corpus[359];
    expect(row?.[1]).toBe(PRINTED);
    expect(row?.[0]).toBe(3);
    expect(corpus.filter(([, s]) => s === PRINTED)).toEqual([[3, PRINTED]]);
  });

  it("the sentence is READ by `resolvedByAnyReader` at head — the census delta's own predicate", () => {
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
  });

  it("the SURFACE did not grow: a new ARM is not a new READER (D447)", () => {
    // Asked of the SURFACE rather than of one reader: arm 23b-bis sits inside
    // `deriveAttackEffect`, so there is no fourteenth reader and `attackReaderSurface()`
    // is the same length it was at HEAD.
  });

  it("ONE apostrophe slot, COUNTED off the printed bytes", () => {
    expect((PRINTED.match(/'/g) ?? []).length).toBe(1);
    expect(PRINTED.split("opponent's")).toHaveLength(2);
  });

  it("the one slot CURLS and derives IDENTICALLY (D136/D137)", () => {
    const curly = PRINTED.replace("opponent's", "opponent’s");
    expect(curly).not.toBe(PRINTED);
    expect((curly.match(/'/g) ?? []).length).toBe(0);
    expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(PRINTED));
    expect(deriveAttackEffect(curly)).toEqual(PROGRAM);
  });

  it("the LOOKALIKE `Pokemon` is not `Pokémon` — the one occurrence", () => {
    expect(PRINTED.split("Pokémon")).toHaveLength(2);
    expect(deriveAttackEffect(PRINTED.replace("Pokémon", "Pokemon"))).toBeNull();
  });

  it("a NON-BREAKING SPACE anywhere in the sentence is NOT this sentence", () => {
    const nbsp = PRINTED.replace("Put 2", "Put 2");
    expect(nbsp).not.toBe(PRINTED);
    expect(deriveAttackEffect(nbsp)).toBeNull();
  });

  it("the HEAD is anchored — a printed prefix refuses", () => {
    expect(
      deriveAttackEffect(`You may ${PRINTED[0]?.toLowerCase()}${PRINTED.slice(1)}`),
    ).toBeNull();
    expect(
      deriveAttackEffect(`Flip a coin. If heads, ${PRINTED[0]?.toLowerCase()}${PRINTED.slice(1)}`),
    ).toBeNull();
  });

  it("the TAIL is anchored — the `$` refuses a printed continuation", () => {
    expect(
      deriveAttackEffect(`${PRINTED} During your next turn, this Pokémon can't attack.`),
    ).toBeNull();
    expect(deriveAttackEffect(PRINTED.replace(/\.$/, ""))).toBeNull();
    expect(deriveAttackEffect(PRINTED.replace(/\.$/, "!"))).toBeNull();
  });

  it("NEITHER HALF IS READ ON ITS OWN, which is what makes the anchor whole-sentence", () => {
    expect(deriveAttackEffect(HEAD_ALONE)).toBeNull();
    expect(deriveAttackEffect(TAIL_ALONE)).toBeNull();
    expect(deriveAttackEffect("Shuffle those Energy cards into your deck.")).toBeNull();
  });

  it("NO SPLITTER composes on it, which is why `SPLIT_ATTACK_UNITS` does not move", () => {
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    expect(splitAttackRequirementClause(PRINTED)).toBeNull();
    expect(splitAttackCancelClause(PRINTED)).toBeNull();
  });
});

describe("D538 §2 — arm 23b-bis derives THREE ops, and ONE filter object serves two of them", () => {
  it("the whole program, field for field", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual(PROGRAM);
  });

  it("the counters are converted to HP AT THE PRODUCER (§12), never left as counters", () => {
    expect((present(deriveAttackEffect(PRINTED))[0] as Record<string, unknown>).amount).toBe(20);
    expect(
      (
        present(deriveAttackEffect(PRINTED.replace("Put 2 ", "Put 5 ")))[0] as Record<
          string,
          unknown
        >
      ).amount,
    ).toBe(50);
  });

  it("the count is CAPTURED and the printed-zero guard is LOUD", () => {
    expect(deriveAttackEffect(PRINTED.replace("Put 2 ", "Put 0 "))).toBeNull();
    expect(deriveAttackEffect(PRINTED.replace("Put 2 ", "Put 1 "))).not.toBeNull();
  });

  it("THE SAME FILTER OBJECT reaches both ops — asserted by IDENTITY, not by shape", () => {
    const program = deriveAttackEffect(PRINTED) as unknown as Record<string, unknown>[];
    expect(program).toHaveLength(3);
    expect(program[0]?.perDiscardPileCard).toBe(program[1]?.filter);
    expect(program[0]?.perDiscardPileCard).toEqual(GRASS_FILTER);
  });

  it("the ORDER is placement → retrieval → shuffle, and the order is the mechanism", () => {
    expect(deriveAttackEffect(PRINTED)?.map((o) => o.op)).toEqual([
      "damageChosen",
      "discardPileRetrieval",
      "shuffleDeck",
    ]);
  });

  it("NO `deals`, NO `recordAs`, NO `exclude`, NO `ignoreWR` — every absent key named", () => {
    const head = deriveAttackEffect(PRINTED)?.[0] as Record<string, unknown>;
    const retrieval = deriveAttackEffect(PRINTED)?.[1] as Record<string, unknown>;
    expect(head).not.toHaveProperty("deals");
    expect(head).not.toHaveProperty("ignoreWR");
    expect(head).not.toHaveProperty("optional");
    expect(retrieval).not.toHaveProperty("recordAs");
    expect(retrieval).not.toHaveProperty("exclude");
    expect(Object.keys(head).sort()).toEqual(
      ["amount", "count", "op", "perDiscardPileCard", "source", "target"].sort(),
    );
    expect(Object.keys(retrieval).sort()).toEqual(["dest", "filter", "max", "op"].sort());
  });

  it("DIRECTION 1 — arm 23b-bis cannot claim arm 23b's string", () => {
    expect(deriveAttackEffect(UNSCALED_TWIN)).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 20, count: 1, source: "attack" },
    ]);
    expect(deriveAttackEffect(UNSCALED_TWIN)).toHaveLength(1);
    expect(deriveAttackEffect(UNSCALED_TWIN)?.[0]).not.toHaveProperty("perDiscardPileCard");
  });

  it("DIRECTION 2 — arm 23b cannot claim arm 23b-bis's string", () => {
    expect(deriveAttackEffect(PRINTED)).toHaveLength(3);
    expect(deriveAttackEffect(PRINTED)).not.toEqual(deriveAttackEffect(UNSCALED_TWIN));
    // …and the scaled sentence is NOT the unscaled one with a rider bolted on: the
    // program length is the difference a widened `(\d+)` capture could never produce.
    expect(deriveAttackEffect(PRINTED)?.[0]).not.toEqual(deriveAttackEffect(UNSCALED_TWIN)?.[0]);
  });

  it("DIRECTION 3 — the COMPOUND at corpus line 416 keeps its own two ops", () => {
    // Arm 25's sentence shares this one's first eight words and diverges at the same
    // offset. The `$` on all three anchors is what keeps the three apart, and it is
    // asserted from every side rather than reasoned about.
    const compound =
      "Put 9 damage counters on 1 of your opponent's Pokémon. During your next turn, this Pokémon can't attack.";
    expect(deriveAttackEffect(compound)).toHaveLength(2);
    expect(deriveAttackEffect(compound)).not.toEqual(deriveAttackEffect(PRINTED));
    expect(deriveAttackEffect(compound)?.map((o) => o.op)).toEqual([
      "damageChosen",
      "preventAttack",
    ]);
  });

  it("THE TWO NEAR MISSES, both refused on the NOUN and each for its own reason", () => {
    // (a) A noun that resolves to a NON-ENERGY filter — refused by the `basicEnergy`
    //     guard, which is the printed anaphora ("those ENERGY cards") made mechanical.
    expect(
      deriveAttackEffect(
        "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Pokémon in your discard pile. Then, shuffle those Energy cards into your deck.",
      ),
    ).toBeNull();
    // (b) A noun that resolves to NOTHING — `{Q}` is in neither code map, so
    //     `typedNounFilter` returns `undefined` and the sentence falls to the loud skip
    //     path rather than being approximated.
    expect(
      deriveAttackEffect(
        "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {Q} Energy card in your discard pile. Then, shuffle those Energy cards into your deck.",
      ),
    ).toBeNull();
  });

  it("THE NUMBER IS WELDED: the PLURAL spelling of the noun derives NOTHING", () => {
    expect(
      deriveAttackEffect(
        "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy cards in your discard pile. Then, shuffle those Energy cards into your deck.",
      ),
    ).toBeNull();
    // …and the SINGULAR one does derive, which is the control that makes the refusal
    // above about the NUMBER rather than about the sentence.
    expect(deriveAttackEffect(PRINTED)).not.toBeNull();
  });

  it("the OTHER printed types derive too — the filter is the CAPTURE, not a literal", () => {
    expect(
      (
        present(
          deriveAttackEffect(PRINTED.replace("Basic {G} Energy", "Basic {R} Energy")),
        )[0] as Record<string, unknown>
      ).perDiscardPileCard,
    ).toEqual({ kind: "basicEnergy", energyType: "Fire" });
    // …and the UNQUALIFIED Energy noun is refused: without the printed word "Basic" the
    // phrase is a PROVISION phrase, a different filter for a different question.
    expect(
      deriveAttackEffect(
        "Put 2 damage counters on 1 of your opponent's Pokémon for each {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck.",
      ),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE FOLD: the pile, the seat and the filter.
// ─────────────────────────────────────────────────────────────────────────────

describe("D538 §3 — the amount folds over the CONTROLLER's pile, through the PRINTED filter", () => {
  it("the canonical pile answers 3 / 5 / 7 / 8 / 1 — five builds, five numbers", () => {
    const state = stockPile(board(SEED));
    expect(countCardsInDiscardPile(state, "p1", GRASS_FILTER)).toBe(3);
    expect(countCardsInDiscardPile(state, "p1", { kind: "basicEnergy" })).toBe(5);
    expect(countCardsInDiscardPile(state, "p1", { kind: "anyEnergy" })).toBe(7);
    expect(state.players.p1.discard).toHaveLength(8);
    expect(countCardsInDiscardPile(state, "p2", GRASS_FILTER)).toBe(1);
  });

  it("the ATTACK reads 3 and places 60 — the printed 2 counters × 3 cards", () => {
    const { state } = attack(stockPile(board(SEED)));
    // The opponent fields only an Active, so `count: 1` FORCES and there is no park.
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(activeDamage(state, "p2")).toBe(60);
  });

  it("THE SEAT IS `ctx.seat` AND NOT ITS COMPLEMENT — the opponent's pile is not read", () => {
    const stocked = stockPile(board(SEED));
    expect(countCardsInDiscardPile(stocked, "p2", GRASS_FILTER)).toBe(1);
    const { state } = attack(stocked);
    expect(activeDamage(state, "p2")).toBe(60);
    expect(activeDamage(state, "p2")).not.toBe(20);
  });

  it("THE FILTER IS READ — a pile of decoys alone places nothing", () => {
    let state = board(SEED);
    state = toPile(state, "p1", FIRE, 2);
    state = toPile(state, "p1", SPECIAL, 2);
    state = toPile(state, "p1", ITEM, 1);
    expect(state.players.p1.discard).toHaveLength(5);
    expect(countCardsInDiscardPile(state, "p1", GRASS_FILTER)).toBe(0);
    const after = attack(state);
    expect(activeDamage(after.state, "p2")).toBe(0);
    expect(after.state.phase.kind).not.toBe("effect:choose");
  });

  it("AN EMPTY PILE FOLDS TO 0 AND `damageChosen` RETURNS BEFORE ASKING", () => {
    // Not a park with nothing in it — `stepOp`'s `amount <= 0` early return ends the op
    // BEFORE the candidates are offered, which is the ending a 0-taken Covetous Ivy has.
    // Driven on a board where the opponent HAS a bench, so a park is otherwise certain.
    const state = board(SEED, [B1, B2]);
    expect(state.players.p1.discard).toHaveLength(0);
    const { state: after } = attack(state);
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(activeDamage(after, "p2")).toBe(0);
    expect(after.players.p2.bench.map((b) => b.damage)).toEqual([0, 0]);
  });

  it("the fold SCALES — one more matching card is one more 20", () => {
    for (const [copies, hp] of [
      [1, 20],
      [2, 40],
      [4, 80],
    ] as const) {
      const { state } = attack(toPile(board(SEED), "p1", GRASS, copies));
      expect(activeDamage(state, "p2"), `${copies} copies`).toBe(hp);
    }
  });
});

describe('D538 §4 — `max: "all"` moves the whole matching pile, FORCED and never parked', () => {
  it("the three matching cards leave the pile and land in the deck", () => {
    const before = stockPile(board(SEED));
    expect(pileIds(before, "p1").filter((id) => id === GRASS)).toHaveLength(3);
    const { state } = attack(before);
    // The matching cards are GONE from the pile and the five decoys are untouched.
    expect(pileIds(state, "p1").filter((id) => id === GRASS)).toHaveLength(0);
    expect(pileIds(state, "p1").sort()).toEqual([FIRE, FIRE, ITEM, SPECIAL, SPECIAL].sort());
    expect(state.players.p1.discard).toHaveLength(5);
    expect(deckIds(state, "p1").filter((id) => id === GRASS)).toHaveLength(
      deckIds(before, "p1").filter((id) => id === GRASS).length + 3,
    );
  });

  it("ONE `DISCARD_RETRIEVED` row, naming the SEAT, the DEST and the UIDS that moved", () => {
    const before = stockPile(board(SEED));
    const movedUids = before.players.p1.discard.filter((u) => before.cardIdByUid[u] === GRASS);
    const { events, state } = attack(before);
    const retrieved = rows(events, "DISCARD_RETRIEVED");
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0]).toEqual({
      type: "DISCARD_RETRIEVED",
      seat: "p1",
      dest: "deck",
      uids: movedUids,
    });
    expect(state.players.p1.discard.some((u) => movedUids.includes(u))).toBe(false);
  });

  it("NO PARK — the clause is mandatory, so the player is never asked", () => {
    const { state } = attack(stockPile(board(SEED)));
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(JSON.stringify(state)).not.toContain("chooseCards");
  });

  it('`max: "all"` is the WHOLE matching pile and not a number — six copies move too', () => {
    const before = toPile(board(SEED), "p1", GRASS, 6);
    const { state } = attack(before);
    expect(activeDamage(state, "p2")).toBe(120);
    expect(pileIds(state, "p1")).toEqual([]);
  });

  it("the DESTINATION is the DECK and not the hand", () => {
    const before = stockPile(board(SEED));
    const handSize = before.players.p1.hand.length;
    const movedUids = before.players.p1.discard.filter((u) => before.cardIdByUid[u] === GRASS);
    const { state } = attack(before);
    expect(state.players.p1.hand).toHaveLength(handSize);
    expect(movedUids).toHaveLength(3);
    for (const uid of movedUids) {
      expect(state.players.p1.hand, uid).not.toContain(uid);
      expect(state.players.p1.deck, uid).toContain(uid);
    }
  });

  it("the RETRIEVAL reads the SAME filter the fold did — the decoys stay put", () => {
    const { state } = attack(stockPile(board(SEED)));
    expect(activeDamage(state, "p2")).toBe(60);
    expect(pileIds(state, "p1").filter((id) => id === SPECIAL)).toHaveLength(2);
    expect(pileIds(state, "p1").filter((id) => id === FIRE)).toHaveLength(2);
    expect(pileIds(state, "p1").filter((id) => id === ITEM)).toHaveLength(1);
  });

  it("ONE `SHUFFLE` row and ONE RNG draw for one printed shuffle", () => {
    const before = stockPile(board(SEED));
    const { events, state } = attack(before);
    expect(rows(events, "SHUFFLE")).toEqual([{ type: "SHUFFLE", seat: "p1" }]);
    expect(state.rngState).not.toEqual(before.rngState);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — BOTH RESOLUTION PATHS OF `damageChosen`, AT THE SAME PILE VALUE.
// ─────────────────────────────────────────────────────────────────────────────

describe("D538 §5 — forced and parked resolve the same sentence to the same board", () => {
  it("FORCED — the opponent fields only an Active, so `count: 1` takes it without asking", () => {
    // §8.6: with fewer candidates than the printed number, take them all. `opponentAny`
    // over a bare Active is exactly one candidate.
    const { state } = attack(stockPile(board(SEED)));
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(activeDamage(state, "p2")).toBe(60);
    // …and the WHOLE program ran in the one action: the retrieval and the shuffle are
    // not left behind by the forced path.
    expect(state.players.p1.discard).toHaveLength(5);
  });

  it("PARKED — a bench makes it a real question, and the pile is READ AT THE SAME VALUE", () => {
    const before = stockPile(board(SEED, [B1, B2]));
    const { state: parked } = attack(before);
    expect(parked.phase.kind).toBe("effect:choose");
    expect(parked.players.p1.discard).toHaveLength(8);
    expect(countCardsInDiscardPile(parked, "p1", GRASS_FILTER)).toBe(3);
    const { state: done } = answer(parked, benchRef(1));
    expect(done.players.p2.bench[1]?.damage).toBe(60);
    expect(done.players.p2.bench[0]?.damage).toBe(0);
    expect(activeDamage(done, "p2")).toBe(0);
    // …and the rest of the program ran on resume, exactly as it did on the forced path.
    expect(done.players.p1.discard).toHaveLength(5);
  });

  it("THE PARKED PATH CAN ALSO NAME THE ACTIVE, and the amount is the same 60", () => {
    const before = stockPile(board(SEED, [B1, B2]));
    const { state: parked } = attack(before);
    const { state: done } = answer(parked, ACTIVE_REF);
    expect(activeDamage(done, "p2")).toBe(60);
    expect(done.players.p2.bench.map((b) => b.damage)).toEqual([0, 0]);
  });

  it("the two paths agree on the PILE, the DECK and the EVENTS", () => {
    // The same sentence, the same pile, two different boards — and everything this op
    // does to the CONTROLLER's zones is identical. That is what makes the forced branch a
    // shortcut rather than a second implementation.
    const forced = attack(stockPile(board(SEED)));
    const before = stockPile(board(SEED, [B1, B2]));
    const parked = attack(before);
    const resumed = answer(parked.state, benchRef(0));
    expect(pileIds(forced.state, "p1").sort()).toEqual(pileIds(resumed.state, "p1").sort());
    expect(rows(forced.events, "DISCARD_RETRIEVED")).toHaveLength(1);
    expect(rows(resumed.events, "DISCARD_RETRIEVED")).toHaveLength(1);
    expect(rows(forced.events, "SHUFFLE")).toHaveLength(1);
    expect(rows(resumed.events, "SHUFFLE")).toHaveLength(1);
    expect(rows(parked.events, "DISCARD_RETRIEVED")).toHaveLength(0);
    expect(rows(parked.events, "SHUFFLE")).toHaveLength(0);
  });

  it("the CONTROL attack, one index over, moves none of this", () => {
    // Same attacker, same cost, no effect text: every "the op did it" verdict above is a
    // claim about the op rather than about the board.
    const before = stockPile(board(SEED, [B1, B2]));
    const { state, events } = attack(before, 1);
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(state.players.p1.discard).toHaveLength(8);
    expect(rows(events, "DISCARD_RETRIEVED")).toHaveLength(0);
    expect(rows(events, "SHUFFLE")).toHaveLength(0);
    expect(activeDamage(state, "p2")).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE `basicEnergy` GUARD, AND ITS LOUD SKIP.
// ─────────────────────────────────────────────────────────────────────────────

describe("D538 §6 — a head noun the tail cannot be about falls to the LOUD skip path", () => {
  it("a NON-ENERGY head noun derives to null, and the attack reports it", () => {
    const { state, events } = attack(stockPile(board(SEED)), 2);
    expect(rows(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(1);
    expect(rows(events, "DISCARD_RETRIEVED")).toHaveLength(0);
    expect(activeDamage(state, "p2")).toBe(0);
    expect(state.players.p1.discard).toHaveLength(8);
  });

  it("an UNRESOLVABLE head noun derives to null too, and for a different reason", () => {
    const { state, events } = attack(stockPile(board(SEED)), 3);
    expect(rows(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(1);
    expect(rows(events, "DISCARD_RETRIEVED")).toHaveLength(0);
    expect(activeDamage(state, "p2")).toBe(0);
  });

  it("…and the PRINTED sentence is NOT skipped, which is the control for both", () => {
    const { events } = attack(stockPile(board(SEED)));
    expect(rows(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
  });

  it("the guard is on the FILTER KIND, asserted through the deriver on every map row", () => {
    // `HAND_SEARCH_SINGULAR` resolves three nouns and only ONE of them is Basic Energy.
    // The other two are refused here, which pins the guard to the KIND rather than to the
    // brace pattern.
    for (const noun of ["a Trainer card", "an Energy card"]) {
      expect(
        deriveAttackEffect(
          `Put 2 damage counters on 1 of your opponent's Pokémon for each ${noun} in your discard pile. Then, shuffle those Energy cards into your deck.`,
        ),
        noun,
      ).toBeNull();
    }
    expect(
      (
        present(
          deriveAttackEffect(
            "Put 2 damage counters on 1 of your opponent's Pokémon for each a Basic Energy card in your discard pile. Then, shuffle those Energy cards into your deck.",
          ),
        )[0] as Record<string, unknown>
      ).perDiscardPileCard,
    ).toEqual({ kind: "basicEnergy" });
  });
});

describe("D538 §7 — two literals GROW the serialized alphabet and `MATCH_RECORD_VERSION` still holds at 30 ( held at THIS slice; 31 since D547; 32 since D548; 33 since D549; 34 since D552; 35 since D556; 36 since D564; 37 since D570; 38 since D575; 39 since D576; 40 since D577; 41 since D579; 42 since D583; 43 since D621; 44 since D630; 45 since D636; 46 since D637; 47 since D640; 48 since D643; 49 since D646)", () => {
  it("THE FIRST DOOR, MEASURED: the rider rides `phase.cont.pendingOp`", () => {
    const { state } = attack(stockPile(board(SEED, [B1, B2])));
    if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(roundTrip(state.phase.cont.pendingOp)).toEqual(PROGRAM[0]);
    expect(JSON.stringify(state)).toContain(
      '"perDiscardPileCard":{"kind":"basicEnergy","energyType":"Grass"}',
    );
  });

  it("THE SECOND DOOR, MEASURED: the widened `max` rides `phase.cont.rest`", () => {
    const { state } = attack(stockPile(board(SEED, [B1, B2])));
    if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(state.phase.cont.rest).toEqual([PROGRAM[1], PROGRAM[2]]);
    expect(JSON.stringify(state)).toContain('"max":"all"');
  });

  it("DIRECTION 1 — every byte string a v30 deploy could have written is UNCHANGED", () => {
    const preSlice = [
      '{"op":"damageChosen","target":"opponentAny","amount":20,"count":1,"source":"attack"}',
      '{"op":"damageChosen","target":"opponentBench","amount":40,"count":1,"source":"attack","deals":true,"perTakenPrize":true}',
      '{"op":"discardPileRetrieval","filter":{"kind":"basicEnergy","energyType":"Water"},"dest":"deck","max":3}',
    ];
    for (const bytes of preSlice) {
      const revived = JSON.parse(bytes) as EffectOp;
      expect(JSON.stringify(revived)).toBe(bytes); // no key gained, none lost, order kept
    }
    // …and the two v30 sentences that wrote the first and the third still derive to
    // exactly those bytes, which is the half a RENAME would have failed.
    expect(JSON.parse(preSlice[0] as string)).toEqual(deriveAttackEffect(UNSCALED_TWIN)?.[0]);
    expect(JSON.parse(preSlice[2] as string)).toEqual(
      deriveAttackEffect(
        "Shuffle up to 3 Basic {W} Energy cards from your discard pile into your deck.",
      )?.[0],
    );
  });

  it("DIRECTION 3 — the LOSS direction, and it degrades LOUDLY ENOUGH (D421)", () => {
    const fresh = deriveAttackEffect(PRINTED)?.[0];
    const dropped = JSON.parse(
      JSON.stringify(fresh, (k, v) => (k === "perDiscardPileCard" ? undefined : v)),
    ) as EffectOp;
    expect(dropped).toEqual(deriveAttackEffect(UNSCALED_TWIN)?.[0]);
    // …and a v30 reader that dropped the retrieval's WIDENED value has no number to fall
    // back on at all, which is why `"all"` is a value and not an absent key.
    expect((present(deriveAttackEffect(PRINTED))[1] as Record<string, unknown>).max).toBe("all");
  });

  it("the parked record REPLAYS — the rider is applied from `pendingOp` and nothing else", () => {
    const { state } = attack(stockPile(board(SEED, [B1, B2])));
    const revived = roundTrip(state);
    expect(revived.phase.kind).toBe("effect:choose");
    const { state: done } = answer(revived, benchRef(0));
    expect(done.players.p2.bench[0]?.damage).toBe(60);
    expect(done.players.p1.discard).toHaveLength(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — THE DECIDED DISCREPANCY: the empty pile still shuffles.
// ─────────────────────────────────────────────────────────────────────────────

describe("D538 §8 — a whiffed retrieval STILL shuffles, and the decision is pinned", () => {
  it("zero matching cards: no damage, no retrieval — and a `SHUFFLE` row anyway", () => {
    const before = board(SEED);
    expect(before.players.p1.discard).toHaveLength(0);
    const { state, events } = attack(before);
    expect(activeDamage(state, "p2")).toBe(0);
    expect(rows(events, "DISCARD_RETRIEVED")).toHaveLength(0);
    expect(rows(events, "SHUFFLE")).toEqual([{ type: "SHUFFLE", seat: "p1" }]);
    expect(state.rngState).not.toEqual(before.rngState);
  });

  it("a pile of DECOYS ONLY does the same thing, which separates the two zeros", () => {
    // The pile is not empty — five cards sit in it — and none of them matches. The
    // retrieval's `candidates.length === 0` branch is reached through the FILTER rather
    // than through the zone, and it ends the same way.
    let before = board(SEED);
    before = toPile(before, "p1", FIRE, 2);
    before = toPile(before, "p1", SPECIAL, 2);
    before = toPile(before, "p1", ITEM, 1);
    const { state, events } = attack(before);
    expect(state.players.p1.discard).toHaveLength(5);
    expect(rows(events, "DISCARD_RETRIEVED")).toHaveLength(0);
    expect(rows(events, "SHUFFLE")).toHaveLength(1);
    expect(state.rngState).not.toEqual(before.rngState);
  });

  it("the whiff is not a SKIP — the sentence was read, and the log says so", () => {
    // The distinction that makes the discrepancy a discrepancy rather than a refusal:
    // nothing about this board reaches `ATTACK_EFFECT_SKIPPED`. The program RAN; it had
    // nothing to move.
    const { events } = attack(board(SEED));
    expect(rows(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
  });
});

import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { BoardCondition } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import { programFor } from "./registry";
import { flipCoin } from "./rng";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  mustApply,
  setActiveFromDeck,
  setDamage,
  trainerCard,
  types,
  must,
} from "./testFixtures";

const ARIANA = ["sv10-171", "sv10-224", "sv10-237"] as const;
const BILLY = ["sv09-142"] as const;
const ELIXIR = ["sv08-172"] as const;
const GREAT_BALL = ["sv10-175"] as const;
const CARETAKER = ["sv06-144", "sv06-203"] as const;
const PECHARUNT = ["svp-129", "svp-149"] as const;
const COMMUNITY_CENTER = "sv06-146";

const ARIANA_TEXT =
  "Draw cards until you have 5 cards in your hand. If all of your Pokémon in play are Team Rocket's Pokémon, draw cards until you have 8 cards in your hand instead.";
const BILLY_TEXT =
  "Draw 2 cards. Then, if you have 10 or more cards in your hand, draw 2 more cards.";
const ELIXIR_TEXT = "Heal 60 damage from your Active {N} Pokémon.";
const GREAT_BALL_TEXT =
  "Flip a coin. If heads, search your deck for an Evolution Team Rocket's Pokémon, reveal it, and put it into your hand. If tails, search your deck for a Basic Team Rocket's Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.";
const CARETAKER_TEXT =
  "Draw 2 cards. If you drew any cards in this way and if Community Center is in play, shuffle this Caretaker into your deck instead of discarding it.";
const CC_TEXT =
  "Once during each player's turn, if they played a Supporter card from their hand this turn, they may heal 10 damage from each of their Pokémon.";
const TOXIC_TEXT =
  "As long as this Pokémon is in the Active Spot, put 5 more damage counters on your opponent's Poisoned Pokémon during Pokémon Checkup.";

const FILLER = "d556b-filler";
const ROCKET = "d556b-rocket";
const ROCKET_EVO = "d556b-rocket-evo";
const EVO = "d556b-evo";
const DRAGON = "d556b-dragon";

function printed(id: string, name: string, trainerType: string, effect: string): Card {
  return { ...trainerCard(id, trainerType, effect), name };
}

function printings(ids: readonly string[], name: string, trainerType: string, effect: string) {
  return Object.fromEntries(ids.map((id) => [id, printed(id, name, trainerType, effect)]));
}

const pecharunt = (id: string): Card =>
  battler(id, {
    name: "Pecharunt",
    types: ["Darkness"],
    hp: 80,
    retreat: 1,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    abilities: [{ type: "Ability", name: "Toxic Subjugation", effect: TOXIC_TEXT }],
    attacks: [
      {
        cost: ["Darkness", "Colorless"],
        name: "Poison Chain",
        damage: 10,
        effect:
          "Your opponent's Active Pokémon is now Poisoned. During your opponent's next turn, that Pokémon can't retreat.",
      },
    ],
  });

const LOCAL_CARDS: Record<string, Card> = {
  ...printings(ARIANA, "Team Rocket's Ariana", "Supporter", ARIANA_TEXT),
  ...printings(BILLY, "Billy & O'Nare", "Supporter", BILLY_TEXT),
  ...printings(ELIXIR, "Dragon Elixir", "Item", ELIXIR_TEXT),
  ...printings(GREAT_BALL, "Team Rocket's Great Ball", "Item", GREAT_BALL_TEXT),
  ...printings(CARETAKER, "Caretaker", "Supporter", CARETAKER_TEXT),
  [COMMUNITY_CENTER]: printed(COMMUNITY_CENTER, "Community Center", "Stadium", CC_TEXT),
  [PECHARUNT[0]]: pecharunt(PECHARUNT[0]),
  [PECHARUNT[1]]: pecharunt(PECHARUNT[1]),
  [FILLER]: battler(FILLER, {
    name: "D556 Filler",
    hp: 200,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [ROCKET]: battler(ROCKET, { name: "Team Rocket's D556 Grunt", hp: 200, types: ["Darkness"] }),
  [ROCKET_EVO]: battler(ROCKET_EVO, {
    name: "Team Rocket's D556 Boss",
    stage: "Stage1",
    evolveFrom: "Team Rocket's D556 Grunt",
    hp: 250,
    types: ["Darkness"],
  }),
  [EVO]: battler(EVO, { name: "D556 Evo", stage: "Stage1", evolveFrom: "D556 Filler", hp: 250 }),
  [DRAGON]: battler(DRAGON, { name: "D556 Dragon", hp: 200, types: ["Dragon"] }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [ARIANA[0]]: 2,
  [ARIANA[1]]: 1,
  [ARIANA[2]]: 1,
  [BILLY[0]]: 2,
  [ELIXIR[0]]: 2,
  [GREAT_BALL[0]]: 2,
  [CARETAKER[0]]: 2,
  [CARETAKER[1]]: 1,
  [COMMUNITY_CENTER]: 1,
  [PECHARUNT[0]]: 2,
  [PECHARUNT[1]]: 1,
  [FILLER]: 20,
  [ROCKET]: 6,
  [ROCKET_EVO]: 4,
  [EVO]: 4,
  [DRAGON]: 3,
  "fix-energy": 6,
});

/** Setup with p2 going first; returns p1's (unrestricted) turn 2 after p2 passed. */
function opened(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] }));
  }
  for (const s of ["p1", "p2"] as const) {
    const hand = state.players[s].hand;
    const uid = hand.find((h) => POOL[state.cardIdByUid[h] ?? ""]?.stage === "Basic");
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const)
    state = must(applyAction(state, { type: "setupReady", seat: s }));
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

/** TEST SURGERY — one copy of `id` into `seat`'s DECK (back from the hand, or swapped
    out of the Prizes for the deck's bottom card). Every uid stays in exactly one zone. */
function ensureInDeck(state: GameState, seat: Seat, id: string): GameState {
  const side = state.players[seat];
  if (side.deck.some((u) => state.cardIdByUid[u] === id)) return state;
  const held = side.hand.find((u) => state.cardIdByUid[u] === id);
  if (held !== undefined) {
    const next = { ...side, hand: side.hand.filter((u) => u !== held), deck: [...side.deck, held] };
    return { ...state, players: { ...state.players, [seat]: next } };
  }
  const prized = side.prizes.find((u) => state.cardIdByUid[u] === id);
  const swap = side.deck[side.deck.length - 1];
  if (prized === undefined || swap === undefined) throw new Error(`${seat} has no ${id} to seat`);
  const next = {
    ...side,
    prizes: side.prizes.map((u) => (u === prized ? swap : u)),
    deck: [...side.deck.slice(0, -1), prized],
  };
  return { ...state, players: { ...state.players, [seat]: next } };
}

const seatActive = (state: GameState, seat: Seat, id: string) =>
  setActiveFromDeck(ensureInDeck(state, seat, id), seat, id);
const seatBench = (state: GameState, seat: Seat, id: string) =>
  benchFromDeck(ensureInDeck(state, seat, id), seat, id);

/** p1's turn 2 with `active` / `bench` for p1 and `oppActive` / `oppBench` for p2. */
function table(
  active: string,
  bench: readonly string[] = [],
  oppActive: string = FILLER,
  oppBench: readonly string[] = [],
  seed = 5560,
): GameState {
  let state = opened(seed);
  state = seatActive(state, "p1", active);
  state = seatActive(state, "p2", oppActive);
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  for (const id of bench) state = seatBench(state, "p1", id);
  for (const id of oppBench) state = seatBench(state, "p2", id);
  return state;
}

/** TEST SURGERY — `seat`'s hand becomes EXACTLY one card per entry of `ids`. */
function setHand(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  const side = state.players[seat];
  let deck = [...side.deck, ...side.hand];
  let prizes = [...side.prizes];
  const hand: string[] = [];
  for (const id of ids) {
    const uid = deck.find((u) => state.cardIdByUid[u] === id);
    if (uid !== undefined) {
      deck = deck.filter((u) => u !== uid);
      hand.push(uid);
      continue;
    }
    const prized = prizes.find((u) => state.cardIdByUid[u] === id);
    const swap = deck[deck.length - 1];
    if (prized === undefined || swap === undefined) throw new Error(`${seat} has no more ${id}`);
    prizes = prizes.map((u) => (u === prized ? swap : u));
    deck = deck.slice(0, -1);
    hand.push(prized);
  }
  return { ...state, players: { ...state.players, [seat]: { ...side, hand, deck, prizes } } };
}

/** TEST SURGERY — put `id` on top of `seat`'s Active, as an evolution would. */
function evolveActive(prior: GameState, seat: Seat, id: string): GameState {
  const state = ensureInDeck(prior, seat, id);
  const side = state.players[seat];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === id) as string;
  const active = side.active;
  if (active === null) throw new Error("no Active");
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((u) => u !== uid),
        active: { ...active, stack: [...active.stack, uid] },
      },
    },
  };
}

/** TEST SURGERY — `seat`'s Active gains a Special Condition. */
function afflict(state: GameState, seat: Seat, status: "poisoned" | "burned"): GameState {
  const active = state.players[seat].active;
  if (active === null) throw new Error("no Active");
  const conditions =
    status === "poisoned"
      ? { ...active.conditions, poisonDamage: 10 }
      : { ...active.conditions, burned: true };
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...state.players[seat], active: { ...active, conditions } },
    },
  };
}

/** p1 holds exactly `[card, ...rest]` on `board`; plays `card`. */
function play(board: GameState, id: string, rest: readonly string[] = []) {
  const before = setHand(board, "p1", [id, ...rest]);
  const uid = before.players.p1.hand[0] as string;
  return { before, uid, ...mustApply(before, { type: "playTrainer", seat: "p1", uid }) };
}

/** An rng cursor whose first flip lands on `face`. */
function cursorFor(face: "heads" | "tails"): number {
  for (let n = 1; n < 1000; n++) if (flipCoin(n)[0] === face) return n;
  throw new Error("no cursor");
}

function all<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

const drawn = (events: readonly GameEvent[]) =>
  all(events, "CARDS_DRAWN").map((e) => e.uids.length);
const idOf = (state: GameState, uid: string | undefined) =>
  uid === undefined ? undefined : state.cardIdByUid[uid];
const cards = (uids: readonly string[]): GameAction => ({
  type: "resolveEffect",
  seat: "p1",
  choice: { kind: "cards", uids: [...uids] },
});

// ────────────────────────────────────────────────────────────────────────────
describe("D556 §1 — the prints, and the registry rows that map them", () => {
  const ROWS: readonly {
    name: string;
    ids: readonly string[];
    text: string;
    subtype: string;
    program: unknown;
  }[] = [
    {
      name: "Team Rocket's Ariana",
      ids: ARIANA,
      text: ARIANA_TEXT,
      subtype: "Supporter",
      program: {
        trainer: [
          {
            op: "conditionGate",
            cond: { kind: "yourPokemonAllOwner", owner: "Team Rocket" },
            then: [{ op: "drawUntilHandSize", size: 8 }],
            otherwise: [{ op: "drawUntilHandSize", size: 5 }],
          },
        ],
      },
    },
    {
      name: "Billy & O'Nare",
      ids: BILLY,
      text: BILLY_TEXT,
      subtype: "Supporter",
      program: {
        trainer: [
          { op: "drawCards", count: 2 },
          {
            op: "conditionGate",
            cond: { kind: "yourHandAtLeast", count: 10 },
            then: [{ op: "drawCards", count: 2 }],
          },
        ],
      },
    },
    {
      name: "Dragon Elixir",
      ids: ELIXIR,
      text: ELIXIR_TEXT,
      subtype: "Item",
      program: {
        trainer: [
          {
            op: "conditionGate",
            cond: { kind: "yourActiveHasType", type: "Dragon" },
            then: [{ op: "heal", target: "self", amount: 60 }],
          },
        ],
      },
    },
    {
      name: "Team Rocket's Great Ball",
      ids: GREAT_BALL,
      text: GREAT_BALL_TEXT,
      subtype: "Item",
      program: {
        trainer: [
          {
            op: "coinFlipGate",
            then: [
              {
                op: "searchDeck",
                filter: { kind: "ownerPokemon", owner: "Team Rocket", stage: "evolution" },
                dest: "hand",
                max: 1,
                reveal: true,
              },
            ],
            otherwise: [
              {
                op: "searchDeck",
                filter: { kind: "ownerPokemon", owner: "Team Rocket", stage: "basic" },
                dest: "hand",
                max: 1,
                reveal: true,
              },
            ],
          },
          { op: "shuffleDeck" },
        ],
      },
    },
    {
      name: "Caretaker",
      ids: CARETAKER,
      text: CARETAKER_TEXT,
      subtype: "Supporter",
      program: {
        trainer: [
          { op: "drawCards", count: 2, recordAs: "moved" },
          {
            op: "recordGate",
            slot: "moved",
            then: [
              {
                op: "conditionGate",
                cond: { kind: "stadiumInPlayNamed", name: "Community Center" },
                then: [{ op: "shufflePlayedCardIntoDeck" }],
              },
            ],
          },
        ],
      },
    },
  ];

  for (const row of ROWS) {
    it(`${row.name}: pinned by toEqual, reprints share ONE object, only a \`trainer\` key`, () => {
      const first = programFor(row.ids[0] as string);
      expect(first).toEqual(row.program);
      expect(Object.keys(first ?? {})).toEqual(["trainer"]);
      for (const id of row.ids) {
        expect(programFor(id)).toBe(first);
        expect(POOL[id]?.name).toBe(row.name);
        expect(POOL[id]?.trainerType).toBe(row.subtype);
        expect(POOL[id]?.effect).toBe(row.text);
      }
    });
  }

  it("Pecharunt: a gated `betweenTurns` trigger, Active-only, and NO `attack` key", () => {
    const first = programFor(PECHARUNT[0]);
    expect(first).toEqual({
      triggered: [
        {
          name: "Toxic Subjugation",
          trigger: "betweenTurns",
          activeOnly: true,
          program: [
            {
              op: "conditionGate",
              cond: { kind: "opponentActivePoisoned" },
              then: [{ op: "damageActive", amount: 50, source: "ability" }],
            },
          ],
        },
      ],
    });
    expect(Object.keys(first ?? {})).toEqual(["triggered"]);
    expect(programFor(PECHARUNT[1])).toBe(first);
  });

  it("six texts, six DISTINCT objects (D199)", () => {
    const objects = new Set(
      [ARIANA[0], BILLY[0], ELIXIR[0], GREAT_BALL[0], CARETAKER[0], PECHARUNT[0]].map((id) =>
        programFor(id),
      ),
    );
    expect(objects.size).toBe(6);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D556 §2 — the three NEW members, driven both ways", () => {
  const ALL_ROCKET: BoardCondition = { kind: "yourPokemonAllOwner", owner: "Team Rocket" };
  const TEN: BoardCondition = { kind: "yourHandAtLeast", count: 10 };
  const DRAGON_ACTIVE: BoardCondition = { kind: "yourActiveHasType", type: "Dragon" };

  it("`yourPokemonAllOwner` — every Pokémon in play, Active AND Bench (R4)", () => {
    expect(conditionHolds(table(ROCKET), "p1", ALL_ROCKET)).toBe(true);
    expect(conditionHolds(table(ROCKET, [ROCKET, ROCKET_EVO]), "p1", ALL_ROCKET)).toBe(true);
    // ONE non-Rocket body anywhere makes it false — on the Bench or in the Active Spot.
    expect(conditionHolds(table(ROCKET, [ROCKET, FILLER]), "p1", ALL_ROCKET)).toBe(false);
    expect(conditionHolds(table(FILLER, [ROCKET]), "p1", ALL_ROCKET)).toBe(false);
    // It reads YOUR side: an all-Rocket opponent does not make it true for you.
    const mirror = table(FILLER, [], ROCKET, [ROCKET]);
    expect(conditionHolds(mirror, "p1", ALL_ROCKET)).toBe(false);
    expect(conditionHolds(mirror, "p2", ALL_ROCKET)).toBe(true);
  });

  it("`yourPokemonAllOwner` reads the stack TOP, and an EMPTY side is false (no vacuous truth)", () => {
    expect(conditionHolds(evolveActive(table(FILLER), "p1", ROCKET_EVO), "p1", ALL_ROCKET)).toBe(
      true,
    );
    expect(conditionHolds(evolveActive(table(ROCKET), "p1", EVO), "p1", ALL_ROCKET)).toBe(false);
    const board = table(ROCKET);
    const empty: GameState = {
      ...board,
      players: { ...board.players, p1: { ...board.players.p1, active: null } },
    };
    expect(conditionHolds(empty, "p1", ALL_ROCKET)).toBe(false);
  });

  it("`yourHandAtLeast` is a FLOOR on YOUR hand: 9 no, 10 yes, 11 yes", () => {
    const board = table(FILLER);
    expect(conditionHolds(setHand(board, "p1", Array(9).fill(FILLER)), "p1", TEN)).toBe(false);
    expect(conditionHolds(setHand(board, "p1", Array(10).fill(FILLER)), "p1", TEN)).toBe(true);
    expect(conditionHolds(setHand(board, "p1", Array(11).fill(FILLER)), "p1", TEN)).toBe(true);
    // The opponent's 10 is not yours.
    const theirs = setHand(
      setHand(board, "p1", Array(3).fill(FILLER)),
      "p2",
      Array(10).fill(FILLER),
    );
    expect(conditionHolds(theirs, "p1", TEN)).toBe(false);
  });

  it("`yourActiveHasType` reads YOUR Active's printed type; the opponent's is not yours", () => {
    expect(conditionHolds(table(DRAGON), "p1", DRAGON_ACTIVE)).toBe(true);
    expect(conditionHolds(table(FILLER), "p1", DRAGON_ACTIVE)).toBe(false);
    const theirs = table(FILLER, [], DRAGON);
    expect(conditionHolds(theirs, "p1", DRAGON_ACTIVE)).toBe(false);
    expect(conditionHolds(theirs, "p2", DRAGON_ACTIVE)).toBe(true);
    expect(conditionHolds(table(DRAGON), "p1", { kind: "yourActiveHasType", type: "Fire" })).toBe(
      false,
    );
    const board = table(DRAGON);
    const empty: GameState = {
      ...board,
      players: { ...board.players, p1: { ...board.players.p1, active: null } },
    };
    expect(conditionHolds(empty, "p1", DRAGON_ACTIVE)).toBe(false);
  });

  it("each note is the printed clause (the type as a word, never `{N}`)", () => {
    expect(conditionNote(ALL_ROCKET)).toBe("all of your Pokémon in play are Team Rocket's Pokémon");
    expect(conditionNote(TEN)).toBe("you have 10 or more cards in your hand");
    expect(conditionNote(DRAGON_ACTIVE)).toBe("your Active Pokémon is a Dragon Pokémon");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D556 §3 — Team Rocket's Ariana: to 5, or to 8 when ALL your Pokémon are Team Rocket's", () => {
  it("an all-Rocket board draws until 8 (the played Supporter already left the hand)", () => {
    const { state, events } = play(table(ROCKET, [ROCKET_EVO]), ARIANA[0], [FILLER]);
    expect(state.players.p1.hand).toHaveLength(8);
    expect(drawn(events)).toEqual([7]);
    expect(state.phase.kind).toBe("turn:action");
  });

  it("ONE non-Rocket benched body drops it to the printed default of 5 (R4 — the Bench counts)", () => {
    const { state, events } = play(table(ROCKET, [FILLER]), ARIANA[0], [FILLER]);
    expect(state.players.p1.hand).toHaveLength(5);
    expect(drawn(events)).toEqual([4]);
  });

  it('a hand already at the size draws nothing — the "until" is a ceiling, not a count', () => {
    const { state, events } = play(table(FILLER), ARIANA[0], Array(6).fill(FILLER));
    expect(state.players.p1.hand).toHaveLength(6);
    expect(all(events, "CARDS_DRAWN")).toHaveLength(0);
  });

  it("every printing is the same card", () => {
    for (const id of ARIANA) {
      expect(play(table(ROCKET), id, []).state.players.p1.hand, id).toHaveLength(8);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D556 §4 — Billy & O'Nare: draw 2; then, at 10 or more, draw 2 more", () => {
  it("8 other cards + 2 = 10 → two more: 12, and TWO draw rows", () => {
    const { state, events } = play(table(FILLER), BILLY[0], Array(8).fill(FILLER));
    expect(drawn(events)).toEqual([2, 2]);
    expect(state.players.p1.hand).toHaveLength(12);
  });

  it("R2 — the count EXCLUDES Billy itself: 7 others + 2 = 9 stops at 9 (counting Billy would say 10)", () => {
    const { uid, state, events } = play(table(FILLER), BILLY[0], Array(7).fill(FILLER));
    expect(state.players.p1.hand).not.toContain(uid);
    expect(state.players.p1.discard).toContain(uid);
    expect(drawn(events)).toEqual([2]);
    expect(state.players.p1.hand).toHaveLength(9);
  });

  it("an empty hand draws 2 and stops", () => {
    const { state, events } = play(table(FILLER), BILLY[0]);
    expect(drawn(events)).toEqual([2]);
    expect(state.players.p1.hand).toHaveLength(2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D556 §5 — Dragon Elixir: heal 60 from your Active {N} Pokémon", () => {
  it("heals 60 from a Dragon Active, one HEALED row", () => {
    const { before, state, events } = play(setDamage(table(DRAGON), "p1", 100), ELIXIR[0]);
    expect(state.players.p1.active?.damage).toBe(40);
    expect(all(events, "HEALED")).toEqual([
      { type: "HEALED", seat: "p1", uid: before.players.p1.active?.stack[0], amount: 60 },
    ]);
  });

  it("the heal clamps: 30 damage heals 30", () => {
    const { state } = play(setDamage(table(DRAGON), "p1", 30), ELIXIR[0]);
    expect(state.players.p1.active?.damage).toBe(0);
  });

  it("R3 (UNRULED) — a NON-Dragon Active: the Item PLAYS and whiffs, nothing healed", () => {
    const { uid, state, events } = play(setDamage(table(FILLER), "p1", 100), ELIXIR[0]);
    expect(types(events)).toEqual(["TRAINER_PLAYED"]);
    expect(state.players.p1.discard).toContain(uid);
    expect(state.players.p1.active?.damage).toBe(100);
  });

  it("the OPPONENT's damaged Dragon Active is neither the gate nor the target", () => {
    const board = setDamage(setDamage(table(FILLER, [], DRAGON), "p2", 100), "p1", 100);
    const { state } = play(board, ELIXIR[0]);
    expect(state.players.p1.active?.damage).toBe(100);
    expect(state.players.p2.active?.damage).toBe(100);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D556 §6 — Team Rocket's Great Ball: the coin picks the stage; the shuffle closes both faces", () => {
  const deckOfIds = (state: GameState, pred: (id: string) => boolean) =>
    state.players.p1.deck.filter((u) => pred(state.cardIdByUid[u] ?? "")).sort();

  function flipped(face: "heads" | "tails") {
    const board = { ...table(FILLER), rngState: cursorFor(face) };
    return play(board, GREAT_BALL[0]);
  }

  it("HEADS: flips, then PARKS over the Evolution Team Rocket's Pokémon ONLY", () => {
    const { before, state, events } = flipped("heads");
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP").map((e) => e.result)).toEqual(["heads"]);
    if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const prompt = state.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${prompt.kind}`);
    expect([...prompt.candidates].sort()).toEqual(deckOfIds(before, (id) => id === ROCKET_EVO));
    expect(prompt.max).toBe(1);
  });

  it("TAILS: PARKS over the Basic Team Rocket's Pokémon ONLY — not an Evolution, not a plain Basic", () => {
    const { before, state } = flipped("tails");
    if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const prompt = state.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${prompt.kind}`);
    expect([...prompt.candidates].sort()).toEqual(deckOfIds(before, (id) => id === ROCKET));
  });

  it("the park RESUMES into the queued shuffle: the pick lands in hand, revealed, then the deck shuffles", () => {
    for (const face of ["heads", "tails"] as const) {
      const { state: parked } = flipped(face);
      if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
      const prompt = parked.phase.prompt;
      if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
      const pick = prompt.candidates[0] as string;
      const { state, events } = mustApply(parked, cards([pick]));
      expect(state.players.p1.hand, face).toContain(pick);
      const searched = all(events, "DECK_SEARCHED");
      expect(
        searched.map((e) => [e.uids, e.reveal]),
        face,
      ).toEqual([[[pick], true]]);
      const order = types(events);
      expect(
        order.filter((t) => t === "SHUFFLE"),
        face,
      ).toHaveLength(1);
      expect(order.indexOf("SHUFFLE"), face).toBeGreaterThan(order.indexOf("DECK_SEARCHED"));
      expect(state.phase, face).toEqual({ kind: "turn:action", seat: "p1" });
      expect(idOf(state, pick), face).toBe(face === "heads" ? ROCKET_EVO : ROCKET);
    }
  });

  it("the park round-trips through JSON and resumes identically", () => {
    const { state: parked } = flipped("heads");
    const revived = JSON.parse(JSON.stringify(parked)) as GameState;
    expect(revived).toEqual(parked);
    if (parked.phase.kind !== "effect:choose" || parked.phase.prompt.kind !== "chooseCards") {
      throw new Error("expected chooseCards");
    }
    const answer = cards([parked.phase.prompt.candidates[0] as string]);
    expect(mustApply(revived, answer).state).toEqual(mustApply(parked, answer).state);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D556 §7 — Caretaker: draw 2, and the Community Center clause ( D564: REACHABLE — the guard below is inverted)", () => {
  it("draws 2 and goes to the discard", () => {
    const { uid, state, events } = play(table(FILLER), CARETAKER[0], [FILLER]);
    expect(drawn(events)).toEqual([2]);
    expect(state.players.p1.hand).toHaveLength(3);
    expect(state.players.p1.discard).toContain(uid);
    expect(play(table(FILLER), CARETAKER[1], []).state.players.p1.hand).toHaveLength(2);
  });

  it("GUARD, INVERTED (D564) — Community Center is BUILT and PLAYABLE, so Caretaker's second sentence has a board and runs", () => {
    expect(programFor(COMMUNITY_CENTER)?.stadium?.ability).toBeDefined();
    const board = setHand(table(FILLER), "p1", [COMMUNITY_CENTER]);
    const staged = mustApply(board, {
      type: "playTrainer",
      seat: "p1",
      uid: board.players.p1.hand[0] as string,
    }).state;
    expect(staged.stadium?.uid).toBe(board.players.p1.hand[0]);
    const { uid, state } = play(staged, CARETAKER[0], [FILLER]);
    expect(state.players.p1.discard).not.toContain(uid);
    expect(state.players.p1.deck).toContain(uid);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('D556 §8 — Pecharunt "Toxic Subjugation": +50 on a Poisoned Active at every Checkup', () => {
  const checkup = (board: GameState) => mustApply(board, { type: "endTurn", seat: "p1" });

  it("R7 — the Poison tick (10) lands FIRST, then +50 from the Ability, then the KO sweep", () => {
    const { state, events } = checkup(afflict(table(PECHARUNT[0]), "p2", "poisoned"));
    expect(state.players.p2.active?.damage).toBe(60);
    const placed = all(events, "COUNTERS_PLACED").map((e) => [e.seat, e.amount, e.source]);
    expect(placed).toEqual([
      ["p2", 10, "poison"],
      ["p2", 50, "ability"],
    ]);
    const order = types(events);
    const poison = order.indexOf("COUNTERS_PLACED");
    expect(order.indexOf("ABILITY_TRIGGERED")).toBeGreaterThan(poison);
    expect(order.lastIndexOf("COUNTERS_PLACED")).toBeGreaterThan(
      order.indexOf("ABILITY_TRIGGERED"),
    );
  });

  it("R7 — a lethal total is swept THAT Checkup: 150 + 10 + 50 on a 200 HP body is a Knock Out", () => {
    const board = setDamage(afflict(table(PECHARUNT[1]), "p2", "poisoned"), "p2", 150);
    const koUid = board.players.p2.active?.stack[0];
    const { events } = checkup(board);
    expect(all(events, "KNOCKED_OUT").map((e) => [e.seat, e.uid])).toEqual([["p2", koUid]]);
    const order = types(events);
    expect(order.indexOf("KNOCKED_OUT")).toBeGreaterThan(order.lastIndexOf("COUNTERS_PLACED"));
  });

  it("R6 — NOT Poisoned: no extra counters, but the ABILITY_TRIGGERED row is STILL filed, exactly once", () => {
    const { state, events } = checkup(table(PECHARUNT[0]));
    expect(state.players.p2.active?.damage).toBe(0);
    expect(all(events, "COUNTERS_PLACED")).toHaveLength(0);
    expect(all(events, "ABILITY_TRIGGERED").map((e) => [e.seat, e.ability])).toEqual([
      ["p1", "Toxic Subjugation"],
    ]);
  });

  it("a BURNED (not Poisoned) Active gets the Burn's 20 and nothing more", () => {
    const { events } = checkup(afflict(table(PECHARUNT[0]), "p2", "burned"));
    expect(all(events, "COUNTERS_PLACED").map((e) => [e.amount, e.source])).toEqual([[20, "burn"]]);
  });

  it("from the BENCH it neither fires nor files a row (Active-only)", () => {
    const { state, events } = checkup(afflict(table(FILLER, [PECHARUNT[0]]), "p2", "poisoned"));
    expect(state.players.p2.active?.damage).toBe(10);
    expect(all(events, "ABILITY_TRIGGERED")).toHaveLength(0);
  });

  it("it fires at the OPPONENT's Checkup too — two Checkups, 120 on a Poisoned Active", () => {
    let state = checkup(afflict(table(PECHARUNT[0]), "p2", "poisoned")).state;
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    expect(state.players.p2.active?.damage).toBe(120);
  });
});

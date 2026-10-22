import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { GameEvent } from "./events";
import { applyAction, createGame } from "./index";
import type { GameAction, GameState, PokemonRef, Seat } from "./index";
import { programFor } from "./registry";
import { shuffle } from "./rng";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  expectErr,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  trainerCard,
  types,
} from "./testFixtures";

// ── 🆕🆕🆕 D555 A — THE ZERO-VOCABULARY TRAINERS, 9 PRINTINGS / 5 TEXTS / 5 OBJECTS ──
//
//   Cook                    sv06-147                         Supporter  heal 70 from your Active
//   Poké Vital A            sv06.5-062                       Item       heal 150 from 1 of your Pokémon
//   Iris's Fighting Spirit  sv09-149 / sv09-180              Supporter  discard another card; draw to 6
//   Eri                     sv05-146 / -199 / -210, sv08.5-136  Supporter  reveal; discard up to 2 Items
//   Meddling Memo           sv08-181                         Item       their hand under their deck; draw that many
//
// ZERO new vocabulary: every op, rider and gate already shipped, and the one line
// outside the registry is `bottomFromOpponentHandNote`'s printed "up to" discard form
// (Eri's caption). Real ids on a LOCAL `cardPool` (D275), no `fix-*` demonstrator.
// Texts, subtypes and legality off tcgdex (the ingest's own upstream), 2026-09-25.
// The Abilities of the slice are `simpleAbilitiesD555.test.ts`.

const COOK_TEXT = "Heal 70 damage from your Active Pokémon.";
const VITAL_TEXT =
  "Heal 150 damage from 1 of your Pokémon.\n\nThis card can't be put into your hand or deck from the discard pile.";
const IRIS_TEXT =
  "You can use this card only if you discard another card from your hand.\n\nDraw cards until you have 6 cards in your hand.";
const ERI_TEXT = "Your opponent reveals their hand, and you discard up to 2 Item cards you find there.";
const MEMO_TEXT =
  "Your opponent counts the cards in their hand, shuffles those cards, and puts them on the bottom of their deck. If they do, they draw that many cards.";

const COOK = ["sv06-147"] as const;
const VITAL = ["sv06.5-062"] as const;
const IRIS = ["sv09-149", "sv09-180"] as const;
const ERI = ["sv05-146", "sv05-199", "sv05-210", "sv08.5-136"] as const;
const MEMO = ["sv08-181"] as const;

const FILLER = "d555a-filler";
const ITEM = "d555a-item";
const ITEM_2 = "d555a-item-two";
const SUPPORTER = "d555a-supporter";

function printed(id: string, name: string, trainerType: string, effect: string): Card {
  return { ...trainerCard(id, trainerType, effect), name };
}

function printings(ids: readonly string[], name: string, trainerType: string, effect: string) {
  return Object.fromEntries(ids.map((id) => [id, printed(id, name, trainerType, effect)]));
}

const LOCAL_CARDS: Record<string, Card> = {
  ...printings(COOK, "Cook", "Supporter", COOK_TEXT),
  ...printings(VITAL, "Poké Vital A", "Item", VITAL_TEXT),
  ...printings(IRIS, "Iris's Fighting Spirit", "Supporter", IRIS_TEXT),
  ...printings(ERI, "Eri", "Supporter", ERI_TEXT),
  ...printings(MEMO, "Meddling Memo", "Item", MEMO_TEXT),
  [FILLER]: battler(FILLER, {
    name: "D555 Filler",
    hp: 200,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [ITEM]: printed(ITEM, "D555 Item", "Item", "A D555 Item."),
  [ITEM_2]: printed(ITEM_2, "D555 Other Item", "Item", "Another D555 Item."),
  [SUPPORTER]: printed(SUPPORTER, "D555 Supporter", "Supporter", "A D555 Supporter."),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [COOK[0]]: 2,
  [VITAL[0]]: 2,
  [IRIS[0]]: 2,
  [IRIS[1]]: 1,
  [ERI[0]]: 2,
  [ERI[1]]: 1,
  [ERI[2]]: 1,
  [ERI[3]]: 1,
  [MEMO[0]]: 2,
  [FILLER]: 24,
  [ITEM]: 8,
  [ITEM_2]: 6,
  [SUPPORTER]: 8,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** p1 on its own (unrestricted) turn 2 — p2 went first and passed — with a FILLER
    Active and an EMPTY Bench on both sides. */
function board(seed = 5550): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }));
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] }));
  }
  for (const s of ["p1", "p2"] as const) {
    const uid = state.players[s].hand.find((h) => state.cardIdByUid[h] === FILLER);
    if (uid === undefined) throw new Error(`no filler Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const) state = must(applyAction(state, { type: "setupReady", seat: s }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  for (const s of ["p1", "p2"] as const) {
    state = setActiveFromDeck(state, s, FILLER);
    state = clearBench(state, s);
  }
  return state;
}

/** TEST SURGERY — `seat`'s hand becomes EXACTLY one card per entry of `ids` (in that
    order): the old hand goes to the BOTTOM of the deck, then each id is pulled from
    the deck — or, when every copy was prized, SWAPPED out of the Prizes for the
    deck's bottom card, so the Prize row keeps its size. Every uid stays in exactly
    one zone. */
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

/** p1 holds exactly `[card, ...rest]`; plays `card`. */
function play(id: string, rest: readonly string[], prep: (s: GameState) => GameState = (s) => s) {
  const before = prep(setHand(board(), "p1", [id, ...rest]));
  const uid = before.players.p1.hand[0] as string;
  const result = mustApply(before, { type: "playTrainer", seat: "p1", uid });
  return { before, uid, ...result };
}

function parkOf(state: GameState) {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  return state.phase.prompt;
}

function cards(uids: readonly string[]): GameAction {
  return { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [...uids] } };
}

function all<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

const ids = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);
const sorted = (xs: readonly (string | undefined)[]) => [...xs].sort();
const P1_BENCH0: PokemonRef = { seat: "p1", spot: { spot: "bench", index: 0 } };

// ────────────────────────────────────────────────────────────────────────────
describe("D555 A §1 — the print, and the registry rows that map it", () => {
  const ROWS: readonly {
    name: string;
    ids: readonly string[];
    text: string;
    trainerType: "Item" | "Supporter";
    program: unknown;
  }[] = [
    {
      name: "Cook",
      ids: COOK,
      text: COOK_TEXT,
      trainerType: "Supporter",
      program: { trainer: [{ op: "heal", target: "self", amount: 70 }] },
    },
    {
      name: "Poké Vital A",
      ids: VITAL,
      text: VITAL_TEXT,
      trainerType: "Item",
      // 🆕 Card revision B06 — the second sentence ("This card can't be put into your hand or deck
      // from the discard pile.") is the card-borne `discardPileLocked` (D555 R3 closed;
      // `revisionB06.test.ts` drives it).
      program: { trainer: [{ op: "healChosen", amount: 150 }], discardPileLocked: true },
    },
    {
      name: "Iris's Fighting Spirit",
      ids: IRIS,
      text: IRIS_TEXT,
      trainerType: "Supporter",
      program: {
        trainer: [
          { op: "payFromHand", count: 1, to: "discard" },
          { op: "drawUntilHandSize", size: 6 },
        ],
      },
    },
    {
      name: "Eri",
      ids: ERI,
      text: ERI_TEXT,
      trainerType: "Supporter",
      program: {
        trainer: [{ op: "bottomFromOpponentHand", filter: { kind: "item" }, dest: "discard", upTo: 2 }],
      },
    },
    {
      name: "Meddling Memo",
      ids: MEMO,
      text: MEMO_TEXT,
      trainerType: "Item",
      program: {
        trainer: [{ op: "handRefresh", who: "opponent", toBottom: true, draw: { kind: "handPlus", delta: 0 } }],
      },
    },
  ];

  for (const row of ROWS) {
    it(`${row.name}: the program is pinned by toEqual, reprints share ONE object, and only a \`trainer\` key (+ B06's pile lock)`, () => {
      const first = programFor(row.ids[0] as string);
      expect(first).toEqual(row.program);
      expect(Object.keys(first ?? {})).toEqual(
        row.name === "Poké Vital A" ? ["trainer", "discardPileLocked"] : ["trainer"],
      );
      for (const id of row.ids) {
        expect(programFor(id)).toBe(first);
        expect(POOL[id]?.name).toBe(row.name);
        expect(POOL[id]?.trainerType).toBe(row.trainerType);
        expect(POOL[id]?.effect).toBe(row.text);
      }
    });
  }

  it("five texts, five DISTINCT objects (D199)", () => {
    const objects = new Set([COOK[0], VITAL[0], IRIS[0], ERI[0], MEMO[0]].map((id) => programFor(id)));
    expect(objects.size).toBe(5);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D555 A §2 — Cook: heal 70 from YOUR Active", () => {
  it("heals 70 from the Active and files ONE HEALED row", () => {
    const { before, state, events } = play(COOK[0], [FILLER], (s) => setDamage(s, "p1", 100));
    expect(state.players.p1.active?.damage).toBe(30);
    const healed = all(events, "HEALED");
    expect(healed).toEqual([
      { type: "HEALED", seat: "p1", uid: before.players.p1.active?.stack[0], amount: 70 },
    ]);
    expect(state.phase.kind).toBe("turn:action");
  });

  it("the heal is CLAMPED by the damage present: 30 damage heals 30", () => {
    const { state, events } = play(COOK[0], [FILLER], (s) => setDamage(s, "p1", 30));
    expect(state.players.p1.active?.damage).toBe(0);
    expect(all(events, "HEALED").map((e) => e.amount)).toEqual([30]);
  });

  it("a damaged BENCHED Pokémon is not healed — the print names the Active", () => {
    const { state, events } = play(COOK[0], [FILLER], (s) =>
      setDamage(setBenchDamage(benchFromDeck(s, "p1", FILLER), "p1", 0, 50), "p1", 20),
    );
    expect(state.players.p1.bench[0]?.damage).toBe(50);
    expect(state.players.p1.active?.damage).toBe(0);
    expect(all(events, "HEALED")).toHaveLength(1);
  });

  it("🛑 an UNDAMAGED Active still PLAYS (D553 R1, UNRULED) — the Supporter is spent and no HEALED is filed", () => {
    const { before, uid, state, events } = play(COOK[0], [FILLER], (s) =>
      setBenchDamage(benchFromDeck(s, "p1", FILLER), "p1", 0, 50),
    );
    expect(before.players.p1.active?.damage).toBe(0);
    expect(types(events)).toEqual(["TRAINER_PLAYED"]);
    expect(state.players.p1.discard).toContain(uid);
    expect(state.players.p1.bench[0]?.damage).toBe(50);
    expect(state.phase.kind).toBe("turn:action");
  });

  it("it is the CONTROLLER's Active — the opponent's damaged Active is untouched", () => {
    const { state } = play(COOK[0], [FILLER], (s) => setDamage(setDamage(s, "p2", 80), "p1", 80));
    expect(state.players.p1.active?.damage).toBe(10);
    expect(state.players.p2.active?.damage).toBe(80);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D555 A §3 — Poké Vital A: heal 150 from 1 of your Pokémon", () => {
  it("parks on the chosen-Pokémon prompt and heals 150 from the CHOSEN body", () => {
    const { state: parked, events } = play(VITAL[0], [FILLER], (s) =>
      setDamage(setBenchDamage(benchFromDeck(s, "p1", FILLER), "p1", 0, 190), "p1", 60),
    );
    expect(types(events)).toEqual(["TRAINER_PLAYED", "EFFECT_PENDING"]);
    const prompt = parkOf(parked);
    if (prompt.kind !== "choosePokemon") throw new Error(`expected choosePokemon, got ${prompt.kind}`);
    expect(prompt.candidates).toHaveLength(2);
    const { state: done, events: healedEvents } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: P1_BENCH0 },
    });
    expect(done.players.p1.bench[0]?.damage).toBe(40);
    expect(done.players.p1.active?.damage).toBe(60);
    expect(all(healedEvents, "HEALED").map((e) => e.amount)).toEqual([150]);
    expect(done.phase.kind).toBe("turn:action");
  });

  it("the heal is clamped: a lone Active at 100 damage is FORCED and heals 100", () => {
    const { state, events } = play(VITAL[0], [FILLER], (s) => setDamage(s, "p1", 100));
    expect(state.phase.kind).toBe("turn:action");
    expect(state.players.p1.active?.damage).toBe(0);
    expect(all(events, "HEALED").map((e) => e.amount)).toEqual([100]);
  });

  it("🛑 MEASURED, NOT PREDICTED — with nothing damaged it is NOT refused: Potion's no-whiff doctrine (D555 R4)", () => {
    // The brief predicted `healChosenTargets` would refuse an undamaged board. It does
    // not: that funnel narrows ONLY on `remainingHpAtMost` (D349), so the unnarrowed
    // offer is every own body, and `programPlayable` calls heal "playable enough".
    const { uid, state, events } = play(VITAL[0], [FILLER]);
    expect(types(events)).toEqual(["TRAINER_PLAYED"]);
    expect(state.players.p1.discard).toContain(uid);
    expect(state.players.p1.active?.damage).toBe(0);
    expect(state.phase.kind).toBe("turn:action");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D555 A §4 — Iris's Fighting Spirit: discard another card, then draw to 6", () => {
  it("is REFUSED with no OTHER card in hand, and the message reads the printed \"another card\"", () => {
    const state = setHand(board(), "p1", [IRIS[0]]);
    const result = applyAction(state, { type: "playTrainer", seat: "p1", uid: state.players.p1.hand[0] as string });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("PLAY_CONDITION_NOT_MET");
    expect(result.error.message).toBe(
      "Iris's Fighting Spirit can only be used if you discard another card from your hand",
    );
  });

  it("pays ONE card and draws until the hand is 6 — the count is taken AFTER the payment", () => {
    const { before, uid, state, events } = play(IRIS[0], [FILLER, FILLER, FILLER, FILLER]);
    // Four interchangeable fillers collapse to one candidate: the cost asks nothing.
    expect(state.phase.kind).toBe("turn:action");
    expect(state.players.p1.hand).toHaveLength(6);
    const paid = before.players.p1.hand.filter((u) => u !== uid && !state.players.p1.hand.includes(u));
    expect(paid).toHaveLength(1);
    expect(state.players.p1.discard).toEqual([...before.players.p1.discard, uid, ...paid]);
    expect(all(events, "CARDS_DRAWN").flatMap((e) => e.uids)).toEqual(before.players.p1.deck.slice(0, 3));
  });

  it("a mixed hand PARKS the payment, and the answer is the card that goes", () => {
    const { before, state: parked } = play(IRIS[0], [FILLER, ITEM]);
    const prompt = parkOf(parked);
    if (prompt.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${prompt.kind}`);
    expect([prompt.min, prompt.max]).toEqual([1, 1]);
    const item = before.players.p1.hand[2] as string;
    const done = mustApply(parked, cards([item])).state;
    expect(done.players.p1.discard).toContain(item);
    expect(done.players.p1.hand).toHaveLength(6);
  });

  it("draws 0 when 6 or more cards remain after paying", () => {
    const seven = play(IRIS[0], Array(7).fill(FILLER));
    expect(seven.state.players.p1.hand).toHaveLength(6);
    expect(all(seven.events, "CARDS_DRAWN")).toHaveLength(0);
    const eight = play(IRIS[0], Array(8).fill(FILLER));
    expect(eight.state.players.p1.hand).toHaveLength(7);
    expect(all(eight.events, "CARDS_DRAWN")).toHaveLength(0);
  });

  it("the second printing is the same card", () => {
    const { state } = play(IRIS[1], [FILLER]);
    expect(state.players.p1.hand).toHaveLength(6);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D555 A §5 — Eri: reveal the opponent's hand, discard up to 2 Item cards", () => {
  const withOpp = (hand: readonly string[]) => (s: GameState) => setHand(s, "p2", hand);

  it("the REVEAL comes first — the whole hand, before any question", () => {
    const { before, events } = play(ERI[0], [], withOpp([ITEM, FILLER, SUPPORTER]));
    expect(types(events)).toEqual(["TRAINER_PLAYED", "HAND_REVEALED", "EFFECT_PENDING"]);
    expect(all(events, "HAND_REVEALED")[0]).toEqual({
      type: "HAND_REVEALED",
      seat: "p2",
      uids: before.players.p2.hand,
    });
  });

  it("two Items park at min 0 / max 2 over the Items alone, under the printed caption", () => {
    const { before, state } = play(ERI[0], [], withOpp([ITEM, FILLER, ITEM_2, SUPPORTER]));
    const prompt = parkOf(state);
    if (prompt.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${prompt.kind}`);
    expect([prompt.min, prompt.max]).toEqual([0, 2]);
    expect(sorted(ids(before, prompt.candidates))).toEqual(sorted([ITEM, ITEM_2]));
    expect(prompt.dest).toBe("discard");
    expect(prompt.note).toBe(ERI_TEXT);
  });

  it("TWO COPIES of one Item are both offered (the per-class cap is the printed 2) and both go", () => {
    const { before, state: parked } = play(ERI[0], [], withOpp([ITEM, ITEM, FILLER]));
    const prompt = parkOf(parked);
    if (prompt.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${prompt.kind}`);
    expect(ids(before, prompt.candidates)).toEqual([ITEM, ITEM]);
    const { state: done, events } = mustApply(parked, cards(prompt.candidates));
    expect(done.players.p2.hand).toEqual([before.players.p2.hand[2]]);
    expect(done.players.p2.discard).toEqual([...before.players.p2.discard, ...prompt.candidates]);
    // CARD_DISCARDED_FROM_HAND carries the ACTOR: p2's cards, p1's choice.
    expect(all(events, "CARD_DISCARDED_FROM_HAND")).toEqual(
      prompt.candidates.map((uid) => ({ type: "CARD_DISCARDED_FROM_HAND", seat: "p2", uid, actor: "p1" })),
    );
  });

  it("a LONE Item is still ASKED — the decline the card prints is offered", () => {
    const { before, state } = play(ERI[0], [], withOpp([FILLER, ITEM]));
    const prompt = parkOf(state);
    if (prompt.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${prompt.kind}`);
    expect(prompt.candidates).toEqual([before.players.p2.hand[1]]);
    expect([prompt.min, prompt.max]).toEqual([0, 2]);
  });

  it("declining is legal: nothing moves and the turn goes on", () => {
    const { before, state: parked } = play(ERI[0], [], withOpp([FILLER, ITEM]));
    const { state: done, events } = mustApply(parked, cards([]));
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p2.hand).toEqual(before.players.p2.hand);
    expect(done.players.p2.discard).toEqual(before.players.p2.discard);
    expect(all(events, "CARD_DISCARDED_FROM_HAND")).toHaveLength(0);
  });

  it("an Item-less hand still PLAYS: the hand is revealed and the discard whiffs", () => {
    const { before, uid, state, events } = play(ERI[0], [], withOpp([FILLER, SUPPORTER]));
    expect(types(events)).toEqual(["TRAINER_PLAYED", "HAND_REVEALED"]);
    expect(state.phase.kind).toBe("turn:action");
    expect(state.players.p2.hand).toEqual(before.players.p2.hand);
    expect(state.players.p1.discard).toContain(uid);
  });

  it("an EMPTY opponent hand is REFUSED — the count is public", () => {
    const state = setHand(setHand(board(), "p1", [ERI[0]]), "p2", []);
    expectErr(state, { type: "playTrainer", seat: "p1", uid: state.players.p1.hand[0] as string }, "NO_LEGAL_TARGET");
  });

  it("every printing is the same object and plays the same way", () => {
    for (const id of ERI) {
      const { state } = play(id, [], withOpp([ITEM]));
      expect(parkOf(state).kind).toBe("chooseCards");
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D555 A §6 — Meddling Memo: the opponent's hand under their deck, then that many", () => {
  it("the hand goes UNDER the deck (the deck's order above it kept) and they draw the SAME count", () => {
    const { before, state, events } = play(MEMO[0], [FILLER], (s) =>
      setHand(s, "p2", [ITEM, SUPPORTER, FILLER, ITEM_2, ITEM]),
    );
    const oldHand = before.players.p2.hand;
    const oldDeck = before.players.p2.deck;
    expect(oldHand).toHaveLength(5);
    // They draw 5 — the top 5 of the OLD deck, because nothing above the hand moved.
    expect(state.players.p2.hand).toEqual(oldDeck.slice(0, 5));
    // …and the deck is the old deck minus those 5, with the old hand (shuffled) under it.
    expect(state.players.p2.deck.slice(0, oldDeck.length - 5)).toEqual(oldDeck.slice(5));
    expect(sorted(state.players.p2.deck.slice(oldDeck.length - 5))).toEqual(sorted(oldHand));
    expect(all(events, "HAND_TO_BOTTOM_OF_DECK")).toEqual([{ type: "HAND_TO_BOTTOM_OF_DECK", seat: "p2", count: 5 }]);
    expect(all(events, "CARDS_DRAWN").map((e) => [e.seat, e.uids.length])).toEqual([["p2", 5]]);
  });

  it("\"shuffles those cards\" — the bottom slice is the hand SHUFFLED off the live rng, not its old order", () => {
    // The rung above compares the bottom slice SORTED, so it cannot see the shuffle.
    // This one can: the slice is exactly `shuffle(oldHand, rngState)` (Iono's shared
    // `handRefresh toBottom` path, interpreter.ts), and on this seed that order is NOT
    // the old one, so a `toBottom` that appended the hand unshuffled goes red here.
    const { before, state } = play(MEMO[0], [FILLER], (s) =>
      setHand(s, "p2", [ITEM, SUPPORTER, FILLER, ITEM_2, ITEM]),
    );
    const oldHand = before.players.p2.hand;
    const bottom = state.players.p2.deck.slice(before.players.p2.deck.length - 5);
    const [expected] = shuffle(oldHand, before.rngState);
    expect(bottom).toEqual(expected);
    expect(bottom).not.toEqual(oldHand);
  });

  it("the CONTROLLER's hand is untouched (the card aside)", () => {
    const { before, uid, state } = play(MEMO[0], [FILLER, ITEM], (s) => setHand(s, "p2", [ITEM, ITEM]));
    expect(state.players.p1.hand).toEqual(before.players.p1.hand.filter((u) => u !== uid));
    expect(state.players.p1.deck).toEqual(before.players.p1.deck);
  });

  it("an EMPTY opponent hand plays, moves nothing and draws 0 (\"If they do\" is handPlus 0)", () => {
    const { before, state, events } = play(MEMO[0], [FILLER], (s) => setHand(s, "p2", []));
    expect(state.players.p2.hand).toEqual([]);
    expect(state.players.p2.deck).toEqual(before.players.p2.deck);
    expect(all(events, "CARDS_DRAWN")).toHaveLength(0);
    expect(state.phase.kind).toBe("turn:action");
  });
});

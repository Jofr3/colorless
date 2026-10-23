import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { applyAction } from "./index";
import type { GameAction, GameState, PokemonRef, Seat } from "./index";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  expectErr,
  mustApply,
  setActiveFromDeck,
  setDamage,
  trainerCard,
  types,
  must,
  effectPrompt,
  ensureInDeck,
  driveSetup,
  roundTrip,
} from "./testFixtures";

const PERRIN = ["sv06-160", "sv06-209", "sv06-220"] as const;
const CRISPIN = ["sv07-133", "sv07-164", "sv08.5-105", "sv08.5-171"] as const;
const SUPER_POTION = "sv09-158";
const LOVE_BALL = "sv06-156";
const HAND_TRIMMER = "sv05-150";
const SCOOP = ["sv06-162", "sv08.5-128"] as const;
const SCRAMBLE = "sv08-186";

const PERRIN_TEXT =
  "Reveal up to 2 Pokémon in your hand and put them into your deck. If you do, search your deck for up to that many Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.";
const CRISPIN_TEXT =
  "Search your deck for up to 2 Basic Energy cards of different types, reveal them, and put 1 of them into your hand. Attach the other to 1 of your Pokémon. Then, shuffle your deck.";
const SUPER_POTION_TEXT =
  "Heal 60 damage from 1 of your Pokémon. If you healed any damage in this way, discard an Energy from that Pokémon.";
const LOVE_BALL_TEXT =
  "Search your deck for a Pokémon with the same name as 1 of your opponent's Pokémon in play, reveal it, and put it into your hand. Then, shuffle your deck.";
const HAND_TRIMMER_TEXT =
  "Each player discards cards from their hand until they have 5 cards in their hand. Your opponent discards first. (If a player has 5 or fewer cards in their hand, they do not discard.)";
const SCOOP_TEXT = "Put 1 of your Pokémon and all attached cards into your hand.";
const SCRAMBLE_TEXT =
  "Switch your Active Pokémon with 1 of your Benched Pokémon. If you do, you may move any amount of Energy from the Pokémon you moved to your Bench to the new Active Pokémon.";

const FILLER = "d561t-filler";
const PIKA = "d561t-pika";
const PIKA_EX = "d561t-pika-ex";
const ITEM = "d561t-item";
const FIRE = "fix-fire-energy";
const WATER = "fix-water-energy";
const GRASS = "fix-grass-energy";
const LUMINOUS = "sv02-191";
const TOOL = "fix-tool";

function printed(id: string, name: string, trainerType: string, effect: string): Card {
  return { ...trainerCard(id, trainerType, effect), name };
}
function printings(ids: readonly string[], name: string, trainerType: string, effect: string) {
  return Object.fromEntries(ids.map((id) => [id, printed(id, name, trainerType, effect)]));
}

const LOCAL_CARDS: Record<string, Card> = {
  ...printings(PERRIN, "Perrin", "Supporter", PERRIN_TEXT),
  ...printings(CRISPIN, "Crispin", "Supporter", CRISPIN_TEXT),
  [SUPER_POTION]: printed(SUPER_POTION, "Super Potion", "Item", SUPER_POTION_TEXT),
  [LOVE_BALL]: printed(LOVE_BALL, "Love Ball", "Item", LOVE_BALL_TEXT),
  [HAND_TRIMMER]: printed(HAND_TRIMMER, "Hand Trimmer", "Item", HAND_TRIMMER_TEXT),
  ...printings(SCOOP, "Scoop Up Cyclone", "Item", SCOOP_TEXT),
  [SCRAMBLE]: printed(SCRAMBLE, "Scramble Switch", "Item", SCRAMBLE_TEXT),
  [FILLER]: battler(FILLER, { name: "D561 Filler", hp: 300, types: ["Colorless"] }),
  [PIKA]: battler(PIKA, { name: "D561 Pikachu", hp: 300, types: ["Lightning"] }),
  [PIKA_EX]: battler(PIKA_EX, { name: "D561 Pikachu ex", hp: 300, types: ["Lightning"] }),
  [ITEM]: printed(ITEM, "D561 Item", "Item", "A test Item."),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [PERRIN[0]]: 1,
  [PERRIN[1]]: 1,
  [PERRIN[2]]: 1,
  [CRISPIN[0]]: 1,
  [CRISPIN[1]]: 1,
  [CRISPIN[2]]: 1,
  [CRISPIN[3]]: 1,
  [SUPER_POTION]: 1,
  [LOVE_BALL]: 1,
  [HAND_TRIMMER]: 1,
  [SCOOP[0]]: 1,
  [SCOOP[1]]: 1,
  [SCRAMBLE]: 1,
  [FILLER]: 16,
  [PIKA]: 4,
  [PIKA_EX]: 2,
  [ITEM]: 6,
  [FIRE]: 6,
  [WATER]: 6,
  [GRASS]: 3,
  [LUMINOUS]: 2,
  [TOOL]: 2,
});

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };
const ACTIVE: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const BENCH = (index: number): PokemonRef => ({ seat: "p1", spot: { spot: "bench", index } });

/** Setup with p2 going first; returns p1's (unrestricted) turn 2 after p2 passed. */
function opened(seed: number): GameState {
  const state = driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first: "p2" });
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

const seatActive = (state: GameState, seat: Seat, id: string) =>
  setActiveFromDeck(ensureInDeck(state, seat, id), seat, id);
const seatBench = (state: GameState, seat: Seat, id: string) =>
  benchFromDeck(ensureInDeck(state, seat, id), seat, id);

/** p1's turn 2 with `active` / `bench` for p1 and `oppActive` / `oppBench` for p2. */
function table(
  active: string = FILLER,
  bench: readonly string[] = [],
  oppActive: string = FILLER,
  oppBench: readonly string[] = [],
  seed = 5612,
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

/** TEST SURGERY — every copy of `id` in `seat`'s DECK goes to their discard pile. */
function purgeFromDeck(state: GameState, seat: Seat, id: string): GameState {
  const side = state.players[seat];
  const gone = side.deck.filter((u) => state.cardIdByUid[u] === id);
  const next = {
    ...side,
    deck: side.deck.filter((u) => !gone.includes(u)),
    discard: [...side.discard, ...gone],
  };
  return { ...state, players: { ...state.players, [seat]: next } };
}

/** p1 holds exactly `[card, ...rest]` on `board`; plays `card`. */
function play(board: GameState, id: string, rest: readonly string[] = []) {
  const before = setHand(board, "p1", [id, ...rest]);
  const uid = before.players.p1.hand[0] as string;
  return { before, uid, ...mustApply(before, { type: "playTrainer", seat: "p1", uid }) };
}

function all<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}
const idOf = (state: GameState, uid: string | undefined) =>
  uid === undefined ? undefined : state.cardIdByUid[uid];
const cards = (uids: readonly string[], seat: Seat = "p1"): GameAction => ({
  type: "resolveEffect",
  seat,
  choice: { kind: "cards", uids: [...uids] },
});
const confirm = (yes: boolean): GameAction => ({
  type: "resolveEffect",
  seat: "p1",
  choice: { kind: "confirm", yes },
});
const pokemon = (ref: PokemonRef): GameAction => ({
  type: "resolveEffect",
  seat: "p1",
  choice: { kind: "pokemon", ref },
});
function cont(state: GameState) {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  return state.phase.cont;
}
function render(events: readonly GameEvent[], state: GameState): { who: string; text: string }[] {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  return logFromEvents([...events], ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}
const handIds = (state: GameState, seat: Seat = "p1") =>
  state.players[seat].hand.map((u) => idOf(state, u));
/** A JSON copy of `state` whose parked continuation has been passed through `edit`. */
function reviveWith(state: GameState, edit: (json: string) => string): GameState {
  return JSON.parse(edit(JSON.stringify(state))) as GameState;
}

// ────────────────────────────────────────────────────────────────────────────
describe("D561 §1 — the prints, and the registry rows that map them", () => {
  const ROWS: readonly {
    name: string;
    ids: readonly string[];
    subtype: string;
    program: unknown;
  }[] = [
    {
      name: "Perrin",
      ids: PERRIN,
      subtype: "Supporter",
      program: {
        trainer: [
          {
            op: "payFromHand",
            count: "any",
            cap: 2,
            filter: { kind: "anyPokemon" },
            to: "deckBottom",
            recordAs: "paid",
          },
          {
            op: "recordGate",
            slot: "paid",
            ops: [
              {
                op: "searchDeck",
                filter: { kind: "anyPokemon" },
                dest: "hand",
                max: 2,
                maxRecorded: "paid",
                reveal: true,
              },
            ],
          },
          { op: "shuffleDeck" },
        ],
      },
    },
    {
      name: "Crispin",
      ids: CRISPIN,
      subtype: "Supporter",
      program: {
        trainer: [
          {
            op: "searchDeck",
            filter: { kind: "basicEnergy" },
            dest: "hand",
            max: 2,
            distinctEnergyTypes: true,
            reveal: true,
            recordAs: "moved",
          },
          { op: "attachEnergyFrom", source: "hand", oneOfRecorded: "moved" },
          { op: "shuffleDeck" },
        ],
      },
    },
    {
      name: "Super Potion",
      ids: [SUPER_POTION],
      subtype: "Item",
      program: { trainer: [{ op: "healChosen", amount: 60, discardEnergyFromHealed: true }] },
    },
    {
      name: "Love Ball",
      ids: [LOVE_BALL],
      subtype: "Item",
      program: {
        trainer: [
          {
            op: "searchDeck",
            filter: { kind: "anyPokemon" },
            dest: "hand",
            max: 1,
            reveal: true,
            sameNameAsOpponentInPlay: true,
          },
          { op: "shuffleDeck" },
        ],
      },
    },
    {
      name: "Hand Trimmer",
      ids: [HAND_TRIMMER],
      subtype: "Item",
      program: {
        trainer: [
          { op: "opponentDiscardsFromHand", untilHandSize: 5 },
          { op: "opponentDiscardsFromHand", untilHandSize: 5, whose: "self" },
        ],
      },
    },
    {
      name: "Scoop Up Cyclone",
      ids: SCOOP,
      subtype: "Item",
      program: {
        trainer: [{ op: "returnBenched", whose: "self", dest: "hand", includeActive: true }],
      },
    },
    {
      name: "Scramble Switch",
      ids: [SCRAMBLE],
      subtype: "Item",
      program: {
        trainer: [
          { op: "switchActive", recordAs: "moved", recordDemoted: true },
          {
            op: "recordGate",
            slot: "moved",
            ops: [
              {
                op: "moveEnergy",
                filter: { kind: "anyEnergy" },
                max: "any",
                route: "benchToActive",
                sourceRecorded: "moved",
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
      }
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
describe("D561 §2 — Perrin: up to 2 Pokémon back into the deck, then search THAT MANY (V1 + V2, R-PR)", () => {
  it("the declinable reveal PARKS over the hand's Pokémon only, captioned with what it buys", () => {
    const { state } = play(table(), PERRIN[0], [PIKA, FILLER, ITEM]);
    const p = effectPrompt(state);
    if (p.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(p.min).toBe(0);
    expect(p.max).toBe(2);
    expect(p.dest).toBe("deckBottom");
    expect(p.candidates.map((u) => idOf(state, u)).sort()).toEqual([FILLER, PIKA].sort());
    expect(p.note).toBe(
      "Reveal up to 2 Pokémon in your hand and put them into your deck. If you do, search your deck for up to that many Pokémon, reveal them, and put them into your hand.",
    );
  });

  it("two returned → the search's ceiling is TWO; the returned cards are IN the deck and can be found again", () => {
    const { state: parked, before } = play(table(), PERRIN[1], [PIKA, FILLER, ITEM]);
    const paid = before.players.p1.hand.slice(1, 3);
    const { state: searching, events } = mustApply(parked, cards(paid));
    expect(all(events, "HAND_COST_PAID")).toEqual([
      { type: "HAND_COST_PAID", seat: "p1", uids: paid, to: "deckBottom" },
    ]);
    const p = effectPrompt(searching);
    if (p.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(p).toMatchObject({ min: 0, max: 2, dest: "hand" });
    for (const u of paid) expect(p.candidates).toContain(u);
    const { state, events: found } = mustApply(searching, cards(paid));
    expect(handIds(state).sort()).toEqual([FILLER, ITEM, PIKA].sort());
    expect(all(found, "DECK_SEARCHED").map((e) => e.reveal)).toEqual([true]);
    expect(types(found as GameEvent[])).toContain("SHUFFLE");
    expect(state.phase.kind).toBe("turn:action");
  });

  it("ONE returned → the ceiling is ONE (`maxRecorded`), not the printed bound 2", () => {
    const { state: parked, before } = play(table(), PERRIN[2], [PIKA, FILLER]);
    const { state: searching } = mustApply(parked, cards([before.players.p1.hand[1] as string]));
    const p = effectPrompt(searching);
    if (p.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(p.max).toBe(1);
    expect(p.note).toBe("Search your deck for a Pokémon into your hand.");
  });

  it('NONE returned (the printed "up to" floor) → no search at all, and the deck is still shuffled', () => {
    const { state: parked } = play(table(), PERRIN[0], [PIKA]);
    const { state, events } = mustApply(parked, cards([]));
    expect(all(events, "DECK_SEARCHED")).toEqual([]);
    expect(all(events, "HAND_COST_PAID")).toEqual([]);
    expect(types(events as GameEvent[])).toContain("SHUFFLE");
    expect(state.phase.kind).toBe("turn:action");
    expect(handIds(state)).toEqual([PIKA]);
  });

  it("a hand with NO Pokémon plays (a declinable cost is never unmet), pays nothing and shuffles", () => {
    const { state, events } = play(table(), PERRIN[0], [ITEM]);
    expect(state.phase.kind).toBe("turn:action");
    expect(all(events, "DECK_SEARCHED")).toEqual([]);
    expect(types(events as GameEvent[])).toContain("SHUFFLE");
  });

  it("R-PR — the log counts the returned cards (hidden → hidden) and the searched ones are REVEALED", () => {
    const { state: parked, before } = play(table(), PERRIN[0], [PIKA, FILLER]);
    const { state: searching, events: paidEvents } = mustApply(
      parked,
      cards(before.players.p1.hand.slice(1, 3)),
    );
    expect(searching.players.p1.deck.slice(-2)).toEqual(before.players.p1.hand.slice(1, 3));
    expect(render(paidEvents, searching).map((r) => r.text)).toContain(
      "put 2 cards from their hand on the bottom of their deck",
    );
    const p = effectPrompt(searching);
    if (p.kind !== "chooseCards") throw new Error("expected chooseCards");
    const { events } = mustApply(searching, cards([p.candidates[0] as string]));
    expect(all(events, "DECK_SEARCHED")[0]?.reveal).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D561 §3 — Crispin: ONE search, then the split as a labelled choice (V4, R-CR1, R-CR2)", () => {
  function searched(board: GameState, rest: readonly string[] = []) {
    const { state } = play(board, CRISPIN[0], rest);
    const p = effectPrompt(state);
    if (p.kind !== "chooseCards") throw new Error("expected chooseCards");
    const fire = p.candidates.find((u) => idOf(state, u) === FIRE) as string;
    const water = p.candidates.find((u) => idOf(state, u) === WATER) as string;
    return { state, p, fire, water };
  }

  it("the search is ONE park: Basic Energy only, up to 2, of DIFFERENT types (D513's caps), revealed", () => {
    const { state, p } = searched(table());
    expect(p).toMatchObject({ min: 0, max: 2, dest: "hand" });
    expect(new Set(p.candidates.map((u) => idOf(state, u)))).toEqual(new Set([FIRE, WATER, GRASS]));
    expect(p.caps?.length).toBe(3);
  });

  it("R-CR2 — TWO found: a labelled choice between the two TYPES; the chosen one is attached, the other STAYS in hand", () => {
    const { state, fire, water } = searched(table());
    const { state: asked, events } = mustApply(state, cards([fire, water]));
    expect(all(events, "DECK_SEARCHED").map((e) => e.reveal)).toEqual([true]);
    const q = effectPrompt(asked);
    expect(q).toEqual({
      kind: "confirm",
      note: "Which Energy do you want to attach?",
      labels: { yes: "Attach Fire Energy", no: "Attach Water Energy" },
      cards: { yes: fire, no: water },
      targets: [ACTIVE],
    });
    const yes = mustApply(asked, confirm(true));
    expect(yes.state.players.p1.active?.energy).toEqual([fire]);
    expect(yes.state.players.p1.hand).toEqual([water]);
    expect(types(yes.events as GameEvent[])).toContain("SHUFFLE");
    const no = mustApply(asked, confirm(false));
    expect(no.state.players.p1.active?.energy).toEqual([water]);
    expect(no.state.players.p1.hand).toEqual([fire]);
  });

  it("the attach is MANDATORY: with a Bench it parks on the target and offers no decline", () => {
    const { state, fire, water } = searched(table(FILLER, [PIKA]));
    const { state: asked } = mustApply(state, cards([fire, water]));
    const { state: target } = mustApply(asked, confirm(true));
    const p = effectPrompt(target);
    if (p.kind !== "choosePokemon") throw new Error(`expected choosePokemon, got ${p.kind}`);
    expect(p.candidates).toEqual([ACTIVE, BENCH(0)]);
    expect("upTo" in p).toBe(false);
    const { state: done } = mustApply(target, pokemon(BENCH(0)));
    expect(done.players.p1.bench[0]?.energy).toEqual([fire]);
    expect(done.players.p1.hand).toEqual([water]);
  });

  it.each([
    { yes: true, spot: ACTIVE },
    { yes: false, spot: BENCH(0) },
  ])("a single drop chooses the Energy and its Pokémon target ($yes)", ({ yes, spot }) => {
    const { state, fire, water } = searched(table(FILLER, [PIKA]));
    const asked = mustApply(state, cards([fire, water])).state;
    const dropped = mustApply(asked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes, target: spot },
    });
    expect(dropped.state.phase.kind).toBe("turn:action");
    const host =
      spot.spot.spot === "active"
        ? dropped.state.players.p1.active
        : dropped.state.players.p1.bench[spot.spot.index];
    expect(host?.energy).toContain(yes ? fire : water);
    expect(dropped.state.players.p1.hand).toEqual([yes ? water : fire]);
    expect(types(dropped.events)).toContain("SHUFFLE");
  });

  it("rejects an opposing or empty target without consuming the staged cards", () => {
    const { state, fire, water } = searched(table());
    const asked = mustApply(state, cards([fire, water])).state;
    for (const target of [{ ...ACTIVE, seat: "p2" as const }, BENCH(0)]) {
      const result = applyAction(asked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "confirm", yes: true, target },
      });
      expect(result.ok).toBe(false);
      expect(asked.players.p1.hand).toEqual([fire, water]);
    }
  });

  it("attaches the dragged physical Energy, preserving an older copy of the same type in hand", () => {
    const { state, fire, water } = searched(table(), [FIRE]);
    const older = state.players.p1.hand[0];
    const asked = mustApply(state, cards([fire, water])).state;
    const dropped = mustApply(asked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true, target: ACTIVE },
    }).state;
    expect(dropped.players.p1.active?.energy).toEqual([fire]);
    expect(dropped.players.p1.hand).toEqual([older, water]);
  });

  it("R-CR2's VERIFY — a Special Energy in hand is never the attached card (the attach's Basic-card test)", () => {
    const { state, fire, water } = searched(table(), [LUMINOUS]);
    const luminous = state.players.p1.hand[0] as string;
    expect(idOf(state, luminous)).toBe(LUMINOUS);
    const { state: asked } = mustApply(state, cards([fire, water]));
    const { state: done } = mustApply(asked, confirm(true));
    expect(done.players.p1.active?.energy).toEqual([fire]);
    expect(done.players.p1.hand).toContain(luminous);
  });

  it('R-CR1 (UNRULED) — ONE found: *"Attach Fire Energy"* or *"Keep it in your hand"*', () => {
    const { state, fire } = searched(table());
    const { state: asked } = mustApply(state, cards([fire]));
    expect(effectPrompt(asked)).toMatchObject({
      labels: { yes: "Attach Fire Energy", no: "Keep it in your hand" },
    });
    expect(mustApply(asked, confirm(true)).state.players.p1.active?.energy).toEqual([fire]);
    const kept = mustApply(asked, confirm(false)).state;
    expect(kept.players.p1.active?.energy).toEqual([]);
    expect(kept.players.p1.hand).toEqual([fire]);
  });

  it("NONE found (the declined search) asks nothing more and still shuffles", () => {
    const { state } = searched(table());
    const { state: done, events } = mustApply(state, cards([]));
    expect(done.phase.kind).toBe("turn:action");
    expect(types(events as GameEvent[])).toContain("SHUFFLE");
    expect(done.players.p1.active?.energy).toEqual([]);
  });

  it("the play gate does not ask the HAND about this attach — Crispin alone in hand plays", () => {
    const board = setHand(table(), "p1", [CRISPIN[1]]);
    const { state } = mustApply(board, {
      type: "playTrainer",
      seat: "p1",
      uid: board.players.p1.hand[0] as string,
    });
    expect(effectPrompt(state).kind).toBe("chooseCards");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D561 §4 — Super Potion: heal 60, and ONLY IF it healed, discard an Energy from THAT body (V5, R-SP)", () => {
  it("one body (forced pick): heals 60, then the discard PARKS over two DIFFERENT Energy on it", () => {
    let board = setDamage(table(), "p1", 80);
    board = attachFromDeck(attachFromDeck(board, "p1", FIRE, 1), "p1", WATER, 1);
    const { state, events } = play(board, SUPER_POTION);
    expect(all(events, "HEALED").map((e) => e.amount)).toEqual([60]);
    expect(state.players.p1.active?.damage).toBe(20);
    const p = effectPrompt(state);
    if (p.kind !== "discardEnergy") throw new Error(`expected discardEnergy, got ${p.kind}`);
    expect(p.note).toBe("Discard an Energy from that Pokémon.");
    expect(p.scope).toEqual({ kind: "total", count: 1 });
    const water = board.players.p1.active?.energy[1] as string;
    const { state: done } = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [water] },
    });
    expect(done.players.p1.active?.energy.map((u) => idOf(done, u))).toEqual([FIRE]);
    expect(done.players.p1.discard).toContain(water);
  });

  it("two SAME-TYPE Basic Energy are fungible: the discard is forced, no park", () => {
    const board = attachFromDeck(setDamage(table(), "p1", 30), "p1", FIRE, 2);
    const { state, events } = play(board, SUPER_POTION);
    expect(state.phase.kind).toBe("turn:action");
    expect(all(events, "ENERGY_DISCARDED")).toHaveLength(1);
    expect(state.players.p1.active?.energy).toHaveLength(1);
    expect(state.players.p1.active?.damage).toBe(0);
  });

  it("R-SP — an UNDAMAGED body heals 0 and discards NOTHING", () => {
    const board = attachFromDeck(table(), "p1", FIRE, 1);
    const { state, events } = play(board, SUPER_POTION);
    expect(all(events, "HEALED")).toEqual([]);
    expect(all(events, "ENERGY_DISCARDED")).toEqual([]);
    expect(state.players.p1.active?.energy).toHaveLength(1);
  });

  it("R-SP — a damaged body with NO Energy is healed and nothing else happens", () => {
    const { state, events } = play(setDamage(table(), "p1", 50), SUPER_POTION);
    expect(state.players.p1.active?.damage).toBe(0);
    expect(all(events, "ENERGY_DISCARDED")).toEqual([]);
    expect(state.phase.kind).toBe("turn:action");
  });

  it("the PICKED body is the one stripped — a damaged Benched pick loses ITS Energy, the Active keeps its own", () => {
    let board = attachFromDeck(table(FILLER, [PIKA]), "p1", FIRE, 1);
    const bench = board.players.p1.bench[0];
    if (bench === undefined) throw new Error("no bench");
    const bulb = board.players.p1.deck.find((u) => board.cardIdByUid[u] === WATER) as string;
    board = {
      ...board,
      players: {
        ...board.players,
        p1: {
          ...board.players.p1,
          deck: board.players.p1.deck.filter((u) => u !== bulb),
          bench: [{ ...bench, damage: 40, energy: [bulb] }],
        },
      },
    };
    const { state: parked } = play(board, SUPER_POTION);
    const p = effectPrompt(parked);
    if (p.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    const { state } = mustApply(parked, pokemon(BENCH(0)));
    expect(state.players.p1.bench[0]?.damage).toBe(0);
    expect(state.players.p1.bench[0]?.energy).toEqual([]);
    expect(state.players.p1.active?.energy).toHaveLength(1);
    expect(state.players.p1.discard).toContain(bulb);
  });

  it("R-SP on the parked path — picking an UNDAMAGED body among several strips nothing", () => {
    const board = attachFromDeck(table(FILLER, [PIKA]), "p1", FIRE, 1);
    const { state: parked } = play(board, SUPER_POTION);
    const { state, events } = mustApply(parked, pokemon(ACTIVE));
    expect(all(events, "ENERGY_DISCARDED")).toEqual([]);
    expect(state.players.p1.active?.energy).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D561 §5 — Love Ball: a Pokémon with the SAME NAME as one of the opponent's in play (V3, R-LB)", () => {
  it("the offer is narrowed at the step to the opposing names — Active AND Bench — and revealed", () => {
    const { state } = play(table(FILLER, [], PIKA, []), LOVE_BALL);
    const p = effectPrompt(state);
    if (p.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(new Set(p.candidates.map((u) => idOf(state, u)))).toEqual(new Set([PIKA]));
    expect(p.max).toBe(1);
    expect(p.note).toBe(
      "Search your deck for a Pokémon with the same name as 1 of your opponent's Pokémon in play into your hand.",
    );
    const { events } = mustApply(state, cards([p.candidates[0] as string]));
    expect(all(events, "DECK_SEARCHED")[0]?.reveal).toBe(true);
    const bench = play(table(FILLER, [], FILLER, [PIKA_EX]), LOVE_BALL).state;
    const q = effectPrompt(bench);
    if (q.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(new Set(q.candidates.map((u) => idOf(bench, u)))).toEqual(new Set([FILLER, PIKA_EX]));
  });

  it('R-LB — the name is EXACT: "D561 Pikachu ex" opposite finds no "D561 Pikachu"; the whiff still shuffles', () => {
    const board = purgeFromDeck(table(FILLER, [], PIKA_EX, []), "p1", PIKA_EX);
    const { state, events } = play(board, LOVE_BALL);
    expect(state.phase.kind).toBe("turn:action");
    expect(all(events, "DECK_SEARCHED")).toEqual([]);
    expect(types(events as GameEvent[])).toContain("SHUFFLE");
    expect(board.players.p1.deck.some((u) => board.cardIdByUid[u] === PIKA)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D561 §6 — Hand Trimmer: each player down to 5, the OPPONENT first (V6, R-HT)", () => {
  const eight = [ITEM, ITEM, ITEM, ITEM, FILLER, FILLER, FILLER, FILLER];

  it("the opponent answers FIRST (their own discard), then the controller answers theirs", () => {
    const board = setHand(table(), "p2", eight);
    const { state: first } = play(board, HAND_TRIMMER, [ITEM, ITEM, FILLER, FILLER, FIRE, WATER]);
    if (first.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(first.phase.answerer).toBe("p2");
    expect(effectPrompt(first)).toMatchObject({
      kind: "chooseCards",
      min: 3,
      max: 3,
      dest: "discard",
    });
    const theirs = first.players.p2.hand.slice(0, 3);
    const { state: second, events: e1 } = mustApply(first, cards(theirs, "p2"));
    expect(all(e1, "FORCED_HAND_DISCARD").map((e) => e.seat)).toEqual(["p2"]);
    expect(second.players.p2.hand).toHaveLength(5);
    if (second.phase.kind !== "effect:choose") throw new Error("expected the controller's park");
    expect("answerer" in second.phase).toBe(false);
    const p = effectPrompt(second);
    expect(p).toMatchObject({
      kind: "chooseCards",
      min: 1,
      max: 1,
      dest: "discard",
      note: "Discard cards from your hand until you have 5 cards in your hand.",
    });
    const mine = second.players.p1.hand[0] as string;
    const { state, events: e2 } = mustApply(second, cards([mine]));
    expect(all(e2, "FORCED_HAND_DISCARD")).toEqual([
      { type: "FORCED_HAND_DISCARD", seat: "p1", uids: [mine] },
    ]);
    expect(state.players.p1.hand).toHaveLength(5);
    expect(state.players.p1.discard).toContain(mine);
    expect(state.phase.kind).toBe("turn:action");
  });

  it("R-HT — the played Item has LEFT the hand: 1 + 5 others is five, so the controller discards nothing", () => {
    const board = setHand(table(), "p2", [ITEM, ITEM]);
    const { state, events } = play(board, HAND_TRIMMER, [ITEM, ITEM, FILLER, FILLER, FIRE]);
    expect(state.phase.kind).toBe("turn:action");
    expect(all(events, "FORCED_HAND_DISCARD")).toEqual([]);
    expect(state.players.p1.hand).toHaveLength(5);
  });

  it("the controller arm alone: a small opposing hand is a silent no-op, then the controller discards down", () => {
    const board = setHand(table(), "p2", [ITEM]);
    const { state } = play(board, HAND_TRIMMER, [ITEM, ITEM, FILLER, FILLER, FIRE, WATER, GRASS]);
    if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect("answerer" in state.phase).toBe(false);
    expect(effectPrompt(state)).toMatchObject({ min: 2, max: 2 });
    expect(state.players.p2.hand).toHaveLength(1);
  });

  it("the controller's park round-trips through JSON and resumes identically", () => {
    const board = setHand(table(), "p2", [ITEM]);
    const { state: parked } = play(board, HAND_TRIMMER, [ITEM, ITEM, FILLER, FILLER, FIRE, WATER]);
    const revived = roundTrip(parked);
    const answer = cards([parked.players.p1.hand[0] as string]);
    expect(mustApply(revived, answer).state).toEqual(mustApply(parked, answer).state);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D561 §7 — Scoop Up Cyclone: 1 of your Pokémon, the Active INCLUDED, with all attached cards (V7, R-SC)", () => {
  it("the Active leads the offer; returning it takes every attached card and the lone Bench body is promoted", () => {
    let board = attachFromDeck(table(FILLER, [PIKA]), "p1", FIRE, 1);
    board = attachToolFromDeck(board, "p1", "active", TOOL);
    const stack = [...(board.players.p1.active?.stack ?? [])];
    const attached = [
      ...(board.players.p1.active?.energy ?? []),
      ...(board.players.p1.active?.tools ?? []),
    ];
    const { state: parked } = play(board, SCOOP[0]);
    const p = effectPrompt(parked);
    if (p.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(p.candidates).toEqual([ACTIVE, BENCH(0)]);
    expect(p.note).toBe("Put which of your Pokémon and all attached cards into your hand?");
    const { state, events } = mustApply(parked, pokemon(ACTIVE));
    const returned = all(events, "POKEMON_RETURNED");
    expect(returned.map((e) => [e.seat, e.dest])).toEqual([["p1", "hand"]]);
    for (const u of [...stack, ...attached]) {
      expect(returned[0]?.uids).toContain(u);
      expect(state.players.p1.hand).toContain(u);
    }
    expect(idOf(state, state.players.p1.active?.stack[0])).toBe(PIKA);
    expect(state.players.p1.bench).toEqual([]);
    expect(state.phase.kind).toBe("turn:action");
  });

  it("a Benched pick is returned exactly as D299's own arm returns it", () => {
    const { state: parked } = play(table(FILLER, [PIKA]), SCOOP[1]);
    const { state } = mustApply(parked, pokemon(BENCH(0)));
    expect(state.players.p1.bench).toEqual([]);
    expect(handIds(state)).toContain(PIKA);
    expect(idOf(state, state.players.p1.active?.stack[0])).toBe(FILLER);
  });

  it("returning the Active over a Bench of TWO asks the §8.1 promotion", () => {
    const { state: parked } = play(table(FILLER, [PIKA, PIKA_EX]), SCOOP[0]);
    const { state, events } = mustApply(parked, pokemon(ACTIVE));
    expect(state.phase).toEqual({ kind: "ko:promote", seat: "p1" });
    expect(types(events as GameEvent[])).toContain("PROMOTION_REQUIRED");
  });

  it("R-SC — with an EMPTY Bench the lone Active is forced, and the empty spot is the §14.2 LOSS", () => {
    const { state, events } = play(table(), SCOOP[0]);
    expect(state.phase.kind).toBe("gameOver");
    if (state.phase.kind !== "gameOver") return;
    expect(state.phase.outcome).toMatchObject({ result: "win", winner: "p2" });
    expect(all(events, "POKEMON_RETURNED")).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D561 §8 — Scramble Switch: switch, then move any amount off the DEMOTED body (V8, R-SS)", () => {
  function staged(bench: readonly string[] = [PIKA, PIKA_EX]) {
    const board = attachFromDeck(table(FILLER, bench), "p1", FIRE, 2);
    return {
      board,
      energy: [...(board.players.p1.active?.energy ?? [])],
      demoted: board.players.p1.active?.stack[0],
    };
  }

  it("the switch's caption says what the answer buys; the move offers ONLY the demoted body's Energy, to the NEW Active", () => {
    const { board, energy, demoted } = staged();
    const { state: parked } = play(board, SCRAMBLE);
    const p = effectPrompt(parked);
    if (p.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(p.note).toContain(
      "If you do, you may move any amount of Energy from the Pokémon you moved to your Bench to the new Active Pokémon",
    );
    const { state: moving } = mustApply(parked, pokemon(BENCH(1)));
    const m = effectPrompt(moving);
    if (m.kind !== "moveEnergy") throw new Error(`expected moveEnergy, got ${m.kind}`);
    expect(cont(moving).record?.moved).toEqual([demoted]);
    expect(m.movable.map((x) => x.uid).sort()).toEqual([...energy].sort());
    expect(m.destinations).toEqual([ACTIVE]);
    expect(m.max).toBe(2);
    expect(m.min).toBeUndefined();
    expect(m.note).toBe(
      "Move any amount of Energy from the Pokémon you moved to your Bench to the new Active Pokémon.",
    );
    const { state } = mustApply(moving, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: energy.map((uid) => ({ uid, dest: ACTIVE })) },
    });
    expect(idOf(state, state.players.p1.active?.stack[0])).toBe(PIKA_EX);
    expect([...(state.players.p1.active?.energy ?? [])].sort()).toEqual([...energy].sort());
  });

  it('R-SS — moving NOTHING is a legal answer ("you may")', () => {
    const { board, energy } = staged();
    const { state: parked } = play(board, SCRAMBLE);
    const { state: moving } = mustApply(parked, pokemon(BENCH(0)));
    const { state } = mustApply(moving, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [] },
    });
    expect(state.phase.kind).toBe("turn:action");
    const benched = state.players.p1.bench.find((b) => b.energy.length > 0);
    expect([...(benched?.energy ?? [])].sort()).toEqual([...energy].sort());
  });

  it("another Benched body's Energy is NOT a source — only the Pokémon moved to the Bench", () => {
    let { board, energy } = staged([PIKA, PIKA_EX]);
    const other = board.players.p1.bench[1];
    if (other === undefined) throw new Error("no second bench body");
    const water = board.players.p1.deck.find((u) => board.cardIdByUid[u] === WATER) as string;
    board = {
      ...board,
      players: {
        ...board.players,
        p1: {
          ...board.players.p1,
          deck: board.players.p1.deck.filter((u) => u !== water),
          bench: [
            board.players.p1.bench[0] as (typeof board.players.p1.bench)[number],
            { ...other, energy: [water] },
          ],
        },
      },
    };
    const { state: parked } = play(board, SCRAMBLE);
    const { state: moving } = mustApply(parked, pokemon(BENCH(0)));
    const m = effectPrompt(moving);
    if (m.kind !== "moveEnergy") throw new Error(`expected moveEnergy, got ${m.kind}`);
    expect(m.movable.map((x) => x.uid)).not.toContain(water);
    expect(m.movable.map((x) => x.uid).sort()).toEqual([...energy].sort());
    expect(moving.players.p1.bench.find((b) => b.energy.includes(water))).toBeDefined();
  });

  it("a demoted body with NO Energy: the switch happens and the move whiffs silently", () => {
    const { state, events } = play(table(FILLER, [PIKA]), SCRAMBLE);
    expect(state.phase.kind).toBe("turn:action");
    expect(all(events, "POKEMON_SWITCHED")).toHaveLength(1);
    expect(all(events, "ENERGY_MOVED")).toEqual([]);
  });

  it('R-SS — an EMPTY Bench refuses the play (§7, no legal target), so "If you do" never reads an empty slot', () => {
    const board = setHand(table(), "p1", [SCRAMBLE]);
    expectErr(
      board,
      { type: "playTrainer", seat: "p1", uid: board.players.p1.hand[0] as string },
      "NO_LEGAL_TARGET",
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D561 §9 — `MATCH_RECORD_VERSION` holds at 35: JSON revivals, and every 0.444 rollback reading named", () => {
  it("Perrin: the parked payment revives identically; stripped of `maxRecorded` (the 0.444 reading) ONE paid Pokémon buys a search of TWO", () => {
    const { state: parked, before } = play(table(), PERRIN[0], [PIKA, FILLER]);
    const one = cards([before.players.p1.hand[1] as string]);
    const revived = roundTrip(parked);
    expect(revived).toEqual(parked);
    expect(mustApply(revived, one).state).toEqual(mustApply(parked, one).state);
    expect(JSON.stringify(cont(parked).rest)).toContain('"maxRecorded":"paid"');
    const rolled = reviveWith(parked, (j) => j.split(',"maxRecorded":"paid"').join(""));
    const p = effectPrompt(mustApply(rolled, one).state);
    if (p.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(p.max).toBe(2);
  });

  it("Crispin: the scheduled optional revives identically and resolves with its labels STRIPPED; stripped of `oneOfRecorded` the attach ~~takes the first Basic Energy in hand, unasked~~ asks which (card revision B01)", () => {
    const { state: searching } = play(table(), CRISPIN[0]);
    const p = effectPrompt(searching);
    if (p.kind !== "chooseCards") throw new Error("expected chooseCards");
    const fire = p.candidates.find((u) => idOf(searching, u) === FIRE) as string;
    const water = p.candidates.find((u) => idOf(searching, u) === WATER) as string;
    const { state: asked } = mustApply(searching, cards([fire, water]));
    const revived = roundTrip(asked);
    expect(mustApply(revived, confirm(false)).state).toEqual(
      mustApply(asked, confirm(false)).state,
    );
    const unlabelled = reviveWith(asked, (j) =>
      j.split(',"labels":{"yes":"Attach Fire Energy","no":"Attach Water Energy"}').join(""),
    );
    expect(effectPrompt(unlabelled)).not.toHaveProperty("labels");
    expect(mustApply(unlabelled, confirm(false)).state.players.p1.active?.energy).toEqual([water]);
    expect(JSON.stringify(cont(searching).rest)).toContain('"oneOfRecorded":"moved"');
    const rolled = reviveWith(searching, (j) => j.split(',"oneOfRecorded":"moved"').join(""));
    const { state } = mustApply(rolled, cards([water, fire]));
    const q = effectPrompt(state);
    if (q.kind !== "chooseCards") throw new Error("expected the B01 card question");
    expect(q).toMatchObject({ min: 1, max: 1, dest: "attach" });
    expect(new Set(q.candidates)).toEqual(new Set([water, fire]));
    const done = mustApply(state, cards([water])).state;
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p1.active?.energy).toEqual([water]);
  });

  it("Super Potion: the parked pick revives identically; stripped of `discardEnergyFromHealed` it heals and discards NOTHING", () => {
    let board = attachFromDeck(table(FILLER, [PIKA]), "p1", FIRE, 1);
    board = setDamage(board, "p1", 60);
    const { state: parked } = play(board, SUPER_POTION);
    const answer = pokemon(ACTIVE);
    const revived = roundTrip(parked);
    expect(mustApply(revived, answer).state).toEqual(mustApply(parked, answer).state);
    expect(mustApply(parked, answer).state.players.p1.active?.energy).toEqual([]);
    const pending = JSON.stringify(cont(parked).pendingOp);
    expect(pending).toContain('"discardEnergyFromHealed":true');
    const rolled = reviveWith(parked, (j) => j.split(',"discardEnergyFromHealed":true').join(""));
    const { state } = mustApply(rolled, answer);
    expect(state.players.p1.active?.damage).toBe(0);
    expect(state.players.p1.active?.energy).toHaveLength(1);
  });

  it("Scramble Switch: the parked switch revives identically; stripped of BOTH `recordDemoted` and `sourceRecorded` (the 0.444 reading) the move is OFFERED over EVERY Benched body's Energy", () => {
    let board = attachFromDeck(table(FILLER, [PIKA, PIKA_EX]), "p1", FIRE, 2);
    const fires = [...(board.players.p1.active?.energy ?? [])];
    const other = board.players.p1.bench[1];
    if (other === undefined) throw new Error("no bench");
    const water = board.players.p1.deck.find((u) => board.cardIdByUid[u] === WATER) as string;
    board = {
      ...board,
      players: {
        ...board.players,
        p1: {
          ...board.players.p1,
          deck: board.players.p1.deck.filter((u) => u !== water),
          bench: [
            board.players.p1.bench[0] as (typeof board.players.p1.bench)[number],
            { ...other, energy: [water] },
          ],
        },
      },
    };
    const { state: parked } = play(board, SCRAMBLE);
    const answer = pokemon(BENCH(0));
    const revived = roundTrip(parked);
    expect(mustApply(revived, answer).state).toEqual(mustApply(parked, answer).state);
    // The shipped reading first: only the DEMOTED body's two Fire are offered.
    const shipped = effectPrompt(mustApply(parked, answer).state);
    if (shipped.kind !== "moveEnergy") throw new Error(`expected moveEnergy, got ${shipped.kind}`);
    expect(shipped.movable.map((x) => x.uid).sort()).toEqual([...fires].sort());
    expect(JSON.stringify(cont(parked).pendingOp)).toContain('"recordDemoted":true');
    expect(JSON.stringify(cont(parked).rest)).toContain(',"sourceRecorded":"moved"');
    const rolled = reviveWith(parked, (j) =>
      j.split(',"recordDemoted":true').join("").split(',"sourceRecorded":"moved"').join(""),
    );
    expect(JSON.stringify(rolled)).not.toContain("recordDemoted");
    expect(JSON.stringify(rolled)).not.toContain("sourceRecorded");
    const { state, events } = mustApply(rolled, answer);
    expect(all(events, "POKEMON_SWITCHED")).toHaveLength(1);
    const m = effectPrompt(state);
    if (m.kind !== "moveEnergy") throw new Error(`expected moveEnergy, got ${m.kind}`);
    expect(m.movable.map((x) => x.uid).sort()).toEqual([...fires, water].sort());
    expect(m.destinations).toEqual([ACTIVE]);
  });

  it("no D561 program spells a NEW `EffectOp` member — every widening is an optional key on a shipped op", () => {
    const ops: EffectOp[] = [
      ...(programFor(PERRIN[0])?.trainer ?? []),
      ...(programFor(CRISPIN[0])?.trainer ?? []),
      ...(programFor(SUPER_POTION)?.trainer ?? []),
      ...(programFor(LOVE_BALL)?.trainer ?? []),
      ...(programFor(HAND_TRIMMER)?.trainer ?? []),
      ...(programFor(SCOOP[0])?.trainer ?? []),
      ...(programFor(SCRAMBLE)?.trainer ?? []),
    ];
    const known = new Set(ops.map((op) => op.op));
    expect([...known].sort()).toEqual([
      "attachEnergyFrom",
      "healChosen",
      "opponentDiscardsFromHand",
      "payFromHand",
      "recordGate",
      "returnBenched",
      "searchDeck",
      "shuffleDeck",
      "switchActive",
    ]);
  });
});

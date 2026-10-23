import type { Card } from "@colorless/schema";
import { redactedEffectPromptSchema } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { matchesFilter } from "./cards";
import type { BoardCondition, CardFilter } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, redactGame } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { programFor } from "./registry";
import { flipCoin } from "./rng";
import {
  FIXTURE_POOL,
  attachBenchFromDeck,
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

const MORTY = ["sv05-155", "sv05-201", "sv05-211"] as const;
const XEROSIC = ["sv06.5-064", "sv06.5-089"] as const;
const LUCIAN = ["sv06-157", "sv06-208"] as const;
const SANDWICH = "sv10-161";
const MEGATON = "sv08-182";
const BLENDER = "sv08-164";
const TM_MACHINE = "sv10-181";
const DUSK_BALL = "sv08-175";
const SCRAPPER = "sv10.5w-085";

const MORTY_TEXT =
  "You can use this card only if you discard another card from your hand. Draw a card for each of your opponent's Benched Pokémon.";
const XEROSIC_TEXT =
  "Your opponent discards cards from their hand until they have 3 cards in their hand.";
const LUCIAN_TEXT =
  "Each player shuffles their hand and puts it on the bottom of their deck. If either player put any cards on the bottom of their deck in this way, each player flips a coin. If heads, that player draws 6 cards. If tails, they draw 3 cards.";
const SANDWICH_TEXT =
  "Heal 30 damage from your Active Pokémon. If that Pokémon is an Arven's Pokémon, heal 100 damage from it instead.";
const MEGATON_TEXT =
  "Discard all Pokémon Tools and Special Energy from all of your opponent's Pokémon, and discard a Stadium in play.";
const BLENDER_TEXT =
  "Search your deck for up to 5 cards and discard them. Then, shuffle your deck.";
const TM_TEXT =
  'Search your deck for up to 3 Pokémon Tool cards that have "Technical Machine" in their name, reveal them, and put them into your hand. Then, shuffle your deck.';
const DUSK_TEXT =
  "Look at the bottom 7 cards of your deck. You may reveal a Pokémon you find there and put it into your hand. Shuffle the other cards back into your deck.";
const SCRAPPER_TEXT =
  "Choose up to 2 Pokémon Tools attached to Pokémon (yours or your opponent's) and discard them.";

const FILLER = "d557r-filler";
const ARVEN = "d557r-arven";
const ARVENISH = "d557r-arvenish";
const TOOL = "d557r-tool";
const TM_A = "d557r-tm-a";
const TM_B = "d557r-tm-b";
const TM_ITEM = "d557r-tm-item";

function printed(id: string, name: string, trainerType: string, effect: string): Card {
  return { ...trainerCard(id, trainerType, effect), name };
}
function printings(ids: readonly string[], name: string, trainerType: string, effect: string) {
  return Object.fromEntries(ids.map((id) => [id, printed(id, name, trainerType, effect)]));
}
const toolNamed = (id: string, name: string): Card =>
  ({ ...FIXTURE_POOL["fix-tool"], id, name }) as Card;

const LOCAL_CARDS: Record<string, Card> = {
  ...printings(MORTY, "Morty's Conviction", "Supporter", MORTY_TEXT),
  ...printings(XEROSIC, "Xerosic's Machinations", "Supporter", XEROSIC_TEXT),
  ...printings(LUCIAN, "Lucian", "Supporter", LUCIAN_TEXT),
  [SANDWICH]: printed(SANDWICH, "Arven's Sandwich", "Item", SANDWICH_TEXT),
  [MEGATON]: printed(MEGATON, "Megaton Blower", "Item", MEGATON_TEXT),
  [BLENDER]: printed(BLENDER, "Brilliant Blender", "Item", BLENDER_TEXT),
  [TM_MACHINE]: printed(TM_MACHINE, "TM Machine", "Item", TM_TEXT),
  [DUSK_BALL]: printed(DUSK_BALL, "Dusk Ball", "Item", DUSK_TEXT),
  [SCRAPPER]: printed(SCRAPPER, "Tool Scrapper", "Item", SCRAPPER_TEXT),
  [FILLER]: battler(FILLER, { name: "D557 Filler", hp: 300, types: ["Colorless"] }),
  [ARVEN]: battler(ARVEN, { name: "Arven's D557 Mabosstiff", hp: 300, types: ["Darkness"] }),
  [ARVENISH]: battler(ARVENISH, { name: "D557 Arven's Friend", hp: 300, types: ["Darkness"] }),
  [TOOL]: toolNamed(TOOL, "D557 Plain Tool"),
  [TM_A]: toolNamed(TM_A, "Technical Machine: D557 Alpha"),
  [TM_B]: toolNamed(TM_B, "Technical Machine: D557 Beta"),
  [TM_ITEM]: printed(TM_ITEM, "D557 Technical Machine Box", "Item", "A test Item."),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [MORTY[0]]: 1,
  [MORTY[1]]: 1,
  [MORTY[2]]: 1,
  [XEROSIC[0]]: 1,
  [XEROSIC[1]]: 1,
  [LUCIAN[0]]: 1,
  [LUCIAN[1]]: 1,
  [SANDWICH]: 1,
  [MEGATON]: 1,
  [BLENDER]: 1,
  [TM_MACHINE]: 1,
  [DUSK_BALL]: 1,
  [SCRAPPER]: 1,
  [FILLER]: 16,
  [ARVEN]: 3,
  [ARVENISH]: 2,
  [TOOL]: 4,
  [TM_A]: 2,
  [TM_B]: 1,
  [TM_ITEM]: 1,
  "fix-special": 4,
  "fix-stadium": 1,
  "fix-unnerve": 3,
  "fix-energy": 10,
});

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };

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
  seed = 5570,
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

/** p1 holds exactly `[card, ...rest]` on `board`; plays `card`. */
function play(board: GameState, id: string, rest: readonly string[] = []) {
  const before = setHand(board, "p1", [id, ...rest]);
  const uid = before.players.p1.hand[0] as string;
  return { before, uid, ...mustApply(before, { type: "playTrainer", seat: "p1", uid }) };
}

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
const find = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  all(events, type)[0];
const idOf = (state: GameState, uid: string | undefined) =>
  uid === undefined ? undefined : state.cardIdByUid[uid];
const cards = (uids: readonly string[], seat: Seat = "p1"): GameAction => ({
  type: "resolveEffect",
  seat,
  choice: { kind: "cards", uids: [...uids] },
});
function render(events: readonly GameEvent[], state: GameState): { who: string; text: string }[] {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  return logFromEvents([...events], ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}
const toolsOn = (state: GameState, seat: Seat, spot: "active" | number) => {
  const side = state.players[seat];
  const body = spot === "active" ? side.active : side.bench[spot];
  return (body?.tools ?? []).map((u) => state.cardIdByUid[u]);
};

// ────────────────────────────────────────────────────────────────────────────
describe("D557 §1 — the prints, and the registry rows that map them", () => {
  const ROWS: readonly {
    name: string;
    ids: readonly string[];
    subtype: string;
    program: unknown;
  }[] = [
    {
      name: "Morty's Conviction",
      ids: MORTY,
      subtype: "Supporter",
      program: {
        trainer: [
          { op: "payFromHand", count: 1, to: "discard" },
          { op: "drawCards", count: 1, per: { kind: "opponentBenchCount" } },
        ],
      },
    },
    {
      name: "Xerosic's Machinations",
      ids: XEROSIC,
      subtype: "Supporter",
      program: { trainer: [{ op: "opponentDiscardsFromHand", untilHandSize: 3 }] },
    },
    {
      name: "Lucian",
      ids: LUCIAN,
      subtype: "Supporter",
      program: {
        trainer: [
          {
            op: "handRefresh",
            who: "both",
            toBottom: true,
            onlyIfAnyMoved: true,
            draw: { kind: "coinFlip", heads: 6, tails: 3 },
          },
        ],
      },
    },
    {
      name: "Arven's Sandwich",
      ids: [SANDWICH],
      subtype: "Item",
      program: {
        trainer: [
          {
            op: "conditionGate",
            cond: { kind: "yourActiveOwner", owner: "Arven" },
            then: [{ op: "heal", target: "self", amount: 100 }],
            otherwise: [{ op: "heal", target: "self", amount: 30 }],
          },
        ],
      },
    },
    {
      name: "Megaton Blower",
      ids: [MEGATON],
      subtype: "Item",
      program: {
        trainer: [
          { op: "discardTools", count: "all" },
          {
            op: "discardEnergy",
            from: "opponentEach",
            filter: { kind: "specialEnergy" },
            count: "all",
          },
          { op: "discardStadium" },
        ],
      },
    },
    {
      name: "Brilliant Blender",
      ids: [BLENDER],
      subtype: "Item",
      program: {
        trainer: [
          { op: "searchDeck", filter: { kind: "anyCard" }, dest: "discard", max: 5 },
          { op: "shuffleDeck" },
        ],
      },
    },
    {
      name: "TM Machine",
      ids: [TM_MACHINE],
      subtype: "Item",
      program: {
        trainer: [
          {
            op: "searchDeck",
            filter: { kind: "toolNameContaining", fragment: "Technical Machine" },
            dest: "hand",
            max: 3,
            reveal: true,
          },
          { op: "shuffleDeck" },
        ],
      },
    },
    {
      name: "Dusk Ball",
      ids: [DUSK_BALL],
      subtype: "Item",
      program: {
        trainer: [
          {
            op: "lookAtTopN",
            n: 7,
            from: "bottom",
            filter: { kind: "anyPokemon" },
            max: 1,
            reveal: true,
          },
          { op: "shuffleDeck" },
        ],
      },
    },
    {
      name: "Tool Scrapper",
      ids: [SCRAPPER],
      subtype: "Item",
      program: { trainer: [{ op: "discardTools", count: 2, sides: "both" }] },
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
describe("D557 §2 — Morty's Conviction: `drawCards.per` reads the OPPONENT's Bench at resolve", () => {
  it('a hand holding Morty ALONE is refused — the printed "another card"', () => {
    const board = setHand(table(), "p1", [MORTY[0]]);
    expectErr(
      board,
      { type: "playTrainer", seat: "p1", uid: board.players.p1.hand[0] as string },
      "PLAY_CONDITION_NOT_MET",
    );
  });

  it("pays 1, then draws ONE PER opponent's Benched Pokémon (3 → 3)", () => {
    const board = table(FILLER, [], FILLER, [FILLER, FILLER, FILLER]);
    const { state, events, before } = play(board, MORTY[0], [TOOL]);
    expect(state.phase.kind).toBe("turn:action");
    expect(state.players.p1.discard.map((u) => state.cardIdByUid[u])).toContain(TOOL);
    expect(all(events, "CARDS_DRAWN").map((e) => e.uids.length)).toEqual([3]);
    expect(state.players.p1.hand).toHaveLength(3);
    expect(before.players.p1.hand).toHaveLength(2);
  });

  it("it counts the OPPONENT's Bench, never your own (own 4, theirs 1 → draws 1)", () => {
    const board = table(FILLER, [FILLER, FILLER, FILLER, FILLER], FILLER, [FILLER]);
    const { events } = play(board, MORTY[1], [TOOL]);
    expect(all(events, "CARDS_DRAWN").map((e) => e.uids.length)).toEqual([1]);
  });

  it("an EMPTY opponent Bench draws 0 and files no draw row — the cost is still paid", () => {
    const { state, events } = play(table(), MORTY[2], [TOOL]);
    expect(all(events, "CARDS_DRAWN")).toEqual([]);
    expect(state.players.p1.hand).toEqual([]);
    expect(state.players.p1.discard.map((u) => state.cardIdByUid[u])).toContain(TOOL);
  });

  it("`per` RIDES the parked cost's `rest`: a JSON round trip of the parked state still draws per the OPPONENT's Bench", () => {
    const board = table(FILLER, [FILLER, FILLER, FILLER], FILLER, [FILLER, FILLER]);
    const { state: parked, before } = play(board, MORTY[0], [TOOL, "fix-energy"]);
    if (parked.phase.kind !== "effect:choose")
      throw new Error(`expected a park, got ${parked.phase.kind}`);
    expect(parked.phase.cont.pendingOp).toEqual({ op: "payFromHand", count: 1, to: "discard" });
    expect(parked.phase.cont.rest).toEqual([
      { op: "drawCards", count: 1, per: { kind: "opponentBenchCount" } },
    ]);
    const revived = roundTrip(parked);
    expect(revived).toEqual(parked);
    const tool = before.players.p1.hand.find((u) => before.cardIdByUid[u] === TOOL) as string;
    const resumed = mustApply(revived, cards([tool]));
    expect(resumed.state).toEqual(mustApply(parked, cards([tool])).state);
    expect(resumed.state.phase.kind).toBe("turn:action");
    // own Bench 3, theirs 2 → draws 2
    expect(all(resumed.events, "CARDS_DRAWN").map((e) => e.uids.length)).toEqual([2]);
    expect(resumed.state.players.p1.discard.map((u) => resumed.state.cardIdByUid[u])).toContain(
      TOOL,
    );
    expect(resumed.state.players.p1.hand.map((u) => resumed.state.cardIdByUid[u])).toContain(
      "fix-energy",
    );
    expect(resumed.state.players.p1.hand).toHaveLength(1 + 2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D557 §3 — Xerosic's Machinations: the OWNER discards DOWN TO 3", () => {
  const withOppHand = (n: number) =>
    setHand(
      table(),
      "p2",
      Array.from({ length: n }, () => FILLER),
    );

  it("a hand of 7 PARKS a mandatory pick of exactly 4, answered by the OWNER", () => {
    const { state } = play(withOppHand(7), XEROSIC[0]);
    const p = effectPrompt(state);
    if (p?.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect([p.min, p.max]).toEqual([4, 4]);
    expect(p.candidates).toEqual(state.players.p2.hand);
    expect(p.note).toBe("Discard cards from your hand until you have 3 cards in your hand.");
    if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(state.phase.answerer).toBe("p2");
  });

  it("the OWNER answers and ends at 3; the controller's frame is refused", () => {
    const parked = play(withOppHand(7), XEROSIC[1]).state;
    const picks = parked.players.p2.hand.slice(0, 4);
    expect(applyAction(parked, cards(picks, "p1")).ok).toBe(false);
    const { state } = mustApply(parked, cards(picks, "p2"));
    expect(state.players.p2.hand).toHaveLength(3);
    expect(state.players.p2.discard.slice(-4)).toEqual(picks);
  });

  it("a hand of 4 takes exactly 1", () => {
    const p = effectPrompt(play(withOppHand(4), XEROSIC[0]).state);
    if (p?.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect([p.min, p.max]).toEqual([1, 1]);
  });

  it("a hand of 3 or fewer does NOTHING and never parks", () => {
    for (const n of [3, 2, 0]) {
      const { state, events, before } = play(withOppHand(n), XEROSIC[0]);
      expect(state.phase.kind, `${n}`).toBe("turn:action");
      expect(types(events), `${n}`).toEqual(["TRAINER_PLAYED"]);
      expect(state.players.p2.hand, `${n}`).toEqual(before.players.p2.hand);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D557 §4 — Lucian: each player flips their OWN coin (heads 6 / tails 3)", () => {
  const both = (n1: number, n2: number) =>
    setHand(
      setHand(
        table(),
        "p1",
        Array.from({ length: n1 }, () => FILLER),
      ),
      "p2",
      Array.from({ length: n2 }, () => FILLER),
    );

  function lucian(board: GameState, cursor: number) {
    const before = setHand(board, "p1", [
      LUCIAN[0],
      ...board.players.p1.hand.map((u) => board.cardIdByUid[u] as string),
    ]);
    const primed = { ...before, rngState: cursor };
    return {
      before: primed,
      ...mustApply(primed, {
        type: "playTrainer",
        seat: "p1",
        uid: primed.players.p1.hand[0] as string,
      }),
    };
  }
  /** Lucian played on `board` from the first cursor whose TWO flips (taken after the two
      hand shuffles spend their own rng) land on `first` then `second`. */
  function lucianFaces(board: GameState, first: "heads" | "tails", second: "heads" | "tails") {
    for (let n = 1; n < 500; n++) {
      const run = lucian(board, n);
      const faces = all(run.events, "ATTACK_EFFECT_COIN_FLIP").map((f) => f.result);
      if (faces[0] === first && faces[1] === second) return run;
    }
    throw new Error("no cursor");
  }

  it("both hands go UNDER the decks, then ONE flip per seat, CONTROLLER FIRST (R-L1), and the faces decide", () => {
    for (const [a, b] of [
      ["heads", "tails"],
      ["tails", "heads"],
    ] as const) {
      const { state, events } = lucianFaces(both(2, 4), a, b);
      const flips = all(events, "ATTACK_EFFECT_COIN_FLIP");
      expect(flips.map((f) => [f.seat, f.result])).toEqual([
        ["p1", a],
        ["p2", b],
      ]);
      expect(state.players.p1.hand).toHaveLength(a === "heads" ? 6 : 3);
      expect(state.players.p2.hand).toHaveLength(b === "heads" ? 6 : 3);
      expect(types(events).filter((t) => t === "HAND_TO_BOTTOM_OF_DECK")).toHaveLength(2);
    }
  });

  it("each seat's draw follows ITS OWN coin — a shared flip would give both the same count", () => {
    const { state } = lucianFaces(both(1, 1), "heads", "tails");
    expect([state.players.p1.hand.length, state.players.p2.hand.length]).toEqual([6, 3]);
  });

  it('only ONE hand non-empty still counts as "either player put any cards": both flip, both draw', () => {
    const { events, state } = lucianFaces(both(0, 3), "tails", "tails");
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(2);
    expect([state.players.p1.hand.length, state.players.p2.hand.length]).toEqual([3, 3]);
  });

  it("NEITHER hand moved a card: no flips, no draws, no rng spent", () => {
    const { events, state, before } = lucian(both(0, 0), cursorFor("heads"));
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toEqual([]);
    expect(all(events, "CARDS_DRAWN")).toEqual([]);
    expect(state.rngState).toBe(before.rngState);
  });

  it("replay-deterministic: the same board and cursor give the same log and the same board", () => {
    const one = lucian(both(2, 5), 4242);
    const two = lucian(both(2, 5), 4242);
    expect(two.events).toEqual(one.events);
    expect(two.state).toEqual(one.state);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('D557 §5 — Arven\'s Sandwich: `yourActiveOwner`, and "instead" is a REPLACEMENT', () => {
  const cond: BoardCondition = { kind: "yourActiveOwner", owner: "Arven" };

  it("conditionHolds both ways, on the PREFIX rule (\"Arven's Friend\" is not an Arven's Pokémon)", () => {
    expect(conditionHolds(table(ARVEN), "p1", cond)).toBe(true);
    expect(conditionHolds(table(FILLER), "p1", cond)).toBe(false);
    expect(conditionHolds(table(ARVENISH), "p1", cond)).toBe(false);
    expect(conditionHolds(table(FILLER, [], ARVEN), "p1", cond)).toBe(false);
    const empty = {
      ...table(ARVEN),
      players: { ...table(ARVEN).players, p1: { ...table(ARVEN).players.p1, active: null } },
    };
    expect(conditionHolds(empty, "p1", cond)).toBe(false);
  });

  it("the note is the printed clause with the printed article", () => {
    expect(conditionNote(cond)).toBe("your Active Pokémon is an Arven's Pokémon");
  });

  it("an Arven's Active damaged 150 heals 100 — ONE heal, never 30 + 70 or 130", () => {
    const { state, events } = play(setDamage(table(ARVEN), "p1", 150), SANDWICH);
    expect(state.players.p1.active?.damage).toBe(50);
    expect(all(events, "HEALED").map((e) => e.amount)).toEqual([100]);
  });

  it("the non-Arven CONTROL on the same damage heals 30", () => {
    const { state, events } = play(setDamage(table(FILLER), "p1", 150), SANDWICH);
    expect(state.players.p1.active?.damage).toBe(120);
    expect(all(events, "HEALED").map((e) => e.amount)).toEqual([30]);
  });

  it("an Arven's Active damaged 60 heals 60 (the clamp), still one row", () => {
    const { events } = play(setDamage(table(ARVEN), "p1", 60), SANDWICH);
    expect(all(events, "HEALED").map((e) => e.amount)).toEqual([60]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D557 §6 — Megaton Blower: three sweeps, no question, refused only when ALL whiff", () => {
  function loaded(): GameState {
    let state = table(FILLER, [], FILLER, [FILLER, "fix-unnerve"]);
    state = attachToolFromDeck(ensureInDeck(state, "p2", TOOL), "p2", "active", TOOL);
    state = attachToolFromDeck(ensureInDeck(state, "p2", TOOL), "p2", 0, TOOL);
    state = attachToolFromDeck(ensureInDeck(state, "p2", TM_A), "p2", 1, TM_A);
    state = attachFromDeck(ensureInDeck(state, "p2", "fix-special"), "p2", "fix-special", 1);
    state = attachBenchFromDeck(
      ensureInDeck(state, "p2", "fix-special"),
      "p2",
      1,
      "fix-special",
      1,
    );
    state = attachToolFromDeck(ensureInDeck(state, "p1", TOOL), "p1", "active", TOOL);
    const stadium = ensureInDeck(state, "p1", "fix-stadium");
    const uid = stadium.players.p1.deck.find(
      (u) => stadium.cardIdByUid[u] === "fix-stadium",
    ) as string;
    return {
      ...stadium,
      stadium: { uid, owner: "p1" },
      players: {
        ...stadium.players,
        p1: { ...stadium.players.p1, deck: stadium.players.p1.deck.filter((u) => u !== uid) },
      },
    };
  }

  it("strips every unshielded opponent Tool and Special Energy INLINE, and discards the Stadium — no park", () => {
    const { state, events } = play(loaded(), MEGATON);
    expect(state.phase.kind).toBe("turn:action");
    expect(toolsOn(state, "p2", "active")).toEqual([]);
    expect(toolsOn(state, "p2", 0)).toEqual([]);
    expect(state.players.p2.active?.energy).toEqual([]);
    expect(state.stadium).toBeNull();
    expect(all(events, "TOOLS_DISCARDED").map((e) => e.seat)).toEqual(["p2", "p2"]);
    expect(
      state.players.p2.discard.map((u) => state.cardIdByUid[u]).filter((id) => id === TOOL),
    ).toHaveLength(2);
  });

  it("the SHIELDED body (preventTrainerEffects) keeps its Tool AND its Special Energy; YOUR own Tool is untouched", () => {
    const { state, events } = play(loaded(), MEGATON);
    expect(toolsOn(state, "p2", 1)).toEqual([TM_A]);
    expect(state.players.p2.bench[1]?.energy).toHaveLength(1);
    expect(toolsOn(state, "p1", "active")).toEqual([TOOL]);
    expect(all(events, "TRAINER_EFFECT_PREVENTED").length).toBeGreaterThan(0);
  });

  it("the three are ALTERNATIVES: a board with ONLY a Tool, ONLY a Special Energy or ONLY a Stadium plays", () => {
    let onlyTool = table();
    onlyTool = attachToolFromDeck(ensureInDeck(onlyTool, "p2", TOOL), "p2", "active", TOOL);
    expect(toolsOn(play(onlyTool, MEGATON).state, "p2", "active")).toEqual([]);
    let onlyEnergy = table();
    onlyEnergy = attachFromDeck(
      ensureInDeck(onlyEnergy, "p2", "fix-special"),
      "p2",
      "fix-special",
      1,
    );
    expect(play(onlyEnergy, MEGATON).state.players.p2.active?.energy).toEqual([]);
    const base = table();
    const withStadium = ensureInDeck(base, "p2", "fix-stadium");
    const uid = withStadium.players.p2.deck.find(
      (u) => withStadium.cardIdByUid[u] === "fix-stadium",
    ) as string;
    expect(
      play({ ...withStadium, stadium: { uid, owner: "p2" } }, MEGATON).state.stadium,
    ).toBeNull();
  });

  it("…and a board with NONE of the three is refused (NO_LEGAL_TARGET), the card kept", () => {
    const board = setHand(table(), "p1", [MEGATON]);
    expectErr(
      board,
      { type: "playTrainer", seat: "p1", uid: board.players.p1.hand[0] as string },
      "NO_LEGAL_TARGET",
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D557 §7 — Brilliant Blender: up to 5 cards to the DISCARD PILE, then the shuffle", () => {
  it('parks an up-to-5 pick over the WHOLE deck with `dest: "discard"` and the printed caption', () => {
    const { state } = play(table(), BLENDER);
    const p = effectPrompt(state);
    if (p?.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect([p.min, p.max, p.dest]).toEqual([0, 5, "discard"]);
    expect(p.candidates).toEqual(state.players.p1.deck);
    expect(p.note).toBe("Search your deck for up to 5 cards and discard them.");
  });

  it("the picks land in the CONTROLLER's discard pile (not the hand), named in the log, then SHUFFLE", () => {
    const parked = play(table(), BLENDER).state;
    const picks = parked.players.p1.deck.slice(0, 5);
    const { state, events } = mustApply(parked, cards(picks));
    expect(state.players.p1.discard.slice(-5)).toEqual(picks);
    expect(state.players.p1.hand).toEqual([]);
    expect(find(events, "DECK_SEARCHED")).toMatchObject({
      seat: "p1",
      dest: "discard",
      uids: picks,
    });
    expect(types(events)).toContain("SHUFFLE");
    const row = render(events, state).find((r) => r.text.startsWith("searched their deck"));
    expect(row?.text.startsWith("searched their deck — discarded ")).toBe(true);
  });

  it("a decline discards nothing and still shuffles", () => {
    const parked = play(table(), BLENDER).state;
    const { state, events } = mustApply(parked, cards([]));
    expect(state.players.p1.discard).toEqual(parked.players.p1.discard);
    expect(types(events)).toContain("SHUFFLE");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D557 §8 — TM Machine: `toolNameContaining`, a TOOL whose name holds the fragment", () => {
  const filter: CardFilter = { kind: "toolNameContaining", fragment: "Technical Machine" };

  it("matches a Technical Machine TOOL; refuses a plain Tool AND a same-fragment ITEM (the head noun)", () => {
    expect(matchesFilter(POOL[TM_A], filter)).toBe(true);
    expect(matchesFilter(POOL[TM_B], filter)).toBe(true);
    expect(matchesFilter(POOL[TOOL], filter)).toBe(false);
    expect(matchesFilter(POOL[TM_ITEM], filter)).toBe(false);
    expect(matchesFilter(POOL[FILLER], filter)).toBe(false);
  });

  it("offers ONLY the Technical Machine Tools, up to 3, revealed, with the printed noun in the caption", () => {
    let board = table();
    for (const id of [TM_A, TM_B]) board = ensureInDeck(board, "p1", id);
    const { state } = play(board, TM_MACHINE);
    const p = effectPrompt(state);
    if (p?.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(new Set(p.candidates.map((u) => idOf(state, u)))).toEqual(new Set([TM_A, TM_B]));
    expect(p.candidates).toHaveLength(3);
    expect([p.min, p.max, p.dest]).toEqual([0, 3, "hand"]);
    expect(p.note).toBe(
      'Search your deck for up to 3 Pokémon Tool cards that have "Technical Machine" in their name into your hand.',
    );
    const { events } = mustApply(state, cards(p.candidates.slice(0, 2)));
    expect(find(events, "DECK_SEARCHED")).toMatchObject({ dest: "hand", reveal: true });
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D557 §9 — Dusk Ball: the BOTTOM 7, never the top", () => {
  /** p1 holds ONLY Dusk Ball, and its deck holds exactly ONE Pokémon, at the top or at the
      bottom (the other Pokémon are parked in the discard pile — test surgery, every uid in
      exactly one zone). */
  function deckWithPokemonAt(at: "top" | "bottom") {
    const board = setHand(table(), "p1", [DUSK_BALL]);
    const side = board.players.p1;
    const pokemon = side.deck.filter(
      (u) => POOL[board.cardIdByUid[u] ?? ""]?.category === "Pokemon",
    );
    const rest = side.deck.filter((u) => !pokemon.includes(u));
    const one = pokemon[0] as string;
    const deck = at === "top" ? [one, ...rest] : [...rest, one];
    const primed: GameState = {
      ...board,
      players: {
        ...board.players,
        p1: { ...side, deck, discard: [...side.discard, ...pokemon.slice(1)] },
      },
    };
    return mustApply(primed, { type: "playTrainer", seat: "p1", uid: side.hand[0] as string });
  }

  it("a Pokémon at the BOTTOM is offered, with the bottom caption", () => {
    const { state } = deckWithPokemonAt("bottom");
    const p = effectPrompt(state);
    if (p?.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(p.candidates).toHaveLength(1);
    expect(p.note).toBe(
      "Look at the bottom 7 cards of your deck and put a Pokémon into your hand.",
    );
  });

  it('a Pokémon on TOP is NOT offered — the look whiffs and says "bottom" in the log', () => {
    const { state, events } = deckWithPokemonAt("top");
    expect(state.phase.kind).toBe("turn:action");
    expect(find(events, "DECK_TOP_REVEALED")).toMatchObject({ uids: [], from: "bottom" });
    expect(render(events, state).map((r) => r.text)).toContain(
      "looked at the bottom of their deck — took nothing",
    );
    expect(types(events)).toContain("SHUFFLE");
  });

  it("taking it puts it in hand, reveals it, and shuffles", () => {
    const parked = deckWithPokemonAt("bottom").state;
    const p = effectPrompt(parked);
    if (p?.kind !== "chooseCards") throw new Error("expected chooseCards");
    const { state, events } = mustApply(parked, cards(p.candidates));
    expect(state.players.p1.hand).toEqual(p.candidates);
    expect(find(events, "DECK_TOP_REVEALED")).toMatchObject({ reveal: true, from: "bottom" });
    expect(types(events)).toContain("SHUFFLE");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D557 §10 — Tool Scrapper: up to 2 Tools off EITHER side", () => {
  function tooled(opts: { ownShielded?: boolean } = {}): GameState {
    let state = table(opts.ownShielded === true ? "fix-unnerve" : FILLER, [], "fix-unnerve", [
      FILLER,
    ]);
    state = attachToolFromDeck(ensureInDeck(state, "p1", TOOL), "p1", "active", TOOL);
    state = attachToolFromDeck(ensureInDeck(state, "p2", TM_A), "p2", "active", TM_A);
    state = attachToolFromDeck(ensureInDeck(state, "p2", TOOL), "p2", 0, TOOL);
    return state;
  }

  it("the offer walks BOTH boards (yours first), each Tool paired with its OWN seat's body; the caption is the print", () => {
    const { state } = play(tooled(), SCRAPPER);
    const p = effectPrompt(state);
    if (p?.kind !== "discardTools") throw new Error("expected discardTools");
    expect(p.discardable.map((d) => [d.from.seat, d.from.spot.spot, idOf(state, d.uid)])).toEqual([
      ["p1", "active", TOOL],
      ["p2", "bench", TOOL],
    ]);
    expect(p.scope).toEqual({ kind: "upTo", max: 2 });
    expect(p.note).toBe(
      "Choose up to 2 Pokémon Tools attached to Pokémon (yours or your opponent's) and discard them.",
    );
  });

  it("the opponent's SHIELDED Active is not offered; YOUR OWN shielded Active is — your own Tools are never shielded", () => {
    const { state, events } = play(tooled({ ownShielded: true }), SCRAPPER);
    const p = effectPrompt(state);
    if (p?.kind !== "discardTools") throw new Error("expected discardTools");
    const offered = p.discardable.map((d) => `${d.from.seat}:${d.from.spot.spot}`);
    expect(offered).toContain("p1:active");
    expect(offered).not.toContain("p2:active");
    expect(all(events, "TRAINER_EFFECT_PREVENTED").map((e) => e.seat)).toEqual(["p2"]);
  });

  it("a pick spanning BOTH boards sends each Tool to ITS OWNER's pile, one row per host under the victim's seat", () => {
    const parked = play(tooled(), SCRAPPER).state;
    const p = effectPrompt(parked);
    if (p?.kind !== "discardTools") throw new Error("expected discardTools");
    const { state, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardTools", uids: p.discardable.map((d) => d.uid) },
    });
    expect(toolsOn(state, "p1", "active")).toEqual([]);
    expect(toolsOn(state, "p2", 0)).toEqual([]);
    expect(all(events, "TOOLS_DISCARDED").map((e) => [e.seat, e.actor])).toEqual([
      ["p1", "p1"],
      ["p2", "p1"],
    ]);
    expect(state.players.p1.discard.map((u) => state.cardIdByUid[u])).toContain(TOOL);
    expect(state.players.p2.discard.map((u) => state.cardIdByUid[u])).toContain(TOOL);
  });

  it("the wire carries the own-side ref and the schema parses it", () => {
    const parked = play(tooled(), SCRAPPER).state;
    const wire = redactGame(parked, "p1");
    if (wire.phase.kind !== "effect:choose" || wire.phase.prompt === null)
      throw new Error("expected a prompt");
    expect(redactedEffectPromptSchema.safeParse(wire.phase.prompt).success).toBe(true);
    expect(JSON.stringify(wire.phase.prompt)).toContain('"seat":"p1"');
  });

  it("…and a board with NO Tool on either side is refused (NO_LEGAL_TARGET)", () => {
    const board = setHand(table(), "p1", [SCRAPPER]);
    expectErr(
      board,
      { type: "playTrainer", seat: "p1", uid: board.players.p1.hand[0] as string },
      "NO_LEGAL_TARGET",
    );
  });

  it("`MATCH_RECORD_VERSION` holds: the parked op round-trips through JSON and resolves identically", () => {
    const parked = play(tooled(), SCRAPPER).state;
    const revived = roundTrip(parked);
    const p = effectPrompt(parked);
    if (p?.kind !== "discardTools") throw new Error("expected discardTools");
    const answer: GameAction = {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardTools", uids: [p.discardable[0]?.uid as string] },
    };
    expect(mustApply(revived, answer).state).toEqual(mustApply(parked, answer).state);
  });
});

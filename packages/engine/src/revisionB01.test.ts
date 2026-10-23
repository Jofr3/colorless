import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import { applyAction, createGame } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  discardFromDeck,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  setPrizes,
  toDeckTop,
  trainerCard,
  must,
} from "./testFixtures";

const JUDGE_IDS = ["sv01-176", "sv04.5-228", "sv10-167", "sv10-222", "me03-076"] as const;
const JUDGE_TEXT = "Each player shuffles their hand into their deck and draws 4 cards.";
const ROSA = "me03-084";
const ROSA_TEXT =
  "You can use this card only if you have more Prize cards remaining than your opponent.\n\nAttach up to 2 Basic Energy cards from your discard pile to 1 of your Stage 2 Pokémon.";
const PP_UP = "sv09-153";
const PP_UP_TEXT =
  "Attach a Basic Energy card from your discard pile to 1 of your Benched N's Pokémon.";
const GRIMSLEY = "me02-090";
const GRIMSLEY_TEXT =
  "Look at the top 7 cards of your deck and put a {D} Pokémon you find there onto your Bench. Shuffle the other cards and put them on the bottom of your deck. You can't use this card during your first turn.";

const BASIC = "b01-basic";
const S1 = "b01-stage1";
const S2 = "b01-stage2";
const N_MON = "b01-n-mon";
const DARK = "b01-dark";
const FILLER = "b01-filler";

const mon = (id: string, name: string, type: string, extra: Partial<Card> = {}): Card =>
  battler(id, {
    name,
    hp: 200,
    types: [type],
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
    ...extra,
  });
const trainer = (id: string, name: string, text: string): Card => ({
  ...trainerCard(id, "Supporter", text),
  name,
});

const LOCAL: Record<string, Card> = {
  ...Object.fromEntries(JUDGE_IDS.map((id) => [id, trainer(id, "Judge", JUDGE_TEXT)])),
  [ROSA]: trainer(ROSA, "Rosa's Encouragement", ROSA_TEXT),
  [PP_UP]: { ...trainerCard(PP_UP, "Item", PP_UP_TEXT), name: "N's PP Up" },
  [GRIMSLEY]: trainer(GRIMSLEY, "Grimsley's Move", GRIMSLEY_TEXT),
  [BASIC]: mon(BASIC, "B01 Basic", "Colorless"),
  [S1]: mon(S1, "B01 Stage 1", "Colorless", { stage: "Stage1", evolveFrom: "B01 Basic" }),
  [S2]: mon(S2, "B01 Stage 2", "Colorless", { stage: "Stage2", evolveFrom: "B01 Stage 1" }),
  [N_MON]: mon(N_MON, "N's B01", "Psychic"),
  [DARK]: mon(DARK, "B01 Dark", "Darkness"),
  [FILLER]: mon(FILLER, "B01 Filler", "Colorless", { hp: 400 }),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  ...Object.fromEntries(JUDGE_IDS.map((id) => [id, 1])),
  [ROSA]: 1,
  [PP_UP]: 1,
  [GRIMSLEY]: 1,
  [BASIC]: 6,
  [S1]: 2,
  [S2]: 2,
  [N_MON]: 2,
  [DARK]: 2,
  [FILLER]: 10,
  "fix-water-energy": 5,
  "fix-fire-energy": 5,
  "fix-psychic-energy": 5,
  "fix-energy": 13,
});

function p1Turn(): GameState {
  const created = createGame({ seed: 1010, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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
    const uid = state.players[s].hand.find(
      (h) => POOL[state.cardIdByUid[h] ?? ""]?.stage === "Basic",
    );
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const)
    state = must(applyAction(state, { type: "setupReady", seat: s }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  if (state.turn !== 4) throw new Error(`expected turn 4, got ${state.turn}`);
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    const pile = [...side.deck, ...side.hand, ...side.prizes, ...side.discard];
    const prizes = pile.filter((u) => state.cardIdByUid[u] === "fix-energy").slice(0, 6);
    state = {
      ...state,
      players: {
        ...state.players,
        [s]: {
          ...side,
          hand: [],
          discard: [],
          prizes,
          deck: pile.filter((u) => !prizes.includes(u)),
        },
      },
    };
  }
  return state;
}

/** P1's Active is `active` and P1's Bench is exactly `bench`; P2's Active is a Filler, no Bench. */
function board(active: string, bench: readonly string[]): GameState {
  let state = clearBench(setActiveFromDeck(p1Turn(), "p1", active), "p1");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  return clearBench(setActiveFromDeck(state, "p2", FILLER), "p2");
}

const idOf = (state: GameState, uid: string | undefined) =>
  uid === undefined ? undefined : state.cardIdByUid[uid];
const ids = (state: GameState, uids: readonly string[]) => uids.map((u) => idOf(state, u));

function staged(state: GameState, id: string): { state: GameState; uid: string } {
  const next = handFromDeck(state, "p1", id, 1);
  return { state: next, uid: next.players.p1.hand.find((u) => idOf(next, u) === id) as string };
}
function play(state: GameState, id: string): { state: GameState; events: GameEvent[] } {
  const { state: next, uid } = staged(state, id);
  return mustApply(next, { type: "playTrainer", seat: "p1", uid });
}
function prompt(state: GameState) {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  return state.phase.prompt;
}
const bench = (index: number, seat: Seat = "p1") =>
  ({ seat, spot: { spot: "bench", index } }) as const;
const pick = (ref: unknown, take?: number): GameAction =>
  ({
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemon", ref, ...(take === undefined ? {} : { take }) },
  }) as GameAction;
const cards = (uids: readonly string[]): GameAction => ({
  type: "resolveEffect",
  seat: "p1",
  choice: { kind: "cards", uids: [...uids] },
});

/** The uids of `cardId` in P1's discard pile, in pile order. */
const inDiscard = (state: GameState, cardId: string) =>
  state.players.p1.discard.filter((u) => idOf(state, u) === cardId);

describe("B01 §1 — Judge: every Standard-legal printing runs the one program", () => {
  it("all five printings resolve to ONE program object, the both-players refresh to 4", () => {
    const program = programFor("sv01-176");
    expect(program).toEqual({
      trainer: [{ op: "handRefresh", who: "both", draw: { kind: "fixed", count: 4 } }],
    });
    for (const id of JUDGE_IDS) expect(programFor(id), id).toBe(program);
  });

  it.each(["sv04.5-228", "sv10-167", "sv10-222"])(
    "%s is played: each hand shuffled in, each player draws 4",
    (id) => {
      let state = board(BASIC, []);
      state = handFromDeck(state, "p1", "fix-fire-energy", 2);
      state = handFromDeck(
        handFromDeck(state, "p2", "fix-water-energy", 3),
        "p2",
        "fix-psychic-energy",
        3,
      );
      const { state: done, events } = play(state, id);
      expect(done.phase.kind).toBe("turn:action");
      expect(done.players.p1.hand).toHaveLength(4);
      expect(done.players.p2.hand).toHaveLength(4);
      expect(done.players.p1.discard.map((u) => idOf(done, u))).toEqual([id]);
      const shuffled = events.filter((e) => e.type === "HAND_SHUFFLED_INTO_DECK");
      expect(shuffled).toMatchObject([
        { seat: "p1", count: 2 },
        { seat: "p2", count: 6 },
      ]);
    },
  );
});

describe("B01 §2 — Rosa's Encouragement: the player picks WHICH Basic Energy cards", () => {
  /** P1: a Basic Active, a Stage 1 and a Stage 2 benched; discard [{R}, {W}, {P}, {P}];
      P2 has 5 Prizes against P1's 6, so P1 is behind. */
  function rosaBoard(): GameState {
    let state = board(BASIC, [S1, S2]);
    state = discardFromDeck(state, "p1", "fix-fire-energy", 1);
    state = discardFromDeck(state, "p1", "fix-water-energy", 1);
    state = discardFromDeck(state, "p1", "fix-psychic-energy", 2);
    return setPrizes(state, "p2", 5);
  }

  it("after the Stage 2 is picked, asks which 2 of the 4 mixed Basic Energy go on it, and attaches those", () => {
    const parked = play(rosaBoard(), ROSA).state;
    const target = prompt(parked);
    expect(target).toMatchObject({ kind: "choosePokemon", candidates: [bench(1)], upTo: 2 });
    const choosing = mustApply(parked, pick(bench(1))).state;
    // The board has not moved yet: the Energy is still in the discard.
    expect(choosing.players.p1.bench[1]?.energy).toEqual([]);
    const p = prompt(choosing);
    if (p.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${p.kind}`);
    expect(p).toMatchObject({ min: 2, max: 2, dest: "attach" });
    // Every Basic Energy card in the pile, in pile order (Rosa herself is not one).
    expect(ids(choosing, p.candidates)).toEqual([
      "fix-fire-energy",
      "fix-water-energy",
      "fix-psychic-energy",
      "fix-psychic-energy",
    ]);
    const psychic = inDiscard(choosing, "fix-psychic-energy");
    const { state: done, events } = mustApply(choosing, cards(psychic));
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p1.bench[1]?.energy).toEqual(psychic);
    expect(ids(done, done.players.p1.discard)).toEqual([
      "fix-fire-energy",
      "fix-water-energy",
      ROSA,
    ]);
    expect(events.filter((e) => e.type === "ENERGY_ATTACHED")).toHaveLength(2);
  });

  it("a take of 1 asks for exactly 1 card; a pick outside the pile or of the wrong size is refused", () => {
    const parked = play(rosaBoard(), ROSA).state;
    const choosing = mustApply(parked, pick(bench(1), 1)).state;
    const p = prompt(choosing);
    expect(p).toMatchObject({ kind: "chooseCards", min: 1, max: 1, dest: "attach" });
    const water = inDiscard(choosing, "fix-water-energy");
    expect(applyAction(choosing, cards([])).ok).toBe(false);
    expect(
      applyAction(choosing, cards([...water, ...inDiscard(choosing, "fix-fire-energy")])).ok,
    ).toBe(false);
    const done = mustApply(choosing, cards(water)).state;
    expect(done.players.p1.bench[1]?.energy).toEqual(water);
  });

  it("no card question when the pick is no decision: one Energy type, or a pile no bigger than the take", () => {
    // Three {P}: fungible, so the two leading ones land with no second prompt.
    let same = board(BASIC, [S2]);
    same = setPrizes(discardFromDeck(same, "p1", "fix-psychic-energy", 3), "p2", 5);
    const sameDone = mustApply(play(same, ROSA).state, pick(bench(0))).state;
    expect(sameDone.phase.kind).toBe("turn:action");
    expect(ids(sameDone, sameDone.players.p1.bench[0]?.energy ?? [])).toEqual([
      "fix-psychic-energy",
      "fix-psychic-energy",
    ]);
    // {R} + {W} against a take of 2: both go, whatever the player would pick.
    let both = board(BASIC, [S2]);
    both = discardFromDeck(
      discardFromDeck(both, "p1", "fix-fire-energy", 1),
      "p1",
      "fix-water-energy",
      1,
    );
    both = setPrizes(both, "p2", 5);
    const bothDone = mustApply(play(both, ROSA).state, pick(bench(0))).state;
    expect(bothDone.phase.kind).toBe("turn:action");
    expect(ids(bothDone, bothDone.players.p1.bench[0]?.energy ?? [])).toEqual([
      "fix-fire-energy",
      "fix-water-energy",
    ]);
  });

  it("the decline at the target prompt still attaches nothing and asks nothing more", () => {
    const parked = play(rosaBoard(), ROSA).state;
    const declined = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon" },
    } as GameAction).state;
    expect(declined.phase.kind).toBe("turn:action");
    expect(declined.players.p1.bench[1]?.energy).toEqual([]);
  });

  it("N's PP Up (the mandatory, forced-target arm of the same op): one N's body, so only the card is asked", () => {
    let state = board(BASIC, [N_MON]);
    state = discardFromDeck(
      discardFromDeck(state, "p1", "fix-fire-energy", 1),
      "p1",
      "fix-water-energy",
      1,
    );
    const parked = play(state, PP_UP).state;
    const p = prompt(parked);
    if (p.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${p.kind}`);
    expect(p).toMatchObject({ min: 1, max: 1, dest: "attach" });
    expect(ids(parked, p.candidates)).toEqual(["fix-fire-energy", "fix-water-energy"]);
    const water = inDiscard(parked, "fix-water-energy");
    const done = mustApply(parked, cards(water)).state;
    expect(done.players.p1.bench[0]?.energy).toEqual(water);
    expect(ids(done, done.players.p1.discard)).toEqual(["fix-fire-energy", PP_UP]);
  });
});

describe("B01 §3 — Grimsley's Move: a full Bench is offered nothing", () => {
  /** `benched` Fillers on the Bench; the top 7 of the deck: a Basic {D} Pokémon, then six Energy. */
  function grimsleyBoard(benched: number): GameState {
    let state = board(BASIC, Array(benched).fill(FILLER));
    state = toDeckTop(state, "p1", "fix-fire-energy", 3);
    state = toDeckTop(state, "p1", "fix-water-energy", 3);
    state = toDeckTop(state, "p1", DARK, 1);
    return state;
  }

  it("with 5 benched, the look happens, nothing is offered, and all 7 go under the deck", () => {
    const state = grimsleyBoard(5);
    const top = state.players.p1.deck.slice(0, 7);
    expect(idOf(state, top[0])).toBe(DARK);
    const { state: done, events } = play(state, GRIMSLEY);
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p1.bench).toHaveLength(5);
    // Every card looked at is still in the deck (Grimsley's Move itself was drawn out of it to be played).
    expect(done.players.p1.deck).toHaveLength(state.players.p1.deck.length - 1);
    expect(new Set(done.players.p1.deck.slice(-7))).toEqual(new Set(top));
    expect(events.some((e) => e.type === "DECK_TOP_REVEALED")).toBe(true);
  });

  it("with room on the Bench the {D} Basic is still offered and benched", () => {
    const state = grimsleyBoard(4);
    const dark = state.players.p1.deck[0] as string;
    const parked = play(state, GRIMSLEY).state;
    expect(prompt(parked)).toMatchObject({
      kind: "chooseCards",
      candidates: [dark],
      max: 1,
      dest: "bench",
    });
    const done = mustApply(parked, cards([dark])).state;
    expect(done.players.p1.bench).toHaveLength(5);
    expect(done.players.p1.bench[4]?.stack).toEqual([dark]);
  });
});

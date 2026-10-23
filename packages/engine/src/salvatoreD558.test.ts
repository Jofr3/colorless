import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { applyAction } from "./index";
import type { GameState, Seat } from "./index";
import { runProgram } from "./interpreter";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  mustApply,
  setActiveFromDeck,
  trainerCard,
  must,
  effectPrompt,
  driveSetup,
  roundTrip,
} from "./testFixtures";

const SALVATORE = ["sv05-160", "sv05-202", "sv05-212"] as const;
const SALVATORE_TEXT =
  "Search your deck for a card that has no Abilities and evolves from 1 of your Pokémon, and put it onto that Pokémon to evolve it. Then, shuffle your deck. You can use this card on a Pokémon you put down when you were setting up to play or on a Pokémon that was put into play this turn.";

const SEED = "d558s-seed";
const BLOOM = "d558s-bloom";
const BLOOM_EMPTY = "d558s-bloom-empty";
const BLOOM_ABLE = "d558s-bloom-able";
const OTHER = "d558s-other";
const OTHER_ABLE = "d558s-other-able";
const FILLER = "d558s-filler";

const ABILITY = [{ type: "Ability", name: "D558 Trick", effect: "A test Ability." }];

function stage1(id: string, name: string, from: string, abilities: Card["abilities"]): Card {
  return battler(id, { name, stage: "Stage1", evolveFrom: from, hp: 300, abilities });
}

const LOCAL_CARDS: Record<string, Card> = {
  ...Object.fromEntries(
    SALVATORE.map((id) => [
      id,
      { ...trainerCard(id, "Supporter", SALVATORE_TEXT), name: "Salvatore" },
    ]),
  ),
  [SEED]: battler(SEED, { name: "D558 Seed", hp: 300, types: ["Grass"] }),
  [OTHER]: battler(OTHER, { name: "D558 Other", hp: 300, types: ["Grass"] }),
  [FILLER]: battler(FILLER, { name: "D558 Filler", hp: 300, types: ["Colorless"] }),
  [BLOOM]: stage1(BLOOM, "D558 Bloom", "D558 Seed", null),
  [BLOOM_EMPTY]: stage1(BLOOM_EMPTY, "D558 Bloom Empty", "D558 Seed", []),
  [BLOOM_ABLE]: stage1(BLOOM_ABLE, "D558 Bloom Able", "D558 Seed", ABILITY as Card["abilities"]),
  [OTHER_ABLE]: stage1(OTHER_ABLE, "D558 Other Able", "D558 Other", ABILITY as Card["abilities"]),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [SALVATORE[0]]: 2,
  [SALVATORE[1]]: 1,
  [SALVATORE[2]]: 1,
  [SEED]: 6,
  [OTHER]: 3,
  [FILLER]: 12,
  [BLOOM]: 3,
  [BLOOM_EMPTY]: 2,
  [BLOOM_ABLE]: 3,
  [OTHER_ABLE]: 3,
  "fix-energy": 24,
});

function opened(seed: number): GameState {
  const state = driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first: "p2" });
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

function arrange(
  state: GameState,
  seat: Seat,
  hand: readonly string[],
  deck: readonly string[],
): GameState {
  const side = state.players[seat];
  let pool = [...side.deck, ...side.hand, ...side.prizes];
  const take = (id: string): string => {
    const uid = pool.find((u) => state.cardIdByUid[u] === id);
    if (uid === undefined) throw new Error(`${seat} has no more ${id}`);
    pool = pool.filter((u) => u !== uid);
    return uid;
  };
  const newHand = hand.map(take);
  const newDeck = deck.map(take);
  const prizes = pool.splice(0, side.prizes.length);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        hand: newHand,
        deck: newDeck,
        prizes,
        discard: [...side.discard, ...pool],
      },
    },
  };
}

function table(
  active: string,
  bench: readonly string[],
  deck: readonly string[],
  printing: string = SALVATORE[0],
  extraHand: readonly string[] = [],
): GameState {
  let state = opened(5580);
  state = setActiveFromDeck(state, "p1", active);
  state = clearBench(state, "p1");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  return arrange(state, "p1", [...extraHand, printing], deck);
}

const play = (state: GameState) =>
  mustApply(state, { type: "playTrainer", seat: "p1", uid: state.players.p1.hand[0] as string });
function pendingOp(state: GameState): EffectOp {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  return state.phase.cont.pendingOp;
}
const idsOf = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);
const candidateIds = (state: GameState) => {
  const p = effectPrompt(state);
  if (p.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${p.kind}`);
  return [...new Set(idsOf(state, p.candidates))].sort();
};
const topId = (state: GameState, spot: "active" | number) => {
  const side = state.players.p1;
  const body = spot === "active" ? side.active : side.bench[spot];
  const top = body?.stack[body.stack.length - 1];
  return top === undefined ? undefined : state.cardIdByUid[top];
};
const deckUid = (state: GameState, id: string) => {
  const uid = state.players.p1.deck.find((u) => state.cardIdByUid[u] === id);
  if (uid === undefined) throw new Error(`no ${id} in p1's deck`);
  return uid;
};
const pickCard = (state: GameState, uid: string) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [uid] } });
const pickBody = (state: GameState, spot: "active" | number) =>
  mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: {
      kind: "pokemon",
      ref: {
        seat: "p1",
        spot: spot === "active" ? { spot: "active" } : { spot: "bench", index: spot },
      },
    },
  });
const revive = (state: GameState): GameState => roundTrip(state);
const shuffled = (events: readonly GameEvent[]) => events.some((e) => e.type === "SHUFFLE");

// ────────────────────────────────────────────────────────────────────────────
describe("D558 Salvatore §1 — the print, and the registry row that maps it", () => {
  it("the program is Duosion's two ops with `noAbilities` on the asker, pinned by toEqual", () => {
    expect(programFor(SALVATORE[0])).toEqual({
      trainer: [{ op: "evolveFromDeckChosen", noAbilities: true }, { op: "shuffleDeck" }],
    });
    expect(Object.keys(programFor(SALVATORE[0]) ?? {})).toEqual(["trainer"]);
  });

  it("all three printings share ONE object, and each is the printed Supporter", () => {
    const first = programFor(SALVATORE[0]);
    for (const id of SALVATORE) {
      expect(programFor(id), id).toBe(first);
      expect(POOL[id]?.name).toBe("Salvatore");
      expect(POOL[id]?.trainerType).toBe("Supporter");
      expect(POOL[id]?.effect).toBe(SALVATORE_TEXT);
    }
  });

  it("every printing plays and evolves the one eligible body", () => {
    for (const printing of SALVATORE) {
      const parked = play(table(SEED, [], [BLOOM, BLOOM_ABLE], printing)).state;
      const { state } = pickCard(parked, deckUid(parked, BLOOM));
      expect(topId(state, "active"), printing).toBe(BLOOM);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D558 Salvatore §2 — the OFFER keeps only the Ability-free cards (R-SV2)", () => {
  it("an Ability-bearing evolution is NOT offered; null and [] abilities both are", () => {
    const parked = play(table(SEED, [], [BLOOM, BLOOM_EMPTY, BLOOM_ABLE])).state;
    expect(candidateIds(parked)).toEqual([BLOOM, BLOOM_EMPTY]);
    expect(pendingOp(parked)).toEqual({
      op: "evolveFromDeck",
      onto: { spot: "active" },
      noAbilities: true,
    });
  });

  it("the CONTROL — the same deck under D309's key-free op offers the Ability card too", () => {
    const board = table(SEED, [], [BLOOM, BLOOM_EMPTY, BLOOM_ABLE]);
    const events: GameEvent[] = [];
    const result = runProgram(
      board,
      [{ op: "evolveFromDeckChosen" }],
      { seat: "p1", invokedBy: "supporter" },
      events,
    );
    if (result.kind !== "parked") throw new Error(`expected parked, got ${result.kind}`);
    const p = result.prompt;
    if (p.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect([...new Set(idsOf(board, p.candidates))].sort()).toEqual([
      BLOOM,
      BLOOM_ABLE,
      BLOOM_EMPTY,
    ]);
  });

  it("the prompt names the printed noun, and the pick evolves the body then shuffles", () => {
    const parked = play(table(SEED, [], [BLOOM, BLOOM_ABLE])).state;
    const p = effectPrompt(parked);
    expect(p.kind === "chooseCards" ? p.note : undefined).toBe(
      "Search your deck for a card that has no Abilities and evolves from D558 Seed and put it onto D558 Seed to evolve it.",
    );
    const { state, events } = pickCard(parked, deckUid(parked, BLOOM));
    expect(topId(state, "active")).toBe(BLOOM);
    expect(state.players.p1.deck.map((u) => state.cardIdByUid[u])).toEqual([BLOOM_ABLE]);
    expect(shuffled(events)).toBe(true);
    expect(state.phase.kind).toBe("turn:action");
  });

  it("a deck whose only evolutions print an Ability WHIFFS — no park, the shuffle still fires", () => {
    const { state, events } = play(table(SEED, [], [BLOOM_ABLE, FILLER]));
    expect(state.phase.kind).toBe("turn:action");
    expect(topId(state, "active")).toBe(SEED);
    expect(shuffled(events)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D558 Salvatore §3 — the BODY narrowing asks the same noun (evolvableOwnRefs)", () => {
  it("a body whose only evolutions print an Ability is not offered — the other is FORCED", () => {
    // Seed (Bloom in deck) Active, Other (only Other Able in deck) Benched: one eligible
    // body under Salvatore's noun, so no body prompt at all — straight to the card.
    const parked = play(table(SEED, [OTHER], [BLOOM, OTHER_ABLE])).state;
    const p = effectPrompt(parked);
    expect(p.kind).toBe("chooseCards");
    expect(candidateIds(parked)).toEqual([BLOOM]);
  });

  it("the CONTROL — without the key the same board asks WHICH body (two are eligible)", () => {
    const board = table(SEED, [OTHER], [BLOOM, OTHER_ABLE]);
    const result = runProgram(
      board,
      [{ op: "evolveFromDeckChosen" }],
      { seat: "p1", invokedBy: "supporter" },
      [],
    );
    if (result.kind !== "parked") throw new Error(`expected parked, got ${result.kind}`);
    expect(result.prompt.kind).toBe("choosePokemon");
    expect(result.prompt.kind === "choosePokemon" ? result.prompt.candidates : []).toHaveLength(2);
  });

  it("with two Ability-free-evolvable bodies the body is ASKED, and the answer carries the key", () => {
    const parked = play(table(SEED, [SEED], [BLOOM, BLOOM_ABLE])).state;
    expect(effectPrompt(parked).kind).toBe("choosePokemon");
    expect(pendingOp(parked)).toEqual({ op: "evolveFromDeckChosen", noAbilities: true });
    const card = pickBody(parked, 0).state;
    expect(pendingOp(card)).toEqual({
      op: "evolveFromDeck",
      onto: { spot: "bench", index: 0 },
      noAbilities: true,
    });
    expect(candidateIds(card)).toEqual([BLOOM]);
    const { state } = pickCard(card, deckUid(card, BLOOM));
    expect(topId(state, 0)).toBe(BLOOM);
    expect(topId(state, "active")).toBe(SEED);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D558 Salvatore §4 — the MOVE re-derives the offer under the key (a crafted frame)", () => {
  it("a revived park whose prompt was widened by hand still refuses the Ability card", () => {
    const parked = revive(play(table(SEED, [], [BLOOM, BLOOM_ABLE])).state);
    if (parked.phase.kind !== "effect:choose" || parked.phase.prompt.kind !== "chooseCards")
      throw new Error("expected a chooseCards park");
    const able = deckUid(parked, BLOOM_ABLE);
    const crafted: GameState = {
      ...parked,
      phase: {
        ...parked.phase,
        prompt: { ...parked.phase.prompt, candidates: [...parked.phase.prompt.candidates, able] },
      },
    };
    const { state } = pickCard(crafted, able);
    expect(topId(state, "active")).toBe(SEED);
    expect(state.players.p1.deck).toContain(able);
  });

  it("the CONTROL — the same crafted frame with the key STRIPPED (an old record) moves it", () => {
    const parked = revive(play(table(SEED, [], [BLOOM, BLOOM_ABLE])).state);
    if (parked.phase.kind !== "effect:choose" || parked.phase.prompt.kind !== "chooseCards")
      throw new Error("expected a chooseCards park");
    const able = deckUid(parked, BLOOM_ABLE);
    const crafted: GameState = {
      ...parked,
      phase: {
        ...parked.phase,
        prompt: { ...parked.phase.prompt, candidates: [...parked.phase.prompt.candidates, able] },
        cont: {
          ...parked.phase.cont,
          pendingOp: { op: "evolveFromDeck", onto: { spot: "active" } },
        },
      },
    };
    const { state } = pickCard(crafted, able);
    expect(topId(state, "active")).toBe(BLOOM_ABLE);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D558 Salvatore §5 — MATCH_RECORD_VERSION HOLDS: the optional key survives JSON, and its absence reads as D309", () => {
  it("a parked BODY question revived from JSON still hands the key to the card question", () => {
    const parked = play(table(SEED, [SEED], [BLOOM, BLOOM_ABLE])).state;
    const revived = revive(parked);
    expect(revived).toEqual(parked);
    const card = pickBody(revived, "active").state;
    expect(candidateIds(card)).toEqual([BLOOM]);
    expect(pendingOp(card)).toEqual({
      op: "evolveFromDeck",
      onto: { spot: "active" },
      noAbilities: true,
    });
  });

  it("a parked CARD question revived from JSON keeps `noAbilities` in `phase.cont.pendingOp`", () => {
    const parked = revive(play(table(SEED, [], [BLOOM, BLOOM_ABLE])).state);
    expect(pendingOp(parked)).toEqual({
      op: "evolveFromDeck",
      onto: { spot: "active" },
      noAbilities: true,
    });
    expect(candidateIds(parked)).toEqual([BLOOM]);
    const { state } = pickCard(parked, deckUid(parked, BLOOM));
    expect(topId(state, "active")).toBe(BLOOM);
  });

  it("an OLD record — the parked body question with NO key — stays UNFILTERED", () => {
    const parked = revive(play(table(SEED, [SEED], [BLOOM, BLOOM_ABLE])).state);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
    const old: GameState = {
      ...parked,
      phase: {
        ...parked.phase,
        cont: { ...parked.phase.cont, pendingOp: { op: "evolveFromDeckChosen" } },
      },
    };
    const card = pickBody(old, "active").state;
    expect(pendingOp(card)).toEqual({ op: "evolveFromDeck", onto: { spot: "active" } });
    expect(candidateIds(card)).toEqual([BLOOM, BLOOM_ABLE]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D558 Salvatore §6 — R-SV1 (UNRULED): the first turn and a body put down this turn", () => {
  it("the going-second player's FIRST turn plays it and evolves the Active put down at setup", () => {
    const board = table(SEED, [], [BLOOM]);
    expect(board.turn).toBe(2);
    expect(board.phase).toEqual({ kind: "turn:action", seat: "p1" });
    const { state } = play(board);
    // One eligible body and one candidate: the card question still PARKS ("up to" 1).
    const { state: done } = pickCard(state, deckUid(state, BLOOM));
    expect(topId(done, "active")).toBe(BLOOM);
  });

  it("a Pokémon put into play THIS turn is evolved too (the third sentence)", () => {
    let board = table(SEED, [], [BLOOM], SALVATORE[1], [SEED]);
    board = mustApply(board, {
      type: "playBasicToBench",
      seat: "p1",
      uid: board.players.p1.hand[0] as string,
    }).state;
    expect(board.players.p1.bench[0]?.turnPlayed).toBe(board.turn);
    // Two bodies now — the setup Active and the fresh Bench Seed — and the answer is the new one.
    const parked = mustApply(board, {
      type: "playTrainer",
      seat: "p1",
      uid: board.players.p1.hand[0] as string,
    }).state;
    const card = pickBody(parked, 0).state;
    const { state } = pickCard(card, deckUid(card, BLOOM));
    expect(topId(state, 0)).toBe(BLOOM);
  });
});

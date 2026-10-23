import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { GameAction, GameEvent, GameState } from "./index";
import { applyAction } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  setDamage,
  trainerCard,
  must,
  driveSetup,
} from "./testFixtures";

const POTION_TEXT = "Heal 30 damage from 1 of your Pokémon.";
const POTION_IDS = ["sv01-188", "me03-083", "mfb-33"] as const;

const BODY = "b05-body";
const FILLER = "b05-filler";

const mon = (id: string, name: string): Card =>
  battler(id, {
    name,
    hp: 200,
    types: ["Colorless"],
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  });

const LOCAL: Record<string, Card> = {
  ...Object.fromEntries(
    POTION_IDS.map((id) => [id, { ...trainerCard(id, "Item", POTION_TEXT), name: "Potion" }]),
  ),
  [BODY]: mon(BODY, "B05 Body"),
  [FILLER]: mon(FILLER, "B05 Filler"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };

const DECK = deckOf({
  ...Object.fromEntries(POTION_IDS.map((id) => [id, 1])),
  [BODY]: 4,
  [FILLER]: 10,
  "fix-energy": 43, // 60 cards
});

function p1Turn(): GameState {
  let state = driveSetup(505, { p1: DECK, p2: DECK }, { pool: POOL, first: "p1" });
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  if (state.turn !== 3) throw new Error(`expected turn 3, got ${state.turn}`);
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

/** P1's Active is a Body with 50 damage and the Bench is `bench`; P2's Active a Filler. */
function board(bench: readonly string[]): GameState {
  let state = clearBench(setActiveFromDeck(p1Turn(), "p1", BODY), "p1");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  state = clearBench(setActiveFromDeck(state, "p2", FILLER), "p2");
  return setDamage(state, "p1", 50);
}

const idOf = (state: GameState, uid: string | undefined) =>
  uid === undefined ? undefined : state.cardIdByUid[uid];

function play(
  state: GameState,
  id: string,
): { state: GameState; events: GameEvent[]; uid: string } {
  const next = handFromDeck(state, "p1", id, 1);
  const uid = next.players.p1.hand.find((u) => idOf(next, u) === id) as string;
  return { ...mustApply(next, { type: "playTrainer", seat: "p1", uid }), uid };
}
const answer = (choice: unknown): GameAction =>
  ({ type: "resolveEffect", seat: "p1", choice }) as GameAction;

describe("B05 §1 — every Standard-legal printing of Potion runs its twin's program", () => {
  it("each printing resolves to the SAME program object as the authored `sv01-188`", () => {
    const twin = programFor("sv01-188");
    expect(twin).toEqual({ trainer: [{ op: "healChosen", amount: 30 }] });
    for (const id of POTION_IDS) expect(programFor(id), id).toBe(twin);
  });

  it.each(POTION_IDS)(
    'Potion %s: "Heal 30 damage from 1 of your Pokémon." — the only Pokémon in play heals 30 of its 50',
    (id) => {
      const { state: done, events } = play(board([]), id);
      expect(done.phase.kind).toBe("turn:action");
      expect(events.find((e) => e.type === "HEALED")).toMatchObject({ amount: 30 });
      expect(done.players.p1.active?.damage).toBe(20);
      expect(done.players.p1.discard.map((u) => idOf(done, u))).toEqual([id]);
    },
  );

  it.each(POTION_IDS)(
    "Potion %s: with a Benched Pokémon too, the heal goes to the CHOSEN one (1 of your Pokémon)",
    (id) => {
      const parked = play(board([BODY]), id).state;
      if (parked.phase.kind !== "effect:choose")
        throw new Error(`expected effect:choose, got ${parked.phase.kind}`);
      const prompt = parked.phase.prompt;
      if (prompt.kind !== "choosePokemon")
        throw new Error(`expected choosePokemon, got ${prompt.kind}`);
      const active = prompt.candidates.find((c) => c.seat === "p1" && c.spot.spot === "active");
      expect(active).toBeDefined();
      const done = mustApply(parked, answer({ kind: "pokemon", ref: active })).state;
      expect(done.phase.kind).toBe("turn:action");
      expect(done.players.p1.active?.damage).toBe(20);
      expect(done.players.p1.bench[0]?.damage).toBe(0);
    },
  );
});

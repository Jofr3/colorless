import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { GameAction, GameEvent, GameState } from "./index";
import { applyAction, createGame } from "./index";
import { discardRetrievalCandidates } from "./interpreter";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  clearBench,
  deckOf,
  discardFromDeck,
  mustApply,
  setActiveFromDeck,
  trainerCard,
  must,
} from "./testFixtures";

const VITAL_TEXT =
  "Heal 150 damage from 1 of your Pokémon.\n\nThis card can't be put into your hand or deck from the discard pile.";
const ZONE_TEXT =
  "Prevent all damage done to Pokémon that don't have a Rule Box (both yours and your opponent's) by attacks from the opponent's Pokémon ex and Pokémon V. (Pokémon ex, Pokémon V, etc. have Rule Boxes.)\n\nThis card can't be put into your hand or deck from the discard pile.";
const HEADSET_TEXT = "Put up to 2 Supporter cards from your discard pile into your hand.";
const SONAR_TEXT = "Put a Trainer card from your discard pile into your hand.";

const VITAL = "sv06.5-062";
const ZONE = "sv06.5-060";
const HEADSET = "sv08-183";
const DEDENNE = "sv08-087";
const FILLER = "b06-filler";

const LOCAL: Record<string, Card> = {
  [VITAL]: { ...trainerCard(VITAL, "Item", VITAL_TEXT), name: "Poké Vital A" },
  [ZONE]: { ...trainerCard(ZONE, "Stadium", ZONE_TEXT), name: "Neutralization Zone" },
  [HEADSET]: { ...trainerCard(HEADSET, "Item", HEADSET_TEXT), name: "Miracle Headset" },
  [DEDENNE]: battler(DEDENNE, {
    name: "Dedenne",
    hp: 70,
    types: ["Psychic"],
    retreat: 1,
    weaknesses: [{ type: "Metal", value: "×2" }],
    attacks: [
      { cost: ["Colorless"], name: "Electromagnetic Sonar", effect: SONAR_TEXT },
      { cost: ["Psychic"], name: "Gnaw", damage: 30 },
    ],
  }),
  [FILLER]: battler(FILLER, {
    name: "B06 Filler",
    hp: 200,
    types: ["Colorless"],
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };

const DECK = deckOf({
  [VITAL]: 2,
  [ZONE]: 1,
  [HEADSET]: 2,
  [DEDENNE]: 2,
  [FILLER]: 30,
  "fix-energy": 23, // 60 cards
});

function p1Turn(): GameState {
  const created = createGame({ seed: 606, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p1" }),
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

/** P1's Active is Dedenne with one Energy for "Electromagnetic Sonar" ({C}), an empty Bench, and
    `pile` in the discard pile (in that order); P2's Active a Filler. */
function board(pile: readonly string[]): GameState {
  let state = clearBench(setActiveFromDeck(p1Turn(), "p1", DEDENNE), "p1");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  for (const id of pile) state = discardFromDeck(state, "p1", id, 1);
  return clearBench(setActiveFromDeck(state, "p2", FILLER), "p2");
}

const idOf = (state: GameState, uid: string | undefined) =>
  uid === undefined ? undefined : state.cardIdByUid[uid];
const ids = (state: GameState, uids: readonly string[]) => uids.map((u) => idOf(state, u));
const uidIn = (state: GameState, zone: readonly string[], id: string) =>
  zone.find((u) => idOf(state, u) === id) as string;

const sonar: GameAction = { type: "attack", seat: "p1", index: 0 };
const answer = (choice: unknown): GameAction =>
  ({ type: "resolveEffect", seat: "p1", choice }) as GameAction;

describe('B06 §1 — Poké Vital A: "This card can\'t be put into your hand or deck from the discard pile."', () => {
  it("both printings of the sentence carry the card-borne pile lock, beside their own program", () => {
    expect(programFor(VITAL)).toEqual({
      trainer: [{ op: "healChosen", amount: 150 }],
      discardPileLocked: true,
    });
    expect(programFor(ZONE)).toEqual({
      stadium: { preventDamageToNoRuleBoxFromExV: true },
      discardPileLocked: true,
    });
    // The neighbour Item that prints no such sentence carries no lock.
    expect(programFor(HEADSET)?.discardPileLocked).toBeUndefined();
  });

  it('Dedenne\'s "Put a Trainer card from your discard pile into your hand." offers Miracle Headset alone', () => {
    const parked = mustApply(board([VITAL, HEADSET, ZONE]), sonar).state;
    if (parked.phase.kind !== "effect:choose")
      throw new Error(`expected effect:choose, got ${parked.phase.kind}`);
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${prompt.kind}`);
    expect(ids(parked, prompt.candidates)).toEqual([HEADSET]);
  });

  it("a crafted answer naming Poké Vital A is refused, and the card stays in the discard pile", () => {
    const parked = mustApply(board([VITAL, HEADSET]), sonar).state;
    const vital = uidIn(parked, parked.players.p1.discard, VITAL);
    const result = applyAction(parked, answer({ kind: "cards", uids: [vital] }));
    expect(result.ok ? undefined : result.error.code).toBe("BAD_EFFECT_CHOICE");
    expect(parked.players.p1.discard).toContain(vital);
    expect(parked.players.p1.hand).not.toContain(vital);
  });

  it("the offered Miracle Headset still comes back to the hand (the attack's own reading is unchanged)", () => {
    const parked = mustApply(board([VITAL, HEADSET]), sonar).state;
    const headset = uidIn(parked, parked.players.p1.discard, HEADSET);
    const { state: done, events } = mustApply(parked, answer({ kind: "cards", uids: [headset] }));
    expect(ids(done, done.players.p1.hand)).toEqual([HEADSET]);
    expect(ids(done, done.players.p1.discard)).toEqual([VITAL]);
    expect(events.filter((e: GameEvent) => e.type === "DISCARD_RETRIEVED")).toEqual([
      { type: "DISCARD_RETRIEVED", seat: "p1", dest: "hand", uids: [headset] },
    ]);
  });

  it("a pile holding only the two locked cards gives Sonar nothing to retrieve: no prompt, nothing moves", () => {
    const { state: done, events } = mustApply(board([VITAL, ZONE]), sonar);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(done.players.p1.hand).toEqual([]);
    expect(ids(done, done.players.p1.discard)).toEqual(expect.arrayContaining([VITAL, ZONE]));
    expect(events.some((e) => e.type === "DISCARD_RETRIEVED")).toBe(false);
  });

  it('"or deck": a shuffle-back retrieval offer (dest deck) drops the locked cards too', () => {
    const state = board([VITAL, HEADSET, ZONE]);
    const offer = discardRetrievalCandidates(state, "p1", {
      op: "discardPileRetrieval",
      filter: { kind: "trainerCard" },
      dest: "deck",
      max: 3,
    });
    expect(ids(state, offer)).toEqual([HEADSET]);
  });
});

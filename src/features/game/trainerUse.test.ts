import { describe, expect, it } from "vitest";
import { applyAction, createGame, redactGame, type GameState } from "@luminous/engine";
import {
  completeSetup,
  deckOf,
  discardFromDeck,
  driveSetup,
  FIXTURE_POOL,
  handFromDeck,
  handToDeck,
  handUid,
  mustApply,
  trainerCard,
  TRAINER_DECK,
} from "../../../packages/engine/src/testFixtures";
import { usableTrainerIdsForGame, usableTrainerIdsFromRedacted } from "./trainerUse";

function trainerTurn() {
  let state = driveSetup(170, { p1: TRAINER_DECK, p2: TRAINER_DECK }, { first: "p2" });
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = handFromDeck(state, "p1", "sv01-181", 2);
  return handFromDeck(state, "p1", "sv01-189", 1);
}

describe("Trainer USE availability", () => {
  it("allows all duplicate copies using the server's deduplicated offers", () => {
    const state = trainerTurn();
    const before = JSON.stringify(state);
    const local = usableTrainerIdsForGame(state, "p1");
    const online = usableTrainerIdsFromRedacted(redactGame(state, "p1"));
    const items = state.players.p1.hand.filter((uid) => state.cardIdByUid[uid] === "sv01-181");
    expect(items.length).toBeGreaterThanOrEqual(2);
    for (const uid of items) {
      expect(local.has(uid)).toBe(true);
      expect(online.has(uid)).toBe(true);
    }
    expect(local.has(handUid(state, "p1", "sv01-189"))).toBe(true);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("blocks a spent Supporter allowance while keeping Items usable", () => {
    const initial = trainerTurn();
    const state = { ...initial, allowances: { ...initial.allowances, supporterPlayed: true } };
    const supporter = handUid(state, "p1", "sv01-189");
    const item = handUid(state, "p1", "sv01-181");
    for (const usable of [
      usableTrainerIdsForGame(state, "p1"),
      usableTrainerIdsFromRedacted(redactGame(state, "p1")),
    ]) {
      expect(usable.has(supporter)).toBe(false);
      expect(usable.has(item)).toBe(true);
    }
  });

  it("blocks first-turn Supporters and all Trainers for the other viewer", () => {
    const state = handFromDeck(
      driveSetup(170, { p1: TRAINER_DECK, p2: TRAINER_DECK }, { first: "p1" }),
      "p1",
      "sv01-189",
      1,
    );
    const supporter = handUid(state, "p1", "sv01-189");
    expect(usableTrainerIdsForGame(state, "p1").has(supporter)).toBe(false);
    expect(usableTrainerIdsFromRedacted(redactGame(state, "p1")).has(supporter)).toBe(false);
    expect(usableTrainerIdsForGame(state, "p2").size).toBe(0);
    expect(usableTrainerIdsFromRedacted(redactGame(state, "p2")).size).toBe(0);
  });
});

describe.each(["sv06.5-061", "sv08-251"])("Night Stretcher USE availability (%s)", (cardId) => {
  function nightStretcherTurn(): GameState {
    const deck = deckOf({
      "fix-basic-1": 20,
      "fix-water-energy": 20,
      [cardId]: 2,
      "fix-special": 4,
      "sv01-189": 2,
      "sv01-181": 2,
      "fix-energy": 10,
    });
    const created = createGame({
      seed: 170,
      decks: { p1: deck, p2: deck },
      cardPool: {
        ...FIXTURE_POOL,
        [cardId]: trainerCard(
          cardId,
          "Item",
          "Put a Pokémon or a Basic Energy card from your discard pile into your hand.",
        ),
      },
    });
    if (!created.ok) throw new Error(created.error.message);
    let state = completeSetup(created.state, { first: "p2" });
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    return handFromDeck(handToDeck(state, "p1", cardId), "p1", cardId, 2);
  }

  it.each([undefined, "sv01-181", "sv01-189", "fix-special"])(
    "rejects an empty or ineligible discard pile (%s) without consuming the card",
    (discardCardId) => {
      let state = nightStretcherTurn();
      if (discardCardId !== undefined) {
        state = discardFromDeck(handToDeck(state, "p1", discardCardId), "p1", discardCardId, 1);
      }
      // An eligible card in the opponent's discard must not enable this Item.
      state = discardFromDeck(handToDeck(state, "p2", "fix-basic-1"), "p2", "fix-basic-1", 1);
      const before = JSON.stringify(state);
      const uid = handUid(state, "p1", cardId);
      const result = applyAction(state, { type: "playTrainer", seat: "p1", uid });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected Night Stretcher to be rejected");
      expect(result.error.code).toBe("NO_LEGAL_TARGET");
      for (const usable of [
        usableTrainerIdsForGame(state, "p1"),
        usableTrainerIdsFromRedacted(redactGame(state, "p1")),
      ]) {
        for (const copy of state.players.p1.hand.filter((id) => state.cardIdByUid[id] === cardId)) {
          expect(usable.has(copy)).toBe(false);
        }
      }
      expect(JSON.stringify(state)).toBe(before);
    },
  );

  it.each(["fix-basic-1", "fix-water-energy"])(
    "allows both copies when %s can be retrieved and moves the selected card into hand",
    (discardCardId) => {
      let state = nightStretcherTurn();
      state = discardFromDeck(handToDeck(state, "p1", discardCardId), "p1", discardCardId, 1);
      const candidate = state.players.p1.discard[0];
      if (candidate === undefined) throw new Error("expected a discarded card");
      for (const usable of [
        usableTrainerIdsForGame(state, "p1"),
        usableTrainerIdsFromRedacted(redactGame(state, "p1")),
      ]) {
        for (const copy of state.players.p1.hand.filter((id) => state.cardIdByUid[id] === cardId)) {
          expect(usable.has(copy)).toBe(true);
        }
      }
      const uid = handUid(state, "p1", cardId);
      const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
      expect(parked.phase.kind).toBe("effect:choose");
      if (parked.phase.kind !== "effect:choose" || parked.phase.prompt.kind !== "chooseCards") {
        throw new Error("expected a card selection prompt");
      }
      expect(parked.phase.prompt.candidates).toEqual([candidate]);
      expect(parked.phase.prompt.max).toBe(1);
      const { state: done } = mustApply(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: [candidate] },
      });
      expect(done.players.p1.hand).toContain(candidate);
      expect(done.players.p1.discard).not.toContain(candidate);
      expect(done.players.p1.discard).toContain(uid);
    },
  );
});

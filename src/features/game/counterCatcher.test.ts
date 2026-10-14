import { createGame, redactGame, type GameState, type Seat } from "@luminous/engine";
import { describe, expect, it } from "vitest";
import {
  FIXTURE_POOL,
  activeUid,
  benchFromDeck,
  benchTopUid,
  clearBench,
  completeSetup,
  deckOf,
  expectErr,
  handFromDeck,
  handToDeck,
  handUid,
  mustApply,
  trainerCard,
} from "../../../packages/engine/src/testFixtures";
import { usableTrainerIdsForGame, usableTrainerIdsFromRedacted } from "./trainerUse";

const PRINTINGS = ["sv04-160", "sv04-264"] as const;
const EFFECT =
  "You can play this card only if you have more Prize cards remaining than your opponent. Switch in 1 of your opponent's Benched Pokémon to the Active Spot.";
const DECK = deckOf({
  "fix-basic-1": 20,
  "fix-basic-2": 20,
  "fix-energy": 16,
  "sv04-160": 2,
  "sv04-264": 2,
});

function table(cardId: string, seat: Seat): GameState {
  const created = createGame({
    seed: 170,
    decks: { p1: DECK, p2: DECK },
    cardPool: {
      ...FIXTURE_POOL,
      ...Object.fromEntries(
        PRINTINGS.map((id) => [
          id,
          { ...trainerCard(id, "Item", EFFECT), name: "Counter Catcher" },
        ]),
      ),
    },
  });
  if (!created.ok) throw new Error(created.error.message);
  let state = completeSetup(created.state, { first: seat });
  state = handFromDeck(handToDeck(state, seat, cardId), seat, cardId, 1);
  const opponent = seat === "p1" ? "p2" : "p1";
  state = benchFromDeck(handToDeck(state, opponent, "fix-basic-1"), opponent, "fix-basic-1");
  return benchFromDeck(handToDeck(state, opponent, "fix-basic-2"), opponent, "fix-basic-2");
}

/** Move taken Prizes to hand so each card stays in exactly one zone. */
function remainingPrizes(state: GameState, seat: Seat, count: number): GameState {
  const side = state.players[seat];
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        prizes: side.prizes.slice(0, count),
        hand: [...side.hand, ...side.prizes.slice(count)],
      },
    },
  };
}

function expectUsable(state: GameState, seat: Seat, uid: string, usable: boolean) {
  expect(usableTrainerIdsForGame(state, seat).has(uid)).toBe(usable);
  expect(usableTrainerIdsFromRedacted(redactGame(state, seat)).has(uid)).toBe(usable);
}

describe.each(PRINTINGS)("Counter Catcher (%s)", (cardId) => {
  describe.each<Seat>(["p1", "p2"])("played by %s", (seat) => {
    const opponent = seat === "p1" ? "p2" : "p1";

    it("chooses an opponent's Benched Pokémon while behind on Prizes, even on turn one", () => {
      const state = remainingPrizes(table(cardId, seat), opponent, 5);
      const uid = handUid(state, seat, cardId);
      const ownActive = activeUid(state, seat);
      const oldActive = activeUid(state, opponent);
      const chosenUid = benchTopUid(state, opponent, 1);
      const before = JSON.stringify(state);
      expect(state.turn).toBe(1);
      expectUsable(state, seat, uid, true);
      expect(JSON.stringify(state)).toBe(before);
      const { state: parked, events } = mustApply(state, { type: "playTrainer", seat, uid });
      expect(events.some((event) => event.type === "COIN_FLIP")).toBe(false);
      expect(parked.players[seat].hand).not.toContain(uid);
      expect(parked.players[seat].discard).toContain(uid);
      if (parked.phase.kind !== "effect:choose" || parked.phase.prompt.kind !== "choosePokemon") {
        throw new Error("expected a Pokémon selection");
      }
      expect(parked.phase.prompt.candidates).toEqual([
        { seat: opponent, spot: { spot: "bench", index: 0 } },
        { seat: opponent, spot: { spot: "bench", index: 1 } },
      ]);
      const { state: done } = mustApply(parked, {
        type: "resolveEffect",
        seat,
        choice: { kind: "pokemon", ref: { seat: opponent, spot: { spot: "bench", index: 1 } } },
      });
      expect(activeUid(done, opponent)).toBe(chosenUid);
      expect(
        done.players[opponent].bench.some((pokemon) => pokemon.stack.includes(oldActive)),
      ).toBe(true);
      expect(activeUid(done, seat)).toBe(ownActive);
      expect(done.allowances.supporterPlayed).toBe(false);
      expect(done.phase).toEqual({ kind: "turn:action", seat });
    });

    it.each([
      [6, 6],
      [5, 5],
      [4, 6],
    ])("rejects %i own versus %i opposing Prizes without spending the card", (own, opposing) => {
      const state = remainingPrizes(
        remainingPrizes(table(cardId, seat), seat, own),
        opponent,
        opposing,
      );
      const uid = handUid(state, seat, cardId);
      const before = JSON.stringify(state);
      expectErr(state, { type: "playTrainer", seat, uid }, "PLAY_CONDITION_NOT_MET");
      expectUsable(state, seat, uid, false);
      expect(JSON.stringify(state)).toBe(before);
    });

    it("rejects an empty opposing Bench even when the prize restriction is met", () => {
      const state = clearBench(remainingPrizes(table(cardId, seat), opponent, 5), opponent);
      const uid = handUid(state, seat, cardId);
      const before = JSON.stringify(state);
      expectErr(state, { type: "playTrainer", seat, uid }, "NO_LEGAL_TARGET");
      expectUsable(state, seat, uid, false);
      expect(JSON.stringify(state)).toBe(before);
    });

    it("automatically switches in a lone benched target", () => {
      let state = clearBench(remainingPrizes(table(cardId, seat), opponent, 5), opponent);
      state = benchFromDeck(state, opponent, "fix-basic-1");
      const target = benchTopUid(state, opponent, 0);
      const uid = handUid(state, seat, cardId);
      const { state: done } = mustApply(state, { type: "playTrainer", seat, uid });
      expect(activeUid(done, opponent)).toBe(target);
      expect(done.phase).toEqual({ kind: "turn:action", seat });
    });
  });
});

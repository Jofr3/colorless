import { describe, expect, it } from "vitest";
import type { CardModel, PlayerBoard } from "../types";
import { energyDiscardsBetween, type EnergyDiscardSnapshot } from "./energyDiscards";

const energy = (id: string): CardModel => ({ id, cardId: id, name: id, type: "energy" });
const pokemon = (id: string, energies: CardModel[] = []): CardModel => ({
  id,
  cardId: id,
  name: id,
  type: "pokemon",
  attached: { tools: [], energies },
});
const side = (active: CardModel | null, bench: CardModel[] = []): PlayerBoard => ({
  active,
  bench,
  hand: [],
  prizesRemaining: 6,
  faceUpPrizes: [],
});
function snapshot(energies = [energy("paid"), energy("kept")]): EnergyDiscardSnapshot {
  return {
    turn: 1,
    blueBackPlayer: "you",
    board: {
      stadium: null,
      you: side(pokemon("active", energies), [pokemon("bench")]),
      opponent: side(null),
    },
    piles: { you: { deckCount: 40, discard: [] }, opponent: { deckCount: 40, discard: [] } },
  };
}

function retreated(previous: EnergyDiscardSnapshot): EnergyDiscardSnapshot {
  const next = snapshot();
  next.board.you = side(pokemon("bench"), [pokemon("active", [energy("kept")])]);
  next.piles = {
    you: { deckCount: 40, discard: [energy("paid")] },
    opponent: { deckCount: 40, discard: [] },
  };
  return { ...next, turn: previous.turn };
}

describe("attached Energy discard flights", () => {
  it("flies only the retreat payment, preserving surplus Energy", () => {
    const previous = snapshot();
    expect(energyDiscardsBetween(previous, retreated(previous))).toEqual([
      { cardId: "paid", owner: "you" },
    ]);
  });

  it("keeps multiple discarded energies in pile order, including bench attachments", () => {
    const previous = snapshot();
    previous.board.you.bench = [pokemon("bench", [energy("bench-energy")])];
    const next = snapshot([]);
    next.piles = {
      you: { deckCount: 40, discard: [energy("kept"), energy("bench-energy"), energy("paid")] },
      opponent: { deckCount: 40, discard: [] },
    };
    expect(energyDiscardsBetween(previous, next)).toEqual([
      { cardId: "kept", owner: "you" },
      { cardId: "bench-energy", owner: "you" },
      { cardId: "paid", owner: "you" },
    ]);
  });

  it("routes an opponent's Energy to their own discard pile", () => {
    const previous = snapshot();
    previous.board.opponent = previous.board.you;
    previous.board.you = side(null);
    const next = retreated(previous);
    next.board.opponent = next.board.you;
    next.board.you = side(null);
    next.piles = {
      you: { deckCount: 40, discard: [] },
      opponent: { deckCount: 40, discard: [energy("paid")] },
    };
    expect(energyDiscardsBetween(previous, next)).toEqual([{ cardId: "paid", owner: "opponent" }]);
  });

  it("tracks the same physical player when the hot-seat view changes", () => {
    const previous = snapshot();
    const next = retreated(previous);
    const piles = next.piles;
    if (!piles) throw new Error("Expected piles");
    next.blueBackPlayer = "opponent";
    next.board = { ...next.board, you: next.board.opponent, opponent: next.board.you };
    next.piles = { you: piles.opponent, opponent: piles.you };
    expect(energyDiscardsBetween(previous, next)).toEqual([{ cardId: "paid", owner: "opponent" }]);
  });

  it("does not animate transfers, hand discards, unchanged snapshots or restored history", () => {
    const previous = snapshot();
    const moved = snapshot([]);
    moved.board.you.hand = [energy("paid")];
    moved.piles = {
      you: { deckCount: 40, discard: [energy("from-hand")] },
      opponent: { deckCount: 40, discard: [] },
    };
    expect(energyDiscardsBetween(previous, moved)).toEqual([]);
    expect(energyDiscardsBetween(previous, previous)).toEqual([]);
    expect(energyDiscardsBetween(null, retreated(previous))).toEqual([]);
    expect(energyDiscardsBetween(previous, { ...retreated(previous), turn: 2 })).toEqual([]);
    expect(energyDiscardsBetween(previous, { ...retreated(previous), turn: 0 })).toEqual([]);
    expect(energyDiscardsBetween({ ...previous, piles: undefined }, retreated(previous))).toEqual(
      [],
    );
    expect(energyDiscardsBetween(previous, { ...retreated(previous), piles: undefined })).toEqual(
      [],
    );
  });
});

import { describe, expect, it } from "vitest";
import type { AttachedCards, BoardState, CardModel, PlayerBoard } from "../types";
import { describeBoard } from "./boardSummary";

const card = (
  id: string,
  type: CardModel["type"] = "pokemon",
  attached?: AttachedCards,
): CardModel => ({
  id,
  name: id,
  cardId: id,
  type,
  attached,
});
const attached = (tools: CardModel[] = [], energies: CardModel[] = []): AttachedCards => ({
  tools,
  energies,
});
const player = (overrides: Partial<PlayerBoard> = {}): PlayerBoard => ({
  hand: [],
  active: null,
  bench: [],
  prizesRemaining: 6,
  ...overrides,
});
const makeBoard = (
  opts: {
    stadium?: CardModel | null;
    you?: Partial<PlayerBoard>;
    opponent?: Partial<PlayerBoard>;
  } = {},
): BoardState => ({
  stadium: opts.stadium ?? null,
  you: player(opts.you),
  opponent: player(opts.opponent),
});

describe("describeBoard", () => {
  it("orders opponent first, then the perspective player", () => {
    const summary = describeBoard(makeBoard(), "you");
    expect(summary.players.map((p) => p.player)).toEqual(["opponent", "you"]);
    expect(summary.players[0]?.possessive).toBe("Opponent's");
    expect(summary.players[1]?.possessive).toBe("Your");
  });

  it("describes an empty board", () => {
    const summary = describeBoard(makeBoard(), "you");
    expect(summary.stadium).toBeNull();
    for (const side of summary.players) {
      expect(side.active).toBeNull();
      expect(side.bench).toEqual([]);
      expect(side.prizesRemaining).toBe(6);
    }
  });

  it("names the active Pokémon with its attachment detail", () => {
    const active = card("Pikachu", "pokemon", attached([card("Tool")], [card("E1"), card("E2")]));
    const summary = describeBoard(makeBoard({ you: { active } }), "you");
    const you = summary.players[1];
    expect(you?.active).toBe("Pikachu (1 tool, 2 energy)");
  });

  it("omits attachment detail when there is none and singularizes 'tool'", () => {
    const oneTool = card("Snorlax", "pokemon", attached([card("Tool")]));
    const plain = card("Eevee");
    const summary = describeBoard(makeBoard({ you: { bench: [oneTool, plain] } }), "you");
    expect(summary.players[1]?.bench).toEqual(["Snorlax (1 tool)", "Eevee"]);
  });

  it("reveals the perspective player's hand by name but only counts the opponent's", () => {
    const summary = describeBoard(
      makeBoard({
        you: { hand: [card("A"), card("B")] },
        opponent: { hand: [card("X"), card("Y"), card("Z")] },
      }),
      "you",
    );
    const opponent = summary.players[0];
    const you = summary.players[1];
    expect(you?.hand).toEqual(["A", "B"]);
    expect(opponent?.hand).toBeNull();
    expect(opponent?.handCount).toBe(3);
  });

  it("names the stadium when one is in play", () => {
    const summary = describeBoard(makeBoard({ stadium: card("Lumiose City", "stadium") }), "you");
    expect(summary.stadium).toBe("Lumiose City");
  });

  it("carries deck/discard counts when pile data is provided", () => {
    const summary = describeBoard(makeBoard(), "you", {
      you: { deckCount: 42, discard: [card("Burnt")] },
      opponent: { deckCount: 51, discard: [] },
    });
    expect(summary.players[0]?.piles).toEqual({ deckCount: 51, discardCount: 0 });
    expect(summary.players[1]?.piles).toEqual({ deckCount: 42, discardCount: 1 });
  });

  it("leaves pile counts null when pile data is absent (mock board)", () => {
    const summary = describeBoard(makeBoard(), "you");
    for (const side of summary.players) {
      expect(side.piles).toBeNull();
    }
  });

  it("flips perspective so 'opponent' sees you as the opponent", () => {
    const summary = describeBoard(makeBoard({ you: { hand: [card("A")] } }), "opponent");
    expect(summary.players.map((p) => p.player)).toEqual(["you", "opponent"]);
    // From the opponent's perspective, your hand is hidden (counts only).
    expect(summary.players[0]?.hand).toBeNull();
    expect(summary.players[0]?.handCount).toBe(1);
  });
});

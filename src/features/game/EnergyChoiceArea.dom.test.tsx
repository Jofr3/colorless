// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import type { GameAction, GameState, PokemonRef } from "@luminous/engine";
import { applyAction, redactGame } from "@luminous/engine";
import { redactedGameSchema } from "@luminous/schema";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { benchFromDeck, driveSetup, typedEnergy } from "../../../packages/engine/src/testFixtures";
import { installDomShims } from "../../test/domShims";
import { OnlineMatch } from "../online/components/OnlineMatch";
import type { PlaymatViewProps } from "../playmat/PlaymatView";
import { LocalMatch } from "./LocalMatch";

const layer = vi.fn();
vi.mock("../playmat/components/AnimatedCardsLayer", () => ({
  AnimatedCardsLayer: (props: PlaymatViewProps) => {
    layer(props);
    return null;
  },
}));
beforeAll(installDomShims);
afterEach(() => {
  cleanup();
  layer.mockClear();
});

function staged(single = false): GameState {
  const state = benchFromDeck(driveSetup(170, undefined, { first: "p1" }), "p1", "fix-basic-1");
  const cards = { yes: "chosen-fire", ...(single ? {} : { no: "chosen-water" }) };
  const targets: PokemonRef[] = [
    { seat: "p1", spot: { spot: "active" } },
    { seat: "p1", spot: { spot: "bench", index: 0 } },
  ];
  const note = "Which Energy do you want to attach?";
  const labels = {
    yes: "Attach Fire Energy",
    no: single ? "Keep it in your hand" : "Attach Water Energy",
  };
  return {
    ...state,
    cardPool: {
      ...state.cardPool,
      "fix-fire-energy": { ...typedEnergy("fix-fire-energy", "Fire"), image: "fire" },
      "fix-water-energy": { ...typedEnergy("fix-water-energy", "Water"), image: "water" },
    },
    cardIdByUid: {
      ...state.cardIdByUid,
      "chosen-fire": "fix-fire-energy",
      "chosen-water": "fix-water-energy",
    },
    players: {
      ...state.players,
      p1: {
        ...state.players.p1,
        hand: [...state.players.p1.hand, "chosen-fire", ...(single ? [] : ["chosen-water"])],
      },
    },
    phase: {
      kind: "effect:choose",
      seat: "p1",
      prompt: { kind: "confirm", note, labels, cards, targets },
      cont: {
        pendingOp: {
          op: "optional",
          note,
          cards,
          targets,
          // biome-ignore lint/suspicious/noThenProperty: effect branch.
          then: [{ op: "attachEnergyFrom", source: "hand", energyType: "Fire" }],
          otherwise: [{ op: "attachEnergyFrom", source: "hand", energyType: "Water" }],
        },
        rest: [],
        ctx: { seat: "p1" },
      },
    },
  };
}

function currentLayer(): PlaymatViewProps {
  return layer.mock.calls.at(-1)?.[0] as PlaymatViewProps;
}

describe.each(["local", "online"] as const)("%s floating Energy choices", (surface) => {
  function show(single = false) {
    let state = staged(single);
    const onAction = vi.fn((action: GameAction) => {
      const result = applyAction(state, action);
      if (!result.ok) throw new Error(result.error.message);
      state = result.state;
    });
    const node = () => (
      <MemoryRouter>
        {surface === "local" ? (
          <LocalMatch
            setup={{ state, events: [], names: { p1: "You", p2: "Opponent" }, startedAt: 0 }}
            onPlayAgain={() => {}}
          />
        ) : (
          <OnlineMatch
            game={redactedGameSchema.parse(redactGame(state, "p1"))}
            log={[]}
            youName="You"
            opponentName="Opponent"
            opponentAway={null}
            actionError={null}
            onAction={onAction}
            onRematch={() => {}}
          />
        )}
      </MemoryRouter>
    );
    const { rerender } = render(node());
    return (cardId: string, to: Parameters<PlaymatViewProps["onMoveCard"]>[0]["to"]) => {
      act(() => currentLayer().onMoveCard({ cardId, from: { owner: "you", zone: "choice" }, to }));
      if (surface === "online") rerender(node());
    };
  }

  it.each([
    { id: "chosen-fire", other: "chosen-water", zone: "active" as const },
    { id: "chosen-water", other: "chosen-fire", zone: "bench" as const },
  ])("attaches $id by drop and returns the other card to hand", ({ id, other, zone }) => {
    const drop = show();
    const props = currentLayer();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Energy attachment choices")).toBeTruthy();
    expect(props.board.energyChoice?.cards.map((card) => card.id)).toEqual([
      "chosen-fire",
      "chosen-water",
    ]);
    expect(props.board.you.hand.some((card) => card.id.startsWith("chosen-"))).toBe(false);
    const target =
      zone === "active"
        ? ({ owner: "you", zone } as const)
        : ({ owner: "you", zone, index: 0 } as const);
    expect(
      props.placementPredicate?.(props.board, { owner: "you", zone: "choice" }, target, "energy"),
    ).toBe(true);
    drop(id, target);
    const board = currentLayer().board;
    expect(board.energyChoice).toBeUndefined();
    const host = zone === "active" ? board.you.active : board.you.bench[0];
    expect(host?.attached?.energies.map((card) => card.id)).toContain(id);
    expect(board.you.hand.map((card) => card.id)).toContain(other);
    expect(board.you.hand.map((card) => card.id)).not.toContain(id);
  });

  it("ignores drops onto the opponent, an empty slot, or the hand", () => {
    const drop = show();
    for (const target of [
      { owner: "opponent", zone: "active" } as const,
      { owner: "you", zone: "bench", index: 4 } as const,
      { owner: "you", zone: "hand" } as const,
    ]) {
      const props = currentLayer();
      expect(
        props.placementPredicate?.(props.board, { owner: "you", zone: "choice" }, target, "energy"),
      ).toBe(false);
      drop("chosen-fire", target);
      expect(currentLayer().board.energyChoice?.cards).toHaveLength(2);
    }
  });

  it("allows a single found Energy to be kept by dropping it in the hand", () => {
    const drop = show(true);
    drop("chosen-fire", { owner: "you", zone: "hand" });
    expect(currentLayer().board.energyChoice).toBeUndefined();
    expect(currentLayer().board.you.hand.map((card) => card.id)).toContain("chosen-fire");
  });
});

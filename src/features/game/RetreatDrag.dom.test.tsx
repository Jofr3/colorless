// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { applyAction, redactGame, type GameAction, type GameState } from "@luminous/engine";
import { redactedGameSchema } from "@luminous/schema";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  attachFromDeck,
  benchFromDeck,
  driveSetup,
} from "../../../packages/engine/src/testFixtures";
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
const currentLayer = () => layer.mock.calls.at(-1)?.[0] as PlaymatViewProps;

function board(energyCount = 1, free = false, cost = 1): GameState {
  let state = driveSetup(170, undefined, {
    first: "p1",
    active: { p1: free ? "fix-basic-0" : `fix-basic-${cost}`, p2: "fix-basic-1" },
  });
  for (const id of ["fix-basic-1", "fix-basic-0", "fix-basic-2"])
    state = benchFromDeck(state, "p1", id);
  state = attachFromDeck(state, "p1", "fix-energy", energyCount);
  return state;
}

describe.each(["local", "online"] as const)("%s bench-to-Active retreat", (surface) => {
  function show(initial: GameState) {
    let state = initial;
    const onAction = vi.fn((action: GameAction) => {
      const result = applyAction(state, action);
      if (!result.ok) throw new Error(result.error.message);
      state = result.state;
    });
    const onSave = vi.fn((snapshot: { state: GameState }) => {
      state = snapshot.state;
    });
    const node = () => (
      <MemoryRouter>
        {surface === "local" ? (
          <LocalMatch
            setup={{
              state: initial,
              events: [],
              names: { p1: "You", p2: "Opponent" },
              startedAt: 0,
            }}
            onSave={onSave}
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
    let renderedState = state;
    const refresh = () => {
      if (surface === "online" && state !== renderedState) {
        renderedState = state;
        rerender(node());
      }
    };
    const drop = (index = 1, cardId = currentLayer().board.you.bench[index]?.id ?? "missing") => {
      act(() =>
        currentLayer().onMoveCard({
          cardId,
          from: { owner: "you", zone: "bench", index },
          to: { owner: "you", zone: "active" },
        }),
      );
      refresh();
    };
    return { drop, refresh, state: () => state, onAction };
  }

  it("automatically pays the exact cost and swaps into the dragged bench slot", () => {
    const initial = board();
    const energy = initial.players.p1.active?.energy[0];
    const match = show(initial);
    const props = currentLayer();
    expect(
      props.placementPredicate?.(
        props.board,
        { owner: "you", zone: "bench", index: 1 },
        { owner: "you", zone: "active" },
        "pokemon",
      ),
    ).toBe(true);
    match.drop();
    expect(screen.queryByRole("dialog")).toBeNull();
    const next = match.state();
    expect(next.players.p1.active?.stack).toEqual(initial.players.p1.bench[1]?.stack);
    expect(next.players.p1.bench.map((pokemon) => pokemon.stack)).toEqual([
      initial.players.p1.bench[0]?.stack,
      initial.players.p1.active?.stack,
      initial.players.p1.bench[2]?.stack,
    ]);
    expect(next.players.p1.bench[1]?.energy).toEqual([]);
    expect(next.players.p1.discard).toContain(energy);
    expect(next.allowances.retreated).toBe(true);
  });

  it("retreats for free without discarding attached energy or prompting", () => {
    const initial = board(2, true);
    const match = show(initial);
    match.drop();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(match.state().players.p1.bench[1]?.energy).toEqual(initial.players.p1.active?.energy);
    expect(match.state().players.p1.discard).toEqual(initial.players.p1.discard);
  });

  it("requires an exact energy selection, keeping the dragged Pokémon selected", () => {
    const initial = board(2);
    const match = show(initial);
    match.drop();
    const dialog = screen.getByRole("dialog", { name: "Choose retreat energy" });
    const confirm = within(dialog).getByRole<HTMLButtonElement>("button", { name: "Retreat" });
    expect(confirm.disabled).toBe(true);
    expect(match.state()).toEqual(initial);
    const choices = within(dialog).getAllByRole("button", { name: "fix-energy" });
    const second = choices[1];
    if (second === undefined) throw new Error("Expected two energy choices");
    fireEvent.click(second);
    expect(confirm.disabled).toBe(false);
    fireEvent.click(choices[0] ?? second);
    expect(second.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(second);
    expect(confirm.disabled).toBe(true);
    fireEvent.click(second);
    fireEvent.click(confirm);
    match.refresh();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(match.state().players.p1.active?.stack).toEqual(initial.players.p1.bench[1]?.stack);
    expect(match.state().players.p1.bench[1]?.energy).toEqual([
      initial.players.p1.active?.energy[0],
    ]);
    expect(match.state().players.p1.discard).toContain(initial.players.p1.active?.energy[1]);
  });

  it("cancels without paying energy or moving either Pokémon", () => {
    const initial = board(2);
    const match = show(initial);
    match.drop();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(match.state()).toEqual(initial);
    match.drop();
    expect(
      within(screen.getByRole("dialog")).getByRole<HTMLButtonElement>("button", { name: "Retreat" })
        .disabled,
    ).toBe(true);
  });

  it("discards two selected energies for a cost of two and preserves the surplus", () => {
    const initial = board(3, false, 2);
    const match = show(initial);
    match.drop();
    const dialog = screen.getByRole("dialog", { name: "Choose retreat energy" });
    const choices = within(dialog).getAllByRole("button", { name: "fix-energy" });
    const confirm = within(dialog).getByRole<HTMLButtonElement>("button", { name: "Retreat" });
    const [first, second, third] = choices;
    if (!first || !second || !third) throw new Error("Expected three attached energies");
    fireEvent.click(second);
    expect(confirm.disabled).toBe(true);
    fireEvent.click(third);
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    match.refresh();
    expect(match.state().players.p1.bench[1]?.energy).toEqual([
      initial.players.p1.active?.energy[0],
    ]);
    expect(match.state().players.p1.discard.slice(-2)).toEqual(
      initial.players.p1.active?.energy.slice(1),
    );
  });

  it("allows a Confused retreat and clears the outgoing Active's conditions", () => {
    const initial = board();
    const active = initial.players.p1.active;
    if (active === null) throw new Error("Expected Active");
    const state: GameState = {
      ...initial,
      players: {
        ...initial.players,
        p1: {
          ...initial.players.p1,
          active: {
            ...active,
            conditions: {
              ...active.conditions,
              rotation: "confused",
              poisonDamage: 10,
              burned: true,
            },
          },
        },
      },
    };
    const match = show(state);
    match.drop();
    expect(match.state().players.p1.bench[1]?.conditions).toMatchObject({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
    });
    expect(match.state().allowances.retreated).toBe(true);
  });

  it.each([
    "insufficient energy",
    "asleep",
    "paralyzed",
    "already retreated",
    "attack lock",
    "wrong turn",
  ])("rejects a retreat with %s", (reason) => {
    let initial = board(reason === "insufficient energy" ? 0 : 1);
    const active = initial.players.p1.active;
    if (active === null) throw new Error("Expected Active");
    if (reason === "asleep" || reason === "paralyzed") {
      initial = {
        ...initial,
        players: {
          ...initial.players,
          p1: {
            ...initial.players.p1,
            active: { ...active, conditions: { ...active.conditions, rotation: reason } },
          },
        },
      };
    }
    if (reason === "attack lock")
      initial = {
        ...initial,
        players: {
          ...initial.players,
          p1: {
            ...initial.players.p1,
            active: { ...active, retreatBlocked: true },
          },
        },
      };
    if (reason === "already retreated")
      initial = { ...initial, allowances: { ...initial.allowances, retreated: true } };
    if (reason === "wrong turn")
      initial = { ...initial, phase: { kind: "turn:action", seat: "p2" } };
    const match = show(initial);
    const props = currentLayer();
    expect(
      props.placementPredicate?.(
        props.board,
        { owner: "you", zone: "bench", index: 1 },
        { owner: "you", zone: "active" },
        "pokemon",
      ),
    ).toBe(false);
    match.drop();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(match.state()).toEqual(initial);
  });

  it("ignores stale card identities and indices", () => {
    const initial = board();
    const match = show(initial);
    match.drop(1, "missing");
    match.drop(1, currentLayer().board.you.bench[0]?.id);
    expect(match.state()).toEqual(initial);
  });
});

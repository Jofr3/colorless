// @vitest-environment jsdom
// Regression: one "Turn actions" panel leaked per turn. TurnPanel and
// the former PrizeDialog sat in GameHud's fragment as siblings sharing key={seatKey};
// React's keyed reconciliation maps the leftover old children BY KEY, so the
// duplicate collapsed to one map entry and the shadowed TurnPanel fiber was
// never deleted when seatKey changed — an orphaned-but-mounted tree with
// stale props and live buttons. The real PlaymatView shell stays in the
// tree (the leak's DOM parent); only the Pixi canvas layer is stubbed.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  driveSetup,
  deckOf,
  attachFromDeck,
  finishOpeningSetup,
  ALL_BASIC_DECK,
  mustCreate,
  mustApply,
  ONE_BASIC_DECK,
  trainerCard,
} from "../../../packages/engine/src/testFixtures";
import { installDomShims } from "../../test/domShims";
import { LocalMatch } from "./LocalMatch";
import type { PlaymatViewProps } from "../playmat/PlaymatView";

// Pixi can't initialise in jsdom (no WebGL); everything else is real.
const cardsLayer = vi.fn();
vi.mock("../playmat/components/AnimatedCardsLayer", () => ({
  AnimatedCardsLayer: (
    props: PlaymatViewProps & { blueBackPlayer: string; turnNumber: number },
  ) => {
    cardsLayer(props);
    const { blueBackPlayer, turnNumber } = props;
    return (
      <div
        data-testid="animated-card-layer"
        data-blue-back-player={blueBackPlayer}
        data-turn-number={turnNumber}
      />
    );
  },
}));

beforeAll(installDomShims);
afterEach(() => {
  cleanup();
  cardsLayer.mockClear();
});

function renderMatch() {
  render(
    // StrictMode to match src/main.tsx — the leak must stay fixed under it.
    <StrictMode>
      <MemoryRouter>
        <LocalMatch
          setup={{
            state: driveSetup(7),
            events: [],
            names: { p1: "Player 1", p2: "Player 2" },
            startedAt: 0,
          }}
          onPlayAgain={() => {}}
        />
      </MemoryRouter>
    </StrictMode>,
  );
}

describe("LocalMatch HUD across turns", () => {
  it("reorders the bench by drag and saves the complete Pokémon in the new order", () => {
    const state = driveSetup(
      3,
      { p1: ALL_BASIC_DECK, p2: ALL_BASIC_DECK },
      {
        first: "p1",
        bench: { p1: Array(5).fill("fix-basic-1") },
      },
    );
    const onSave = vi.fn();
    render(
      <MemoryRouter>
        <LocalMatch
          setup={{ state, events: [], names: { p1: "One", p2: "Two" }, startedAt: 0 }}
          onPlayAgain={() => {}}
          onSave={onSave}
        />
      </MemoryRouter>,
    );
    const props = cardsLayer.mock.calls.at(-1)?.[0] as PlaymatViewProps;
    const first = props.board.you.bench[0];
    if (first === undefined) throw new Error("Expected a benched Pokémon");
    const from = { owner: "you", zone: "bench", index: 0 } as const;
    const to = { owner: "you", zone: "bench", index: 4 } as const;
    expect(props.placementPredicate?.(props.board, from, to, "pokemon")).toBe(true);
    act(() => props.onMoveCard({ cardId: first.id, from, to }));
    const current = cardsLayer.mock.calls.at(-1)?.[0] as PlaymatViewProps;
    expect(current.board.you.bench).toEqual([...props.board.you.bench.slice(1), first]);
    expect(onSave.mock.calls.at(-1)?.[0].state.players.p1.bench).toEqual([
      ...state.players.p1.bench.slice(1),
      state.players.p1.bench[0],
    ]);
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it.each([
    ["turn-draw", "Drawing a card for the turn."],
    ["prize-take", "Adding Prize cards to the player's hand."],
  ] as const)("keeps the current turn and revealed board during %s, then restores the actions", (stage, announcement) => {
    renderMatch();
    act(() => cardsLayer.mock.calls.at(-1)?.[0].onSetupAnimationChange(stage));
    const playmat = screen.getByRole("region", { name: "Trading card game playmat" });
    expect(playmat.getAttribute("data-setup-animation")).toBe(stage);
    expect(screen.getByText(/^Turn 1\./)).toBeTruthy();
    expect(cardsLayer.mock.calls.at(-1)?.[0].holdSetupReveal).toBe(false);
    expect(screen.getByText(announcement)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Turn actions" })).toBeNull();
    expect(screen.getByRole("button", { name: "Pass turn" }).closest("[inert]")).not.toBeNull();
    act(() => cardsLayer.mock.calls.at(-1)?.[0].onSetupAnimationChange(null));
    expect(playmat.hasAttribute("data-setup-animation")).toBe(false);
    expect(screen.getByRole("region", { name: "Turn actions" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pass turn" }).closest("[inert]")).toBeNull();
  });

  it("collects a knockout prize automatically into the saved hand under StrictMode", () => {
    let state = driveSetup(11, {
      p1: deckOf({ "fix-attacker": 30, "fix-fire-energy": 20, "fix-water-energy": 10 }),
      p2: deckOf({ "fix-weak": 40, "fix-water-energy": 20 }),
    }, { first: "p1", active: { p1: "fix-attacker", p2: "fix-weak" }, bench: { p2: ["fix-weak"] } });
    state = attachFromDeck(state, "p1", "fix-fire-energy", 1);
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    const onSave = vi.fn();
    render(
      <StrictMode><MemoryRouter>
        <LocalMatch setup={{ state, events: [], names: { p1: "One", p2: "Two" }, startedAt: 0 }} onSave={onSave} onPlayAgain={() => {}} />
      </MemoryRouter></StrictMode>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Bite/ }));
    const saved = onSave.mock.calls.at(-1)?.[0];
    expect(saved.state.players.p1.prizes).toHaveLength(5);
    expect(saved.state.players.p1.hand).toEqual([...state.players.p1.hand, state.players.p1.prizes[5]]);
    expect(saved.state.phase.kind).not.toBe("ko:takePrizes");
    expect(screen.queryByRole("dialog", { name: "Take prizes" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("passes from the restored control and enables history only for recorded turns", () => {
    renderMatch();
    const previous = () => screen.getByRole<HTMLButtonElement>("button", { name: "Previous turn" });
    const next = () => screen.getByRole<HTMLButtonElement>("button", { name: "Next turn" });
    expect(previous().disabled).toBe(true);
    expect(next().disabled).toBe(true);
    const firstBoard = cardsLayer.mock.calls.at(-1)?.[0].board;
    fireEvent.click(screen.getByRole("button", { name: "Pass turn" }));
    expect(cardsLayer.mock.calls.at(-1)?.[0].turnNumber).toBe(2);
    expect(previous().disabled).toBe(false);
    expect(next().disabled).toBe(true);
    const secondBoard = cardsLayer.mock.calls.at(-1)?.[0].board;
    fireEvent.click(previous());
    expect(cardsLayer.mock.calls.at(-1)?.[0].board).toEqual(firstBoard);
    expect(previous().disabled).toBe(true);
    expect(next().disabled).toBe(false);
    fireEvent.click(next());
    expect(cardsLayer.mock.calls.at(-1)?.[0].board).toEqual(secondBoard);
    expect(next().disabled).toBe(true);
  });

  it("returns an unusable Trainer drag silently without changing the saved game", () => {
    const initial = driveSetup(3, { p1: ALL_BASIC_DECK, p2: ALL_BASIC_DECK }, { first: "p1" });
    const uid = initial.players.p1.hand[0];
    if (uid === undefined) throw new Error("Expected a hand card");
    const state = {
      ...initial,
      cardIdByUid: { ...initial.cardIdByUid, [uid]: "sv01-189" },
      cardPool: {
        ...initial.cardPool,
        "sv01-189": trainerCard("sv01-189", "Supporter", ""),
      },
    };
    const onSave = vi.fn();
    render(
      <MemoryRouter>
        <LocalMatch
          setup={{ state, events: [], names: { p1: "One", p2: "Two" }, startedAt: 0 }}
          onPlayAgain={() => {}}
          onSave={onSave}
        />
      </MemoryRouter>,
    );
    const props = cardsLayer.mock.calls.at(-1)?.[0] as PlaymatViewProps;
    expect(props.usableTrainerIds?.has(uid)).toBe(false);
    onSave.mockClear();
    act(() =>
      props.onMoveCard({
        cardId: uid,
        from: { owner: "you", zone: "hand" },
        to: { owner: "you", zone: "playmat" },
      }),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
    expect(props.board.you.hand.some((card) => card.id === uid)).toBe(true);
  });

  it("puts both Buddy-Buddy Poffin selections on the bench without remounting", () => {
    const initial = driveSetup(3, { p1: ALL_BASIC_DECK, p2: ALL_BASIC_DECK }, { first: "p1" });
    const poffinUid = initial.players.p1.hand[0];
    if (poffinUid === undefined) throw new Error("Expected a card in hand");
    const state = {
      ...initial,
      cardIdByUid: { ...initial.cardIdByUid, [poffinUid]: "sv05-144" },
      cardPool: {
        ...initial.cardPool,
        "sv05-144": {
          ...trainerCard("sv05-144", "Item", ""),
          name: "Buddy-Buddy Poffin",
        },
      },
    };
    const onSave = vi.fn();
    render(
      <StrictMode>
        <MemoryRouter>
          <LocalMatch
            setup={{ state, events: [], names: { p1: "Player 1", p2: "Player 2" }, startedAt: 0 }}
            onPlayAgain={() => {}}
            onSave={onSave}
          />
        </MemoryRouter>
      </StrictMode>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Buddy-Buddy Poffin" }));
    const choices = screen.getAllByRole("button", { name: "fix-basic-1" });
    const [first, second] = choices;
    if (first === undefined || second === undefined) throw new Error("Expected two candidates");
    fireEvent.click(first);
    fireEvent.click(second);
    fireEvent.click(screen.getByRole("button", { name: "Take 2" }));

    const saved = onSave.mock.calls.at(-1)?.[0];
    expect(saved.state.phase.kind).toBe("turn:action");
    expect(saved.state.players.p1.bench).toHaveLength(2);
    const anchors = document.querySelectorAll<HTMLElement>(
      '[data-card-owner="you"][data-card-zone="bench"] [data-card-anchor="true"]',
    );
    expect([...anchors].map((anchor) => anchor.dataset.cardId)).toEqual(
      saved.state.players.p1.bench.map((pokemon: { stack: string[] }) => pokemon.stack.at(-1)),
    );
    expect(screen.queryByRole("dialog", { name: "Choose cards" })).toBeNull();
  });

  it("automatically draws both players' full mulligan bonuses without a prompt", () => {
    const created = mustCreate(1, { p1: ONE_BASIC_DECK, p2: ONE_BASIC_DECK });
    if (created.state.phase.kind !== "setup:chooseFirst") throw new Error("Expected coin choice");
    const pending = finishOpeningSetup(
      mustApply(created.state, {
        type: "chooseFirstPlayer",
        seat: created.state.phase.coinWinner,
        first: "p1",
      }).state,
    ).state;
    if (pending.phase.kind !== "setup:drawExtra") throw new Error("Expected mulligans");
    expect(pending.phase.owed.p1).toBeGreaterThan(0);
    expect(pending.phase.owed.p2).toBeGreaterThan(0);
    expect(pending.players.p1.prizes).toHaveLength(6);
    expect(pending.players.p2.prizes).toHaveLength(6);
    const onSave = vi.fn();
    render(
      <StrictMode>
        <MemoryRouter>
          <LocalMatch
            setup={{
              state: pending,
              events: [],
              names: { p1: "Player 1", p2: "Player 2" },
              startedAt: 0,
            }}
            onPlayAgain={() => {}}
            onSave={onSave}
          />
        </MemoryRouter>
      </StrictMode>,
    );
    const saved = onSave.mock.calls.at(-1)?.[0];
    expect(saved.state.phase.kind).toBe("turn:action");
    expect(
      saved.resume.turns.every(
        (turn: { game: { phase: { kind: string } } }) => turn.game.phase.kind !== "setup:drawExtra",
      ),
    ).toBe(true);
    for (const seat of ["p1", "p2"] as const) {
      expect(saved.state.players[seat].prizes).toEqual(pending.players[seat].prizes);
      expect(saved.state.players[seat].hand).toHaveLength(
        pending.players[seat].hand.length + pending.phase.owed[seat] + (seat === "p1" ? 1 : 0),
      );
      expect(saved.state.players[seat].deck).toHaveLength(
        pending.players[seat].deck.length - pending.phase.owed[seat] - (seat === "p1" ? 1 : 0),
      );
    }
    expect(screen.queryByLabelText("Mulligan draw")).toBeNull();
    expect(screen.queryByRole("button", { name: "Skip the draw" })).toBeNull();
    expect(
      screen.queryByText("Drag a Basic Pokémon from your hand to the Active slot."),
    ).toBeNull();
    expect(saved.state.players.p1.active).toEqual(pending.players.p1.active);
    expect(saved.state.players.p2.active).toEqual(pending.players.p2.active);
  });

  it("swaps deck and prize back colors with each hot-seat handoff", () => {
    renderMatch();
    const initialPerspective = document.body.dataset.perspective;
    const initialTurn = Number(screen.getByTestId("animated-card-layer").dataset.turnNumber);
    const anchors = Array.from(document.querySelectorAll<HTMLElement>("[data-card-back-tone]"));
    expect(anchors).toHaveLength(14);
    const initialColors = anchors.map((anchor) => anchor.dataset.cardBackTone);

    for (let pass = 1; pass <= 4; pass += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Pass" }));
      const swapped = pass % 2 === 1;
      expect(document.body.dataset.perspective === initialPerspective).toBe(!swapped);
      const current = Array.from(document.querySelectorAll<HTMLElement>("[data-card-back-tone]"));
      expect(current.map((anchor) => anchor.dataset.cardId)).toEqual(
        anchors.map((anchor) => anchor.dataset.cardId),
      );
      expect(current.map((anchor) => anchor.dataset.cardBackTone)).toEqual(
        initialColors.map((tone) => (swapped ? (tone === "blue" ? "red" : "blue") : tone)),
      );
      // The canvas must receive the same mapping as its deck/prize DOM anchors.
      const blueBackPlayer = screen.getByTestId("animated-card-layer").dataset.blueBackPlayer;
      expect(blueBackPlayer).toBe(document.body.dataset.perspective);
      expect(Number(screen.getByTestId("animated-card-layer").dataset.turnNumber)).toBe(
        initialTurn + pass,
      );
    }
  });

  it("keeps exactly one Turn actions panel as turns pass", () => {
    renderMatch();
    expect(document.querySelectorAll('[aria-label="Turn actions"]')).toHaveLength(1);

    // Each pass flips the hot-seat viewer and bumps game.turn — both parts
    // of seatKey — so every turn exercises the keyed remount. Driven from the
    // panel's own `Pass`, alongside the restored right-side control.
    for (let turn = 1; turn <= 6; turn += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Pass" }));
      expect(
        document.querySelectorAll('[aria-label="Turn actions"]'),
        `after ending turn ${turn}`,
      ).toHaveLength(1);
    }

    // The survivor is the CURRENT panel, not a leaked turn-1 instance (the
    // §4 note renders only while game.turn === 1).
    expect(document.body.textContent).not.toContain("No attacking on the first turn");
  });

  it("also passes the turn from the in-panel Pass button", () => {
    renderMatch();
    // Turn 1 is the going-first player's, so the §4 note is up — the probe the
    // leak test above uses for "this panel belongs to the current turn".
    expect(document.body.textContent).toContain("No attacking on the first turn");
    fireEvent.click(screen.getByRole("button", { name: "Pass" }));
    // The turn advanced: the note is gone and exactly one panel survives.
    expect(document.body.textContent).not.toContain("No attacking on the first turn");
    expect(document.querySelectorAll('[aria-label="Turn actions"]')).toHaveLength(1);
  });
});

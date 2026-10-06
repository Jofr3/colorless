// @vitest-environment jsdom
// Regression: one "Turn actions" panel leaked per turn. TurnPanel and
// PrizeDialog sat in GameHud's fragment as siblings sharing key={seatKey};
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
    // panel's own `Pass`, which since P5-4 is the only pass control this surface
    // has: the playmat's ⟶ was enabled exactly when the panel covered it, so it
    // was never clickable here, and it is no longer rendered.
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

  it("passes the turn from the IN-PANEL Pass button — the only one here", () => {
    // History: the playmat's ⟶ control (aria-label "Pass turn") was COVERED by
    // this panel at every ordinary viewport height — z-[75] bottom-right vs the
    // control's z-20 right-edge-centred box — so a real click there landed on an
    // attack row. The panel took over passing, and P5-4 removed the ⟶ from this
    // surface entirely rather than leave a control that could never be clicked.
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

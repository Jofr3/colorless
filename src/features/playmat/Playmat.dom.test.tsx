// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Card, Deck, DeckSummary } from "@luminous/schema";
import { applyAction } from "@luminous/engine";
import {
  driveSetup,
  handFromDeck,
  handUid,
  TRAINER_DECK,
  ALL_BASIC_DECK,
  mustCreate,
} from "../../../packages/engine/src/testFixtures";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomShims } from "../../test/domShims";
import { json, stubFetch } from "../../test/fetchStub";
import { cardBrief, USER } from "../../test/fixtures";
import { AuthProvider } from "../auth/AuthProvider";
import { clearCardPoolCache } from "../game/cardPool";
import { initHost } from "../game/useLocalGame";
import type { LocalGameSetup } from "../game/useLocalGame";
import { GamePage as Playmat } from "../game/GamePage";
import type { PlaymatViewProps } from "./PlaymatView";
import { loadSimulatorSave, saveSimulator, SIMULATOR_SAVE_KEY } from "./simulatorSave";

// Keep the setup, picker, API loading and board driver real; skip the canvas.
const view = vi.fn();
vi.mock("./PlaymatView", () => ({
  PlaymatView: (props: PlaymatViewProps) => {
    view(props);
    return <section aria-label="Playmat stub">{props.children}</section>;
  },
}));

beforeAll(installDomShims);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  view.mockClear();
  clearCardPoolCache();
});

const first: Deck = {
  id: "first",
  name: "Joltik deck",
  format: null,
  tint: 205,
  folderId: null,
  position: 0,
  updated: "2026-01-02T00:00:00.000Z",
  chosenCoverCardId: null,
  cards: [{ cardId: "sv06.5-001", count: 60 }],
};
const second: Deck = {
  ...first,
  id: "second",
  name: "Training deck",
  cards: [
    { cardId: "second-basic", count: 57 },
    { cardId: "tool", count: 1 },
    { cardId: "stadium", count: 1 },
    { cardId: "energy", count: 1 },
  ],
};

function fullCard(overrides: Partial<Card> = {}): Card {
  return {
    ...cardBrief(),
    illustrator: null,
    evolveFrom: null,
    retreat: 0,
    abilities: null,
    attacks: null,
    weaknesses: null,
    resistances: null,
    effect: null,
    variants: null,
    ...overrides,
  };
}

function stubApi(overrides: Record<string, () => Response> = {}) {
  const summaries: DeckSummary[] = [first, second].map(({ cards, ...deck }) => ({
    ...deck,
    cardCount: cards.reduce((sum, card) => sum + card.count, 0),
    coverCardId: null,
  }));
  return stubFetch({
    "GET /auth/me": () => json(USER),
    "GET /decks": () => json(summaries),
    "GET /folders": () => json([]),
    "GET /decks/first": () => json(first),
    "GET /decks/second": () => json(second),
    "GET /cards/sv06.5-001": () => json(fullCard()),
    "GET /cards/second-basic": () => json(fullCard({ id: "second-basic", name: "Second Basic" })),
    "GET /cards/tool": () =>
      json(fullCard({ id: "tool", category: "Trainer", trainerType: "Tool" })),
    "GET /cards/stadium": () =>
      json(fullCard({ id: "stadium", category: "Trainer", trainerType: "Stadium" })),
    "GET /cards/energy": () => json(fullCard({ id: "energy", category: "Energy" })),
    ...overrides,
  });
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/play"]}>
      <AuthProvider>
        <Playmat />
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function pick(player: number, name: string, change = false) {
  fireEvent.click(
    screen.getByRole("button", {
      name: `${change ? "Change" : "Choose"} deck for Player ${player}`,
    }),
  );
  const dialog = screen.getByRole("dialog", { name: `Choose a deck for Player ${player}` });
  fireEvent.click(await within(dialog).findByRole("button", { name: new RegExp(name) }));
}

function currentView(): PlaymatViewProps {
  return view.mock.calls.at(-1)?.[0] as PlaymatViewProps;
}

function reloadPage() {
  cleanup();
  clearCardPoolCache();
  view.mockClear();
  // A refresh must not need the saved decks or catalog to be available again.
  stubFetch({ "GET /auth/me": () => json(USER) });
  renderPage();
}

function savedSetup(state = driveSetup(7)): LocalGameSetup {
  const setup = { state, events: [], names: { p1: "Player 1", p2: "Player 2" }, startedAt: 1000 };
  const host = initHost(setup);
  return { ...setup, resume: { log: host.log, viewerSeat: host.viewerSeat } };
}

describe("Play deck setup", () => {
  it.each([
    { label: "Go first", seed: 1, firstPlayer: "p1" },
    { label: "Go second", seed: 3, firstPlayer: "p2" },
    { label: "Coin flip (random)", seed: 1, firstPlayer: "p2" },
    { label: "Coin flip (random)", seed: 3, firstPlayer: "p1" },
  ])("$label starts $firstPlayer first with seed $seed", async ({ label, seed, firstPlayer }) => {
    stubApi();
    renderPage();
    expect(screen.queryByRole("button", { name: "Coin flip (random)" })).toBeNull();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    await pick(1, first.name);
    await pick(2, second.name);
    // Seeds 1 and 3 yield opposite coin winners. The manual choices above
    // deliberately oppose the toss, proving they refer to Player 1.
    vi.spyOn(Date, "now").mockReturnValue(seed);
    fireEvent.click(screen.getByRole("button", { name: "Start game" }));
    const choices = await screen.findByRole("region", { name: "Starting player" });
    expect(currentView().board.you.hand).toHaveLength(0);
    expect(currentView().piles?.you.deckCount).toBe(60);
    expect(within(choices).getAllByRole("button")).toHaveLength(3);
    expect(loadSimulatorSave()?.state.firstPlayer).toBeNull();
    reloadPage();
    expect(screen.getByRole("region", { name: "Starting player" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: label }));
    await screen.findByLabelText("Setup placement");
    expect(screen.queryByLabelText("Coin toss")).toBeNull();
    expect(loadSimulatorSave()?.state.firstPlayer).toBe(firstPlayer);
    expect(currentView().board.you.hand).toHaveLength(7);
    expect(currentView().piles?.you.deckCount).toBe(53);
    const log = currentView()
      .logEntries.flatMap((entry) =>
        entry.kind === "action" ? entry.segments.map((segment) => segment.text) : [],
      )
      .join("");
    expect(log).toContain(`${firstPlayer === "p1" ? "Player 1" : "Player 2"} goes first`);
    reloadPage();
    expect(loadSimulatorSave()?.state.firstPlayer).toBe(firstPlayer);
  });

  it("starts a normal game with seven-card hands, prizes, setup and turn draws", async () => {
    stubApi();
    renderPage();
    const start = screen.getByRole<HTMLButtonElement>("button", { name: "Start game" });
    expect(start.disabled).toBe(true);
    expect(view).not.toHaveBeenCalled();
    await pick(1, first.name);
    expect(start.disabled).toBe(true);
    await pick(2, second.name);
    expect(start.disabled).toBe(false);
    fireEvent.click(start);
    await screen.findByLabelText("Starting player");
    fireEvent.click(screen.getByRole("button", { name: "Coin flip (random)" }));
    await screen.findByLabelText("Setup placement");
    expect(currentView().board.you.hand).toHaveLength(7);
    expect(currentView().board.opponent.hand).toHaveLength(7);
    expect(currentView().piles?.you.deckCount).toBe(53);
    expect(currentView().piles?.opponent.deckCount).toBe(53);
    expect(currentView().board.you.prizesRemaining).toBe(0);
    expect(currentView().board.opponent.prizesRemaining).toBe(0);
    const names = new Set<string>();
    const dealtIds: string[] = [];
    for (let seat = 0; seat < 2; seat++) {
      const props = currentView();
      names.add(props.turn.youName);
      dealtIds.push(...props.board.you.hand.map((card) => card.cardId));
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Ready" }).disabled).toBe(true);
      const basic = props.board.you.hand.find((card) => card.type === "pokemon");
      if (!basic) throw new Error("Expected a Basic in the opening hand");
      act(() =>
        props.onMoveCard({
          cardId: basic.id,
          from: { owner: "you", zone: "hand" },
          to: { owner: "you", zone: "active" },
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Ready" }));
      if (seat === 0) {
        const beforeRefresh = currentView();
        const saved = loadSimulatorSave();
        expect(saved).not.toBeNull();
        reloadPage();
        expect(currentView().board).toEqual(beforeRefresh.board);
        expect(currentView().turn).toEqual(beforeRefresh.turn);
        expect(loadSimulatorSave()).toEqual(saved);
      }
    }
    expect(names).toEqual(new Set(["Player 1", "Player 2"]));
    expect(dealtIds).toContain("sv06.5-001");
    expect(dealtIds).toContain("second-basic");
    await screen.findByLabelText("Turn actions");
    const started = currentView();
    expect(started.turn.turn).toBe(1);
    expect(started.board.you.prizesRemaining).toBe(6);
    expect(started.board.opponent.prizesRemaining).toBe(6);
    expect(started.board.you.hand).toHaveLength(7); // 7 - active + first turn draw
    expect(started.board.opponent.hand).toHaveLength(6);
    expect(started.piles?.you.deckCount).toBe(46);
    expect(started.piles?.opponent.deckCount).toBe(47);
    expect(started.logEntries.length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Pass" }));
    expect(currentView().turn.turn).toBe(2);
    expect(currentView().turn.youName).not.toBe(started.turn.youName);
    expect(currentView().board.you.hand).toHaveLength(7);
    expect(currentView().piles?.you.deckCount).toBe(46);
    const beforeRefresh = currentView();
    const saved = loadSimulatorSave();
    reloadPage();
    expect(currentView().board).toEqual(beforeRefresh.board);
    expect(currentView().turn).toEqual(beforeRefresh.turn);
    expect(currentView().piles).toEqual(beforeRefresh.piles);
    expect(currentView().logEntries).toEqual(beforeRefresh.logEntries);
    expect(loadSimulatorSave()).toEqual(saved);
    fireEvent.click(screen.getByRole("button", { name: "Pass" }));
    expect(currentView().turn.turn).toBe(3);
  });

  it("allows changing a pick and using the same deck with independent card identities", async () => {
    stubApi();
    renderPage();
    await pick(1, second.name);
    await pick(1, first.name, true);
    await pick(2, first.name);
    fireEvent.click(screen.getByRole("button", { name: "Start game" }));
    await screen.findByLabelText("Starting player");
    fireEvent.click(screen.getByRole("button", { name: "Coin flip (random)" }));
    await screen.findByLabelText("Setup placement");
    const firstHand = currentView().board.you.hand;
    const basic = firstHand[0];
    if (!basic) throw new Error("Expected an opening hand");
    act(() =>
      currentView().onMoveCard({
        cardId: basic.id,
        from: { owner: "you", zone: "hand" },
        to: { owner: "you", zone: "active" },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Ready" }));
    const secondHand = currentView().board.you.hand;
    const cards = [...firstHand, ...secondHand];
    expect(cards).toHaveLength(14);
    expect(new Set(cards.map((card) => card.id)).size).toBe(14);
    expect(cards.every((card) => card.cardId === "sv06.5-001")).toBe(true);
  });

  it("retains selections after a load failure and allows retrying", async () => {
    let fail = true;
    stubApi({
      "GET /decks/second": () => (fail ? json({ error: "unavailable" }, 503) : json(second)),
    });
    renderPage();
    await pick(1, first.name);
    await pick(2, second.name);
    fireEvent.click(screen.getByRole("button", { name: "Start game" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't load the decks");
    expect(view).not.toHaveBeenCalled();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Start game" }));
    await screen.findByLabelText("Starting player");
    fireEvent.click(screen.getByRole("button", { name: "Coin flip (random)" }));
    await screen.findByLabelText("Setup placement");
  });

  it("rejects an empty deck without opening a demo board", async () => {
    stubApi({ "GET /decks/second": () => json({ ...second, cards: [] }) });
    renderPage();
    await pick(1, first.name);
    await pick(2, second.name);
    fireEvent.click(screen.getByRole("button", { name: "Start game" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Player 2 — “Training deck” has 0 cards; a deck needs exactly 60.",
    );
    expect(view).not.toHaveBeenCalled();
  });

  it("rejects a 60-card deck without a Basic Pokémon", async () => {
    stubApi({
      "GET /decks/second": () => json({ ...second, cards: [{ cardId: "energy", count: 60 }] }),
    });
    renderPage();
    await pick(1, first.name);
    await pick(2, second.name);
    fireEvent.click(screen.getByRole("button", { name: "Start game" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Player 2 has no Basic Pokémon",
    );
    expect(view).not.toHaveBeenCalled();
  });

  it("reports missing catalog cards without starting a partial board", async () => {
    stubApi({ "GET /cards/stadium": () => json({ error: "not found" }, 404) });
    renderPage();
    await pick(1, first.name);
    await pick(2, second.name);
    fireEvent.click(screen.getByRole("button", { name: "Start game" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "These cards aren't in the catalog: stadium",
    );
    expect(view).not.toHaveBeenCalled();
  });

  it("uses the online sign-in prompt for an anonymous player", async () => {
    stubApi({ "GET /auth/me": () => json({ error: "unauthorized" }, 401) });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Choose deck for Player 1" }));
    await screen.findByText("Sign in to use your decks.");
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login");
    await waitFor(() => expect(view).not.toHaveBeenCalled());
  });
});

describe("Simulator saved games", () => {
  it("rewinds setup handoffs across refresh and replays the starting-player choice", () => {
    const created = mustCreate(170, { p1: ALL_BASIC_DECK, p2: ALL_BASIC_DECK });
    saveSimulator(savedSetup(created.state));
    stubApi();
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Go first" }));
    const placements: PlaymatViewProps[] = [];
    for (let player = 0; player < 2; player++) {
      const props = currentView();
      placements.push(props);
      const basic = props.board.you.hand[0];
      if (!basic) throw new Error("Expected an opening Basic");
      act(() =>
        props.onMoveCard({
          cardId: basic.id,
          from: { owner: "you", zone: "hand" },
          to: { owner: "you", zone: "active" },
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Ready" }));
    }
    const started = currentView();
    expect(started.turn.turn).toBe(1);
    act(() => currentView().onPreviousTurn?.());
    expect(currentView().turn.turn).toBe(0);
    expect(currentView().board).toEqual(placements[1]?.board);
    expect(currentView().nextTurnDisabled).toBe(false);
    reloadPage();
    expect(currentView().board).toEqual(placements[1]?.board);
    act(() => currentView().onNextTurn?.());
    expect(currentView().board).toEqual(started.board);
    act(() => currentView().onPreviousTurn?.());
    act(() => currentView().onPreviousTurn?.());
    expect(currentView().board).toEqual(placements[0]?.board);
    act(() => currentView().onPreviousTurn?.());
    expect(screen.getByRole("region", { name: "Starting player" })).toBeTruthy();
    expect(currentView().previousTurnDisabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Go second" }));
    expect(loadSimulatorSave()?.state.firstPlayer).toBe("p2");
    expect(currentView().nextTurnDisabled).toBe(true);
  });

  it("restores a rewound turn and its future, then replaces that future when replaying", () => {
    saveSimulator(savedSetup());
    stubApi();
    renderPage();
    const first = currentView();
    act(() => first.onPassTurn?.());
    const second = currentView();
    act(() => second.onPassTurn?.());
    const latest = currentView();
    act(() => latest.onPreviousTurn?.());
    expect(currentView().turn.turn).toBe(2);
    expect(currentView().nextTurnDisabled).toBe(false);
    const raw = JSON.parse(localStorage.getItem(SIMULATOR_SAVE_KEY) ?? "null");
    expect(raw.snapshot.resume.turns[0].game.cardPool).toBeUndefined();
    const saved = loadSimulatorSave();
    expect(saved?.resume?.turns?.[0]?.game.cardPool).toEqual(saved?.state.cardPool);
    reloadPage();
    expect(currentView().board).toEqual(second.board);
    act(() => currentView().onNextTurn?.());
    expect(currentView().board).toEqual(latest.board);
    expect(currentView().nextTurnDisabled).toBe(true);
    act(() => currentView().onPreviousTurn?.());
    act(() => currentView().onPreviousTurn?.());
    expect(currentView().board).toEqual(first.board);
    act(() => currentView().onPassTurn?.());
    expect(currentView().turn.turn).toBe(2);
    expect(currentView().nextTurnDisabled).toBe(true);
    reloadPage();
    expect(currentView().nextTurnDisabled).toBe(true);
    expect(currentView().previousTurnDisabled).toBe(false);
  });

  it("plays an Item dropped on the mat and opens its choice dialog", async () => {
    const state = handFromDeck(
      driveSetup(7, { p1: TRAINER_DECK, p2: TRAINER_DECK }, { first: "p1" }),
      "p1",
      "sv01-181",
      1,
    );
    const uid = handUid(state, "p1", "sv01-181");
    saveSimulator(savedSetup(state));
    stubApi();
    renderPage();
    const props = currentView();
    const from = { owner: "you", zone: "hand" } as const;
    const to = { owner: "you", zone: "playmat" } as const;
    expect(props.placementPredicate?.(props.board, from, to, "trainer")).toBe(true);
    act(() => props.onMoveCard({ cardId: uid, from, to }));
    await screen.findByRole("dialog", { name: "Choose cards" });
    expect(loadSimulatorSave()?.state.players.p1.discard).toContain(uid);
    expect(currentView().board.you.hand.some((card) => card.id === uid)).toBe(false);
  });

  it("restores a pending card search and its continuation, including shuffle RNG", async () => {
    const state = handFromDeck(
      driveSetup(7, { p1: TRAINER_DECK, p2: TRAINER_DECK }, { first: "p1" }),
      "p1",
      "sv01-181",
      1,
    );
    saveSimulator(savedSetup(state));
    stubApi();
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "sv01-181" }));
    await screen.findByRole("dialog", { name: "Choose cards" });
    const saved = loadSimulatorSave();
    expect(saved?.state.phase.kind).toBe("effect:choose");
    expect(saved?.state.players.p1.discard).toContain(handUid(state, "p1", "sv01-181"));
    reloadPage();
    await screen.findByRole("dialog", { name: "Choose cards" });
    expect(loadSimulatorSave()).toEqual(saved);
    if (!saved) throw new Error("Expected saved search");
    const expected = applyAction(saved.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [] },
    });
    expect(expected.ok).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Take none" }));
    expect(screen.queryByRole("dialog", { name: "Choose cards" })).toBeNull();
    if (expected.ok) expect(loadSimulatorSave()?.state).toEqual(expected.state);
  });

  it("clears the completed game when Play again is clicked", () => {
    const state = driveSetup(7);
    state.phase = {
      kind: "gameOver",
      outcome: { result: "win", winner: "p1", reason: "prizesTaken" },
    };
    saveSimulator(savedSetup(state));
    stubApi();
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    expect(localStorage.getItem(SIMULATOR_SAVE_KEY)).toBeNull();
    reloadPage();
    expect(screen.getByRole("button", { name: "Choose deck for Player 1" })).toBeTruthy();
    expect(screen.queryByLabelText("Playmat stub")).toBeNull();
  });

  it("falls back to deck selection for malformed or incompatible saves", () => {
    const setup = savedSetup();
    saveSimulator(setup);
    const record = JSON.parse(localStorage.getItem(SIMULATOR_SAVE_KEY) ?? "null");
    for (const raw of [
      "{bad json",
      "null",
      "{}",
      JSON.stringify({ ...record, engineVersion: "old-engine" }),
      JSON.stringify({ ...record, snapshot: { ...setup, state: {} } }),
    ]) {
      localStorage.setItem(SIMULATOR_SAVE_KEY, raw);
      expect(loadSimulatorSave()).toBeNull();
    }
    stubApi();
    renderPage();
    expect(screen.getByRole("button", { name: "Choose deck for Player 1" })).toBeTruthy();
  });

  it("keeps the game playable when browser storage is unavailable", async () => {
    saveSimulator(savedSetup());
    stubApi();
    renderPage();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    fireEvent.click(screen.getByRole("button", { name: "Pass" }));
    expect(currentView().turn.turn).toBe(2);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadSimulatorSave()).toBeNull();
  });
});

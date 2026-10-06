// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Card, Deck, DeckSummary } from "@luminous/schema";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomShims } from "../../test/domShims";
import { json, stubFetch } from "../../test/fetchStub";
import { cardBrief, USER } from "../../test/fixtures";
import { AuthProvider } from "../auth/AuthProvider";
import { clearCardPoolCache } from "../game/cardPool";
import { Playmat } from "./Playmat";
import type { PlaymatViewProps } from "./PlaymatView";

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
  vi.unstubAllGlobals();
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
    <MemoryRouter initialEntries={["/simulator"]}>
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

describe("Sandbox deck setup", () => {
  it("starts a normal game with seven-card hands, prizes, setup and turn draws", async () => {
    stubApi();
    renderPage();
    const start = screen.getByRole<HTMLButtonElement>("button", { name: "Start sandbox" });
    expect(start.disabled).toBe(true);
    expect(view).not.toHaveBeenCalled();
    await pick(1, first.name);
    expect(start.disabled).toBe(true);
    await pick(2, second.name);
    expect(start.disabled).toBe(false);
    fireEvent.click(start);
    await screen.findByLabelText("Coin toss");
    expect(currentView().board.you.hand).toHaveLength(0);
    expect(currentView().piles?.you.deckCount).toBe(60);
    fireEvent.click(screen.getByRole("button", { name: "Go first" }));
    await screen.findByLabelText("Setup placement");
    expect(currentView().board.you.hand).toHaveLength(7);
    expect(currentView().board.opponent.hand).toHaveLength(7);
    expect(currentView().piles?.you.deckCount).toBe(53);
    expect(currentView().piles?.opponent.deckCount).toBe(53);
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
  });

  it("allows changing a pick and using the same deck with independent card identities", async () => {
    stubApi();
    renderPage();
    await pick(1, second.name);
    await pick(1, first.name, true);
    await pick(2, first.name);
    fireEvent.click(screen.getByRole("button", { name: "Start sandbox" }));
    await screen.findByLabelText("Coin toss");
    fireEvent.click(screen.getByRole("button", { name: "Go first" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Start sandbox" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't load the decks");
    expect(view).not.toHaveBeenCalled();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Start sandbox" }));
    await screen.findByLabelText("Coin toss");
  });

  it("rejects an empty deck without opening a demo board", async () => {
    stubApi({ "GET /decks/second": () => json({ ...second, cards: [] }) });
    renderPage();
    await pick(1, first.name);
    await pick(2, second.name);
    fireEvent.click(screen.getByRole("button", { name: "Start sandbox" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Start sandbox" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Start sandbox" }));
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

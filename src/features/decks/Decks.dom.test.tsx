// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Decks } from "./Decks";

// jsdom doesn't implement these, and the tiles' tilt/scroll hooks probe them on
// mount. The keyboard move mode under test is index-based (no real geometry), so
// stubs are enough — no layout needed.
beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof window.ResizeObserver;
  }
});

afterEach(cleanup);

const renderDecks = () => render(
  <MemoryRouter>
    <Decks />
  </MemoryRouter>,
);

const deckOrder = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('[data-reorder-group="deck"]')].map(
    (el) => el.dataset.reorderId,
  );

describe("Decks — keyboard move mode", () => {
  it("reorders a deck among its siblings via the Move handle + arrow keys", () => {
    const { container } = renderDecks();
    expect(deckOrder(container)).toEqual(["deck-lugia", "deck-miraidon", "deck-snorlax"]);

    fireEvent.click(screen.getByRole("button", { name: "Move Lugia Archeops" }));
    expect(screen.getByRole("button", { name: "Drop here" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(deckOrder(container)).toEqual(["deck-miraidon", "deck-lugia", "deck-snorlax"]);

    fireEvent.click(screen.getByRole("button", { name: "Drop here" }));
    expect(screen.queryByRole("button", { name: "Drop here" })).toBeNull();
    expect(deckOrder(container)).toEqual(["deck-miraidon", "deck-lugia", "deck-snorlax"]);
  });

  it("reverts on Escape without committing", () => {
    const { container } = renderDecks();
    const before = deckOrder(container);

    fireEvent.click(screen.getByRole("button", { name: "Move Lugia Archeops" }));
    fireEvent.keyDown(window, { key: "ArrowRight" }); // preview a move
    fireEvent.keyDown(window, { key: "Escape" }); // cancel

    expect(screen.queryByRole("button", { name: "Drop here" })).toBeNull();
    expect(deckOrder(container)).toEqual(before);
  });

  it("nests a deck into a folder via the banner button", () => {
    const { container } = renderDecks();

    fireEvent.click(screen.getByRole("button", { name: "Move Lugia Archeops" }));
    fireEvent.click(screen.getByRole("button", { name: "Into Standard" }));

    // Lugia moved into Standard, so it leaves the root deck list.
    expect(deckOrder(container)).toEqual(["deck-miraidon", "deck-snorlax"]);
  });
});

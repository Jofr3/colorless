// @vitest-environment jsdom
// The cover picker (P5-6): Automatic is a real, selectable option rather than
// the absence of one, only drawable cards are offered, and the current pick is
// announced through aria-pressed rather than colour alone.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomShims } from "../../../test/domShims";
import { builderCard } from "../../../test/fixtures";
import { CoverDialog } from "./CoverDialog";

// jsdom's <dialog> lacks showModal/close; the shared shims polyfill it.
beforeAll(installDomShims);
afterEach(cleanup);

const card = (cardId: string, name: string, hasImage = true) =>
  builderCard({ cardId, name, supertype: "Pokémon", subtype: "Basic", hasImage });

const DECK = [
  { card: card("sv01-001", "Skeledirge"), quantity: 3 },
  { card: card("sv01-002", "Fuecoco"), quantity: 4 },
];

function renderDialog(over: { deck?: typeof DECK; chosenCoverCardId?: string | null } = {}) {
  const onChoose = vi.fn();
  const onClose = vi.fn();
  render(
    <CoverDialog
      open
      deck={over.deck ?? DECK}
      chosenCoverCardId={over.chosenCoverCardId ?? null}
      onChoose={onChoose}
      onClose={onClose}
    />,
  );
  return { onChoose, onClose };
}

const tile = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

describe("CoverDialog", () => {
  it("pins a card the owner picks", () => {
    const { onChoose } = renderDialog();
    fireEvent.click(tile("Use Fuecoco as the deck cover"));
    expect(onChoose).toHaveBeenCalledWith("sv01-002");
  });

  it("makes going back to the derived default a single click", () => {
    // Automatic is an OPTION, not the absence of one — otherwise a pick would
    // be irreversible.
    const { onChoose } = renderDialog({ chosenCoverCardId: "sv01-002" });
    fireEvent.click(tile("Automatic"));
    expect(onChoose).toHaveBeenCalledWith(null);
  });

  it("marks the current pick with aria-pressed, not colour alone", () => {
    renderDialog({ chosenCoverCardId: "sv01-001" });
    expect(tile("Use Skeledirge as the deck cover").getAttribute("aria-pressed")).toBe("true");
    expect(tile("Use Fuecoco as the deck cover").getAttribute("aria-pressed")).toBe("false");
    expect(tile("Automatic").getAttribute("aria-pressed")).toBe("false");
  });

  it("marks Automatic when nothing is pinned", () => {
    renderDialog();
    expect(tile("Automatic").getAttribute("aria-pressed")).toBe("true");
  });

  it("doesn't offer a card the catalog can't draw", () => {
    // A cover with no scan is a blank rectangle, and the server resolves such a
    // pin back to the default anyway.
    renderDialog({
      deck: [
        { card: card("sv01-001", "Skeledirge"), quantity: 3 },
        { card: card("sv01-003", "Unscanned", false), quantity: 1 },
      ],
    });
    expect(screen.queryByRole("button", { name: /Unscanned/ })).toBeNull();
    expect(tile("Use Skeledirge as the deck cover")).toBeTruthy();
  });

  it("says so plainly when there is nothing to pick", () => {
    renderDialog({ deck: [] });
    expect(screen.getByText(/Add some cards/)).toBeTruthy();
    // Automatic still stands: the deck has a face, it just isn't chosen.
    expect(tile("Automatic")).toBeTruthy();
  });
});

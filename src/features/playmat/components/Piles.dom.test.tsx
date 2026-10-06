// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { installDomShims } from "../../../test/domShims";
import type { CardModel } from "../types";
import { DiscardPile } from "./Piles";

beforeAll(installDomShims);
afterEach(cleanup);

const cards: CardModel[] = [
  { id: "budew-1", cardId: "budew", name: "Budew", type: "pokemon" },
  { id: "dunsparce-1", cardId: "dunsparce", name: "Dunsparce", type: "pokemon" },
  { id: "budew-2", cardId: "budew", name: "Budew", type: "pokemon" },
];

describe("discard pile popup", () => {
  it("shows every physical card newest first without changing the pile", () => {
    render(
      <StrictMode>
        <DiscardPile owner="you" discard={cards} />
      </StrictMode>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View your discard pile" }));
    const dialog = screen.getByRole("dialog", { name: "Your discard pile" });
    expect(
      within(dialog)
        .getAllByRole("img")
        .map((image) => image.getAttribute("aria-label")),
    ).toEqual(["Budew", "Dunsparce", "Budew"]);
    expect(
      within(dialog)
        .getAllByRole("listitem")
        .map((item) => item.dataset.discardId),
    ).toEqual(["budew-2", "dunsparce-1", "budew-1"]);
    expect(cards.map((card) => card.id)).toEqual(["budew-1", "dunsparce-1", "budew-2"]);
    fireEvent.click(screen.getByRole("button", { name: "Close discard pile" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("img", { name: "Discard pile, top card Budew" })).toBeTruthy();
  });

  it("shows the opponent's live discard and dismisses on Escape or backdrop click", () => {
    const { rerender } = render(<DiscardPile owner="opponent" discard={cards} />);
    const open = () =>
      fireEvent.click(screen.getByRole("button", { name: "View opponent's discard pile" }));
    open();
    rerender(<DiscardPile owner="opponent" discard={cards.slice(0, 1)} />);
    const dialog = screen.getByRole("dialog", { name: "Opponent's discard pile" });
    expect(within(dialog).getAllByRole("img")).toHaveLength(1);
    expect(within(dialog).getByText("1 card · Newest first")).toBeTruthy();
    fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    open();
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens an empty pile without offering fake cards", () => {
    render(<DiscardPile owner="you" discard={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "View your discard pile" }));
    const dialog = screen.getByRole("dialog", { name: "Your discard pile" });
    expect(within(dialog).getByText("No discarded cards yet.")).toBeTruthy();
    expect(within(dialog).queryByRole("img")).toBeNull();
  });
});

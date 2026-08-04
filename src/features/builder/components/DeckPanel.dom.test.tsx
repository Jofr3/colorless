// @vitest-environment jsdom
// The panel's pending-entry states: a hydrating entry shimmers inertly, a
// 404-known entry states "Not available" and offers Remove (the user's only
// way out — no BuilderCard exists to route through onRemove), and Clear stays
// usable while ONLY unrenderable entries remain. Plus the composition stats:
// per-supertype counts and the Pokémon type-distribution bar.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomShims } from "../../../test/domShims";
import { builderCard } from "../../../test/fixtures";
import { DEFAULT_FORMAT } from "../cards";
import { validateDeck } from "../deckMath";
import { DeckPanel, type DeckPanelProps } from "./DeckPanel";

beforeAll(installDomShims);
afterEach(cleanup);

function renderPanel(over: Partial<DeckPanelProps> = {}) {
  const onRemoveEntry = vi.fn();
  const onClear = vi.fn();
  const onChooseCover = vi.fn();
  render(
    <DeckPanel
      deckName="Test Deck"
      onRename={() => {}}
      deck={[]}
      pending={[]}
      total={0}
      validation={validateDeck([], DEFAULT_FORMAT)}
      format={DEFAULT_FORMAT}
      remainingOf={() => 0}
      onAdd={() => {}}
      onRemove={() => {}}
      onRemoveEntry={onRemoveEntry}
      onClear={onClear}
      onImportExport={() => {}}
      onChooseCover={onChooseCover}
      {...over}
    />,
  );
  return { onRemoveEntry, onClear, onChooseCover };
}

describe("DeckPanel — pending entries", () => {
  it("renders a hydrating entry as an inert loading tile", () => {
    renderPanel({ pending: [{ cardId: "sv01-001", quantity: 2, unknown: false }], total: 2 });
    expect(screen.getByRole("img", { name: "Loading card" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Remove unavailable/ })).toBeNull();
  });

  it("renders a 404-known entry as 'Not available' with a working remove control", () => {
    const { onRemoveEntry } = renderPanel({
      pending: [{ cardId: "gone-001", quantity: 3, unknown: true }],
      total: 3,
    });
    expect(screen.getByText("Not available")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove unavailable card gone-001" }));
    expect(onRemoveEntry).toHaveBeenCalledWith("gone-001");
  });

  it("keeps Clear enabled while only pending/unavailable entries remain", () => {
    const { onClear } = renderPanel({
      pending: [{ cardId: "gone-001", quantity: 1, unknown: true }],
      total: 1,
    });
    const clear = screen.getByRole("button", { name: "Clear deck" }) as HTMLButtonElement;
    expect(clear.disabled).toBe(false);
    fireEvent.click(clear);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("disables Clear on a truly empty deck", () => {
    renderPanel();
    const clear = screen.getByRole("button", { name: "Clear deck" }) as HTMLButtonElement;
    expect(clear.disabled).toBe(true);
  });

  it("withholds the cover picker while no hydrated card could be picked (P5-6)", () => {
    // Unlike Clear, this one needs a HYDRATED card: a pending or unavailable
    // entry has no art to front a deck with.
    renderPanel({ pending: [{ cardId: "gone-001", quantity: 1, unknown: true }], total: 1 });
    expect((screen.getByRole("button", { name: "Deck cover" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("opens the cover picker once the deck holds a real card", () => {
    const { onChooseCover } = renderPanel({ deck: [{ card: pikachu, quantity: 1 }], total: 1 });
    const cover = screen.getByRole("button", { name: "Deck cover" }) as HTMLButtonElement;
    expect(cover.disabled).toBe(false);
    fireEvent.click(cover);
    expect(onChooseCover).toHaveBeenCalledTimes(1);
  });
});

// Terse hydrated-card fixtures. `legal` is required (D191) but never spelled
// out here: the factory derives it from the printed mark, and these four are
// unmarked, so all four are Standard-legal — this suite is about the panel's
// composition stats, not legality.
const pikachu = builderCard({
  cardId: "sv1-25",
  name: "Pikachu",
  supertype: "Pokémon",
  subtype: "Basic",
  types: ["Lightning"],
});
const eevee = builderCard({
  cardId: "sv1-133",
  name: "Eevee",
  supertype: "Pokémon",
  subtype: "Basic",
  types: ["Colorless"],
});
const research = builderCard({
  cardId: "sv1-189",
  name: "Professor's Research",
  supertype: "Trainer",
  subtype: "Supporter",
});
const lightningEnergy = builderCard({
  cardId: "sve-4",
  name: "Lightning Energy",
  supertype: "Energy",
  subtype: "Basic Energy",
  types: ["Lightning"],
});

describe("DeckPanel — composition stats", () => {
  /** The <dd> count rendered next to a supertype's <dt> label. */
  const countOf = (label: string) => screen.getByText(label).nextElementSibling?.textContent;

  it("shows per-supertype counts and the type bar's text alternative", () => {
    const deck = [
      { card: pikachu, quantity: 3 },
      { card: eevee, quantity: 1 },
      { card: research, quantity: 2 },
      { card: lightningEnergy, quantity: 4 },
    ];
    renderPanel({ deck, total: 10, validation: validateDeck(deck, DEFAULT_FORMAT) });
    expect(countOf("Pokémon")).toBe("4");
    expect(countOf("Trainer")).toBe("2");
    expect(countOf("Energy")).toBe("4");
    // The bar's sr-only alternative: wheel order (Lightning before Colorless),
    // Pokémon only — the 4 Energy cards don't contribute.
    expect(screen.getByText("Pokémon types: Lightning 3, Colorless 1")).toBeTruthy();
  });

  it("counts only hydrated entries — pending/unavailable supertypes are unknown", () => {
    const deck = [{ card: pikachu, quantity: 1 }];
    renderPanel({
      deck,
      pending: [
        { cardId: "load-1", quantity: 2, unknown: false },
        { cardId: "gone-1", quantity: 3, unknown: true },
      ],
      total: 6,
      validation: validateDeck(deck, DEFAULT_FORMAT),
    });
    // The header total spans all 6 copies; the stats only the hydrated card.
    expect(countOf("Pokémon")).toBe("1");
    expect(countOf("Trainer")).toBe("0");
  });

  it("shows no stats (and no type bar) while nothing has hydrated", () => {
    renderPanel({ pending: [{ cardId: "load-1", quantity: 2, unknown: false }], total: 2 });
    expect(screen.queryByText("Pokémon")).toBeNull();
    expect(screen.queryByText(/^Pokémon types:/)).toBeNull();
  });

  it("omits the type bar when no hydrated Pokémon carries a type", () => {
    const deck = [{ card: research, quantity: 2 }];
    renderPanel({ deck, total: 2, validation: validateDeck(deck, DEFAULT_FORMAT) });
    expect(countOf("Trainer")).toBe("2");
    expect(screen.queryByText(/^Pokémon types:/)).toBeNull();
  });
});

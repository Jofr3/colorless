// @vitest-environment jsdom
// The card-detail modal: it must show the seeded name the instant it opens (so
// the header never flashes empty while getCard is in flight), render the full
// card once resolved, and recover from a failed fetch via Retry. The fetch is
// mocked here — the backend is exercised elsewhere; this covers the dialog's
// own loading/ready/error interaction and the glyph-type guard.

import type { Card } from "@luminous/schema";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomShims } from "../../../test/domShims";
import { builderCard } from "../../../test/fixtures";
import { CardDetailDialog, isGlyphType } from "./CardDetailDialog";

// getCard is the only backend touch; cardImageUrl just builds an <img src>, so
// a plain stub keeps the module runtime-complete under the mock.
vi.mock("../../../lib/api", () => ({
  getCard: vi.fn(),
  cardImageUrl: (id: string, quality: string) => `https://example.test/${id}/${quality}.webp`,
}));

import { getCard } from "../../../lib/api";

const getCardMock = vi.mocked(getCard);

// jsdom's <dialog> lacks showModal/close; the shared shims polyfill it.
beforeAll(installDomShims);

afterEach(() => {
  cleanup();
  getCardMock.mockReset();
});

const SEED = builderCard({
  cardId: "sv01-025",
  name: "Pikachu",
  supertype: "Pokémon",
  subtype: "Basic",
  hasImage: true,
});

const FULL: Card = {
  id: "sv01-025",
  setId: "sv01",
  localId: "025",
  name: "Pikachu",
  category: "Pokemon",
  image: "/assets/cards/sv01-025",
  illustrator: "Ken Sugimori",
  rarity: "Common",
  regulationMark: "G",
  hp: 60,
  stage: "Basic",
  evolveFrom: null,
  types: ["Lightning"],
  retreat: 1,
  abilities: [{ type: "Ability", name: "Static Charge", effect: "Once during your turn…" }],
  attacks: [{ cost: ["Lightning"], name: "Thunder Shock", effect: "Flip a coin.", damage: 30 }],
  weaknesses: [{ type: "Fighting", value: "×2" }],
  resistances: null,
  trainerType: null,
  energyType: null,
  effect: null,
  legal: { standard: true, expanded: true },
  variants: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("CardDetailDialog", () => {
  it("fetches the full card on open and renders its details", async () => {
    getCardMock.mockResolvedValue(FULL);
    render(<CardDetailDialog open card={SEED} onClose={vi.fn()} />);

    expect(getCardMock).toHaveBeenCalledWith("sv01-025");
    // The seeded name is up immediately, before the fetch resolves.
    expect(screen.getByRole("heading", { name: "Pikachu" })).toBeTruthy();

    await waitFor(() => expect(screen.getByText("Thunder Shock")).toBeTruthy());
    expect(screen.getByText("Static Charge")).toBeTruthy();
    expect(screen.getByText(/Ken Sugimori/)).toBeTruthy();
    // The set/number line is plain text — no set-name lookup.
    expect(screen.getByText(/025 · sv01/)).toBeTruthy();
  });

  it("shows the seeded name while the fetch is still loading", () => {
    // A never-resolving promise pins the dialog in its loading state.
    getCardMock.mockReturnValue(deferred<Card>().promise);
    render(<CardDetailDialog open card={SEED} onClose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Pikachu" })).toBeTruthy();
    expect(screen.getByText("Loading…")).toBeTruthy();
    // The attack only appears once ready.
    expect(screen.queryByText("Thunder Shock")).toBeNull();
  });

  it("surfaces an error and re-runs the fetch on Retry", async () => {
    getCardMock.mockRejectedValueOnce(new Error("boom"));
    render(<CardDetailDialog open card={SEED} onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/Couldn't load card details/)).toBeTruthy());
    expect(getCardMock).toHaveBeenCalledTimes(1);

    // Retry re-invokes getCard; this time it resolves and the details render.
    getCardMock.mockResolvedValueOnce(FULL);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.getByText("Thunder Shock")).toBeTruthy());
    expect(getCardMock).toHaveBeenCalledTimes(2);
  });

  it("closes via the close button", () => {
    getCardMock.mockResolvedValue(FULL);
    const onClose = vi.fn();
    render(<CardDetailDialog open card={SEED} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("isGlyphType", () => {
  it("accepts the ten glyph keys, including Colorless, and rejects the rest", () => {
    expect(isGlyphType("Water")).toBe(true);
    expect(isGlyphType("Colorless")).toBe(true);
    expect(isGlyphType("Dragon")).toBe(true);
    expect(isGlyphType("Fairy")).toBe(false);
    expect(isGlyphType("Bogus")).toBe(false);
  });
});

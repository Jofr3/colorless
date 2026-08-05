// @vitest-environment jsdom
// The page-level flow: pregame (demo decks, anonymous) → Start → a real
// createGame → the coin-toss HUD over the playmat. The heavy PlaymatView
// (Pixi/GSAP canvas) is stubbed to its children slot — the page logic, the
// engine and the HUD stay real.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import type { Card } from "@luminous/schema";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomShims } from "../../test/domShims";
import { json, stubFetch } from "../../test/fetchStub";
import { AuthProvider, useAuth } from "../auth/AuthProvider";
import { clearCardPoolCache } from "./cardPool";
import { DEMO_DECKS } from "./demoDecks";
import { GamePage } from "./GamePage";

vi.mock("../playmat", () => ({
  PlaymatView: ({ children }: { children?: ReactNode }) => (
    <section aria-label="Playmat stub">{children}</section>
  ),
}));

beforeAll(installDomShims);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // The card-pool cache is module-level by design; keep the cases hermetic.
  clearCardPoolCache();
});

const blankCard: Omit<Card, "id" | "name" | "category"> = {
  setId: "sv01",
  localId: "0",
  image: null,
  illustrator: null,
  rarity: null,
  regulationMark: null,
  hp: null,
  stage: null,
  evolveFrom: null,
  types: null,
  retreat: null,
  abilities: null,
  attacks: null,
  weaknesses: null,
  resistances: null,
  trainerType: null,
  energyType: null,
  effect: null,
  legal: { standard: true, expanded: true },
  variants: null,
};

/** A believable Card for any demo id — the two energy sets become basic
    energies, everything else a Basic Pokémon with one payable attack. */
function fabricate(id: string): Card {
  if (id === "sv03-230" || id === "sv02-279") {
    return {
      ...blankCard,
      id,
      name: id === "sv03-230" ? "Basic Fire Energy" : "Basic Water Energy",
      category: "Energy",
      energyType: "Normal",
    };
  }
  return {
    ...blankCard,
    id,
    name: `Mon ${id}`,
    category: "Pokemon",
    stage: "Basic",
    hp: 60,
    types: ["Fire"],
    retreat: 1,
    attacks: [{ name: "Tackle", cost: ["Colorless"], damage: 10 }],
  };
}

function stubApi(overrides: Record<string, () => Response> = {}) {
  const routes: Record<string, () => Response> = {
    "GET /auth/me": () => json({ error: "unauthorized" }, 401),
  };
  for (const deck of DEMO_DECKS) {
    for (const id of deck.ids) {
      routes[`GET /cards/${id}`] = () => json(fabricate(id));
    }
  }
  return stubFetch({ ...routes, ...overrides });
}

/** Rides inside AuthProvider next to the page: the only way a dom test can
    end the session (there is no sign-out affordance on the pregame form). */
function SignOutProbe() {
  const { logout } = useAuth();
  return (
    <button type="button" onClick={() => void logout()}>
      probe sign out
    </button>
  );
}

function renderPage() {
  render(
    <MemoryRouter>
      <AuthProvider>
        <GamePage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("GamePage", () => {
  it("offers the demo decks to an anonymous player", async () => {
    stubApi();
    renderPage();

    expect(screen.getByRole("heading", { name: "Local match" })).toBeTruthy();
    const selects = screen.getAllByRole("combobox");
    expect(selects).toHaveLength(2);
    for (const deck of DEMO_DECKS) {
      expect(screen.getAllByRole("option", { name: deck.name })).toHaveLength(2);
    }
  });

  it("starts a game and lands on the coin-toss decision", async () => {
    stubApi();
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Start game" }));

    // Pregame → fetch pool → createGame → the playmat + the first HUD panel.
    const coinPanel = await screen.findByLabelText("Coin toss");
    expect(coinPanel.textContent).toMatch(/Coin toss: (heads|tails)/);
    expect(coinPanel.textContent).toMatch(/Ember Starters|Tidal Splash/);
    expect(screen.getByLabelText("Playmat stub")).toBeTruthy();

    // The winner decides; either way the setup continues to the next panel
    // (placement, or the mulligan draw when the shuffle dealt one).
    fireEvent.click(screen.getByRole("button", { name: "Go first" }));
    await waitFor(() => {
      const next =
        screen.queryByLabelText("Setup placement") ?? screen.queryByLabelText("Mulligan draw");
      expect(next).toBeTruthy();
    });
  });

  it("resets a saved-deck slot to its demo default when the session dies", async () => {
    stubApi({
      "GET /auth/me": () =>
        json({
          id: "u1",
          email: "player@example.com",
          displayName: "Player",
          emailVerified: true,
          createdAt: "2026-01-01T00:00:00.000Z",
        }),
      "GET /decks": () =>
        json([
          {
            id: "d1",
            name: "Sea Legends",
            format: null,
            tint: 200,
            folderId: null,
            position: 0,
            updated: "2026-01-01T00:00:00.000Z",
            cardCount: 60,
          },
        ]),
      "POST /auth/logout": () => new Response(null, { status: 204 }),
    });
    render(
      <MemoryRouter>
        <AuthProvider>
          <GamePage />
          <SignOutProbe />
        </AuthProvider>
      </MemoryRouter>,
    );

    // Signed in: the saved deck is offered (once per slot) and fills slot 1.
    await screen.findAllByRole("option", { name: "Sea Legends (60)" });
    const slot = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    fireEvent.change(slot, { target: { value: "deck:d1" } });
    expect(slot.value).toBe("deck:d1");

    // Session over: the saved options vanish AND the slot value falls back
    // to its demo default — a lingering "deck:" value would just 401 (and
    // dead-end the form) at Start.
    fireEvent.click(screen.getByRole("button", { name: "probe sign out" }));
    await waitFor(() => {
      expect(screen.queryAllByRole("option", { name: "Sea Legends (60)" })).toHaveLength(0);
    });
    expect(slot.value).toBe("demo:0");
  });
});

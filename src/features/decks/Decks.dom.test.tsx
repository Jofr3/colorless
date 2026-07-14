// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DeckSummary, Folder, User } from "@luminous/schema";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth/AuthProvider";
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

// --- Server fixtures ---------------------------------------------------------

const USER: User = {
  id: "user-1",
  email: "ash@example.com",
  displayName: "Ash",
  emailVerified: false,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const UPDATED = "2026-01-02T00:00:00.000Z";

const FOLDERS: Folder[] = [{ id: "folder-standard", name: "Standard", parentId: null }];

const summary = (
  partial: Pick<DeckSummary, "id" | "name"> & Partial<DeckSummary>,
): DeckSummary => ({
  format: null,
  tint: 200,
  folderId: null,
  updated: UPDATED,
  cardCount: 60,
  ...partial,
});

// GET /decks order = the grid's initial manual order. Pidgeot lives inside the
// Standard folder, so the root shows the other three.
const DECKS: DeckSummary[] = [
  summary({ id: "deck-lugia", name: "Lugia Archeops" }),
  summary({ id: "deck-miraidon", name: "Miraidon ex", cardCount: 58 }),
  summary({ id: "deck-snorlax", name: "Snorlax Stall", cardCount: 0 }),
  summary({ id: "deck-pidgeot", name: "Pidgeot Control", folderId: "folder-standard" }),
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Stub fetch with a "METHOD /path" routing table; unrouted calls reject.
    Returns the mock plus a log of the routed keys, in call order. */
function stubFetch(routes: Record<string, () => Response | Promise<Response>>) {
  const calls: string[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const key = `${init?.method ?? "GET"} ${new URL(url).pathname}`;
    const route = routes[key];
    if (!route) throw new Error(`unstubbed fetch: ${key}`);
    calls.push(key);
    return route();
  });
  vi.stubGlobal("fetch", impl);
  return { impl, calls };
}

/** The signed-in happy-path routes; spread and override per test. */
const libraryRoutes = () => ({
  "GET /auth/me": () => json(USER),
  "GET /decks": () => json(DECKS),
  "GET /folders": () => json(FOLDERS),
});

const renderDecks = () =>
  render(
    <MemoryRouter>
      <AuthProvider>
        <Decks />
      </AuthProvider>
    </MemoryRouter>,
  );

/** Render and wait for the library grid (session probe + list fetches). */
const renderLoaded = async () => {
  const view = renderDecks();
  await screen.findByText("Lugia Archeops");
  return view;
};

const deckOrder = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('[data-reorder-group="deck"]')].map(
    (el) => el.dataset.reorderId,
  );

describe("Decks — server library", () => {
  it("renders the account's decks and folders from the api", async () => {
    stubFetch(libraryRoutes());
    await renderLoaded();

    // Root view: the folder tile plus the three loose decks, with the
    // server-derived card counts (no more seed placeholders).
    expect(screen.getByText("Standard")).toBeTruthy();
    expect(screen.getByText("Miraidon ex")).toBeTruthy();
    expect(screen.getByText("58 cards")).toBeTruthy();
    expect(screen.getByText("Empty")).toBeTruthy();
    // Pidgeot lives inside the folder, so it isn't on the root grid.
    expect(screen.queryByText("Pidgeot Control")).toBeNull();
  });

  it("shows the sign-in prompt when signed out", async () => {
    stubFetch({ "GET /auth/me": () => json({ error: "unauthorized" }, 401) });
    renderDecks();

    expect(await screen.findByText("Sign in to see your decks")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Sign in" });
    expect(link.getAttribute("href")).toBe("/login");
  });

  it("rolls an optimistic rename back when the PATCH fails", async () => {
    stubFetch({
      ...libraryRoutes(),
      "PATCH /decks/deck-lugia": () => json({ error: "boom" }, 500),
    });
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Rename Lugia Archeops" }));
    const input = screen.getByRole("textbox", { name: "Name" });
    fireEvent.change(input, { target: { value: "Lugia VSTAR" } });
    fireEvent.blur(input);

    // Optimistic: the new name shows before the server answers…
    expect(screen.getByText("Lugia VSTAR")).toBeTruthy();

    // …then the 500 rolls it back and announces the failure.
    await screen.findByText("Lugia Archeops");
    expect(screen.queryByText("Lugia VSTAR")).toBeNull();
    expect(screen.getByText(/Couldn't rename Lugia Archeops/)).toBeTruthy();
  });

  it("empties a folder onto its parent before deleting it", async () => {
    const { calls } = stubFetch({
      ...libraryRoutes(),
      "PATCH /decks/deck-pidgeot": () =>
        json({ ...summary({ id: "deck-pidgeot", name: "Pidgeot Control" }), cards: [] }),
      "DELETE /folders/folder-standard": () => new Response(null, { status: 204 }),
    });
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Delete Standard" }));

    // Optimistically, the contained deck surfaces at the root right away…
    expect(screen.getByText("Pidgeot Control")).toBeTruthy();
    expect(screen.queryByText("Standard")).toBeNull();

    // …and the server sequence PATCHes the deck out FIRST, so the folder is
    // empty when the cascade-delete runs (today's lift-up UX, preserved).
    await waitFor(() =>
      expect(calls.filter((key) => key.startsWith("PATCH") || key.startsWith("DELETE"))).toEqual([
        "PATCH /decks/deck-pidgeot",
        "DELETE /folders/folder-standard",
      ]),
    );
  });
});

describe("Decks — keyboard move mode", () => {
  it("reorders a deck among its siblings via the Move handle + arrow keys", async () => {
    stubFetch(libraryRoutes());
    const { container } = await renderLoaded();
    expect(deckOrder(container)).toEqual(["deck-lugia", "deck-miraidon", "deck-snorlax"]);

    fireEvent.click(screen.getByRole("button", { name: "Move Lugia Archeops" }));
    expect(screen.getByRole("button", { name: "Drop here" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(deckOrder(container)).toEqual(["deck-miraidon", "deck-lugia", "deck-snorlax"]);

    // Manual reorder is session-only (no server position field) — committing
    // it fires no request, so no PATCH route is needed here.
    fireEvent.click(screen.getByRole("button", { name: "Drop here" }));
    expect(screen.queryByRole("button", { name: "Drop here" })).toBeNull();
    expect(deckOrder(container)).toEqual(["deck-miraidon", "deck-lugia", "deck-snorlax"]);
  });

  it("reverts on Escape without committing", async () => {
    stubFetch(libraryRoutes());
    const { container } = await renderLoaded();
    const before = deckOrder(container);

    fireEvent.click(screen.getByRole("button", { name: "Move Lugia Archeops" }));
    fireEvent.keyDown(window, { key: "ArrowRight" }); // preview a move
    fireEvent.keyDown(window, { key: "Escape" }); // cancel

    expect(screen.queryByRole("button", { name: "Drop here" })).toBeNull();
    expect(deckOrder(container)).toEqual(before);
  });

  it("nests a deck into a folder via the banner button and PATCHes the move", async () => {
    const { calls } = stubFetch({
      ...libraryRoutes(),
      "PATCH /decks/deck-lugia": () =>
        json({
          ...summary({ id: "deck-lugia", name: "Lugia Archeops", folderId: "folder-standard" }),
          cards: [],
        }),
    });
    const { container } = await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Move Lugia Archeops" }));
    fireEvent.click(screen.getByRole("button", { name: "Into Standard" }));

    // Lugia moved into Standard, so it leaves the root deck list…
    expect(deckOrder(container)).toEqual(["deck-miraidon", "deck-snorlax"]);
    // …and the move persists.
    await waitFor(() => expect(calls).toContain("PATCH /decks/deck-lugia"));
  });
});

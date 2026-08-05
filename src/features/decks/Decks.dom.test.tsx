// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DeckSummary, Folder } from "@luminous/schema";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomShims } from "../../test/domShims";
import { json, stubFetch } from "../../test/fetchStub";
import { USER } from "../../test/fixtures";
import { AuthProvider } from "../auth/AuthProvider";
import { Decks } from "./Decks";

// The tiles' tilt/scroll hooks probe matchMedia/ResizeObserver on mount. The
// keyboard move mode under test is index-based (no real geometry), so the
// shims are enough — no layout needed.
beforeAll(installDomShims);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

// --- Server fixtures ---------------------------------------------------------

const UPDATED = "2026-01-02T00:00:00.000Z";

const FOLDERS: Folder[] = [
  { id: "folder-standard", name: "Standard", parentId: null, position: 0 },
];

const summary = (
  partial: Pick<DeckSummary, "id" | "name"> & Partial<DeckSummary>,
): DeckSummary => ({
  format: null,
  tint: 200,
  folderId: null,
  updated: UPDATED,
  cardCount: 60,
  coverCardId: null,
  position: 0,
  ...partial,
});

// GET /decks order = the grid's initial manual order (position ascending).
// Pidgeot lives inside the Standard folder, so the root shows the other three.
const DECKS: DeckSummary[] = [
  summary({ id: "deck-lugia", name: "Lugia Archeops", position: 0 }),
  summary({ id: "deck-miraidon", name: "Miraidon ex", cardCount: 58, position: 1 }),
  summary({ id: "deck-snorlax", name: "Snorlax Stall", cardCount: 0, position: 2 }),
  summary({
    id: "deck-pidgeot",
    name: "Pidgeot Control",
    folderId: "folder-standard",
    position: 3,
  }),
];

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

    // …then the 500 rolls it back and shows the failure notice (a visible,
    // dismissible role="alert" — not an sr-only whisper).
    await screen.findByText("Lugia Archeops");
    expect(screen.queryByText("Lugia VSTAR")).toBeNull();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Couldn't rename Lugia Archeops");

    // Dismissing clears it.
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("rolls a session-expired PATCH back WITHOUT the failure pill", async () => {
    // A 401 that survives the api client's re-probe-and-retry means the
    // session is dead — AuthProvider handles the page flip, so the pill
    // would only float misleadingly over the sign-in view. The rollback
    // itself still runs.
    stubFetch({
      ...libraryRoutes(),
      "PATCH /decks/deck-lugia": () => json({ error: "unauthorized" }, 401),
    });
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Rename Lugia Archeops" }));
    const input = screen.getByRole("textbox", { name: "Name" });
    fireEvent.change(input, { target: { value: "Lugia VSTAR" } });
    fireEvent.blur(input);

    // Rolled back — but no role="alert" pill this time.
    await screen.findByText("Lugia Archeops");
    expect(screen.queryByText("Lugia VSTAR")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not roll a failed PATCH back over a newer edit that already succeeded", async () => {
    // First rename hangs, second rename lands, THEN the first one fails: the
    // stale snapshot must not clobber the newer, successful name.
    let rejectFirst!: (reason: unknown) => void;
    const firstPatch = new Promise<Response>((_, reject) => {
      rejectFirst = reject;
    });
    let patchCalls = 0;
    stubFetch({
      ...libraryRoutes(),
      "PATCH /decks/deck-lugia": () => {
        patchCalls += 1;
        return patchCalls === 1
          ? firstPatch
          : json({ ...summary({ id: "deck-lugia", name: "Lugia Third" }), cards: [] });
      },
    });
    await renderLoaded();

    const rename = (from: string, to: string) => {
      fireEvent.click(screen.getByRole("button", { name: `Rename ${from}` }));
      const input = screen.getByRole("textbox", { name: "Name" });
      fireEvent.change(input, { target: { value: to } });
      fireEvent.blur(input);
    };

    rename("Lugia Archeops", "Lugia Second");
    rename("Lugia Second", "Lugia Third");
    await waitFor(() => expect(patchCalls).toBe(2));

    // The slow first PATCH now fails — its optimistic value ("Lugia Second")
    // is no longer current, so the guarded rollback leaves the name alone.
    rejectFirst(new TypeError("network down"));
    await screen.findByRole("alert");
    expect(screen.getByText("Lugia Third")).toBeTruthy();
    expect(screen.queryByText("Lugia Second")).toBeNull();
    expect(screen.queryByText("Lugia Archeops")).toBeNull();
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
    const { impl, calls } = stubFetch({
      ...libraryRoutes(),
      "POST /decks/reorder": () => new Response(null, { status: 204 }),
    });
    const { container } = await renderLoaded();
    expect(deckOrder(container)).toEqual(["deck-lugia", "deck-miraidon", "deck-snorlax"]);

    fireEvent.click(screen.getByRole("button", { name: "Move Lugia Archeops" }));
    expect(screen.getByRole("button", { name: "Drop here" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(deckOrder(container)).toEqual(["deck-miraidon", "deck-lugia", "deck-snorlax"]);

    fireEvent.click(screen.getByRole("button", { name: "Drop here" }));
    expect(screen.queryByRole("button", { name: "Drop here" })).toBeNull();
    expect(deckOrder(container)).toEqual(["deck-miraidon", "deck-lugia", "deck-snorlax"]);

    // The permuted rows persist their slot positions in one atomic call —
    // snorlax kept its slot, so only the two moved rows go over the wire.
    await waitFor(() => expect(calls).toContain("POST /decks/reorder"));
    const reorderCall = impl.mock.calls.find(([url]) => String(url).endsWith("/decks/reorder"));
    expect(JSON.parse(String(reorderCall?.[1]?.body))).toEqual({
      positions: [
        { id: "deck-miraidon", position: 0 },
        { id: "deck-lugia", position: 1 },
      ],
    });
  });

  it("resyncs from the server when persisting a reorder fails", async () => {
    stubFetch({
      ...libraryRoutes(),
      "POST /decks/reorder": () => json({ error: "boom" }, 500),
    });
    const { container } = await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Move Lugia Archeops" }));
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("button", { name: "Drop here" }));
    expect(deckOrder(container)).toEqual(["deck-miraidon", "deck-lugia", "deck-snorlax"]);

    // The failure surfaces the pill and the refetched lists restore the
    // server's order.
    await screen.findByText("Couldn't save the new order — restored from the server.");
    await waitFor(() =>
      expect(deckOrder(container)).toEqual(["deck-lugia", "deck-miraidon", "deck-snorlax"]),
    );
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

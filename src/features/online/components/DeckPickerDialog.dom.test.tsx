// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DeckSummary, Folder, User } from "@luminous/schema";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../../auth/AuthProvider";
import { DeckPickerDialog } from "./DeckPickerDialog";

// jsdom doesn't implement these; the card stacks/scroll area probe them on
// mount. Guarded assignments in case a newer jsdom grows them.
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
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.open = false;
    };
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const USER: User = {
  id: "user-1",
  email: "ash@example.com",
  displayName: "Ash",
  emailVerified: false,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const FOLDERS: Folder[] = [{ id: "folder-standard", name: "Standard", parentId: null }];

const DECKS: DeckSummary[] = [
  {
    id: "deck-lugia",
    name: "Lugia Archeops",
    format: null,
    tint: 205,
    folderId: null,
    updated: "2026-01-02T00:00:00.000Z",
    cardCount: 60,
  },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Stub fetch with a "METHOD /path" routing table; unrouted calls reject. */
function stubFetch(routes: Record<string, () => Response | Promise<Response>>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const key = `${init?.method ?? "GET"} ${new URL(url).pathname}`;
      const route = routes[key];
      if (!route) throw new Error(`unstubbed fetch: ${key}`);
      return route();
    }),
  );
}

const renderPicker = (onSelect = vi.fn()) => {
  render(
    <MemoryRouter>
      <AuthProvider>
        <DeckPickerDialog open selectedDeckId={null} onSelect={onSelect} onCancel={() => {}} />
      </AuthProvider>
    </MemoryRouter>,
  );
  return onSelect;
};

describe("DeckPickerDialog", () => {
  it("prompts an anonymous player to sign in instead of showing decks", async () => {
    stubFetch({ "GET /auth/me": () => json({ error: "unauthorized" }, 401) });
    renderPicker();

    expect(await screen.findByText("Sign in to use your decks.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login");
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("lists the account's library and hands back the picked deck's id + name", async () => {
    stubFetch({
      "GET /auth/me": () => json(USER),
      "GET /decks": () => json(DECKS),
      "GET /folders": () => json(FOLDERS),
    });
    const onSelect = renderPicker();

    // Folder tile and deck option, straight from the api.
    expect(await screen.findByText("Lugia Archeops")).toBeTruthy();
    expect(screen.getByText("Standard")).toBeTruthy();
    expect(screen.getByText("60 cards")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Lugia Archeops/ }));
    expect(onSelect).toHaveBeenCalledWith({ id: "deck-lugia", name: "Lugia Archeops" });
  });
});

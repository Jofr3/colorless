// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DeckSummary, Folder } from "@luminous/schema";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomShims } from "../../../test/domShims";
import { json, stubFetch } from "../../../test/fetchStub";
import { USER } from "../../../test/fixtures";
import { AuthProvider } from "../../auth/AuthProvider";
import { DeckPickerDialog } from "./DeckPickerDialog";

// The card stacks/scroll area probe matchMedia/ResizeObserver on mount, and
// the native <dialog> wants showModal.
beforeAll(installDomShims);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const FOLDERS: Folder[] = [
  { id: "folder-standard", name: "Standard", parentId: null, position: 0 },
];

const DECKS: DeckSummary[] = [
  {
    id: "deck-lugia",
    name: "Lugia Archeops",
    format: null,
    tint: 205,
    folderId: null,
    position: 0,
    updated: "2026-01-02T00:00:00.000Z",
    cardCount: 60,
    coverCardId: null,
  },
];

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

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, stubFetch } from "../../test/fetchStub";
import { USER } from "../../test/fixtures";
import { AuthProvider } from "../auth/AuthProvider";
import { ProfileSection } from "./ProfileSection";

// The /settings profile panel against a stubbed fetch: the signed-out prompt,
// the save round-trip and what it does to the rest of the app's idea of "me",
// the guards on the Save button, and the error paths.

const renderSection = () =>
  render(
    <AuthProvider>
      <MemoryRouter>
        <ProfileSection />
      </MemoryRouter>
    </AuthProvider>,
  );

const nameField = () => screen.getByLabelText("Display name") as HTMLInputElement;
const saveButton = () => screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;

const rename = (value: string) => {
  fireEvent.change(nameField(), { target: { value } });
  fireEvent.click(saveButton());
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ProfileSection", () => {
  it("asks an anonymous visitor to sign in instead of offering a name field", async () => {
    stubFetch({ "GET /auth/me": () => json({ error: "unauthorized" }, 401) });
    renderSection();

    await screen.findByRole("link", { name: "Sign in" });
    expect(screen.queryByLabelText("Display name")).toBeNull();
  });

  it("seeds the field with the current name and saves a trimmed new one", async () => {
    const { impl } = stubFetch({
      "GET /auth/me": () => json(USER),
      "PATCH /auth/me": () => json({ ...USER, displayName: "Ashley" }),
    });
    renderSection();

    await waitFor(() => expect(nameField().value).toBe("Ash"));
    rename("  Ashley  ");

    await screen.findByText("Saved.");
    const [, init] = impl.mock.calls[1] as [unknown, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ displayName: "Ashley" });
    // Saving again is refused until the name changes again — the api's answer
    // became the current user, so the field now matches it.
    expect(saveButton().disabled).toBe(true);
  });

  it("refuses to save a blank or unchanged name", async () => {
    stubFetch({ "GET /auth/me": () => json(USER) });
    renderSection();

    // Freshly loaded: the field holds the saved name, so there is nothing to save.
    await waitFor(() => expect(saveButton().disabled).toBe(true));
    fireEvent.change(nameField(), { target: { value: "   " } });
    expect(saveButton().disabled).toBe(true);
    fireEvent.change(nameField(), { target: { value: " Ash " } });
    expect(saveButton().disabled).toBe(true);
    fireEvent.change(nameField(), { target: { value: "Brock" } });
    expect(saveButton().disabled).toBe(false);
  });

  it("draws the account's own generated face beside the field", async () => {
    stubFetch({ "GET /auth/me": () => json(USER) });
    renderSection();

    // The avatar is the lobby's component fed the account's seed — its initial
    // follows the DRAFT so the face and the name never disagree on screen.
    await screen.findByText("A");
    fireEvent.change(nameField(), { target: { value: "Brock" } });
    expect(screen.getByText("B")).toBeTruthy();
  });

  it("explains a rejected name without losing what was typed", async () => {
    stubFetch({
      "GET /auth/me": () => json(USER),
      "PATCH /auth/me": () => json({ error: "invalid body" }, 400),
    });
    renderSection();

    await waitFor(() => expect(nameField().value).toBe("Ash"));
    rename("Brock");

    await screen.findByText(/1 to 64 characters/);
    expect(nameField().value).toBe("Brock");
  });

  it("falls back to the sign-in prompt when the session died mid-edit", async () => {
    let sessionAlive = true;
    stubFetch({
      "GET /auth/me": () => (sessionAlive ? json(USER) : json({ error: "unauthorized" }, 401)),
      "PATCH /auth/me": () => {
        sessionAlive = false;
        return json({ error: "unauthorized" }, 401);
      },
    });
    renderSection();

    await waitFor(() => expect(nameField().value).toBe("Ash"));
    rename("Brock");

    // The 401 re-probes: the whole app flips to signed-out, which says it
    // better than an error line under a form that can no longer work.
    await screen.findByRole("link", { name: "Sign in" });
  });
});

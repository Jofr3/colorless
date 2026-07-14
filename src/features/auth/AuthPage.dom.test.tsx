// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, stubFetch } from "../../test/fetchStub";
import { USER } from "../../test/fixtures";
import { Login } from "./AuthPage";
import { AuthProvider } from "./AuthProvider";

// The login page against a stubbed fetch: field rendering, the client-side
// email check, the 401 → friendly-copy mapping, the success → navigate path
// (including an incoming `state.from`), the already-authenticated redirect,
// and the OAuth 503 → "isn't set up yet" probe outcome.

const ANONYMOUS_ME = { "GET /auth/me": () => json({ error: "unauthorized" }, 401) };

// Stub destination routes so a successful navigate is observable as content.
const renderLogin = (initialEntry: string | { pathname: string; state?: unknown } = "/login") =>
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<div>HOME PAGE</div>} />
          <Route path="/decks" element={<div>DECKS PAGE</div>} />
          <Route path="/settings" element={<div>SETTINGS PAGE</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );

const fillAndSubmit = (email: string, password: string) => {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Login page", () => {
  it("renders the form fields, OAuth buttons, and the register link", async () => {
    stubFetch(ANONYMOUS_ME);
    renderLogin();

    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Discord" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Google" })).toBeTruthy();
    const registerLink = screen.getByRole("link", { name: "Create one" });
    expect(registerLink.getAttribute("href")).toBe("/register");
    // Let the mount-time me() probe settle inside the test's act scope.
    await screen.findByLabelText("Email");
  });

  it("rejects a malformed email client-side without calling the server", async () => {
    const { impl } = stubFetch(ANONYMOUS_ME);
    renderLogin();

    fillAndSubmit("not-an-email", "pikapika1");

    expect(await screen.findByText("Enter a valid email address.")).toBeTruthy();
    const posts = impl.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toEqual([]);
  });

  it("maps a 401 login to the friendly wrong-credentials message", async () => {
    stubFetch({
      ...ANONYMOUS_ME,
      "POST /auth/login": () => json({ error: "invalid credentials" }, 401),
    });
    renderLogin();

    fillAndSubmit(USER.email, "wrong-password");

    expect(await screen.findByText("Wrong email or password.")).toBeTruthy();
    // The form recovered — the submit button is enabled again.
    const submit = screen.getByRole("button", { name: "Sign in" });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("navigates to /decks by default on a successful sign-in", async () => {
    stubFetch({
      ...ANONYMOUS_ME,
      "POST /auth/login": () => json(USER),
    });
    renderLogin();

    fillAndSubmit(USER.email, "pikapika1");

    expect(await screen.findByText("DECKS PAGE")).toBeTruthy();
  });

  it("navigates to state.from when the visitor arrived with one", async () => {
    stubFetch({
      ...ANONYMOUS_ME,
      "POST /auth/login": () => json(USER),
    });
    renderLogin({ pathname: "/login", state: { from: "/settings" } });

    fillAndSubmit(USER.email, "pikapika1");

    expect(await screen.findByText("SETTINGS PAGE")).toBeTruthy();
  });

  it("ignores a scheme-relative state.from — an off-site redirect — and falls back to /decks", async () => {
    stubFetch({
      ...ANONYMOUS_ME,
      "POST /auth/login": () => json(USER),
    });
    renderLogin({ pathname: "/login", state: { from: "//evil.example" } });

    fillAndSubmit(USER.email, "pikapika1");

    expect(await screen.findByText("DECKS PAGE")).toBeTruthy();
  });

  it("redirects an already-authenticated visitor to the decks page", async () => {
    // Same destination as a successful submit: the context flips to
    // "authenticated" mid-submit, so this render-time redirect can win the
    // race against `navigate(from)` — the two must agree on the target.
    stubFetch({ "GET /auth/me": () => json(USER) });
    renderLogin();

    expect(await screen.findByText("DECKS PAGE")).toBeTruthy();
  });

  it("reports an unconfigured OAuth provider inline instead of navigating", async () => {
    stubFetch({
      ...ANONYMOUS_ME,
      "GET /auth/oauth/discord": () => json({ error: "provider not configured" }, 503),
    });
    renderLogin();

    fireEvent.click(screen.getByRole("button", { name: "Discord" }));

    expect(await screen.findByText("Discord sign-in isn't set up yet.")).toBeTruthy();
  });
});

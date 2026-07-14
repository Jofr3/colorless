// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { User } from "@luminous/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthProvider";

// The provider's whole job is turning api responses into auth state, so every
// test stubs global fetch (the client builds absolute urls via apiOrigin) and
// watches the state through a probe component.

const USER: User = {
  id: "user-1",
  email: "ash@example.com",
  displayName: "Ash",
  emailVerified: false,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Stub fetch with a "METHOD /path" routing table; unrouted calls reject. */
function stubFetch(routes: Record<string, () => Response | Promise<Response>>) {
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const key = `${init?.method ?? "GET"} ${new URL(url).pathname}`;
    const route = routes[key];
    if (!route) throw new Error(`unstubbed fetch: ${key}`);
    return route();
  });
  vi.stubGlobal("fetch", impl);
  return impl;
}

function Probe() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="user">{auth.user?.email ?? "none"}</span>
      <span data-testid="probe-failed">{String(auth.probeFailed)}</span>
      <button
        type="button"
        onClick={() => void auth.login({ email: USER.email, password: "pikapika1" })}
      >
        login
      </button>
      <button type="button" onClick={() => void auth.logout()}>
        logout
      </button>
    </div>
  );
}

const renderProbe = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );

const expectStatus = (status: string) =>
  waitFor(() => expect(screen.getByTestId("status").textContent).toBe(status));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AuthProvider", () => {
  it("resolves the mount probe to authenticated on a 200 me()", async () => {
    stubFetch({ "GET /auth/me": () => json(USER) });
    renderProbe();

    expect(screen.getByTestId("status").textContent).toBe("loading");
    await expectStatus("authenticated");
    expect(screen.getByTestId("user").textContent).toBe(USER.email);
    expect(screen.getByTestId("probe-failed").textContent).toBe("false");
  });

  it("maps a 401 me() to anonymous without flagging a probe failure", async () => {
    stubFetch({ "GET /auth/me": () => json({ error: "unauthorized" }, 401) });
    renderProbe();

    await expectStatus("anonymous");
    expect(screen.getByTestId("user").textContent).toBe("none");
    expect(screen.getByTestId("probe-failed").textContent).toBe("false");
  });

  it("maps a network failure to anonymous but flags the failed probe", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    renderProbe();

    await expectStatus("anonymous");
    expect(screen.getByTestId("probe-failed").textContent).toBe("true");
  });

  it("login flips anonymous to authenticated with the returned user", async () => {
    stubFetch({
      "GET /auth/me": () => json({ error: "unauthorized" }, 401),
      "POST /auth/login": () => json(USER),
    });
    renderProbe();
    await expectStatus("anonymous");

    fireEvent.click(screen.getByRole("button", { name: "login" }));

    await expectStatus("authenticated");
    expect(screen.getByTestId("user").textContent).toBe(USER.email);
  });

  it("logout clears an authenticated session back to anonymous", async () => {
    stubFetch({
      "GET /auth/me": () => json(USER),
      "POST /auth/logout": () => new Response(null, { status: 204 }),
    });
    renderProbe();
    await expectStatus("authenticated");

    fireEvent.click(screen.getByRole("button", { name: "logout" }));

    await expectStatus("anonymous");
    expect(screen.getByTestId("user").textContent).toBe("none");
  });

  it("ignores a slow mount probe that settles after a successful login", async () => {
    // The mount-time me() hangs until we release it — the login wins the race.
    let releaseMe!: (response: Response) => void;
    const mePromise = new Promise<Response>((resolve) => {
      releaseMe = resolve;
    });
    stubFetch({
      "GET /auth/me": () => mePromise,
      "POST /auth/login": () => json(USER),
    });
    renderProbe();
    expect(screen.getByTestId("status").textContent).toBe("loading");

    fireEvent.click(screen.getByRole("button", { name: "login" }));
    await expectStatus("authenticated");

    // The stale probe finally answers 401 — it lost the race, so it must not
    // flip the fresh session back to anonymous.
    releaseMe(json({ error: "unauthorized" }, 401));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByTestId("status").textContent).toBe("authenticated");
    expect(screen.getByTestId("user").textContent).toBe(USER.email);
  });

  it("useAuth throws outside the provider", () => {
    // React logs the render error before rethrowing; keep the output clean.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/within <AuthProvider>/);
    spy.mockRestore();
  });
});

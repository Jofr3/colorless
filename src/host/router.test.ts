import { describe, expect, it, vi } from "vitest";
import {
  type Route,
  Router,
  type RouterWindow,
  pageLabel,
  pageTitle,
  routeFromUrl,
  routePath,
  routeUrl,
} from "./router";

const at = (path: string) => routeFromUrl(new URL(path, "https://colorless.test"));

describe("routeFromUrl", () => {
  it.each([
    ["/", { page: "home", id: "" }],
    ["/decks", { page: "decks", id: "" }],
    ["/decks/abc", { page: "builder", id: "abc" }],
    ["/sandbox", { page: "sandbox", id: "" }],
    ["/sandbox/play", { page: "simulator", id: "" }],
    ["/online", { page: "online", id: "" }],
    ["/online/ABCD", { page: "online", id: "ABCD" }],
    ["/online/ABCD/play", { page: "match", id: "ABCD" }],
  ])("reads %s", (path, route) => {
    expect(at(path)).toEqual(route);
  });

  it.each([
    ["/?page=decks", { page: "decks", id: "" }],
    ["/?page=builder&deck=abc", { page: "builder", id: "abc" }],
    ["/?lobby=ABCD", { page: "online", id: "ABCD" }],
    ["/?page=match&lobby=ABCD", { page: "match", id: "ABCD" }],
    ["/simulator", { page: "simulator", id: "" }],
    ["/match/ABCD", { page: "match", id: "ABCD" }],
    ["/lobby/ABCD", { page: "online", id: "ABCD" }],
  ])("resolves the older URL %s", (path, route) => {
    expect(at(path)).toEqual(route);
  });

  it.each(["/builder/abc", "/nowhere", "/?page=nowhere", "/%E0%A4%A"])("sends %s home", (path) => {
    expect(at(path)).toEqual({ page: "home", id: "" });
  });

  it("drops an id the page cannot carry", () => {
    expect(at("/sandbox/extra")).toEqual({ page: "sandbox", id: "" });
    expect(at("/?page=decks&deck=abc")).toEqual({ page: "decks", id: "" });
  });

  it("decodes the id", () => {
    expect(at("/decks/a%20b")).toEqual({ page: "builder", id: "a b" });
  });
});

describe("routePath", () => {
  it.each([
    "/",
    "/decks",
    "/decks/a%20b",
    "/sandbox",
    "/sandbox/play",
    "/online",
    "/online/ABCD",
    "/online/ABCD/play",
  ])("round-trips %s", (path) => {
    expect(routePath(at(path))).toBe(path);
  });
});

describe("routeUrl", () => {
  it("drops the legacy route parameters and keeps the rest of the query", () => {
    const url = routeUrl(new URL("https://colorless.test/?lobby=ABCD&account"), {
      page: "online",
      id: "ABCD",
    });
    expect(url.pathname).toBe("/online/ABCD");
    expect([...url.searchParams.keys()]).toEqual(["account"]);
  });

  it("leaves a query with no legacy parameter as it was written", () => {
    const url = routeUrl(new URL("https://colorless.test/?settings"), { page: "decks", id: "" });
    expect(url.pathname + url.search).toBe("/decks?settings");
  });
});

describe("titles and labels", () => {
  it("names the builder after its deck once it has one", () => {
    expect(pageTitle("builder")).toBe("Colorless — Deck builder");
    expect(pageTitle("builder", "Tidal Splash")).toBe("Colorless — Tidal Splash");
    expect(pageTitle("decks", "Tidal Splash")).toBe("Colorless — Decks");
    expect(pageLabel("builder", { name: "Tidal Splash", cards: 60 })).toContain(
      "Tidal Splash. 60 cards.",
    );
  });
});

function fakeWindow(path: string) {
  let href = new URL(path, "https://colorless.test").href;
  const entries = [href];
  let index = 0;
  let popstate = () => {};
  const set = (url: string | URL | null | undefined) => {
    href = new URL(String(url), href).href;
  };
  const win: RouterWindow = {
    location: {
      get href() {
        return href;
      },
    },
    history: {
      pushState: (_data, _unused, url) => {
        set(url);
        entries.splice(index + 1, Number.POSITIVE_INFINITY, href);
        index++;
      },
      replaceState: (_data, _unused, url) => {
        set(url);
        entries[index] = href;
      },
    },
    addEventListener: (_type, listener) => {
      popstate = listener;
    },
  };
  return {
    win,
    path: () => new URL(href).pathname + new URL(href).search,
    entries: () => entries.map((e) => new URL(e).pathname),
    back() {
      index--;
      href = entries[index] ?? href;
      popstate();
    },
  };
}

describe("Router", () => {
  it("rewrites an older URL in place when it starts", () => {
    const page = fakeWindow("/?lobby=ABCD");
    const router = new Router(page.win, { changed: () => {} });
    expect(router.current).toEqual({ page: "online", id: "ABCD" });
    expect(page.entries()).toEqual(["/online/ABCD"]);
  });

  it("pushes a page, replaces on request, and strips the settings parameters", () => {
    const page = fakeWindow("/?settings");
    const changed = vi.fn<(route: Route) => void>();
    const router = new Router(page.win, { changed });
    router.navigate("decks");
    expect(page.path()).toBe("/decks");
    router.navigate("online", "ABCD", true);
    expect(page.entries()).toEqual(["/", "/online/ABCD"]);
    expect(changed.mock.calls.map(([route]) => route)).toEqual([
      { page: "decks", id: "" },
      { page: "online", id: "ABCD" },
    ]);
  });

  it("follows back and forward", () => {
    const page = fakeWindow("/");
    const changed = vi.fn<(route: Route) => void>();
    const router = new Router(page.win, { changed });
    router.navigate("decks");
    router.navigate("builder", "abc");
    page.back();
    expect(router.current).toEqual({ page: "decks", id: "" });
    expect(changed).toHaveBeenLastCalledWith({ page: "decks", id: "" });
  });

  it("holds a change until the page it leaves lets go", () => {
    const page = fakeWindow("/decks/abc");
    const changed = vi.fn<(route: Route) => void>();
    let release = () => {};
    const holdLeave = vi.fn((from: Route, proceed: () => void) => {
      release = proceed;
      return from.page === "builder";
    });
    const router = new Router(page.win, { changed, holdLeave });
    router.navigate("decks");
    expect(router.current).toEqual({ page: "builder", id: "abc" });
    expect(page.path()).toBe("/decks/abc");
    expect(changed).not.toHaveBeenCalled();
    release();
    expect(router.current).toEqual({ page: "decks", id: "" });
    expect(page.path()).toBe("/decks");
    expect(holdLeave).toHaveBeenCalledTimes(1);
  });

  it("puts the URL back on the held page when back moved it", () => {
    const page = fakeWindow("/decks");
    const router = new Router(page.win, {
      changed: () => {},
      holdLeave: (from) => from.page === "builder",
    });
    router.navigate("builder", "abc");
    page.back();
    expect(router.current).toEqual({ page: "builder", id: "abc" });
    expect(page.path()).toBe("/decks/abc");
  });

  it("lands on the new page when the held page lets go at once", () => {
    for (const leave of ["navigate", "back"] as const) {
      const page = fakeWindow("/decks");
      const router = new Router(page.win, {
        changed: () => {},
        holdLeave: (from, proceed) => {
          if (from.page !== "builder") return false;
          proceed();
          return true;
        },
      });
      router.navigate("builder", "abc");
      if (leave === "navigate") router.navigate("decks");
      else page.back();
      expect(router.current).toEqual({ page: "decks", id: "" });
      expect(page.path()).toBe("/decks");
    }
  });

  it("does not ask to leave when the route stays put", () => {
    const page = fakeWindow("/decks/abc");
    const holdLeave = vi.fn(() => true);
    const router = new Router(page.win, { changed: () => {}, holdLeave });
    router.navigate("builder", "abc", true);
    expect(holdLeave).not.toHaveBeenCalled();
  });
});

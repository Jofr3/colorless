/** Page routes. Pages live in the path: /decks, /decks/<id> (builder), /sandbox, /sandbox/play
 * (simulator), /online, /online/<code> and /online/<code>/play (match). The older query URLs
 * (/?page=decks, /?lobby=CODE), /simulator, /match/<code> and /lobby/<code> still resolve, and
 * the router rewrites them. */

export const PAGES = [
  "home",
  "decks",
  "builder",
  "sandbox",
  "simulator",
  "online",
  "match",
] as const;
export type Page = (typeof PAGES)[number];

export interface Route {
  page: Page;
  /** The deck id (builder) or lobby code (online, match); empty on every other page. */
  id: string;
}

/** The pages whose route carries an id, with the legacy query parameter that named it. */
const ID_PARAMS: Partial<Record<Page, string>> = {
  builder: "deck",
  online: "lobby",
  match: "lobby",
};
const LEGACY_PARAMS = ["page", ...new Set(Object.values(ID_PARAMS))];

const isPage = (value: string): value is Page => (PAGES as readonly string[]).includes(value);

/** A route for `page`, falling back to home for an unknown page and dropping an id it cannot carry. */
export function routeTo(page: string, id = ""): Route {
  const known = isPage(page) ? page : "home";
  return { page: known, id: ID_PARAMS[known] ? id : "" };
}

export function routeFromUrl(url: URL): Route {
  const params = url.searchParams;
  const legacy = params.get("page") || (params.has("lobby") ? "online" : "");
  if (legacy) {
    const { page } = routeTo(legacy);
    return routeTo(page, params.get(ID_PARAMS[page] ?? "") ?? "");
  }
  let parts: string[];
  try {
    parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return routeTo("home");
  }
  const [first = "", second = "", third = ""] = parts;
  if (first === "decks" && second) return routeTo("builder", second);
  if (first === "sandbox" && second === "play") return routeTo("simulator");
  if (first === "online" && second && third === "play") return routeTo("match", second);
  if (first === "lobby") return routeTo("online", second);
  return routeTo(first === "builder" ? "home" : first, second);
}

export function routePath({ page, id }: Route): string {
  if (page === "home") return "/";
  if (page === "builder") return `/decks/${encodeURIComponent(id)}`;
  if (page === "simulator") return "/sandbox/play";
  if (page === "match") return `/online/${encodeURIComponent(id)}/play`;
  return id ? `/${page}/${encodeURIComponent(id)}` : `/${page}`;
}

/** `current` moved to `route`. Its query survives (so ?settings keeps its form) except for the
 * legacy route parameters. */
export function routeUrl(current: URL, route: Route): URL {
  const url = new URL(current.href);
  url.pathname = routePath(route);
  for (const param of LEGACY_PARAMS)
    if (url.searchParams.has(param)) url.searchParams.delete(param);
  return url;
}

const PAGE_NAMES: Record<Page, string> = {
  home: "Home",
  decks: "Decks",
  builder: "Deck builder",
  sandbox: "Sandbox",
  simulator: "Simulator",
  online: "Online",
  match: "Online match",
};

/** The document title; the builder shows the open deck's name once it has one. */
export function pageTitle(page: Page, deckName = ""): string {
  return `Colorless — ${(page === "builder" && deckName) || PAGE_NAMES[page]}`;
}

const LIBRARY_LABEL =
  "Deck library. Tab or arrows choose controls and cards. Enter opens. Escape returns home.";
const TABLE_LABEL =
  "game table. Drag cards to play. Tab selects controls and cards; Enter activates. Escape opens options.";

/** The canvas's accessible name on each page. */
export function pageLabel(page: Page, deck?: { name: string; cards: number }): string {
  switch (page) {
    case "simulator":
      return `Sandbox ${TABLE_LABEL}`;
    case "match":
      return `Online ${TABLE_LABEL}`;
    case "sandbox":
      return "Sandbox deck selection. Tab or arrows choose controls. Enter selects a deck or activates a button. Escape returns home.";
    case "online":
      return "Online lobby. Tab or arrows choose controls; left and right switch tabs. Enter activates. Escape goes back.";
    case "builder":
      if (deck)
        return `Deck builder. ${deck.name}. ${deck.cards} cards. Tab selects controls. Enter inspects a card. Drag a card into your deck or use Add in its dialog.`;
      return LIBRARY_LABEL;
    case "decks":
      return LIBRARY_LABEL;
    case "home":
      return "Colorless main menu. Use Tab or arrow keys to choose; Enter to open. M toggles sound.";
  }
}

/** Pages that draw the game table rather than a modal over the menu. */
export const isTablePage = (page: Page) => page === "simulator" || page === "match";

export interface RouterWindow {
  location: { href: string };
  history: Pick<History, "pushState" | "replaceState">;
  addEventListener(type: "popstate", listener: () => void): void;
}

export interface RouterOptions {
  /** Runs after every page change. */
  changed(route: Route): void;
  /** Asked before leaving `from`; returning true holds the change until `proceed` runs. */
  holdLeave?(from: Route, proceed: () => void): boolean;
}

/** Owns the current route and the browser history; Lua follows it through the page mailbox. */
export class Router {
  current: Route;
  constructor(
    private readonly win: RouterWindow,
    private readonly options: RouterOptions,
  ) {
    this.current = routeFromUrl(this.url());
    win.history.replaceState(null, "", routeUrl(this.url(), this.current));
    win.addEventListener("popstate", () => this.go(routeFromUrl(this.url()), false));
  }

  navigate(page: string, id = "", replace = false) {
    this.go(routeTo(page, id), !replace);
  }

  private url() {
    return new URL(this.win.location.href);
  }

  private go(next: Route, push: boolean, held = false) {
    const from = this.current;
    const moving = next.page !== from.page || next.id !== from.id;
    if (!held && moving && this.options.holdLeave?.(from, () => this.go(next, push, true))) {
      // Back/forward already moved the URL; keep it on the held page until it lets go.
      this.win.history.replaceState(null, "", routeUrl(this.url(), from));
      return;
    }
    this.current = next;
    const url = routeUrl(this.url(), next);
    url.searchParams.delete("account");
    url.searchParams.delete("settings");
    if (push) this.win.history.pushState(null, "", url);
    else this.win.history.replaceState(null, "", url);
    this.options.changed(next);
  }
}

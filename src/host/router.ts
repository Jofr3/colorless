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

const PAGE_LABELS: Record<Page, string> = {
  home: "Colorless main menu",
  decks: "Deck library",
  builder: "Deck builder",
  sandbox: "Sandbox deck selection",
  simulator: "Sandbox game table",
  online: "Online lobby",
  match: "Online game table",
};

/** The open deck as the builder knows it: its name once loaded, or that it is still loading. */
export interface BuilderDeck {
  name: string;
  loading: boolean;
}

/** The canvas's accessible name and the page heading. It stays short and stable, so adding a card
 * does not rename the focused canvas (Lua announces the count); how to use the page is in
 * pageInstructions. */
export function pageLabel(page: Page, deck?: BuilderDeck): string {
  if (page === "builder" && deck?.name) return `Deck builder: ${deck.name}`;
  if (page === "builder" && deck?.loading) return "Deck builder: loading the deck";
  return PAGE_LABELS[page];
}

const TABLE_INSTRUCTIONS =
  "Drag cards to play. Tab selects controls and cards; Enter activates; V views a selected card. Escape opens options.";

const PAGE_INSTRUCTIONS: Record<Page, string> = {
  home: "Click a button, or use Tab or arrow keys to choose and Enter to open. Tab past the last button, or Shift+Tab before the first, leaves the game for the page's links. M toggles sound. Settings opens a popup: Tab moves between controls, left and right adjust sliders, and Escape closes. Account opens your profile in the settings popup. Decks opens the deck library. Sandbox opens the deck chooser and game table. Online opens the lobby popup: create a lobby and share its code, or join with a code; then choose a deck and ready up.",
  decks:
    "Tab or arrows choose controls and cards; each deck's Manage button renames or deletes it. Enter opens. Escape returns home.",
  builder:
    "Tab selects controls. Enter inspects a card. Drag a card into your deck or use Add in its dialog. Escape returns to the deck library.",
  sandbox:
    "Tab or arrows choose controls. Enter selects a deck or activates a button. Escape returns home.",
  simulator: TABLE_INSTRUCTIONS,
  online:
    "Tab or arrows choose controls; left and right switch tabs. Enter activates. Escape goes back.",
  match: TABLE_INSTRUCTIONS,
};

/** How to use each page: the canvas's description (#instructions). */
export function pageInstructions(page: Page): string {
  return PAGE_INSTRUCTIONS[page];
}

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
    if (!moving && push) {
      // Asked for the page it is on: no second history entry and no page change, and an open
      // settings or account form keeps its parameter.
      this.win.history.replaceState(null, "", routeUrl(this.url(), next));
      return;
    }
    if (!held && moving && this.options.holdLeave) {
      // Back/forward already moved the URL; keep it on the held page until it lets go, which may
      // happen before holdLeave returns.
      this.win.history.replaceState(null, "", routeUrl(this.url(), from));
      if (this.options.holdLeave(from, () => this.go(next, push, true))) return;
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

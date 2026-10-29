import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeFields } from "../lua/wire";
import type { ColorlessHost } from "./bridgeProtocol";
import { MAILBOXES } from "./mailboxes";
import { HostShell, type PageView, type ShellPorts } from "./shell";

/** Just enough of an element for the shell and its text proxies, on Node's EventTarget. */
class FakeElement extends EventTarget {
  tagName = "";
  value = "";
  hidden = false;
  inert = false;
  className = "";
  textContent = "";
  type = "";
  autocomplete = "";
  autocapitalize = "";
  spellcheck = true;
  inputMode = "";
  enterKeyHint = "";
  maxLength = 0;
  selectionStart = 0;
  selectionEnd = 0;
  style: Record<string, string> = {};
  private attributes = new Map<string, string>();
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  focus() {
    page.activeElement = this;
  }
  blur() {
    if (page.activeElement === this) page.activeElement = null;
  }
  select() {}
  setSelectionRange() {}
  append() {}
}
class FakeCanvas extends FakeElement {}
/** The fake document's focus, which FakeElement.focus moves. */
const page: { activeElement: FakeElement | null } = { activeElement: null };

const PAGE_VIEWS = {
  home: {
    page: "home",
    id: "",
    title: "Colorless — Home",
    label: "Colorless main menu",
    instructions: "Home instructions.",
  },
  builder: {
    page: "builder",
    id: "d1",
    title: "Colorless — Tidal Splash",
    label: "Deck builder: Tidal Splash",
    instructions: "Builder instructions.",
  },
} satisfies Record<string, PageView>;

function fakePage() {
  const canvas = new FakeCanvas();
  canvas.setAttribute("role", "application");
  canvas.setAttribute("tabindex", "0");
  const announcement = new FakeElement();
  const instructions = new FakeElement();
  const heading = new FakeElement();
  const nav = new FakeElement();
  const links = Object.fromEntries(
    ["decks-link", "online-link", "sandbox-link", "settings-link", "account-link", "home-link"].map(
      (id) => [id, new FakeElement()],
    ),
  );
  const elements: Record<string, FakeElement> = {
    canvas,
    announcement,
    instructions,
    "page-heading": heading,
    ...links,
  };
  const created: FakeElement[] = [];
  let titleWrites = 0;
  let title = "Colorless";
  page.activeElement = null;
  const doc = {
    get title() {
      return title;
    },
    set title(value: string) {
      titleWrites++;
      title = value;
    },
    get activeElement() {
      return page.activeElement;
    },
    location: { search: "" },
    body: new FakeElement(),
    getElementById: (id: string) => elements[id] ?? null,
    querySelector: (selector: string) => (selector === ".accessible-menu" ? nav : null),
    createElement: (tag: string) => {
      const element = new FakeElement();
      element.tagName = tag.toUpperCase();
      created.push(element);
      return element;
    },
  };
  const mailboxes: [string, string][] = [];
  const host = {
    connect: () => {},
    writeMailbox: (name: string, value: string) => mailboxes.push([name, value]),
    wantArt: () => {},
  } as unknown as ColorlessHost;
  const ports: ShellPorts = {
    command: vi.fn(),
    navigate: vi.fn(),
    authenticate: vi.fn(),
    deleteAccount: vi.fn(),
  };
  const shell = new HostShell(doc as unknown as Document, host, ports);
  const labelled = (label: string) => created.find((e) => e.getAttribute("aria-label") === label);
  return {
    shell,
    ports,
    mailboxes,
    labelled,
    created,
    announcement,
    canvas,
    instructions,
    heading,
    nav,
    links,
    titleWrites: () => titleWrites,
  };
}

/** Clicks a link as a user would; true when the shell kept the browser from following it. */
function click(link: FakeElement | undefined) {
  const event = new Event("click", { cancelable: true });
  link?.dispatchEvent(event);
  return event.defaultPrevented;
}

/** A Tab keydown as the window's later listeners (SDL's) see it: whether it reached them, and
    whether anything prevented the browser's own focus move. */
function tab(shiftKey = false) {
  let reached = false;
  const later = () => {
    reached = true;
  };
  window.addEventListener("keydown", later);
  const event = new Event("keydown", { cancelable: true });
  Object.assign(event, { key: "Tab", code: "Tab", shiftKey });
  window.dispatchEvent(event);
  window.removeEventListener("keydown", later);
  return { reachedSdl: reached, prevented: event.defaultPrevented };
}

const print = (channel: string, ...fields: string[]) =>
  `COLORLESS:${channel}${fields.length ? `:${encodeFields(fields)}` : ""}`;

beforeEach(() => {
  vi.stubGlobal("HTMLCanvasElement", FakeCanvas);
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("HostShell", () => {
  it("joins the announcements of one Lua frame, so a later one does not replace an earlier one", async () => {
    const { shell, announcement } = fakePage();
    shell.onPrint(print("announce", "Ash: played Nest Ball."));
    shell.onPrint(
      print("announce", "Search your deck for a Basic Pokémon onto your Bench. 2 cards."),
    );
    shell.onPrint(print("announce", "Ash: played Nest Ball."));
    await Promise.resolve();
    expect(announcement.textContent).toBe(
      "Ash: played Nest Ball. Search your deck for a Basic Pokémon onto your Bench. 2 cards.",
    );
    shell.onPrint(print("announce", "Choose your next move."));
    await Promise.resolve();
    expect(announcement.textContent).toBe("Choose your next move.");
    shell.onPrint(print("announce", "Choose your next move."));
    await Promise.resolve();
    expect(announcement.textContent).toBe("Choose your next move.\u00a0");
  });
  it("ends each joined part as a sentence, and leaves a lone part as it is", async () => {
    const { shell, announcement } = fakePage();
    shell.onPrint(print("announce", "Fire Energy, your hand"));
    shell.onPrint(print("announce", "Attach to which Pok\u00e9mon?"));
    shell.onPrint(print("announce", "Ash: placed a face-down Active Pok\u00e9mon."));
    await Promise.resolve();
    expect(announcement.textContent).toBe(
      "Fire Energy, your hand. Attach to which Pok\u00e9mon? Ash: placed a face-down Active Pok\u00e9mon.",
    );
    shell.onPrint(print("announce", "Fire Energy, your hand"));
    await Promise.resolve();
    expect(announcement.textContent).toBe("Fire Energy, your hand");
  });
  it("routes Lua's prints to the screens and the router", () => {
    const { shell, ports } = fakePage();
    shell.onPrint(print("simulator", "open"));
    shell.onPrint(print("library", "rename", "d1"));
    shell.onPrint(print("page", "decks"));
    shell.onPrint("COLORLESS:builder:unencoded byte");
    expect(ports.command).toHaveBeenCalledWith("simulator", encodeFields(["open"]));
    expect(ports.command).toHaveBeenCalledWith("library", encodeFields(["rename", "d1"]));
    expect(ports.navigate).toHaveBeenCalledWith("decks");
    expect(ports.command).toHaveBeenCalledTimes(2);
  });

  it("reports a command that throws instead of throwing into love.js, and runs the next", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { shell, ports } = fakePage();
    vi.mocked(ports.command).mockImplementationOnce(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'seat')");
    });
    expect(() => shell.onPrint(print("simulator", "invoke", "1"))).not.toThrow();
    expect(logged).toHaveBeenCalledTimes(1);
    shell.onPrint(print("simulator", "open"));
    expect(ports.command).toHaveBeenLastCalledWith("simulator", encodeFields(["open"]));
  });

  it("says a copy failed where the page has no clipboard", () => {
    vi.stubGlobal("navigator", {});
    const { shell, mailboxes } = fakePage();
    expect(() => shell.onPrint(print("builder", "copy", "4 Pikachu"))).not.toThrow();
    const note = mailboxes.find(([name]) => name === MAILBOXES.builderClipboard)?.[1] ?? "";
    expect(note.split("\t")[1]).toBe(
      "Copy failed. Select the decklist and use your copy shortcut.",
    );
  });

  it("edits the builder's names and searches in a one-line field named as Lua draws it", () => {
    const { shell, created } = fakePage();
    const open = () => created.filter((e) => !e.hidden);
    const expected = {
      name: ["Deck name", "done", "text", 100],
      query: ["Search cards", "search", "search", 300],
      optionQuery: ["Find an option", "search", "search", 300],
      text: ["Rules text", "search", "search", 300],
    } as const;
    for (const [field, [label, enter, mode, max]] of Object.entries(expected)) {
      shell.onPrint(print("builder", "input", field, "Pika"));
      const [element, ...others] = open();
      expect(others).toEqual([]);
      expect(element?.tagName).toBe("INPUT");
      expect(element?.getAttribute("aria-label")).toBe(label);
      expect([element?.enterKeyHint, element?.inputMode, element?.maxLength]).toEqual([
        enter,
        mode,
        max,
      ]);
      expect([element?.spellcheck, element?.autocapitalize, element?.value]).toEqual([
        false,
        "none",
        "Pika",
      ]);
    }
    shell.onPrint(print("builder", "input", "transfer", "4 Pikachu"));
    const [decklist, ...others] = open();
    expect(others).toEqual([]);
    expect(decklist?.tagName).toBe("TEXTAREA");
    expect(decklist?.getAttribute("aria-label")).toBe("Decklist. Paste your list here.");
    shell.onPrint(print("builder", "finish-input"));
    expect(open()).toEqual([]);
  });

  it("empties the auth form for another account, a deletion's email, and on close", () => {
    const { shell, labelled } = fakePage();
    const email = labelled("Email");
    const password = labelled("Password");
    if (!email || !password) throw new Error("The auth form has no inputs");
    const account = (user: string) =>
      encodeFields([1, user ? "authenticated" : "anonymous", 0, "", user]);

    shell.onPrint(print("auth", "open", "login"));
    email.value = "ash@example.com";
    password.value = "pikachu123";
    shell.accountChanged(account("u1"));
    expect([email.value, password.value]).toEqual(["", ""]);

    email.value = "ash@example.com";
    password.value = "pikachu123";
    shell.accountChanged(account("u1"));
    expect([email.value, password.value]).toEqual(["ash@example.com", "pikachu123"]);
    shell.onPrint(print("auth", "open", "delete"));
    expect([email.value, password.value]).toEqual(["", ""]);

    email.value = "ash@example.com";
    shell.onPrint(print("auth", "close"));
    expect(email.value).toBe("");
  });
});

describe("HostShell's page semantics", () => {
  it("says the canvas is loading until Lua is ready, then names the page and says it is ready", async () => {
    const { shell, canvas, instructions, heading, nav, announcement } = fakePage();
    shell.showPage(PAGE_VIEWS.builder);
    expect(canvas.getAttribute("aria-busy")).toBe("true");
    expect(canvas.getAttribute("aria-label")).toBe("Colorless is loading");
    expect(canvas.getAttribute("role")).toBe("application");
    expect(canvas.getAttribute("aria-roledescription")).toBe("game");
    expect(canvas.getAttribute("aria-modal")).toBeNull();
    expect(heading.textContent).toBe("Deck builder: Tidal Splash");
    expect(instructions.textContent).toBe("Builder instructions.");
    expect(nav.inert).toBe(true);
    shell.onPrint(print("ready"));
    expect(canvas.getAttribute("aria-busy")).toBe("false");
    expect(canvas.getAttribute("aria-label")).toBe("Deck builder: Tidal Splash");
    await Promise.resolve();
    expect(announcement.textContent).toBe("Colorless is ready");
  });

  it("opens the links and the page up while the boot stalls, and closes them again when it moves", () => {
    const { shell, canvas, nav, links, ports } = fakePage();
    shell.showPage(PAGE_VIEWS.builder);
    expect(links["home-link"]?.hidden).toBe(false);
    shell.onDegraded("stalled");
    expect(nav.inert).toBe(false);
    expect(canvas.getAttribute("tabindex")).toBe("-1");
    expect(canvas.getAttribute("role")).toBeNull();
    expect(canvas.getAttribute("aria-busy")).toBe("true");
    expect(click(links["decks-link"])).toBe(false);
    shell.onDegraded("recovered");
    expect(nav.inert).toBe(true);
    expect(canvas.getAttribute("tabindex")).toBe("0");
    expect(canvas.getAttribute("role")).toBe("application");
    shell.onPrint(print("ready"));
    expect(click(links["decks-link"])).toBe(true);
    expect(ports.navigate).toHaveBeenCalledWith("decks");
  });

  it("leaves a failed page to ordinary links, off the dead canvas", () => {
    const { shell, canvas, nav, links, ports } = fakePage();
    shell.showPage(PAGE_VIEWS.builder);
    shell.onPrint(print("ready"));
    canvas.focus();
    shell.onDegraded("failed");
    expect(nav.inert).toBe(false);
    expect(canvas.getAttribute("tabindex")).toBe("-1");
    expect(canvas.getAttribute("role")).toBeNull();
    expect(canvas.getAttribute("aria-busy")).toBe("false");
    expect(canvas.getAttribute("aria-label")).toBe("Colorless has stopped. Reload to continue.");
    expect(page.activeElement).toBeNull();
    expect(click(links["decks-link"])).toBe(false);
    expect(click(links["home-link"])).toBe(false);
    expect(ports.navigate).not.toHaveBeenCalled();
    shell.onDegraded("recovered");
    shell.onPrint(print("settings", "open"));
    expect(nav.inert).toBe(false);
    expect(canvas.getAttribute("tabindex")).toBe("-1");
  });

  it("hides the Home link on home", () => {
    const { shell, links } = fakePage();
    shell.showPage(PAGE_VIEWS.home);
    expect(links["home-link"]?.hidden).toBe(true);
  });

  it("writes the title, name, description and heading only when they change", () => {
    const { shell, canvas, titleWrites } = fakePage();
    shell.onPrint(print("ready"));
    shell.showPage(PAGE_VIEWS.builder);
    const writes = vi.spyOn(canvas, "setAttribute");
    const titles = titleWrites();
    shell.showPage({ ...PAGE_VIEWS.builder });
    expect(writes).not.toHaveBeenCalled();
    expect(titleWrites()).toBe(titles);
  });

  it("names and describes Settings and the auth form while they are open", () => {
    const { shell, canvas, instructions } = fakePage();
    shell.onPrint(print("ready"));
    shell.showPage(PAGE_VIEWS.home);
    shell.onPrint(print("settings", "open"));
    expect(canvas.getAttribute("aria-label")).toBe("Settings");
    expect(instructions.textContent).toBe(
      "Tab between controls. Arrow keys adjust values. Escape closes.",
    );
    shell.onPrint(print("auth", "open", "register"));
    expect(canvas.getAttribute("aria-label")).toBe("Create account");
    expect(instructions.textContent).toBe(
      "Tab between controls. Enter edits or activates. Escape returns to Settings.",
    );
    shell.onPrint(print("auth", "close"));
    expect(canvas.getAttribute("aria-label")).toBe("Settings");
    shell.onPrint(print("auth", "open", "login"));
    shell.onPrint(print("settings", "closed"));
    expect(canvas.getAttribute("aria-label")).toBe("Colorless main menu");
    expect(instructions.textContent).toBe("Home instructions.");
  });

  it("clears an announcement a few seconds after it is made", async () => {
    vi.useFakeTimers();
    try {
      const { shell, announcement } = fakePage();
      shell.onPrint(print("announce", "Decks"));
      await Promise.resolve();
      vi.advanceTimersByTime(2000);
      shell.onPrint(print("announce", "Decks"));
      await Promise.resolve();
      expect(announcement.textContent).toBe("Decks ");
      vi.advanceTimersByTime(4000);
      expect(announcement.textContent).toBe("Decks ");
      vi.advanceTimersByTime(1000);
      expect(announcement.textContent).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("HostShell's Tab out of the canvas", () => {
  function onHome() {
    const shell = fakePage();
    shell.shell.onPrint(print("ready"));
    shell.shell.showPage(PAGE_VIEWS.home);
    shell.canvas.focus();
    return shell;
  }

  it("lets Tab at the last home button and Shift+Tab at the first through to the browser", () => {
    const { shell } = onHome();
    expect(tab()).toEqual({ reachedSdl: true, prevented: false });
    shell.onPrint(print("focus-edge", "last"));
    expect(tab()).toEqual({ reachedSdl: false, prevented: false });
    expect(tab(true).reachedSdl).toBe(true);
    shell.onPrint(print("focus-edge", "first"));
    expect(tab(true)).toEqual({ reachedSdl: false, prevented: false });
    expect(tab().reachedSdl).toBe(true);
    shell.onPrint(print("focus-edge", "none"));
    expect(tab(true).reachedSdl).toBe(true);
  });

  it("keeps the Tab in the canvas off home, under Settings or a wipe, and while a field edits", () => {
    const { shell, canvas } = onHome();
    shell.onPrint(print("focus-edge", "last"));
    shell.onPrint(print("settings", "open"));
    expect(tab().reachedSdl).toBe(true);
    shell.onPrint(print("settings", "closed"));
    shell.onPrint(print("transition", "open"));
    expect(tab().reachedSdl).toBe(true);
    shell.onPrint(print("transition", "closed"));
    shell.showPage(PAGE_VIEWS.builder);
    expect(tab().reachedSdl).toBe(true);
    shell.showPage(PAGE_VIEWS.home);
    canvas.focus();
    expect(tab().reachedSdl).toBe(false);
    shell.onPrint(print("account", "edit", "Ash"));
    canvas.focus();
    expect(tab().reachedSdl).toBe(true);
    shell.onPrint(print("account", "finish-edit"));
    canvas.focus();
    expect(tab().reachedSdl).toBe(false);
    page.activeElement = null;
    expect(tab().reachedSdl).toBe(true);
  });
});

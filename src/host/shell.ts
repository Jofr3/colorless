/** The page around the Lua canvas: Lua's print commands, the text proxies, the accessible links,
 * the canvas's name, description and state, and the Tab that leaves the canvas. */

import { DECK_NAME_MAX, DISPLAY_NAME_MAX, normalizeLobbyCode } from "@colorless/schema";
import { readPersisted, writePersisted } from "../lib/persistedState";
import { reportError } from "../lib/reportError";
import { decodeFields, encodeFields } from "../lua/wire";
import type { ColorlessHost } from "./bridgeProtocol";
import { MAILBOXES } from "./mailboxes";
import type { Page } from "./router";
import { WIRE_ROWS, wireColumn } from "../lua/wireFields";
import { storePasswordCredential } from "./passwordCredential";
import {
  AUTH_FIELDS,
  type AuthField,
  type AuthProxy,
  type ProxyAction,
  type TextProxy,
  createAuthProxy,
  createTextProxy,
  placeProxy,
  proxyElement,
  readFieldBox,
} from "./textProxy";

export type BridgeScreen = "library" | "builder" | "sandbox" | "simulator" | "online" | "account";

export interface AuthRequest {
  mode: "login" | "register";
  email: string;
  password: string;
  name: string;
}

export interface PageView {
  page: Page;
  id: string;
  title: string;
  /** The canvas's accessible name and the page heading (router.ts pageLabel). */
  label: string;
  /** How to use the page: the canvas's description (router.ts pageInstructions). */
  instructions: string;
}

/** What host.js reports about the boot and the runtime (bridgeProtocol.d.ts onDegraded). */
export type DegradedState = "stalled" | "failed" | "recovered";

/** Where home's keyboard focus sits in its ring (main.lua's focus-edge print). */
type FocusEdge = "first" | "last" | "none";

export interface ShellPorts {
  command(screen: BridgeScreen, raw: string): void;
  navigate(page: string): void;
  /** Signs in or registers; resolves true when the account is signed in. */
  authenticate(request: AuthRequest): Promise<boolean> | void;
  /** Deletes the signed-in account with the auth form's fields: the password, or for an
   * OAuth-only account the email typed to confirm. */
  deleteAccount(password: string, email: string): void;
}

/** What the auth form is open for: signing in, creating an account, or confirming a deletion. */
type AuthMode = AuthRequest["mode"] | "delete";

const AUTH_FORM_LABEL: Record<AuthMode, string> = {
  login: "Sign in",
  register: "Create account",
  delete: "Delete account",
};

/** Lua's preferences record, kept as Lua serializes it; Lua owns its fields. */
const PREFERENCES_KEY = "colorless.lua.preferences";

const SETTINGS_INSTRUCTIONS = "Tab between controls. Arrow keys adjust values. Escape closes.";
const AUTH_INSTRUCTIONS =
  "Tab between controls. Enter edits or activates. Escape returns to Settings.";
const LOADING_LABEL = "Colorless is loading";
const FAILED_LABEL = "Colorless has stopped. Reload to continue.";

/** How long an announcement stays in the live region before it is cleared, so no stale text is
    left for a screen reader to meet while reading. */
export const ANNOUNCEMENT_CLEAR_MS = 5000;
/** How long "Colorless is ready" waits for the page's own first line, to be said with it rather
    than overwrite it (or be overwritten) a moment later. */
export const READY_JOIN_MS = 400;
const READY_ANNOUNCEMENT = "Colorless is ready";

/** The screens whose single-line fields share one proxy, each with its own mailbox. */
type LineOwner = "library" | "sandbox" | "online";
const LINE_MAILBOX: Record<LineOwner, string> = {
  library: MAILBOXES.libraryInput,
  sandbox: MAILBOXES.sandboxInput,
  online: MAILBOXES.onlineInput,
};

/** The builder's text fields, named as Lua draws them (frontend/lua/ui/builder.lua FIELD_LABELS). */
export const BUILDER_FIELD_LABEL: Record<string, string> = {
  name: "Deck name",
  query: "Search cards",
  optionQuery: "Find an option",
  text: "Rules text",
  transfer: "Decklist. Paste your list here.",
};

/** Dresses the builder's one-line proxy for `field`: a deck name, or one of its searches. */
export function dressBuilderLine(element: HTMLInputElement, field: string) {
  const name = field === "name";
  element.maxLength = name ? DECK_NAME_MAX : 300;
  element.setAttribute("aria-label", BUILDER_FIELD_LABEL[field] ?? field);
  element.spellcheck = false;
  element.autocapitalize = "none";
  element.enterKeyHint = name ? "done" : "search";
  element.inputMode = name ? "text" : "search";
}

/** A pasted invite link (/online/CODE, or an older /?lobby=CODE) yields its code. */
const INVITE_LINK = /(?:[?&]lobby=|\/(?:online|lobby|match)\/)([^&#?/\s]+)/i;

/** The lobby code field keeps only the code's alphabet, with the caret where it was. */
export function normalizeCodeField(element: { value: string; selectionStart: number | null }) {
  const link = INVITE_LINK.exec(element.value);
  const value = normalizeLobbyCode(link?.[1] ?? element.value);
  const caret = link
    ? value.length
    : normalizeLobbyCode(element.value.slice(0, element.selectionStart ?? 0)).length;
  return { value, caret };
}

/** One print from Lua (frontend/lua/ui/bridge.lua): `COLORLESS:<channel>` or
    `COLORLESS:<channel>:<payload>`, the payload being percent-encoded TAB-joined fields. Anything
    else, a payload with an unencoded byte included, is not a command. */
export function parsePrint(message: string): { channel: string; rest: string } | null {
  const match = /^COLORLESS:([a-z][a-z-]*)(?::([\w.~%\t-]*))?$/.exec(message);
  if (!match) return null;
  return { channel: match[1] ?? "", rest: match[2] ?? "" };
}

/** A payload of one text field, decoded, with control characters shown as spaces. */
export function printText(rest: string): string {
  const [text = ""] = decodeFields(rest) ?? [];
  return text.replace(/\p{Cc}/gu, " ");
}

/** The live region's next text: a repeat of the current message gains a trailing no-break space,
    so screen readers still hear it. */
export function nextAnnouncement(current: string, message: string): string {
  return current === message ? `${message}\u00a0` : message;
}

/** One frame's announcements as one message. Joined parts each end as a sentence, so a focus
    label such as "Fire Energy, your hand" does not run into the next; a lone part is kept as is. */
export function joinAnnouncements(parts: readonly string[]): string {
  if (parts.length === 1) return parts[0] ?? "";
  return parts.map((p) => (/[.!?]$/.test(p.trimEnd()) ? p.trimEnd() : `${p.trimEnd()}.`)).join(" ");
}

/** Marks an auth input refused, described by the element `describedBy` names, or unmarks it. */
function markInvalid(input: HTMLInputElement, invalid: boolean, describedBy = "") {
  if (invalid) {
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", describedBy);
  } else {
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
  }
}

export class HostShell {
  private view: PageView;
  private ready = false;
  /** A stalled boot or a failed page: the canvas steps aside for the links, which load for real. */
  private degraded: "stalled" | "failed" | null = null;
  private settingsOpen = false;
  /** The auth form open in Settings. */
  private authOpen = false;
  private transitionOpen = false;
  private focusEdge: FocusEdge = "none";
  /** The button at the edge, which Tab left the canvas from and comes back to. */
  private edgeLabel = "";
  /** Focus left the canvas past the edge; the keyboard's way back says where it lands. */
  private leftAtEdge = false;
  private lastKeyTab = false;
  private readyTimer: ReturnType<typeof setTimeout> | undefined;
  private announcementTimer: ReturnType<typeof setTimeout> | undefined;
  private pageRevision = 0;
  private settingsRevision = 0;
  private lineOwner: LineOwner = "library";
  /** This Lua frame's announcements, spoken together once the frame's prints are handled. */
  private heard: string[] = [];
  private readonly canvas: HTMLCanvasElement;
  private readonly name: TextProxy;
  private readonly line: TextProxy;
  /** The builder's name and search fields. */
  private readonly builderLine: TextProxy;
  private readonly builderLineInput: HTMLInputElement;
  /** The builder's decklist, where Enter types a newline. */
  private readonly builderText: TextProxy;
  private readonly auth: AuthProxy;
  /** The last failed submit's message, which describes the fields it refused (audit PG9). */
  private readonly authProblem: HTMLElement;
  /** Failed submits the account snapshots have counted. */
  private authFailures = 0;
  private authMode: AuthMode = "login";
  /** The account the last snapshot named, "" when signed out. */
  private accountUser = "";

  constructor(
    private readonly doc: Document,
    private readonly host: ColorlessHost,
    private readonly ports: ShellPorts,
  ) {
    const canvas = doc.getElementById("canvas");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("The page has no #canvas.");
    this.canvas = canvas;
    this.view = {
      page: "home",
      id: "",
      title: doc.title,
      label: canvas.getAttribute("aria-label") ?? "",
      instructions: doc.getElementById("instructions")?.textContent ?? "",
    };
    const release = () => this.focusCanvas();
    host.writeMailbox(
      MAILBOXES.preferences,
      readPersisted(PREFERENCES_KEY, (raw) => raw, ""),
    );

    const nameInput = proxyElement(doc, "input");
    nameInput.setAttribute("aria-label", "Display name");
    nameInput.setAttribute("autocomplete", "nickname");
    nameInput.maxLength = DISPLAY_NAME_MAX;
    this.name = createTextProxy({
      element: nameInput,
      write: (record) => host.writeMailbox(MAILBOXES.accountInput, record),
      release,
    });

    const lineInput = proxyElement(doc, "input");
    lineInput.autocomplete = "off";
    this.line = createTextProxy({
      element: lineInput,
      write: (record) => host.writeMailbox(LINE_MAILBOX[this.lineOwner], record),
      release,
      normalize: (element, field) => {
        if (this.lineOwner !== "online" || field !== "code") return;
        const { value, caret } = normalizeCodeField(element);
        element.value = value;
        element.setSelectionRange(caret, caret);
      },
    });

    const builderPublished = (field: string, value: string, action: ProxyAction) => {
      // The builder refuses a name that ends its edit blank, so it hears how each record ends.
      if (field === "name") this.builderCommand("name", value, action);
      else if (field === "optionQuery") this.builderCommand("option-query", value);
      else if (field !== "transfer") this.builderCommand("filter", field, value);
    };
    const builderLineInput = proxyElement(doc, "input");
    builderLineInput.autocomplete = "off";
    this.builderLineInput = builderLineInput;
    this.builderLine = createTextProxy({
      element: builderLineInput,
      write: (record) => host.writeMailbox(MAILBOXES.builderInput, record),
      release,
      // A pasted line break would otherwise end up inside a name or a search.
      normalize: (element) => {
        element.value = element.value.replace(/[\r\n]/g, " ");
      },
      published: builderPublished,
    });
    const builderInput = proxyElement(doc, "textarea");
    builderInput.setAttribute("aria-label", BUILDER_FIELD_LABEL.transfer ?? "");
    builderInput.spellcheck = false;
    builderInput.autocapitalize = "none";
    this.builderText = createTextProxy({
      element: builderInput,
      write: (record) => host.writeMailbox(MAILBOXES.builderInput, record),
      release,
      multiline: () => true,
      published: builderPublished,
    });

    const authInputs = {} as Record<AuthField, HTMLInputElement>;
    // A form groups the sign-in fields for a password manager (audit BR7). It never submits: Lua
    // sends the sign-in. With display: contents it has no box, so the proxies keep their place and
    // their order in the page, and only the field being edited is shown, as before.
    const authForm = doc.createElement("form");
    authForm.style.display = "contents";
    authForm.addEventListener("submit", (event) => event.preventDefault());
    (doc.querySelector("main") ?? doc.body).append(authForm);
    for (const field of AUTH_FIELDS) {
      const input = proxyElement(doc, "input");
      authForm.append(input);
      input.type = field === "password" ? "password" : "text";
      input.setAttribute(
        "aria-label",
        field === "email" ? "Email" : field === "password" ? "Password" : "Display name (optional)",
      );
      input.maxLength = field === "email" ? 254 : field === "password" ? 256 : DISPLAY_NAME_MAX;
      input.setAttribute(
        "autocomplete",
        field === "email" ? "username" : field === "password" ? "current-password" : "nickname",
      );
      input.autocapitalize = field === "name" ? "words" : "none";
      input.spellcheck = false;
      if (field === "email") input.inputMode = "email";
      // Typing in a refused field takes its mark away, as Lua takes away its outline.
      input.addEventListener("input", () => markInvalid(input, false));
      authInputs[field] = input;
    }
    const authProblem = doc.createElement("p");
    authProblem.id = "auth-problem";
    authProblem.className = "sr-only";
    // Read only through the fields' aria-describedby, which reaches a hidden element.
    authProblem.hidden = true;
    (doc.querySelector("main") ?? doc.body).append(authProblem);
    this.authProblem = authProblem;
    this.auth = createAuthProxy({
      inputs: authInputs,
      write: (record) => host.writeMailbox(MAILBOXES.authInput, record),
      release,
    });

    this.link("decks-link", () => ports.navigate("decks"));
    this.link("online-link", () => ports.navigate("online"));
    this.link("sandbox-link", () => ports.command("simulator", "resume"));
    this.link("settings-link", () => this.requestSettings("game"));
    this.link("account-link", () => this.requestSettings("account"));
    this.link("home-link", () => ports.navigate("home"));
    // ?account and ?settings open Settings over the page on the matching tab.
    const params = new URLSearchParams(doc.location.search);
    if (params.has("account") || params.has("settings"))
      this.requestSettings(params.has("account") ? "account" : "game");
    // SDL's window listener (bubble phase) prevents every Tab; this capture listener runs first
    // and keeps the one Tab that leaves home's ring from it, so the browser moves focus on.
    window.addEventListener(
      "keydown",
      (event) => {
        this.lastKeyTab = (event as KeyboardEvent).key === "Tab";
        if (!this.tabLeaves(event)) return;
        this.leftAtEdge = true;
        event.stopImmediatePropagation();
      },
      true,
    );
    window.addEventListener(
      "pointerdown",
      () => {
        this.lastKeyTab = false;
      },
      true,
    );
    // Lua cannot tell the canvas got focus back, so Tab's return to the edge button is said here.
    canvas.addEventListener("focus", () => {
      const back = this.leftAtEdge && this.lastKeyTab;
      this.leftAtEdge = false;
      if (back && this.view.page === "home" && !this.settingsOpen && this.focusEdge !== "none")
        this.announce(this.edgeLabel);
    });
    // Off home and in Settings the canvas keeps Tab and the paging keys; arrows always navigate
    // inside it rather than scrolling.
    canvas.addEventListener("keydown", (event) => {
      if (
        ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code) ||
        ((this.settingsOpen || this.view.page !== "home") &&
          ["Tab", "Home", "End", "Escape", "PageUp", "PageDown"].includes(event.code))
      )
        event.preventDefault();
    });
  }

  /** Mirrors the router's page into Lua's page mailbox, the title, heading and canvas. */
  showPage(view: PageView) {
    const moved = view.page !== this.view.page || view.id !== this.view.id;
    if (moved) this.finishInputs();
    this.view = view;
    this.sync();
    if (moved || this.pageRevision === 0)
      this.host.writeMailbox(
        MAILBOXES.page,
        encodeFields([++this.pageRevision, view.page, view.id]),
      );
  }

  /** host.js's boot and runtime state. A failure is final; a stall lasts until the download moves
      again or Lua is ready. */
  onDegraded(state: DegradedState) {
    if (state === "failed") this.degraded = "failed";
    else if (this.degraded !== "failed")
      this.degraded = state === "stalled" && !this.ready ? "stalled" : null;
    this.sync();
  }

  /** Ends the deck and builder edits, publishing their last values. */
  finishInputs() {
    this.line.finish();
    this.builderLine.finish();
    this.builderText.finish();
  }

  accountChanged(snapshot: string) {
    this.host.writeMailbox(MAILBOXES.account, snapshot);
    const fields = decodeFields(snapshot) ?? [];
    const [, status = "", , , user = ""] = fields;
    this.markRefused(fields);
    // A different account (a sign-in, a sign-out, a deletion) empties the auth form, password
    // included. Other snapshots leave it: the deletion form stays filled while signed in.
    if (user !== this.accountUser) {
      this.accountUser = user;
      this.auth.clear();
    }
    if (status !== "authenticated") this.name.finish("done", true);
  }

  /** A failed submit marks the auth fields it refused invalid, described by its message; a repeat
   * marks them again. Other snapshots keep the marks typing took away, until the account clears
   * them all. */
  private markRefused(fields: readonly string[]) {
    const header = WIRE_ROWS.account.header;
    const invalid = (fields[wireColumn(header, "invalid")] ?? "").split(" ").filter(Boolean);
    const failures = Number(fields[wireColumn(header, "failures")] ?? this.authFailures);
    const failed = failures !== this.authFailures;
    this.authFailures = failures;
    if (!failed && invalid.length > 0) return;
    for (const field of AUTH_FIELDS)
      markInvalid(this.authInput(field), invalid.includes(field), this.authProblem.id);
    this.authProblem.textContent = invalid.length
      ? (fields[wireColumn(header, "message")] ?? "")
      : "";
  }

  /** Runs one of Lua's prints. It never throws: love.js swallows an error thrown from print, and
      the unflushed line then spoils the next command too. */
  /** Lua prints a frame's lines in one task, so a table snapshot's line and the tray that opens with
      it would replace each other in the live region; they are joined into one message instead. */
  private announce(text: string) {
    if (!text || this.heard.includes(text)) return;
    const first = this.heard.length === 0;
    if (this.readyTimer !== undefined) {
      clearTimeout(this.readyTimer);
      this.readyTimer = undefined;
      this.heard.push(READY_ANNOUNCEMENT);
    }
    this.heard.push(text);
    if (!first) return;
    queueMicrotask(() => {
      const message = joinAnnouncements(this.heard);
      this.heard = [];
      const region = this.doc.getElementById("announcement");
      if (!region) return;
      region.textContent = nextAnnouncement(region.textContent ?? "", message);
      clearTimeout(this.announcementTimer);
      this.announcementTimer = setTimeout(() => {
        region.textContent = "";
      }, ANNOUNCEMENT_CLEAR_MS);
    });
  }
  onPrint(message: string) {
    try {
      this.runPrint(message);
    } catch (error) {
      reportError("run a Lua command", error);
    }
  }

  private runPrint(message: string) {
    const print = parsePrint(message);
    if (!print) return;
    const { channel, rest } = print;
    switch (channel) {
      case "ready":
        this.ready = true;
        if (this.degraded === "stalled") this.degraded = null;
        this.sync();
        this.focusCanvas();
        clearTimeout(this.readyTimer);
        this.readyTimer = setTimeout(() => {
          this.readyTimer = undefined;
          this.announce(READY_ANNOUNCEMENT);
        }, READY_JOIN_MS);
        break;
      case "page":
        this.ports.navigate(printText(rest));
        break;
      case "library":
      case "sandbox":
      case "online":
        this.lineCommand(channel, rest);
        break;
      case "builder":
        this.builderPrint(rest);
        break;
      case "simulator":
        this.ports.command("simulator", rest);
        break;
      case "auth":
        this.authPrint(rest);
        break;
      case "account":
        this.accountPrint(rest);
        break;
      case "announce":
        this.announce(printText(rest));
        break;
      case "preferences":
        writePersisted(PREFERENCES_KEY, printText(rest));
        break;
      case "settings": {
        const state = printText(rest);
        if (state === "open" || state === "closed") this.settingsChanged(state === "open");
        break;
      }
      case "transition":
        this.transitionOpen = printText(rest) === "open";
        this.sync();
        break;
      case "field-box":
        this.moveEditingProxy(rest);
        break;
      case "focus-edge": {
        const [edge = "", label = ""] = decodeFields(rest) ?? [];
        if (edge !== "first" && edge !== "last" && edge !== "none") break;
        this.focusEdge = edge;
        this.edgeLabel = label.replace(/\p{Cc}/gu, " ");
        break;
      }
    }
  }

  private focusCanvas() {
    if (!this.degraded) this.canvas.focus({ preventScroll: true });
  }

  private link(id: string, run: () => void) {
    this.doc.getElementById(id)?.addEventListener("click", (event) => {
      // Until Lua is ready, and once the boot stalls or the page fails, the link loads its page
      // the ordinary way.
      if (!this.ready || this.degraded) return;
      event.preventDefault();
      this.leftAtEdge = false;
      run();
      this.focusCanvas();
    });
  }

  /** The field an edit's print carries from `start` (main.lua withEditBox): its proxy goes there. */
  private place(element: HTMLElement, fields: readonly string[], start: number) {
    placeProxy(element, readFieldBox(fields, start), this.canvas);
  }

  /** Lua's field moved (a resize, a dialog sliding in): the proxy editing it follows. */
  private moveEditingProxy(raw: string) {
    const box = readFieldBox(decodeFields(raw) ?? [], 0);
    const lines = [this.name, this.line, this.builderLine, this.builderText];
    const element =
      lines.find((proxy) => proxy.field !== "")?.element ??
      (this.auth.editing ? this.authInput(this.auth.editing) : undefined);
    if (box && element) placeProxy(element, box, this.canvas);
  }

  /** A text proxy holds focus and its keys. */
  private editing(): boolean {
    const lines = [this.name, this.line, this.builderLine, this.builderText];
    return lines.some((proxy) => proxy.field !== "") || this.auth.editing !== "";
  }

  /** The Tab (or Shift+Tab) that leaves the canvas: on home, with Lua's focus on the ring's last
      (first) button, and nothing over the menu. Lua says "none" while a popup or a wipe is up;
      the shell's own Settings, wipe and proxy state are checked too, in case a print is late. */
  private tabLeaves(event: Event): boolean {
    const key = event as KeyboardEvent;
    if (key.key !== "Tab" || key.ctrlKey || key.altKey || key.metaKey) return false;
    if (this.doc.activeElement !== this.canvas) return false;
    if (!this.ready || this.degraded || this.view.page !== "home") return false;
    if (this.settingsOpen || this.transitionOpen || this.editing()) return false;
    return this.focusEdge === (key.shiftKey ? "first" : "last");
  }

  /** The canvas's name while something covers the page, else the page's. */
  private canvasLabel(): string {
    if (this.degraded === "failed") return FAILED_LABEL;
    if (!this.ready || this.degraded) return LOADING_LABEL;
    if (this.settingsOpen && this.authOpen) return AUTH_FORM_LABEL[this.authMode];
    if (this.settingsOpen) return "Settings";
    return this.view.label;
  }

  private canvasInstructions(): string {
    if (this.settingsOpen && this.authOpen) return AUTH_INSTRUCTIONS;
    if (this.settingsOpen) return SETTINGS_INSTRUCTIONS;
    return this.view.instructions;
  }

  /** Derives the page's semantics from its state, writing only what changed. The canvas is a game
      application. Settings and the collection pages are drawn over home, so the home links are
      inert under them (real inert, not aria-modal, which could hide the #announcement live
      region outside a modal). While degraded the canvas steps aside: no role, out of the Tab
      order, and the links live, so a deep link's reader can reach Home or a page. */
  private sync() {
    const degraded = this.degraded !== null;
    const menu = this.doc.querySelector<HTMLElement>(".accessible-menu");
    const covered = this.settingsOpen || this.view.page !== "home" || this.transitionOpen;
    if (menu) menu.inert = !degraded && covered;
    const home = this.doc.getElementById("home-link");
    if (home) home.hidden = this.view.page === "home";
    const busy = this.degraded !== "failed" && (!this.ready || this.transitionOpen);
    this.attribute("aria-busy", String(busy));
    this.attribute("role", degraded ? null : "application");
    this.attribute("aria-roledescription", degraded ? null : "game");
    this.attribute("tabindex", degraded ? "-1" : "0");
    this.attribute("aria-label", this.canvasLabel());
    this.text("instructions", this.canvasInstructions());
    this.text("page-heading", this.view.label);
    if (this.doc.title !== this.view.title) this.doc.title = this.view.title;
    if (this.degraded === "failed" && this.doc.activeElement === this.canvas) this.canvas.blur();
  }

  private attribute(name: string, value: string | null) {
    if (this.canvas.getAttribute(name) === value) return;
    if (value === null) this.canvas.removeAttribute(name);
    else this.canvas.setAttribute(name, value);
  }

  private text(id: string, value: string) {
    const element = this.doc.getElementById(id);
    if (element && element.textContent !== value) element.textContent = value;
  }

  private requestSettings(tab: "game" | "account") {
    this.host.writeMailbox(MAILBOXES.settings, encodeFields([++this.settingsRevision, tab]));
  }

  private settingsChanged(open: boolean) {
    this.settingsOpen = open;
    this.doc.getElementById("settings-link")?.setAttribute("aria-expanded", String(open));
    this.authOpen = false;
    if (open) this.line.finish();
    else {
      this.name.finish();
      this.auth.clear();
    }
    this.sync();
    this.focusCanvas();
  }

  private lineCommand(owner: LineOwner, raw: string) {
    const fields = decodeFields(raw) ?? [];
    const [action = "", field = "", value = ""] = fields;
    if (action === "input") {
      this.line.finish();
      this.lineOwner = owner;
      const code = owner === "online" && field === "code";
      const element = this.line.element;
      // The code field caps itself as it normalizes, so a pasted link or "AB-CD" survives.
      element.maxLength = DECK_NAME_MAX;
      if (code) {
        element.autocapitalize = "characters";
        element.spellcheck = false;
      } else {
        element.removeAttribute("autocapitalize");
        element.removeAttribute("spellcheck");
      }
      element.setAttribute(
        "aria-label",
        code ? "Lobby code" : field === "search" ? "Search decks" : "Deck name",
      );
      this.place(element, fields, 3);
      // A code typed before the field opened keeps its caret at the end.
      this.line.open(field, value, code);
    } else if (action === "finish-input") this.line.finish();
    else this.ports.command(owner, raw);
  }

  private builderCommand(...fields: string[]) {
    this.ports.command("builder", encodeFields(fields));
  }

  private builderPrint(raw: string) {
    const fields = decodeFields(raw) ?? [];
    const [action = "", field = "", value = ""] = fields;
    if (action === "input") {
      this.builderLine.finish();
      this.builderText.finish();
      if (field === "transfer") {
        this.builderText.element.maxLength = 30000;
        this.place(this.builderText.element, fields, 3);
        this.builderText.open(field, value);
      } else {
        dressBuilderLine(this.builderLineInput, field);
        this.place(this.builderLineInput, fields, 3);
        this.builderLine.open(field, value);
      }
    } else if (action === "finish-input") {
      this.builderLine.finish();
      this.builderText.finish();
    } else if (action === "copy") {
      const note = (text: string) =>
        this.host.writeMailbox(MAILBOXES.builderClipboard, `${Date.now()}\t${text}`);
      const failed = () => note("Copy failed. Select the decklist and use your copy shortcut.");
      // The clipboard is missing outside a secure context.
      if (!navigator.clipboard) failed();
      else navigator.clipboard.writeText(field).then(() => note("Copied decklist."), failed);
    } else this.ports.command("builder", raw);
  }

  private accountPrint(raw: string) {
    const fields = decodeFields(raw) ?? [];
    const [action = "", value = ""] = fields;
    if (action === "edit") {
      this.place(this.name.element, fields, 2);
      this.name.open("name", value);
    } else if (action === "finish-edit") this.name.finish();
    else this.ports.command("account", raw);
  }

  private authPrint(raw: string) {
    const fields = decodeFields(raw) ?? [];
    const [action = "", value = ""] = fields;
    if (action === "open") {
      this.name.finish();
      this.auth.finish();
      this.authMode = value === "register" || value === "delete" ? value : "login";
      this.authInput("password").value = "";
      this.authInput("password").autocomplete =
        this.authMode === "register" ? "new-password" : "current-password";
      // The rule Lua keeps in the field's label, which typing would hide as a placeholder.
      this.authInput("password").setAttribute(
        "aria-label",
        this.authMode === "register" ? "Password, at least 8 characters" : "Password",
      );
      // A deletion's email is typed, never filled in: by this page or by the browser.
      const email = this.authInput("email");
      const deleting = this.authMode === "delete";
      if (deleting) email.value = "";
      email.autocomplete = deleting ? "off" : "username";
      email.setAttribute("aria-label", deleting ? "Type your email to confirm" : "Email");
      this.auth.publish("reset");
      this.ports.command("account", "clear-message");
      this.authOpen = true;
      this.sync();
    } else if (action === "edit" && (AUTH_FIELDS as readonly string[]).includes(value)) {
      this.place(this.authInput(value as AuthField), fields, 2);
      this.auth.edit(value as AuthField);
    } else if (action === "submit") {
      this.auth.finish();
      if (this.authMode === "delete") {
        this.ports.deleteAccount(this.authInput("password").value, this.authInput("email").value);
        return;
      }
      const request = {
        mode: this.authMode,
        email: this.authInput("email").value,
        password: this.authInput("password").value,
        name: this.authInput("name").value,
      };
      // The account's snapshot empties the fields once signed in, so the request keeps them.
      void Promise.resolve(this.ports.authenticate(request)).then((signedIn) => {
        if (signedIn)
          storePasswordCredential(request.email.trim(), request.password, request.name.trim());
      });
    } else if (action === "google") {
      this.auth.finish();
      this.ports.command("account", "google");
    } else if (action === "close") {
      this.auth.clear();
      this.authOpen = false;
      this.sync();
      this.focusCanvas();
    }
  }

  private authInput(field: AuthField): HTMLInputElement {
    return this.auth.inputs[field];
  }
}

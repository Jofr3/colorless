/** The page around the Lua canvas: Lua's print commands, the text proxies, the accessible links
 * and the canvas's dialog semantics. */

import { DECK_NAME_MAX, DISPLAY_NAME_MAX, normalizeLobbyCode } from "@colorless/schema";
import { readPersisted, writePersisted } from "../lib/persistedState";
import { decodeFields, encodeFields } from "../lua/wire";
import type { ColorlessHost } from "./bridgeProtocol";
import { MAILBOXES } from "./mailboxes";
import { type Page, isTablePage } from "./router";
import {
  AUTH_FIELDS,
  type AuthField,
  type AuthProxy,
  type TextProxy,
  createAuthProxy,
  createTextProxy,
  proxyElement,
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
  label: string;
}

export interface ShellPorts {
  command(screen: BridgeScreen, raw: string): void;
  navigate(page: string): void;
  authenticate(request: AuthRequest): void;
}

/** Lua's preferences record, kept as Lua serializes it; Lua owns its fields. */
const PREFERENCES_KEY = "colorless.lua.preferences";

const SETTINGS_LABEL = "Settings. Tab between controls. Arrow keys adjust values. Escape closes.";

/** The screens whose single-line fields share one proxy, each with its own mailbox. */
type LineOwner = "library" | "sandbox" | "online";
const LINE_MAILBOX: Record<LineOwner, string> = {
  library: MAILBOXES.libraryInput,
  sandbox: MAILBOXES.sandboxInput,
  online: MAILBOXES.onlineInput,
};

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

/** The live region's next text: a repeat of the current message gains a trailing no-break space,
    so screen readers still hear it. */
export function nextAnnouncement(current: string, message: string): string {
  return current === message ? `${message}\u00a0` : message;
}

export class HostShell {
  private view: PageView;
  private ready = false;
  private settingsOpen = false;
  private transitionOpen = false;
  private pageRevision = 0;
  private settingsRevision = 0;
  private lineOwner: LineOwner = "library";
  private readonly canvas: HTMLCanvasElement;
  private readonly name: TextProxy;
  private readonly line: TextProxy;
  private readonly builderText: TextProxy;
  private readonly auth: AuthProxy;
  private authMode: "login" | "register" = "login";

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

    const builderInput = proxyElement(doc, "textarea");
    this.builderText = createTextProxy({
      element: builderInput,
      write: (record) => host.writeMailbox(MAILBOXES.builderInput, record),
      release,
      multiline: (field) => field === "transfer",
      normalize: (element, field) => {
        if (field !== "transfer") element.value = element.value.replace(/[\r\n]/g, " ");
      },
      published: (field, value) => {
        if (field === "name") this.builderCommand("name", value);
        else if (field === "optionQuery") this.builderCommand("option-query", value);
        else if (field !== "transfer") this.builderCommand("filter", field, value);
      },
    });

    const authInputs = {} as Record<AuthField, HTMLInputElement>;
    for (const field of AUTH_FIELDS) {
      const input = proxyElement(doc, "input");
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
      authInputs[field] = input;
    }
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
    // ?account and ?settings open Settings over the page on the matching tab.
    const params = new URLSearchParams(doc.location.search);
    if (params.has("account") || params.has("settings"))
      this.requestSettings(params.has("account") ? "account" : "game");
    // Tab stays with the native links; arrows navigate inside the canvas.
    canvas.addEventListener("keydown", (event) => {
      if (
        ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code) ||
        ((this.settingsOpen || this.view.page !== "home") &&
          ["Tab", "Home", "End", "Escape", "PageUp", "PageDown"].includes(event.code))
      )
        event.preventDefault();
    });
  }

  /** Mirrors the router's page into Lua's page mailbox, the title and the canvas label. */
  showPage(view: PageView) {
    const moved = view.page !== this.view.page || view.id !== this.view.id;
    if (moved) this.finishInputs();
    this.view = view;
    this.syncModal();
    if (moved || this.pageRevision === 0)
      this.host.writeMailbox(
        MAILBOXES.page,
        encodeFields([++this.pageRevision, view.page, view.id]),
      );
    this.doc.title = view.title;
    if (!this.settingsOpen) this.canvas.setAttribute("aria-label", view.label);
  }

  /** Ends the deck and builder edits, publishing their last values. */
  finishInputs() {
    this.line.finish();
    this.builderText.finish();
  }

  accountChanged(snapshot: string) {
    this.host.writeMailbox(MAILBOXES.account, snapshot);
    if (decodeFields(snapshot)?.[1] === "authenticated") this.auth.clear();
    else this.name.finish("done", true);
  }

  onPrint(message: string) {
    const match = /^COLORLESS:([a-z-]+)(?::([\s\S]*))?$/.exec(message);
    if (!match) return;
    const [, channel = "", rest = ""] = match;
    switch (channel) {
      case "ready":
        this.ready = true;
        this.doc.title = this.view.title;
        this.focusCanvas();
        break;
      case "page":
        this.ports.navigate(rest);
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
      case "announce": {
        const region = this.doc.getElementById("announcement");
        if (region) region.textContent = nextAnnouncement(region.textContent ?? "", rest);
        break;
      }
      case "preferences":
        writePersisted(PREFERENCES_KEY, rest);
        break;
      case "settings":
        if (rest === "open" || rest === "closed") this.settingsChanged(rest === "open");
        break;
      case "transition":
        this.transitionOpen = rest === "open";
        this.syncModal();
        break;
    }
  }

  private focusCanvas() {
    this.canvas.focus({ preventScroll: true });
  }

  private link(id: string, run: () => void) {
    this.doc.getElementById(id)?.addEventListener("click", (event) => {
      // Until Lua is ready the link loads its page the ordinary way.
      if (!this.ready) return;
      event.preventDefault();
      run();
      this.focusCanvas();
    });
  }

  private syncModal() {
    const elsewhere = this.view.page !== "home";
    const menu = this.doc.querySelector<HTMLElement>(".accessible-menu");
    if (menu) menu.inert = this.settingsOpen || elsewhere || this.transitionOpen;
    this.canvas.setAttribute("aria-busy", String(this.transitionOpen));
    if (this.settingsOpen || (elsewhere && !isTablePage(this.view.page))) {
      this.canvas.setAttribute("role", "dialog");
      this.canvas.setAttribute("aria-modal", "true");
    } else {
      this.canvas.removeAttribute("role");
      this.canvas.removeAttribute("aria-modal");
    }
  }

  private requestSettings(tab: "game" | "account") {
    this.host.writeMailbox(MAILBOXES.settings, encodeFields([++this.settingsRevision, tab]));
  }

  private settingsChanged(open: boolean) {
    this.settingsOpen = open;
    this.doc.getElementById("settings-link")?.setAttribute("aria-expanded", String(open));
    if (open) this.line.finish();
    else {
      this.name.finish();
      this.auth.clear();
    }
    this.syncModal();
    this.canvas.setAttribute("aria-label", open ? SETTINGS_LABEL : this.view.label);
    this.focusCanvas();
  }

  private lineCommand(owner: LineOwner, raw: string) {
    const [action = "", field = "", value = ""] = decodeFields(raw) ?? [];
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
      // A code typed before the field opened keeps its caret at the end.
      this.line.open(field, value, code);
    } else if (action === "finish-input") this.line.finish();
    else this.ports.command(owner, raw);
  }

  private builderCommand(...fields: string[]) {
    this.ports.command("builder", encodeFields(fields));
  }

  private builderPrint(raw: string) {
    const [action = "", field = "", value = ""] = decodeFields(raw) ?? [];
    if (action === "input") {
      this.builderText.finish();
      const element = this.builderText.element;
      element.maxLength = field === "transfer" ? 30000 : field === "name" ? DECK_NAME_MAX : 300;
      element.setAttribute(
        "aria-label",
        field === "transfer" ? "Decklist. Paste your list here." : field,
      );
      this.builderText.open(field, value);
    } else if (action === "finish-input") this.builderText.finish();
    else if (action === "copy") {
      const note = (text: string) =>
        this.host.writeMailbox(MAILBOXES.builderClipboard, `${Date.now()}\t${text}`);
      navigator.clipboard.writeText(field).then(
        () => note("Copied decklist."),
        () => note("Copy failed. Select the decklist and use your copy shortcut."),
      );
    } else this.ports.command("builder", raw);
  }

  private accountPrint(raw: string) {
    const [action = "", value = ""] = decodeFields(raw) ?? [];
    if (action === "edit") this.name.open("name", value);
    else if (action === "finish-edit") this.name.finish();
    else this.ports.command("account", raw);
  }

  private authPrint(raw: string) {
    const [action = "", value = ""] = raw.split("\t");
    if (action === "open") {
      this.name.finish();
      this.auth.finish();
      this.authMode = value === "register" ? "register" : "login";
      this.authInput("password").value = "";
      this.authInput("password").autocomplete =
        this.authMode === "register" ? "new-password" : "current-password";
      this.auth.publish("reset");
      this.ports.command("account", "clear-message");
      this.canvas.setAttribute(
        "aria-label",
        `${this.authMode === "register" ? "Create account" : "Sign in"}. Tab between controls. Enter edits or activates. Escape returns to Settings.`,
      );
    } else if (action === "edit" && (AUTH_FIELDS as readonly string[]).includes(value)) {
      this.auth.edit(value as AuthField);
    } else if (action === "submit") {
      this.auth.finish();
      this.ports.authenticate({
        mode: this.authMode,
        email: this.authInput("email").value,
        password: this.authInput("password").value,
        name: this.authInput("name").value,
      });
    } else if (action === "google") {
      this.auth.finish();
      this.ports.command("account", "google");
    } else if (action === "close") {
      this.auth.clear();
      this.focusCanvas();
      this.canvas.setAttribute("aria-label", SETTINGS_LABEL);
    }
  }

  private authInput(field: AuthField): HTMLInputElement {
    return this.auth.inputs[field];
  }
}

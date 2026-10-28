import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeFields } from "../lua/wire";
import type { ColorlessHost } from "./bridgeProtocol";
import { MAILBOXES } from "./mailboxes";
import { HostShell, type ShellPorts } from "./shell";

/** Just enough of an element for the shell and its text proxies, on Node's EventTarget. */
class FakeElement extends EventTarget {
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
  focus() {}
  select() {}
  setSelectionRange() {}
  append() {}
}
class FakeCanvas extends FakeElement {}

function fakePage() {
  const canvas = new FakeCanvas();
  const created: FakeElement[] = [];
  const doc = {
    title: "Colorless",
    location: { search: "" },
    body: new FakeElement(),
    getElementById: (id: string) => (id === "canvas" ? canvas : null),
    querySelector: () => null,
    createElement: () => {
      const element = new FakeElement();
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
  return { shell, ports, mailboxes, labelled };
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

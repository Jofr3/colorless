import { describe, expect, it, vi } from "vitest";
import { decodeFields } from "../lua/wire";
import { normalizeCodeField } from "./shell";
import {
  type AuthField,
  createAuthProxy,
  createTextProxy,
  placeProxy,
  readFieldBox,
} from "./textProxy";

/** The slice of a text field the proxies touch, on Node's own EventTarget. */
class FakeField extends EventTarget {
  value = "";
  hidden = true;
  focused = false;
  selectionStart: number | null = 0;
  selectionEnd: number | null = 0;
  focus() {
    this.focused = true;
  }
  select() {
    this.setSelectionRange(0, this.value.length);
  }
  setSelectionRange(start: number, end: number) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
  type(value: string) {
    this.value = value;
    this.setSelectionRange(value.length, value.length);
    this.dispatchEvent(new Event("input"));
  }
  /** Keys reach a proxy through its key target; here that is the field itself. */
  key(type: "keydown" | "keyup", key: string, extra: Partial<KeyboardEvent> = {}) {
    const event = Object.assign(new Event(type, { cancelable: true }), {
      key,
      isComposing: false,
      shiftKey: false,
      ...extra,
    });
    this.dispatchEvent(event);
    return event;
  }
}
const asInput = (field: FakeField) => field as unknown as HTMLInputElement;

function setup(options: Partial<Parameters<typeof createTextProxy>[0]> = {}) {
  const field = new FakeField();
  const records: string[][] = [];
  const release = vi.fn();
  const proxy = createTextProxy({
    element: asInput(field),
    keyTarget: field,
    write: (record) => records.push(decodeFields(record) ?? []),
    release,
    ...options,
  });
  return { proxy, field, records, release, last: () => records.at(-1) };
}

describe("createTextProxy", () => {
  it("opens on a field, publishing the shared record with the selection", () => {
    const { proxy, field, last } = setup();
    proxy.open("search", "fire");
    expect(field.hidden).toBe(false);
    expect(field.focused).toBe(true);
    expect(last()).toEqual(["1", "search", "fire", "0", "4", "input"]);
  });

  it("can open with the caret at the end instead of selecting", () => {
    const { proxy, last } = setup();
    proxy.open("code", "AB", true);
    expect(last()).toEqual(["1", "code", "AB", "2", "2", "input"]);
  });

  it("publishes each edit and caret move with a rising revision", () => {
    const { proxy, field, last } = setup();
    proxy.open("name", "");
    field.type("Ash");
    expect(last()).toEqual(["2", "name", "Ash", "3", "3", "input"]);
    field.setSelectionRange(1, 1);
    field.key("keyup", "ArrowLeft");
    expect(last()).toEqual(["3", "name", "Ash", "1", "1", "input"]);
  });

  it("ends on Enter as enter, on Tab as done, and restores the original on Escape", () => {
    const { proxy, field, last, release } = setup();
    proxy.open("name", "Zoe");
    field.type("Zoey");
    expect(field.key("keydown", "Enter").defaultPrevented).toBe(true);
    expect(last()).toEqual(["3", "name", "Zoey", "4", "4", "enter"]);
    expect(proxy.field).toBe("");
    expect(field.hidden).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);

    proxy.open("name", "Zoe");
    field.key("keydown", "Tab");
    expect(last()?.[5]).toBe("done");

    proxy.open("name", "Zoe");
    field.type("Zed");
    field.key("keydown", "Escape");
    expect(last()?.slice(1)).toEqual(["name", "Zoe", "3", "3", "done"]);
  });

  it("lets Enter type a newline in a multiline field", () => {
    const { proxy, field, records } = setup({ multiline: (name) => name === "transfer" });
    proxy.open("transfer", "4 Buizel");
    const before = records.length;
    expect(field.key("keydown", "Enter").defaultPrevented).toBe(false);
    expect(proxy.field).toBe("transfer");
    expect(records.length).toBe(before);
  });

  it("stops other listeners from seeing the keys typed into it", () => {
    const { proxy, field } = setup();
    const game = vi.fn();
    field.addEventListener("keydown", game);
    proxy.open("search", "");
    field.key("keydown", "a");
    expect(game).not.toHaveBeenCalled();
  });

  it("lets the game see a key's release when it saw the key go down (QA7)", () => {
    // The key that opens a proxy (Enter, or the builder's /) goes down on the canvas and comes up
    // on the proxy focused since. Swallowed, SDL would think it still held and drop the next press.
    const page = new EventTarget();
    const canvas = new EventTarget();
    const field = new FakeField();
    const proxy = createTextProxy({
      element: asInput(field),
      keyTarget: page,
      write: () => {},
      release: vi.fn(),
    });
    const game: string[] = [];
    for (const type of ["keydown", "keyup"])
      page.addEventListener(type, (event) => game.push(`${type}:${(event as KeyboardEvent).key}`));
    const send = (type: string, key: string, target: EventTarget) => {
      const event = Object.assign(new Event(type, { cancelable: true }), {
        key,
        code: `Key${key}`,
        isComposing: false,
      });
      Object.defineProperty(event, "target", { value: target });
      page.dispatchEvent(event);
    };
    send("keydown", "/", canvas);
    proxy.open("query", "");
    send("keyup", "/", field);
    send("keydown", "a", field);
    send("keyup", "a", field);
    send("keyup", "/", field);
    expect(game).toEqual(["keydown:/", "keyup:/"]);
  });

  it("ignores a composing Enter", () => {
    const { proxy, field } = setup();
    proxy.open("search", "");
    field.key("keydown", "Enter", { isComposing: true });
    expect(proxy.field).toBe("search");
  });

  it("finishes on blur, and finishing an idle proxy writes nothing", () => {
    const { proxy, field, records } = setup();
    proxy.finish();
    expect(records).toEqual([]);
    proxy.open("search", "x");
    field.dispatchEvent(new Event("blur"));
    expect(proxy.field).toBe("");
    expect(records.at(-1)?.[5]).toBe("done");
  });

  it("opening another field finishes the first", () => {
    const { proxy, records } = setup();
    proxy.open("search", "x");
    proxy.open("name", "y");
    expect(records.map((r) => [r[1], r[5]])).toEqual([
      ["search", "input"],
      ["search", "done"],
      ["name", "input"],
    ]);
  });

  it("normalizes typed text before it is published, then reports it", () => {
    const published = vi.fn();
    const { proxy, field, last } = setup({
      normalize: (element) => {
        element.value = element.value.toUpperCase();
      },
      published,
    });
    proxy.open("code", "");
    field.type("ab");
    expect(last()?.[2]).toBe("AB");
    expect(published).toHaveBeenLastCalledWith("code", "AB", "input");
  });
});

describe("normalizeCodeField", () => {
  it("keeps the lobby alphabet and the caret's place in it", () => {
    expect(normalizeCodeField({ value: "ab-cd", selectionStart: 3 })).toEqual({
      value: "ABCD",
      caret: 2,
    });
    expect(normalizeCodeField({ value: "aI0bcdef", selectionStart: 8 })).toEqual({
      value: "ABCD",
      caret: 4,
    });
  });

  it("takes the code out of a pasted invite link", () => {
    for (const link of [
      "https://colorless.test/online/wxyz/play",
      "https://colorless.test/?lobby=wxyz",
      "/lobby/WXYZ",
    ])
      expect(normalizeCodeField({ value: link, selectionStart: 0 })).toEqual({
        value: "WXYZ",
        caret: 4,
      });
  });
});

describe("createAuthProxy", () => {
  function auth() {
    const fields = { email: new FakeField(), password: new FakeField(), name: new FakeField() };
    const records: string[][] = [];
    const proxy = createAuthProxy({
      inputs: {
        email: asInput(fields.email),
        password: asInput(fields.password),
        name: asInput(fields.name),
      } satisfies Record<AuthField, HTMLInputElement>,
      write: (record) => records.push(decodeFields(record) ?? []),
      release: () => {},
      keyTarget: new EventTarget(),
    });
    return { proxy, fields, records, last: () => records.at(-1) };
  }

  it("masks the password and names the field it edits", () => {
    const { proxy, fields, last } = auth();
    proxy.edit("password");
    fields.password.type("hunter22");
    expect(last()).toEqual(["2", "password", "", "********", "", "8", "8", "input", "password"]);
  });

  it("clears every field and tells Lua", () => {
    const { proxy, fields, last } = auth();
    fields.email.value = "zoe@example.com";
    proxy.clear();
    expect(fields.email.value).toBe("");
    expect(last()?.[7]).toBe("reset");
  });

  it("restores the field Escape leaves", () => {
    const { proxy, fields, last } = auth();
    fields.email.value = "zoe@example.com";
    proxy.edit("email");
    fields.email.type("x");
    proxy.finish("done", true);
    expect(fields.email.value).toBe("zoe@example.com");
    expect(last()?.slice(-2)).toEqual(["done", "email"]);
    expect(proxy.editing).toBe("");
  });
});

describe("readFieldBox", () => {
  it("reads the four whole numbers after a print's own fields", () => {
    expect(readFieldBox(["input", "search", "fire", "120", "-8", "432", "42"], 3)).toEqual({
      x: 120,
      y: -8,
      width: 432,
      height: 42,
    });
    expect(readFieldBox(["0", "0", "1", "1"], 0)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it("has no box for a print without one, or with a broken one", () => {
    for (const fields of [
      ["input", "search", "fire"],
      ["1", "2", "3"],
      ["1", "2", "3", ""],
      ["1.5", "2", "3", "4"],
      ["1e3", "2", "3", "4"],
      [" 1", "2", "3", "4"],
      ["1", "2", "0", "4"],
      ["1", "2", "3", "-4"],
      ["1", "2", "3", "4000000"],
    ])
      expect(readFieldBox(fields, 0)).toBeNull();
  });
});

describe("placeProxy", () => {
  const canvas = { getBoundingClientRect: () => ({ left: 10, top: -4 }) } as unknown as Element;

  it("puts the proxy over the field, from the canvas's place in the viewport", () => {
    const element = { style: {} } as HTMLElement;
    placeProxy(element, { x: 120, y: 48, width: 432, height: 42 }, canvas);
    expect(element.style).toEqual({ left: "130px", top: "44px", width: "432px", height: "42px" });
  });

  it("hands the proxy back to the page's flow without a box", () => {
    const element = { style: { left: "1px", top: "2px", width: "3px", height: "4px" } };
    placeProxy(element as unknown as HTMLElement, null, canvas);
    expect(element.style).toEqual({ left: "", top: "", width: "", height: "" });
  });
});

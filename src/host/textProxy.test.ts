import { describe, expect, it, vi } from "vitest";
import { decodeFields } from "../lua/wire";
import { normalizeCodeField } from "./shell";
import { type AuthField, createAuthProxy, createTextProxy } from "./textProxy";

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

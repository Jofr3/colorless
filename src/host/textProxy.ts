/** Native text-input proxies: a hidden browser field gives a Lua text field IME, paste, selection
 * and a mobile keyboard, while the visible field and caret are drawn in the Lua canvas. */

import { encodeFields } from "../lua/wire";

/** `input` while the edit is live; `enter`, `done` and `previous`/`next` (Tab, auth only) end it,
 * and `reset` clears the auth form. */
export type ProxyAction = "input" | "enter" | "done" | "previous" | "next" | "reset";

type TextElement = HTMLInputElement | HTMLTextAreaElement;

const KEY_EVENTS = ["keydown", "keyup", "keypress"] as const;

/** Keeps SDL from also handling keys typed into a proxy: a capture listener on the window sees
 * them first. `keyup` republishes the caret, and Enter, Escape and Tab end the edit. A key SDL saw
 * go down outside the proxy, as the Enter or / that opened it, still has its release reach SDL,
 * which would otherwise think it held and take the next press for a repeat. */
function captureKeys(
  target: EventTarget,
  owns: (element: EventTarget | null) => boolean,
  editing: () => boolean,
  republish: () => void,
  endKey: (event: KeyboardEvent) => boolean,
) {
  const heldOutside = new Set<string>();
  for (const type of KEY_EVENTS)
    target.addEventListener(
      type,
      (event) => {
        if (!("key" in event)) return;
        const key = event as KeyboardEvent;
        const id = key.code || key.key;
        if (!owns(event.target)) {
          if (type === "keydown") heldOutside.add(id);
          else if (type === "keyup") heldOutside.delete(id);
          return;
        }
        const released = type === "keyup" && heldOutside.delete(id);
        if (!released) event.stopImmediatePropagation();
        if (type === "keyup" && editing()) republish();
        if (
          type === "keydown" &&
          !key.isComposing &&
          ["Enter", "Escape", "Tab"].includes(key.key) &&
          endKey(key)
        )
          event.preventDefault();
      },
      true,
    );
}

/** Where Lua draws the field a proxy edits: whole CSS pixels from the canvas's top-left. */
export interface FieldBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const WHOLE = /^-?\d{1,6}$/;

/** The box Lua's print carries in `fields` from `start` (frontend/lua/main.lua withEditBox), or
 * null where it has none, as from an older game package, or a broken one. */
export function readFieldBox(fields: readonly string[], start: number): FieldBox | null {
  const parts = fields.slice(start, start + 4);
  if (parts.length < 4 || !parts.every((part) => WHOLE.test(part))) return null;
  const [x = 0, y = 0, width = 0, height = 0] = parts.map(Number);
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

/** Puts a proxy over its field, so the IME window and a phone keyboard's pan anchor
 * at the field the canvas draws, not at its corner. host.css keeps it clipped, fixed and out of
 * the pointer's way. Without a box it goes back to where the page's flow leaves it. */
export function placeProxy(element: HTMLElement, box: FieldBox | null, canvas: Element) {
  const { style } = element;
  if (!box) {
    style.left = style.top = style.width = style.height = "";
    return;
  }
  const frame = canvas.getBoundingClientRect();
  style.left = `${frame.left + box.x}px`;
  style.top = `${frame.top + box.y}px`;
  style.width = `${box.width}px`;
  style.height = `${box.height}px`;
}

/** Creates the hidden field a proxy types into. */
export function proxyElement<K extends "input" | "textarea">(
  doc: Document,
  tag: K,
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  element.className = "sr-only text-proxy";
  element.style.fontSize = "16px";
  element.hidden = true;
  (doc.querySelector("main") ?? doc.body).append(element);
  return element;
}

export interface TextProxyOptions {
  element: TextElement;
  /** Writes one record, `[revision, field, value, selectionStart, selectionEnd, action]`. */
  write(record: string): void;
  /** Hands focus back to the canvas once an edit ends. */
  release(): void;
  /** Rewrites the value as it is typed, before it is published. */
  normalize?(element: TextElement, field: string): void;
  /** Runs after every record is written. */
  published?(field: string, value: string, action: ProxyAction): void;
  /** Fields where Enter types a newline instead of ending the edit. */
  multiline?(field: string): boolean;
  /** Listens for the proxy's keys; the window by default. */
  keyTarget?: EventTarget;
}

export interface TextProxy {
  readonly element: TextElement;
  /** The field being edited, or "" when the proxy is idle. */
  readonly field: string;
  open(field: string, value: string, caretAtEnd?: boolean): void;
  finish(action?: ProxyAction, cancel?: boolean): void;
}

export function createTextProxy(options: TextProxyOptions): TextProxy {
  const { element } = options;
  let field = "";
  let original = "";
  let revision = 0;
  const publish = (action: ProxyAction = "input", name = field) => {
    options.write(
      encodeFields([
        ++revision,
        name,
        element.value,
        element.selectionStart ?? 0,
        element.selectionEnd ?? 0,
        action,
      ]),
    );
    options.published?.(name, element.value, action);
  };
  const finish = (action: ProxyAction = "done", cancel = false) => {
    if (!field) return;
    const name = field;
    if (cancel) element.value = original;
    field = "";
    element.hidden = true;
    publish(action, name);
    options.release();
  };
  element.addEventListener("input", () => {
    if (!field) return;
    options.normalize?.(element, field);
    publish();
  });
  element.addEventListener("select", () => {
    if (field) publish();
  });
  element.addEventListener("blur", () => finish());
  captureKeys(
    options.keyTarget ?? window,
    (target) => target === element,
    () => field !== "",
    () => publish(),
    (event) => {
      if (event.key === "Enter" && options.multiline?.(field)) return false;
      finish(event.key === "Enter" ? "enter" : "done", event.key === "Escape");
      return true;
    },
  );
  return {
    element,
    get field() {
      return field;
    },
    open(name, value, caretAtEnd = false) {
      finish();
      field = name;
      element.value = value;
      original = element.value;
      element.hidden = false;
      element.focus({ preventScroll: true });
      if (caretAtEnd) element.setSelectionRange(element.value.length, element.value.length);
      else element.select();
      publish();
    },
    finish,
  };
}

export const AUTH_FIELDS = ["email", "password", "name"] as const;
export type AuthField = (typeof AUTH_FIELDS)[number];

export interface AuthProxyOptions {
  inputs: Record<AuthField, HTMLInputElement>;
  /** Writes one record, `[revision, editing, email, masked password, name, selectionStart,
   * selectionEnd, action, field]`; the password itself never leaves its input. */
  write(record: string): void;
  release(): void;
  keyTarget?: EventTarget;
}

export interface AuthProxy {
  readonly inputs: Record<AuthField, HTMLInputElement>;
  readonly editing: AuthField | "";
  edit(field: AuthField): void;
  finish(action?: ProxyAction, cancel?: boolean): void;
  /** Empties every field and tells Lua. */
  clear(): void;
  publish(action?: ProxyAction): void;
}

/** The sign-in form's three fields, published together with the password masked. */
export function createAuthProxy(options: AuthProxyOptions): AuthProxy {
  const { inputs } = options;
  let editing: AuthField | "" = "";
  let original = "";
  let revision = 0;
  const publish = (action: ProxyAction = "input", field: AuthField | "" = editing) => {
    const input = field ? inputs[field] : undefined;
    options.write(
      encodeFields([
        ++revision,
        editing,
        inputs.email.value,
        "*".repeat(inputs.password.value.length),
        inputs.name.value,
        input?.selectionStart ?? 0,
        input?.selectionEnd ?? 0,
        action,
        field,
      ]),
    );
  };
  const finish = (action: ProxyAction = "done", cancel = false) => {
    if (!editing) return;
    const field = editing;
    const input = inputs[field];
    if (cancel) input.value = original;
    editing = "";
    input.hidden = true;
    publish(action, field);
    options.release();
  };
  for (const field of AUTH_FIELDS) {
    const input = inputs[field];
    input.addEventListener("input", () => publish());
    input.addEventListener("select", () => {
      if (editing === field) publish();
    });
    input.addEventListener("blur", () => {
      if (editing === field) finish();
    });
  }
  const all: EventTarget[] = Object.values(inputs);
  captureKeys(
    options.keyTarget ?? window,
    (target) => target !== null && all.includes(target),
    () => editing !== "",
    () => publish(),
    (event) => {
      const action =
        event.key === "Enter"
          ? "enter"
          : event.key === "Tab"
            ? event.shiftKey
              ? "previous"
              : "next"
            : "done";
      finish(action, event.key === "Escape");
      return true;
    },
  );
  return {
    inputs,
    get editing() {
      return editing;
    },
    edit(field) {
      finish();
      editing = field;
      const input = inputs[field];
      original = input.value;
      input.hidden = false;
      input.focus({ preventScroll: true });
      input.select();
      publish();
    },
    finish,
    clear() {
      editing = "";
      original = "";
      for (const input of Object.values(inputs)) {
        input.value = "";
        input.hidden = true;
      }
      publish("reset");
    },
    publish,
  };
}

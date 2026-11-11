// frontend/lua/web/host.js is a classic browser script with no test seam of its own, so this suite
// runs its source in a node:vm context over a fake page: just the elements, events, timers,
// fetches and runtime hooks the boot path touches. It lives here for the Node types.

import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { repoPath } from "./lib/repo";

const SIZES = { wasm: 1000, wasmTransfer: 600, data: 800, packed: 400 };
const SOURCE = readFileSync(repoPath("frontend/lua/web/host.js"), "utf8").replace(
  "/* love-sizes */ {}",
  JSON.stringify(SIZES),
);
/** The two mailboxes host.js writes itself before Lua's first frame (src/host/mailboxes.ts). */
const MAILBOXES = { viewport: "__viewport.txt", revisions: "__mailbox_revisions.txt" };
/** build.mjs's versions for the deferred transition scans. */
const CARD_VERSIONS = {
  "transition_cards/sv01-030.png": "aaa111",
  "transition_cards/sv01-033.png": "bbb222",
  "music1.ogg": "ccc333",
};

const UNSUPPORTED =
  "Colorless needs WebGL and WebAssembly. Turn on hardware acceleration or try another browser.";

class FakeElement extends EventTarget {
  id = "";
  type = "";
  hidden = false;
  textContent = "";
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  attributeWrites: [string, string][] = [];
  children: FakeElement[] = [];
  private classes = new Set<string>();
  classList = {
    add: (name: string) => void this.classes.add(name),
    remove: (name: string) => void this.classes.delete(name),
    contains: (name: string) => this.classes.has(name),
  };
  constructor(
    private readonly page: { activeElement: FakeElement | null },
    readonly tagName: string,
  ) {
    super();
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
    this.attributeWrites.push([name, value]);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  append(child: FakeElement) {
    this.children.push(child);
  }
  focus() {
    this.page.activeElement = this;
  }
}
class FakeInput extends FakeElement {}
class FakeTextArea extends FakeElement {}
class FakeScript extends FakeElement {}

interface Options {
  webAssembly?: boolean;
  webgl?: boolean;
  decompression?: boolean;
  /** navigator.connection.saveData; no connection object when undefined. */
  saveData?: boolean;
  /** build.mjs's per-file content hashes, the love-versions placeholder. */
  versions?: Record<string, string>;
  /** window.devicePixelRatio, innerWidth and innerHeight. */
  ratio?: number;
  width?: number;
  height?: number;
  /** Whether `(pointer: coarse)` matches: a touch screen as the primary pointer. */
  coarse?: boolean;
}

/** One boot of host.js over a fresh fake page. */
function boot({
  webAssembly = true,
  webgl = true,
  decompression = true,
  saveData,
  versions,
  ratio = 1,
  width = 1280,
  height = 800,
  coarse = false,
}: Options = {}) {
  const page = {
    activeElement: null as FakeElement | null,
    hidden: false,
  };
  const make = (tag: string, id = "") => {
    const element = new (
      tag === "input" ? FakeInput : tag === "textarea" ? FakeTextArea : FakeElement
    )(page, tag.toUpperCase());
    element.id = id;
    return element;
  };
  const elements = Object.fromEntries(
    ["canvas", "loading", "status", "loading-progress", "loading-fill"].map((id) => [
      id,
      make(id === "canvas" ? "canvas" : "div", id),
    ]),
  ) as Record<"canvas" | "loading" | "status" | "loading-progress" | "loading-fill", FakeElement>;
  const lostContexts: string[] = [];
  const probes: string[] = [];
  const documentTarget = new EventTarget();
  const document = Object.assign(page, {
    body: make("body"),
    getElementById: (id: string) => (elements as Record<string, FakeElement>)[id] ?? null,
    createElement: (tag: string) => {
      const element = make(tag);
      if (tag === "canvas")
        Object.assign(element, {
          getContext: (kind: string) => {
            probes.push(kind);
            return webgl
              ? {
                  getExtension: (name: string) =>
                    name === "WEBGL_lose_context"
                      ? { loseContext: () => lostContexts.push(kind) }
                      : null,
                }
              : null;
          },
        });
      return element;
    },
    addEventListener: documentTarget.addEventListener.bind(documentTarget),
    removeEventListener: documentTarget.removeEventListener.bind(documentTarget),
    dispatchEvent: documentTarget.dispatchEvent.bind(documentTarget),
  });

  // Timers run only when the test advances the clock.
  let now = 0;
  let timerSerial = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const advance = async (ms: number) => {
    const until = now + ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].run();
      await settle();
    }
    now = until;
  };

  const fetches: string[] = [];
  const bodies = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
  const responses = new Map<string, () => Response>();
  const aborted: string[] = [];
  const fetch = (url: string, init?: { signal?: AbortSignal }) => {
    fetches.push(url);
    init?.signal?.addEventListener("abort", () => aborted.push(url));
    const respond = responses.get(url.split("?")[0] ?? "");
    if (respond) return Promise.resolve(respond());
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => void bodies.set(url.split("?")[0] ?? "", controller),
    });
    return Promise.resolve(new Response(body));
  };
  const compiled: string[] = [];
  const loveCalls: unknown[] = [];
  const reloads: string[] = [];
  const deletedDatabases: string[] = [];
  const deletions: Record<string, () => void>[] = [];
  const storage = new Map<string, string>();
  const nativeAlerts: string[] = [];
  const errors: unknown[] = [];
  const windowTarget = new EventTarget();
  // matchMedia over the fake page: reduced motion never matches, a resolution query matches the
  // current ratio, hearing "change" when the ratio moves off it, and a coarse pointer matches
  // when the boot says so.
  const mediaQueries: { media: string; target: EventTarget }[] = [];
  const matchMedia = (media: string) => {
    const target = new EventTarget();
    mediaQueries.push({ media, target });
    return {
      media,
      get matches() {
        if (media === "(pointer: coarse)") return coarse;
        return media === `(resolution: ${context.devicePixelRatio}dppx)`;
      },
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
    };
  };
  const context: Record<string, unknown> = {
    document,
    console: { log() {}, info() {}, warn() {}, error: (...args: unknown[]) => errors.push(args) },
    setTimeout: (run: () => void, ms = 0) => {
      timers.set(++timerSerial, { at: now + ms, run });
      return timerSerial;
    },
    clearTimeout: (id: number) => void timers.delete(id),
    addEventListener: windowTarget.addEventListener.bind(windowTarget),
    removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
    alert: (message: string) => void nativeAlerts.push(message),
    matchMedia,
    performance: { mark() {}, measure() {} },
    innerWidth: width,
    innerHeight: height,
    devicePixelRatio: ratio,
    navigator: { connection: saveData === undefined ? undefined : { saveData } },
    fetch,
    Response,
    TransformStream,
    AbortController,
    DecompressionStream: decompression ? DecompressionStream : undefined,
    WebAssembly: webAssembly
      ? {
          compileStreaming: async (source: Response | Promise<Response>) => {
            await (await source).arrayBuffer();
            compiled.push("streaming");
            return {};
          },
          compile: async () => ({}),
          instantiate: async () => ({}),
        }
      : undefined,
    Love: (module: unknown) => {
      loveCalls.push(module);
      return new Promise(() => {});
    },
    location: { reload: () => reloads.push("reload") },
    indexedDB: {
      deleteDatabase: (name: string) => {
        deletedDatabases.push(name);
        const request: Record<string, () => void> = {};
        deletions.push(request);
        return request;
      },
    },
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
    },
    HTMLInputElement: FakeInput,
    HTMLTextAreaElement: FakeTextArea,
    HTMLScriptElement: FakeScript,
  };
  context.window = context;
  createContext(context);
  runInContext(
    versions ? SOURCE.replace("/* love-versions */ {}", JSON.stringify(versions)) : SOURCE,
    context,
  );

  const host = context.colorlessHost as {
    connect(bridge: {
      onDegraded(state: string): void;
      onPrint(): void;
      mailboxes?: Record<string, string>;
      artwork?: { get(id: string): Promise<Blob | null> };
      artSlots?: number;
    }): void;
    wantArt(cards: readonly { id: string; url: string }[]): void;
  };
  const degraded: string[] = [];
  host.connect({
    onDegraded: (state) => degraded.push(state),
    onPrint() {},
    mailboxes: MAILBOXES,
  });
  const module = context.Module as {
    preRun: ((runtime: unknown) => void)[];
    print(message: string): void;
    printErr(message: string): void;
    fetchPackage(url: string, receive: (bytes: ArrayBuffer) => void): void;
  };
  const reloadButton = elements.loading.children.find((c) => c.id === "reload");
  if (!reloadButton) throw new Error("host.js added no Reload button to #loading");

  /** Sends `n` bytes of a held response body. */
  const send = async (path: string, n: number) => {
    await settle();
    const body = bodies.get(path);
    if (!body) throw new Error(`nothing is downloading ${path}`);
    body.enqueue(new Uint8Array(n));
    await settle();
  };
  const finish = async (path: string) => {
    await settle();
    bodies.get(path)?.close();
    await settle();
  };
  const key = (type: string, init: Record<string, unknown>) => {
    const event = Object.assign(new Event(type, { cancelable: true }), init);
    let reachedSdl = false;
    const sdl = () => {
      reachedSdl = true;
    };
    windowTarget.addEventListener(type, sdl);
    windowTarget.dispatchEvent(event);
    windowTarget.removeEventListener(type, sdl);
    return { reachedSdl, prevented: event.defaultPrevented };
  };

  /** The files host.js writes into the runtime's filesystem, by path, and the folders it makes. */
  const written = new Map<string, Uint8Array | string>();
  const folders: string[] = [];
  /** Starts the runtime the way love.js does, before Lua's first frame. */
  const start = () =>
    module.preRun[0]?.({
      FS_createDataFile: (parent: string, name: string, data: Uint8Array | string) => {
        const path = `${parent === "/" ? "" : parent}/${name}`;
        if (written.has(path)) throw new Error(`FS: ${path} exists`);
        written.set(path, data);
      },
      FS_unlink: (path: string) => void written.delete(path),
      FS_createPath: (parent: string, path: string) => void folders.push(`${parent}/${path}`),
    });

  return {
    ...elements,
    body: document.body,
    written,
    folders,
    start,
    page,
    reloadButton,
    module,
    host,
    degraded,
    fetches,
    aborted,
    compiled,
    loveCalls,
    reloads,
    deletedDatabases,
    deletions,
    storage,
    nativeAlerts,
    probes,
    lostContexts,
    responses,
    errors,
    advance,
    send,
    finish,
    key,
    load: () => windowTarget.dispatchEvent(new Event("load")),
    leave: () => windowTarget.dispatchEvent(new Event("pagehide")),
    visibility: (hidden: boolean) => {
      page.hidden = hidden;
      documentTarget.dispatchEvent(new Event("visibilitychange"));
    },
    ready: () => {
      context.Love = undefined;
      module.print("COLORLESS:ready");
    },
    connectLate: () => {
      const seen: string[] = [];
      host.connect({ onDegraded: (state) => seen.push(state), onPrint() {} });
      return seen;
    },
    /** window.alert as SDL calls it, whatever host.js put there. */
    alert: (message: string) => (context.alert as (message: string) => void)(message),
    contextLost: () =>
      elements.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true })),
    /** The page moves to a screen of another pixel ratio: no resize, only the media query. */
    moveToRatio: (next: number) => {
      const was = `(resolution: ${context.devicePixelRatio}dppx)`;
      context.devicePixelRatio = next;
      for (const query of mediaQueries)
        if (query.media === was) query.target.dispatchEvent(new Event("change"));
    },
    /** The window resizes, or browser zoom changes the CSS size and the ratio together. */
    resize: (w: number, h: number, nextRatio = context.devicePixelRatio) => {
      Object.assign(context, { innerWidth: w, innerHeight: h, devicePixelRatio: nextRatio });
      windowTarget.dispatchEvent(new Event("resize"));
    },
  };
}

async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((done) => setImmediate(done));
}

/** The failure text arrives a moment after the overlay shows; this waits it out. */
async function failureText(page: ReturnType<typeof boot>) {
  await page.advance(100);
  return page.status.textContent;
}

/** Bytes that gzip cannot shrink much, so the packed copy is about as long. */
function packageBytes(length: number) {
  const bytes = new Uint8Array(length);
  let seed = 7;
  for (let i = 0; i < length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    bytes[i] = (seed >> 16) & 0xff;
  }
  return bytes;
}

/** Asks for the package the way game.js's patched loader does. */
async function fetchPackage(page: ReturnType<typeof boot>) {
  let received: Uint8Array | undefined;
  page.module.fetchPackage("/love/game.data?v=1", (bytes) => {
    received = new Uint8Array(bytes);
  });
  // Unpacking runs on zlib's thread pool, outside the microtask queue.
  for (let i = 0; i < 50 && !received && !page.body.classList.contains("failed"); i++)
    await new Promise((done) => setTimeout(done, 5));
  await settle();
  return received;
}

describe("host.js capability check (BT4)", () => {
  it("fails before any download without WebAssembly, and starts nothing on load", async () => {
    const page = boot({ webAssembly: false });
    expect(page.body.classList.contains("failed")).toBe(true);
    expect(await failureText(page)).toBe(UNSUPPORTED);
    page.load();
    await settle();
    expect(page.fetches).toEqual([]);
    expect(page.loveCalls).toEqual([]);
  });

  it("fails without WebGL, cancelling the runtime download and starting nothing else", async () => {
    const page = boot({ webgl: false });
    expect(await failureText(page)).toBe(UNSUPPORTED);
    expect(page.probes).toEqual(["webgl2", "webgl"]);
    // The runtime's request went out before the probe and is cancelled; nothing else starts.
    expect(page.fetches).toEqual(["/love/love.wasm"]);
    expect(page.aborted).toEqual(["/love/love.wasm"]);
    page.load();
    await settle();
    expect(page.fetches).toEqual(["/love/love.wasm"]);
    expect(page.loveCalls).toEqual([]);
  });

  it("probes WebGL on a throwaway canvas, releases it, then downloads the runtime", async () => {
    const page = boot();
    await settle();
    expect(page.probes).toEqual(["webgl2"]);
    expect(page.lostContexts).toEqual(["webgl2"]);
    expect(page.fetches).toEqual(["/love/love.wasm"]);
    expect(page.body.classList.contains("failed")).toBe(false);
  });

  it("turns SDL's OpenGL error line before ready into the same failure", async () => {
    const page = boot();
    page.module.printErr("Unable to create OpenGL window: EGL_BAD_CONFIG");
    expect(await failureText(page)).toBe(UNSUPPORTED);
  });

  it("routes window.alert into the failure until ready, and leaves it native after", async () => {
    const early = boot();
    early.alert("Unable to create OpenGL window\n\nEGL_BAD_CONFIG");
    expect(early.nativeAlerts).toEqual([]);
    expect(await failureText(early)).toBe(UNSUPPORTED);
    const running = boot();
    running.ready();
    running.alert("after ready");
    expect(running.nativeAlerts).toEqual(["after ready"]);
    expect(running.body.classList.contains("failed")).toBe(false);
  });
});

describe("host.js boot bar (BT2, BT3)", () => {
  it("counts love.wasm bytes into the bar while they stream to the compiler", async () => {
    const page = boot();
    // love.wasm weighs 600 of 1000 expected transfer bytes, inside the 90% the downloads fill.
    await page.send("/love/love.wasm", 500);
    expect(page["loading-progress"].getAttribute("aria-valuenow")).toBe("27");
    expect(page["loading-fill"].style.width).toBe("27%");
    await page.send("/love/love.wasm", 500);
    expect(page["loading-progress"].getAttribute("aria-valuenow")).toBe("54");
    await page.finish("/love/love.wasm");
    expect(page.compiled).toEqual(["streaming"]);
  });

  it("re-arms the stall watch with every chunk, so a slow download is never called stalled", async () => {
    const page = boot();
    for (let i = 0; i < 3; i++) {
      await page.advance(44000);
      await page.send("/love/love.wasm", 50);
    }
    expect(page.body.classList.contains("stalled")).toBe(false);
    await page.advance(45000);
    expect(page.body.classList.contains("stalled")).toBe(true);
  });

  it("tells the live region milestones only, never byte counts", async () => {
    const page = boot();
    expect((page.module as unknown as Record<string, unknown>).setStatus).toBeUndefined();
    const texts: string[] = [];
    for (let i = 0; i < 20; i++) {
      await page.send("/love/love.wasm", 50);
      if (texts.at(-1) !== page.status.textContent) texts.push(page.status.textContent);
    }
    await page.finish("/love/love.wasm");
    const packed = gzipSync(packageBytes(400));
    page.responses.set("/love/game.data.gz", () => new Response(packed));
    await fetchPackage(page);
    texts.push(page.status.textContent);
    expect(texts).toEqual([
      "Loading the menu…",
      "Loading the menu… 25%",
      "Loading the menu… 50%",
      "Starting…",
    ]);
  });

  it("writes aria-valuenow only when the whole percent changes", async () => {
    const page = boot();
    for (let i = 0; i < 100; i++) await page.send("/love/love.wasm", 10);
    const values = page["loading-progress"].attributeWrites
      .filter(([name]) => name === "aria-valuenow")
      .map(([, value]) => value);
    expect(values.length).toBe(54);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("host.js game package (BT1)", () => {
  it("downloads the gzip copy and hands love.js the unpacked bytes", async () => {
    const page = boot();
    const raw = packageBytes(800);
    page.responses.set("/love/game.data.gz", () => new Response(gzipSync(raw)));
    expect(await fetchPackage(page)).toEqual(raw);
    expect(page.fetches).toEqual(["/love/love.wasm", "/love/game.data.gz"]);
  });

  it("takes a body the server labelled gzip as already decoded", async () => {
    const page = boot();
    const raw = packageBytes(800);
    page.responses.set(
      "/love/game.data.gz",
      () => new Response(raw, { headers: { "Content-Encoding": "gzip" } }),
    );
    expect(await fetchPackage(page)).toEqual(raw);
  });

  it("falls back to the plain package without DecompressionStream", async () => {
    const page = boot({ decompression: false });
    const raw = packageBytes(800);
    page.responses.set("/love/game.data", () => new Response(raw));
    expect(await fetchPackage(page)).toEqual(raw);
    expect(page.fetches).toEqual(["/love/love.wasm", "/love/game.data?v=1"]);
  });

  it("falls back to the plain package when the gzip copy will not download", async () => {
    const page = boot();
    const raw = packageBytes(800);
    page.responses.set("/love/game.data.gz", () => new Response("", { status: 404 }));
    page.responses.set("/love/game.data", () => new Response(raw));
    expect(await fetchPackage(page)).toEqual(raw);
  });

  it("starts no plain download when the gzip copy fails because the page is being left", async () => {
    const page = boot();
    page.responses.set("/love/game.data.gz", () => {
      page.leave();
      throw new TypeError("NetworkError when attempting to fetch resource.");
    });
    expect(await fetchPackage(page)).toBeUndefined();
    expect(page.fetches).toEqual(["/love/love.wasm", "/love/game.data.gz"]);
    expect(page.body.classList.contains("failed")).toBe(false);
    expect(page.errors).toEqual([]);
  });

  it("fails the page when neither copy downloads", async () => {
    const page = boot();
    page.responses.set("/love/game.data.gz", () => new Response("", { status: 503 }));
    page.responses.set("/love/game.data", () => new Response("", { status: 503 }));
    expect(await fetchPackage(page)).toBeUndefined();
    expect(await failureText(page)).toBe("Could not download the menu. Reload to try again.");
  });
});

describe("host.js stall and failure overlay (BR1)", () => {
  it("shows Reload on a stall without taking focus, and takes it down on progress", async () => {
    const page = boot();
    page.canvas.focus();
    await page.advance(45000);
    expect(page.body.classList.contains("stalled")).toBe(true);
    expect(page.status.textContent).toBe("Still loading… Keep waiting, or reload to try again.");
    expect(page.reloadButton.hidden).toBe(false);
    expect(page.page.activeElement).toBe(page.canvas);
    expect(page.degraded).toEqual(["stalled"]);
    await page.send("/love/love.wasm", 100);
    expect(page.body.classList.contains("stalled")).toBe(false);
    expect(page.reloadButton.hidden).toBe(true);
    expect(page.status.textContent).toBe("Loading the menu…");
    expect(page.degraded).toEqual(["stalled", "recovered"]);
  });

  it("focuses Reload on a failure and writes the text once the overlay is back", async () => {
    const page = boot();
    page.canvas.focus();
    page.module.print("Error: main.lua:1: boom");
    expect(page.body.classList.contains("failed")).toBe(true);
    expect(page.loading.style.display).toBe("flex");
    expect(page.status.textContent).toBe("");
    expect(page.status.getAttribute("aria-live")).toBe("assertive");
    expect(page.reloadButton.hidden).toBe(false);
    expect(page.page.activeElement).toBe(page.reloadButton);
    expect(page.degraded).toEqual(["failed"]);
    expect(await failureText(page)).toBe("The menu could not start. Reload to try again.");
    // What breaks after the first failure does not replace its message.
    page.contextLost();
    expect(await failureText(page)).toBe("The menu could not start. Reload to try again.");
    expect(page.degraded).toEqual(["failed"]);
  });

  it("tells a bridge that connects after the failure", () => {
    const page = boot({ webAssembly: false });
    expect(page.degraded).toEqual(["failed"]);
    expect(page.connectLate()).toEqual(["failed"]);
  });

  it("empties the package cache before a reload after a boot failure", async () => {
    const page = boot();
    page.module.print("Error: main.lua:1: boom");
    page.reloadButton.dispatchEvent(new Event("click"));
    expect(page.deletedDatabases).toEqual(["EM_PRELOAD_CACHE"]);
    expect(page.reloads).toEqual([]);
    page.deletions[0]?.onblocked?.();
    expect(page.reloads).toEqual(["reload"]);
    // A delete that never answers still reloads, once.
    await page.advance(1000);
    expect(page.reloads).toEqual(["reload"]);
    const unanswered = boot();
    unanswered.module.print("Error: main.lua:1: boom");
    unanswered.reloadButton.dispatchEvent(new Event("click"));
    await unanswered.advance(1000);
    expect(unanswered.reloads).toEqual(["reload"]);
  });

  it("reloads at once after a crash once ready, and while stalled", async () => {
    const crashed = boot();
    crashed.ready();
    crashed.module.print("Error: main.lua:1: boom");
    expect(await failureText(crashed)).toMatch(/^Something went wrong\. Reload to continue/);
    crashed.reloadButton.dispatchEvent(new Event("click"));
    expect(crashed.reloads).toEqual(["reload"]);
    expect(crashed.deletedDatabases).toEqual([]);
    const stalled = boot();
    await stalled.advance(45000);
    stalled.reloadButton.dispatchEvent(new Event("click"));
    expect(stalled.reloads).toEqual(["reload"]);
    expect(stalled.deletedDatabases).toEqual([]);
  });

  it("reloads once when a tab whose context was lost in the background is shown", async () => {
    const page = boot();
    page.ready();
    page.page.hidden = true;
    page.contextLost();
    expect(await failureText(page)).toBe("Graphics connection lost. Reload to continue.");
    expect(page.reloads).toEqual([]);
    page.visibility(false);
    expect(page.reloads).toEqual(["reload"]);
    page.visibility(true);
    page.visibility(false);
    expect(page.reloads).toEqual(["reload"]);

    const again = boot();
    again.storage.set("colorless.host.contextReload", String(Date.now()));
    again.page.hidden = true;
    again.contextLost();
    again.visibility(false);
    expect(again.reloads).toEqual([]);

    const shown = boot();
    shown.contextLost();
    shown.visibility(false);
    expect(shown.reloads).toEqual([]);
  });
});

describe("host.js keys (BT5, LC3)", () => {
  const SHORTCUTS: [string, Record<string, unknown>][] = [
    ["F5", { key: "F5" }],
    ["F6", { key: "F6" }],
    ["F11", { key: "F11" }],
    ["F12", { key: "F12" }],
    ["Ctrl+R", { key: "r", ctrlKey: true }],
    ["Cmd+R", { key: "r", metaKey: true }],
    ["Ctrl+Shift+R", { key: "R", ctrlKey: true, shiftKey: true }],
    ["Ctrl+=", { key: "=", ctrlKey: true }],
    ["Ctrl++", { key: "+", ctrlKey: true, shiftKey: true }],
    ["Ctrl+-", { key: "-", ctrlKey: true }],
    ["Cmd+0", { key: "0", metaKey: true }],
    ["Alt+Left", { key: "ArrowLeft", altKey: true }],
    ["Alt+Right", { key: "ArrowRight", altKey: true }],
    ["Ctrl+L", { key: "l", ctrlKey: true }],
    ["Ctrl+F", { key: "f", ctrlKey: true }],
  ];
  it.each(SHORTCUTS)("keeps %s from SDL without preventing it", (_, init) => {
    const page = boot();
    page.ready();
    page.canvas.focus();
    for (const type of ["keydown", "keyup", "keypress"])
      expect(page.key(type, init)).toEqual({ reachedSdl: false, prevented: false });
  });

  it("leaves Lua's own keys to SDL while the running menu has focus", () => {
    const page = boot();
    page.ready();
    page.canvas.focus();
    for (const init of [
      { key: "ArrowRight" },
      { key: "Enter" },
      { key: "m" },
      { key: "Escape" },
      { key: "Tab" },
      { key: "Tab", shiftKey: true },
      { key: "ArrowLeft", shiftKey: true },
    ])
      expect(page.key("keydown", init).reachedSdl).toBe(true);
  });

  it("keeps Ctrl+wheel (zoom) from SDL's canvas listener, and plain wheel not", () => {
    const page = boot();
    page.ready();
    expect(page.key("wheel", { ctrlKey: true }).reachedSdl).toBe(false);
    expect(page.key("wheel", {}).reachedSdl).toBe(true);
  });

  it("lets Tab move natively off the canvas, before ready and after a failure", async () => {
    const page = boot();
    page.canvas.focus();
    expect(page.key("keydown", { key: "Tab" })).toEqual({ reachedSdl: false, prevented: false });
    page.ready();
    expect(page.key("keydown", { key: "Tab" }).reachedSdl).toBe(true);
    const link = new FakeElement(page.page, "A");
    link.focus();
    expect(page.key("keydown", { key: "Tab" }).reachedSdl).toBe(false);
    expect(page.key("keydown", { key: "Tab", shiftKey: true }).reachedSdl).toBe(false);
    expect(page.key("keydown", { key: "ArrowRight" }).reachedSdl).toBe(true);
    page.module.print("Error: main.lua:1: boom");
    expect(page.page.activeElement).toBe(page.reloadButton);
    for (const key of ["Tab", "Enter", " "])
      expect(page.key("keydown", { key })).toEqual({ reachedSdl: false, prevented: false });
    page.canvas.focus();
    expect(page.key("keydown", { key: "Tab" }).reachedSdl).toBe(false);
  });

  it("leaves a focused text proxy's keys, Tab and shortcuts too, to the proxy's own listener", () => {
    const page = boot();
    page.ready();
    for (const proxy of [
      new FakeInput(page.page, "INPUT"),
      new FakeTextArea(page.page, "TEXTAREA"),
    ]) {
      proxy.focus();
      for (const init of [
        { key: "Tab" },
        { key: "Tab", shiftKey: true },
        { key: "ArrowLeft", altKey: true },
        { key: "F6" },
      ])
        expect(page.key("keydown", init).reachedSdl).toBe(true);
      // Ctrl+R was kept from every listener before; it still is.
      expect(page.key("keydown", { key: "r", ctrlKey: true }).reachedSdl).toBe(false);
    }
  });
});

describe("host.js menu music (BT8)", () => {
  const musicFetches = (page: ReturnType<typeof boot>) =>
    page.fetches.filter((url) => url.startsWith("/love/music1.ogg"));

  it("downloads the music after ready once Lua asks, and writes it where Lua looks", async () => {
    const page = boot();
    page.start();
    page.module.print("COLORLESS:music:want\tstart");
    await settle();
    expect(musicFetches(page)).toEqual([]);
    page.ready();
    await page.send("/love/music1.ogg", 5);
    await page.finish("/love/music1.ogg");
    expect(musicFetches(page)).toHaveLength(1);
    expect(page.written.get("/assets/sounds/music1.ogg")).toHaveLength(5);
  });

  it("downloads nothing for a player Lua does not ask for (muted, or the volume at zero)", async () => {
    const page = boot();
    page.start();
    page.ready();
    await settle();
    expect(musicFetches(page)).toEqual([]);
  });

  it("downloads at once on an ask after ready, and only once however often Lua asks", async () => {
    const page = boot();
    page.start();
    page.ready();
    page.module.print("COLORLESS:music:want\tchange");
    page.module.print("COLORLESS:music:want\tchange");
    await settle();
    expect(musicFetches(page)).toHaveLength(1);
    await page.finish("/love/music1.ogg");
    page.module.print("COLORLESS:music:want\tchange");
    await settle();
    expect(musicFetches(page)).toHaveLength(1);
  });

  it("skips the start ask under Save-Data, and downloads when the player turns the music on", async () => {
    const page = boot({ saveData: true });
    page.start();
    page.module.print("COLORLESS:music:want\tstart");
    page.ready();
    await settle();
    expect(musicFetches(page)).toEqual([]);
    page.module.print("COLORLESS:music:want\tchange");
    await settle();
    expect(musicFetches(page)).toHaveLength(1);
  });

  it("downloads the start ask with a connection that does not save data", async () => {
    const page = boot({ saveData: false });
    page.start();
    page.module.print("COLORLESS:music:want\tstart");
    page.ready();
    await settle();
    expect(musicFetches(page)).toHaveLength(1);
  });

  it("asks again after a download that failed", async () => {
    const page = boot();
    page.responses.set("/love/music1.ogg", () => new Response(null, { status: 503 }));
    page.start();
    page.ready();
    page.module.print("COLORLESS:music:want\tchange");
    await settle();
    page.module.print("COLORLESS:music:want\tchange");
    await settle();
    expect(musicFetches(page)).toHaveLength(2);
    expect(page.written.has("/assets/sounds/music1.ogg")).toBe(false);
  });
});

describe("host.js card art", () => {
  const cards = (from: number, to: number) =>
    Array.from({ length: to - from }, (_, i) => ({ id: `c${from + i}`, url: `/art/c${from + i}` }));
  const staged = (page: ReturnType<typeof boot>) =>
    [...page.written.keys()].filter((path) => path.startsWith("/__card_art_"));

  it("keeps as many cards as the bridge's artSlots, and evicts one for the next", async () => {
    const slots = 5;
    const page = boot();
    page.start();
    // Each card is in the store once; an evicted one Lua still wants goes to the network, which
    // never answers here, so a list over the host's limit stalls rather than reloading forever.
    const stored = new Set<string>();
    page.host.connect({
      onDegraded() {},
      onPrint() {},
      mailboxes: { ...MAILBOXES, art: "__art.txt" },
      artSlots: slots,
      artwork: {
        get: async (id) => {
          if (stored.has(id)) return null;
          stored.add(id);
          return new Blob([new Uint8Array(3)]);
        },
      },
    });
    page.host.wantArt(cards(0, slots));
    for (let i = 0; i < slots; i++) await settle();
    expect(staged(page)).toHaveLength(slots);
    const before = staged(page);
    page.host.wantArt(cards(slots, slots + 1));
    for (let i = 0; i < 4; i++) await settle();
    expect(staged(page)).toHaveLength(slots);
    expect(before.filter((path) => !page.written.has(path))).toHaveLength(1);
  });
});

describe("host.js transition scans (BT9)", () => {
  const cardFetches = (page: ReturnType<typeof boot>) =>
    page.fetches.filter((url) => url.startsWith("/love/transition_cards/"));

  it("downloads each versioned scan after ready into the folder Lua's fallback reads", async () => {
    const page = boot({ versions: CARD_VERSIONS });
    page.start();
    await settle();
    expect(cardFetches(page)).toEqual([]);
    page.ready();
    await settle();
    expect(cardFetches(page).sort()).toEqual([
      "/love/transition_cards/sv01-030.png?v=aaa111",
      "/love/transition_cards/sv01-033.png?v=bbb222",
    ]);
    expect(page.folders).toEqual(["/assets/transition_cards"]);
    await page.send("/love/transition_cards/sv01-033.png", 7);
    await page.finish("/love/transition_cards/sv01-033.png");
    expect(page.written.get("/assets/transition_cards/sv01-033.png")).toHaveLength(7);
    expect(page.written.has("/assets/transition_cards/sv01-030.png")).toBe(false);
    await page.finish("/love/transition_cards/sv01-030.png");
    expect(page.written.has("/assets/transition_cards/sv01-030.png")).toBe(true);
  });

  it("keeps the scans that arrive when one fails", async () => {
    const page = boot({ versions: CARD_VERSIONS });
    page.responses.set(
      "/love/transition_cards/sv01-030.png",
      () => new Response(null, { status: 404 }),
    );
    page.start();
    page.ready();
    await page.finish("/love/transition_cards/sv01-033.png");
    expect([...page.written.keys()].filter((path) => path.includes("transition_cards"))).toEqual([
      "/assets/transition_cards/sv01-033.png",
    ]);
    expect(page.body.classList.contains("failed")).toBe(false);
  });

  it("downloads the scans under Save-Data too, and whether or not Lua asks for music", async () => {
    const page = boot({ versions: CARD_VERSIONS, saveData: true });
    page.start();
    page.ready();
    await settle();
    expect(cardFetches(page)).toHaveLength(2);
    expect(page.fetches.some((url) => url.startsWith("/love/music1.ogg"))).toBe(false);
  });
});

describe("host.js viewport (BT6)", () => {
  const viewport = (page: ReturnType<typeof boot>) => page.written.get(`/${MAILBOXES.viewport}`);

  it("sends the CSS size, reduced motion and the device-pixel size at the full ratio", () => {
    const page = boot({ ratio: 3, width: 390, height: 844 });
    page.start();
    expect(viewport(page)).toBe("390 844 0 1170 2532 0");
  });

  it("sends one device pixel per CSS pixel at ratio 1, and rounds a fractional ratio", () => {
    const flat = boot();
    flat.start();
    expect(viewport(flat)).toBe("1280 800 0 1280 800 0");
    const scaled = boot({ ratio: 1.25, width: 1366, height: 768 });
    scaled.start();
    expect(viewport(scaled)).toBe("1366 768 0 1708 960 0");
  });

  it("re-sends at once when the page moves to a screen of another ratio, with no resize", () => {
    const page = boot();
    page.start();
    page.moveToRatio(2);
    expect(viewport(page)).toBe("1280 800 0 2560 1600 0");
    page.moveToRatio(1.5);
    expect(viewport(page)).toBe("1280 800 0 1920 1200 0");
    page.moveToRatio(1);
    expect(viewport(page)).toBe("1280 800 0 1280 800 0");
  });

  it("ends with 1 when the primary pointer is coarse, a phone or tablet (LC4)", () => {
    const page = boot({ ratio: 3, width: 844, height: 390, coarse: true });
    page.start();
    expect(viewport(page)).toBe("844 390 0 2532 1170 1");
  });

  it("re-sends after a resize, browser zoom's new ratio included", async () => {
    const page = boot();
    page.start();
    page.resize(640, 400, 2);
    await page.advance(100);
    expect(viewport(page)).toBe("640 400 0 1280 800 0");
  });
});

describe("host page viewport (BT7)", () => {
  it("keeps the canvas inside the safe area: the viewport has no viewport-fit=cover", () => {
    const page = readFileSync(repoPath("index.html"), "utf8");
    const content = page.match(/<meta name="viewport" content="([^"]*)">/)?.[1];
    const directives = Object.fromEntries(
      (content ?? "").split(",").map((part) => part.split("=").map((side) => side.trim())),
    );
    expect(directives).toEqual({ width: "device-width", "initial-scale": "1" });
  });
});

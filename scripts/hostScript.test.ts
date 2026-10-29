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
}

/** One boot of host.js over a fresh fake page. */
function boot({ webAssembly = true, webgl = true, decompression = true }: Options = {}) {
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
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    performance: { mark() {}, measure() {} },
    innerWidth: 1280,
    innerHeight: 800,
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
  runInContext(SOURCE, context);

  const host = context.colorlessHost as {
    connect(bridge: { onFailed(): void; onPrint(): void }): void;
  };
  host.connect({ onFailed() {}, onPrint() {} });
  const module = context.Module as {
    print(message: string): void;
    printErr(message: string): void;
    fetchPackage(url: string, receive: (bytes: ArrayBuffer) => void): void;
  };

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

  return {
    ...elements,
    body: document.body,
    page,
    module,
    host,
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
    visibility: (hidden: boolean) => {
      page.hidden = hidden;
      documentTarget.dispatchEvent(new Event("visibilitychange"));
    },
    ready: () => {
      context.Love = undefined;
      module.print("COLORLESS:ready");
    },
    /** window.alert as SDL calls it, whatever host.js put there. */
    alert: (message: string) => (context.alert as (message: string) => void)(message),
    contextLost: () =>
      elements.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true })),
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

  it("fails the page when neither copy downloads", async () => {
    const page = boot();
    page.responses.set("/love/game.data.gz", () => new Response("", { status: 503 }));
    page.responses.set("/love/game.data", () => new Response("", { status: 503 }));
    expect(await fetchPackage(page)).toBeUndefined();
    expect(await failureText(page)).toBe("Could not download the menu. Reload to try again.");
  });
});

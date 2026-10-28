// The two browsers scripts/e2e.ts drives, behind one small interface: headless Chromium over the
// DevTools protocol, and Firefox over WebDriver BiDi (Firefox dropped its CDP). Headless Firefox
// makes no WebGL context, so it can run on an X display instead (scripts/e2e.ts gives it an Xvfb).
// Each page is a tab with its own cookie jar unless it is opened beside another; Firefox puts each
// in its own window, as a background tab there gets no animation frames and love.js would stop.

import type { ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Page = {
  name: string;
  /** Console errors and uncaught exceptions, as text. */
  consoleErrors: string[];
  consoleLines: string[];
};

export type PageOptions = {
  /** Appended to the user agent, so the site server can tell this page's requests apart. */
  userAgentMark?: string;
  /** Opens the page in `beside`'s cookie jar instead of a fresh one. */
  beside?: Page;
};

export interface Browser {
  /** "Chromium 154.0.8037.57" and the like. */
  readonly version: string;
  /** Opens a tab on about:blank whose every document runs `hook` first. */
  newPage(name: string, options?: PageOptions): Promise<Page>;
  /** Starts a navigation and returns once the new document replaced the old one. */
  navigate(page: Page, url: string): Promise<void>;
  /** The value of `expression`, awaited, as JSON carries it; a thrown error rejects. */
  evaluate<T>(page: Page, expression: string): Promise<T>;
  /** Presses and releases a key in the focused element. */
  key(page: Page, key: "ArrowRight"): Promise<void>;
  /** Closes the tab as a user would, skipping any beforeunload prompt. */
  closePage(page: Page): Promise<void>;
  /** Ends the session; the process itself is the caller's to stop. */
  close(): void;
}

export type Launch = {
  binary: string;
  /** A fresh directory for the browser's profile. */
  profile: string;
  /** A free port for the remote protocol. */
  port: number;
  /** Starts the browser process, owned by the caller. */
  start: (command: string, args: string[]) => ChildProcess;
  /** Firefox only: false runs it on the X display that `start` puts in its environment. */
  headless?: boolean;
  /** Script source that runs in every page before its own scripts. */
  hook: string;
  log: (line: string) => void;
};

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

type Message = {
  id?: number;
  method?: string;
  sessionId?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: unknown;
  message?: string;
  type?: string;
};

/** A JSON-RPC style socket: `call` sends a command and resolves with its result. */
async function rpc(url: string, log: (line: string) => void) {
  const socket = new WebSocket(url);
  await new Promise((done, reject) => {
    socket.addEventListener("open", done);
    socket.addEventListener("error", reject);
  });
  let serial = 0;
  const pending = new Map<
    number,
    { ok: (v: Record<string, unknown>) => void; no: (e: Error) => void }
  >();
  const listeners: ((message: Message) => void)[] = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as Message;
    if (message.id === undefined) {
      for (const listener of listeners) listener(message);
      return;
    }
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error)
      waiter?.no(new Error(`${JSON.stringify(message.error)} ${message.message ?? ""}`));
    else waiter?.ok(message.result ?? {});
  });
  const call = (method: string, params: object = {}, sessionId?: string) => {
    const sent = Date.now();
    return new Promise<Record<string, unknown>>((ok, no) => {
      const id = ++serial;
      pending.set(id, { ok, no });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    }).finally(() => {
      if (Date.now() - sent > 5000) log(`slow ${method}: ${Date.now() - sent} ms`);
    });
  };
  return { call, listeners, close: () => socket.close() };
}

// ---------- Chromium, over the DevTools protocol ----------

export async function launchChromium(launch: Launch): Promise<Browser> {
  launch.start(launch.binary, [
    "--headless=new",
    `--remote-debugging-port=${launch.port}`,
    `--user-data-dir=${launch.profile}`,
    "--no-first-run",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--autoplay-policy=no-user-gesture-required",
    "--window-size=1280,800",
    // Two love.js pages share the CPU; a page in the background must not be throttled.
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "about:blank",
  ]);
  let url = "";
  let product = "";
  for (let attempt = 0; attempt < 100 && !url; attempt++) {
    await sleep(100);
    try {
      const version = (await (
        await fetch(`http://127.0.0.1:${launch.port}/json/version`)
      ).json()) as { webSocketDebuggerUrl: string; Browser: string };
      url = version.webSocketDebuggerUrl;
      product = version.Browser;
    } catch {}
  }
  if (!url) throw new Error(`Chromium (${launch.binary}) did not open a debugging port`);
  const { call, listeners, close } = await rpc(url, launch.log);
  const sessions = new Map<Page, { session: string; target: string }>();
  const contexts = new Map<Page, string>();
  const of = (page: Page) => {
    const found = sessions.get(page);
    if (!found) throw new Error(`${page.name} is closed`);
    return found;
  };

  return {
    version: product.replace(/^(Headless)?Chrome\//, "Chromium "),
    async newPage(name, options = {}) {
      const browserContextId =
        (options.beside && contexts.get(options.beside)) ??
        String(
          (await call("Target.createBrowserContext", { disposeOnDetach: true })).browserContextId,
        );
      const { targetId } = await call("Target.createTarget", {
        url: "about:blank",
        browserContextId,
      });
      const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
      const session = String(sessionId);
      const page: Page = { name, consoleErrors: [], consoleLines: [] };
      sessions.set(page, { session, target: String(targetId) });
      contexts.set(page, browserContextId);
      listeners.push((message) => {
        if (message.sessionId !== session) return;
        const params = message.params ?? {};
        if (message.method === "Runtime.consoleAPICalled") {
          const args = (params.args ?? []) as { value?: unknown; description?: string }[];
          const text = args.map((arg) => String(arg.value ?? arg.description)).join(" ");
          page.consoleLines.push(text);
          if (params.type === "error") page.consoleErrors.push(text);
        }
        if (message.method === "Runtime.exceptionThrown")
          page.consoleErrors.push(`exception ${JSON.stringify(params.exceptionDetails)}`);
      });
      await call("Runtime.enable", {}, session);
      await call("Page.enable", {}, session);
      if (options.userAgentMark) {
        const { userAgent } = await call("Browser.getVersion");
        await call(
          "Network.setUserAgentOverride",
          { userAgent: `${userAgent} ${options.userAgentMark}` },
          session,
        );
      }
      await call(
        "Emulation.setDeviceMetricsOverride",
        { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false },
        session,
      );
      await call("Page.addScriptToEvaluateOnNewDocument", { source: launch.hook }, session);
      await call("Emulation.setFocusEmulationEnabled", { enabled: true }, session);
      return page;
    },
    async navigate(page, url) {
      await call("Page.navigate", { url }, of(page).session);
    },
    async evaluate<T>(page: Page, expression: string) {
      const reply = (await call(
        "Runtime.evaluate",
        { expression, awaitPromise: true, returnByValue: true },
        of(page).session,
      )) as {
        result?: { value?: T };
        exceptionDetails?: { text?: string; exception?: { description?: string } };
      };
      if (reply.exceptionDetails) {
        const detail = reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text;
        throw new Error(`${page.name}: ${detail}`);
      }
      return reply.result?.value as T;
    },
    async key(page, key) {
      const codes = { ArrowRight: 39 };
      for (const type of ["keyDown", "keyUp"])
        await call(
          "Input.dispatchKeyEvent",
          { type, key, code: key, windowsVirtualKeyCode: codes[key] },
          of(page).session,
        );
    },
    async closePage(page) {
      await call("Target.closeTarget", { targetId: of(page).target });
      sessions.delete(page);
    },
    close,
  };
}

// ---------- Firefox, over WebDriver BiDi ----------

/** Profile preferences: no first-run pages, no telemetry, sound may start without a gesture. */
const FIREFOX_PREFS: Record<string, string | number | boolean> = {
  "browser.shell.checkDefaultBrowser": false,
  "browser.startup.homepage_override.mstone": "ignore",
  "browser.sessionstore.resume_from_crash": false,
  "datareporting.policy.dataSubmissionEnabled": false,
  "toolkit.telemetry.reportingpolicy.firstRun": false,
  "media.autoplay.default": 0,
  "media.autoplay.blocking_policy": 0,
  "webgl.force-enabled": true,
};

type RemoteValue = { type: string; value?: unknown };

export async function launchFirefox(launch: Launch): Promise<Browser> {
  mkdirSync(launch.profile, { recursive: true });
  writeFileSync(
    join(launch.profile, "user.js"),
    Object.entries(FIREFOX_PREFS)
      .map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`)
      .join("\n"),
  );
  launch.start(launch.binary, [
    ...(launch.headless === false ? [] : ["--headless"]),
    "--no-remote",
    `--remote-debugging-port=${launch.port}`,
    "--profile",
    launch.profile,
    "about:blank",
  ]);
  let bidi: Awaited<ReturnType<typeof rpc>> | undefined;
  for (let attempt = 0; attempt < 150 && !bidi; attempt++) {
    await sleep(100);
    bidi = await rpc(`ws://127.0.0.1:${launch.port}/session`, launch.log).catch(() => undefined);
  }
  if (!bidi) throw new Error(`Firefox (${launch.binary}) did not open a BiDi port`);
  const { call, listeners, close } = bidi;
  const session = await call("session.new", {
    capabilities: { alwaysMatch: { unhandledPromptBehavior: { beforeUnload: "accept" } } },
  });
  const capabilities = session.capabilities as { browserVersion: string; userAgent: string };
  const contextOf = new Map<Page, string>();
  const userContextOf = new Map<Page, string>();
  const pageOf = new Map<string, Page>();
  const of = (page: Page) => {
    const found = contextOf.get(page);
    if (!found) throw new Error(`${page.name} is closed`);
    return found;
  };
  await call("session.subscribe", { events: ["log.entryAdded"] });
  listeners.push((message) => {
    if (message.method !== "log.entryAdded") return;
    const params = message.params as {
      type: string;
      level: string;
      text: string | null;
      source: { context?: string };
      stackTrace?: unknown;
    };
    const page = params.source.context ? pageOf.get(params.source.context) : undefined;
    if (!page) return;
    const text = params.text ?? "";
    if (params.type === "console") page.consoleLines.push(text);
    if (params.type === "javascript") page.consoleErrors.push(`exception ${text}`);
    else if (params.level === "error") page.consoleErrors.push(text);
  });

  return {
    version: `Firefox ${capabilities.browserVersion}`,
    async newPage(name, options = {}) {
      const userContext =
        (options.beside && userContextOf.get(options.beside)) ??
        String((await call("browser.createUserContext")).userContext);
      const { context } = await call("browsingContext.create", { type: "window", userContext });
      const id = String(context);
      const page: Page = { name, consoleErrors: [], consoleLines: [] };
      contextOf.set(page, id);
      userContextOf.set(page, userContext);
      pageOf.set(id, page);
      if (options.userAgentMark)
        await call("emulation.setUserAgentOverride", {
          userAgent: `${capabilities.userAgent} ${options.userAgentMark}`,
          contexts: [id],
        });
      // On a display without a window manager the resize never settles, and the call never
      // returns; the window there fills the 1280x800 screen instead.
      if (launch.headless !== false)
        await call("browsingContext.setViewport", {
          context: id,
          viewport: { width: 1280, height: 800 },
        });
      await call("script.addPreloadScript", {
        functionDeclaration: `() => { ${launch.hook} }`,
        contexts: [id],
      });
      return page;
    },
    async navigate(page, url) {
      // "interactive" is the earliest wait after which an evaluation reaches the new document.
      await call("browsingContext.navigate", { context: of(page), url, wait: "interactive" });
    },
    async evaluate<T>(page: Page, expression: string) {
      // Values cross as JSON, which is what Chromium's returnByValue gives too.
      const reply = (await call("script.evaluate", {
        expression: `(async () => { const v = await (${expression}); return v === undefined ? undefined : JSON.stringify(v); })()`,
        target: { context: of(page) },
        awaitPromise: true,
        resultOwnership: "none",
      })) as {
        type: string;
        result?: RemoteValue;
        exceptionDetails?: { text?: string };
      };
      if (reply.type === "exception")
        throw new Error(`${page.name}: ${reply.exceptionDetails?.text}`);
      const value = reply.result;
      return (value?.type === "string" ? JSON.parse(String(value.value)) : undefined) as T;
    },
    async key(page, key) {
      const codes = { ArrowRight: "" };
      await call("input.performActions", {
        context: of(page),
        actions: [
          {
            type: "key",
            id: "keyboard",
            actions: [
              { type: "keyDown", value: codes[key] },
              { type: "keyUp", value: codes[key] },
            ],
          },
        ],
      });
    },
    async closePage(page) {
      const context = of(page);
      contextOf.delete(page);
      await call("browsingContext.close", { context, promptUnload: false });
    },
    close: () => {
      void call("browser.close").catch(() => {});
      setTimeout(close, 200);
    },
  };
}
